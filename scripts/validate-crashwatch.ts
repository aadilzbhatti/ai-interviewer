/**
 * The crash postmortem. The whole point of this machinery is to tell three
 * situations apart after the fact, so the tests are about that discrimination:
 * an exception, an orderly teardown, and a process that died mid-beat.
 *
 * Run with: npm run validate:crash
 */
import {
  WATCH_VERSION,
  diagnose,
  newRecord,
  parseRecord,
  pushBreadcrumb,
  reportPayload,
  summarize,
  worthReporting,
  type WatchRecord,
} from "../src/lib/crashModel";
import { guardStream, ndjsonSender } from "../src/lib/streamSafe";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const T0 = 1_700_000_000_000;
const S = 1000;

function live(): WatchRecord {
  return newRecord("boot-1", T0, { phase: "live", sessionId: "s1", questionId: "q1" }, 3000);
}

// ---- the three-way split ---------------------------------------------------
{
  check("no previous record reads as a first run", diagnose(null, T0).kind === "first-run");
}
{
  const r = live();
  r.at = T0 + 10 * S;
  r.crash = { kind: "exception", message: "x is not a function", at: T0 + 10 * S };
  const d = diagnose(r, T0 + 12 * S);
  check("a crash note reads as an exception", d.kind === "exception");
}
{
  const r = live();
  r.at = T0 + 10 * S;
  r.unload = { at: T0 + 10 * S, persisted: false };
  const d = diagnose(r, T0 + 40 * S);
  check("an unload note reads as orderly", d.kind === "orderly");
  check("and measures how long the page was away", d.kind === "orderly" && d.awayMs === 30 * S);
}
{
  // The case the whole thing exists for: heartbeat stops, nothing else.
  const r = live();
  r.at = T0 + 10 * S;
  r.hidden = false;
  const d = diagnose(r, T0 + 70 * 60 * S);
  check("a stopped heartbeat with no note reads as vanished", d.kind === "vanished");
  check(
    "and measures the silence",
    d.kind === "vanished" && d.silentMs === 70 * 60 * S - 10 * S,
    d.kind === "vanished" ? String(d.silentMs) : d.kind,
  );
  check("and remembers whether the tab was backgrounded", d.kind === "vanished" && !d.wasHidden);
}
{
  // A page can throw and THEN unload. The throw is the story.
  const r = live();
  r.crash = { kind: "render", message: "Cannot read properties of undefined", at: T0 + 5 * S };
  r.unload = { at: T0 + 6 * S, persisted: false };
  check("a crash outranks a later unload", diagnose(r, T0 + 9 * S).kind === "exception");
}

// ---- what is worth a line in the log ---------------------------------------
{
  check("a first run is not reported", !worthReporting(diagnose(null, T0)));
}
{
  const r = live();
  r.context.phase = "done";
  r.unload = { at: T0 + S, persisted: false };
  check("closing a finished interview is not reported", !worthReporting(diagnose(r, T0 + 2 * S)));
}
{
  const r = live();
  r.context.phase = "grading";
  r.unload = { at: T0 + S, persisted: false };
  check("but closing DURING grading is reported", worthReporting(diagnose(r, T0 + 2 * S)));
}
{
  const r = live();
  r.at = T0 + S;
  check("a vanish is always reported", worthReporting(diagnose(r, T0 + 99 * S)));
}

// ---- breadcrumbs -----------------------------------------------------------
{
  let list = pushBreadcrumb([], "first", T0);
  list = pushBreadcrumb(list, "second", T0 + S);
  check("breadcrumbs keep their order", list.map((b) => b.what).join(",") === "first,second");

  let big = list;
  for (let i = 0; i < 100; i++) big = pushBreadcrumb(big, `crumb-${i}`, T0 + i, 40);
  check("breadcrumbs are capped", big.length === 40, String(big.length));
  check(
    "and the cap drops the OLDEST, not the newest",
    big[big.length - 1].what === "crumb-99" && big[0].what === "crumb-60",
    `${big[0].what}..${big[big.length - 1].what}`,
  );
}

// ---- surviving a round trip through localStorage ---------------------------
{
  const r = live();
  r.breadcrumbs = pushBreadcrumb(r.breadcrumbs, "ran tests — 12/12", T0 + S);
  r.heapMb = 812;
  r.heapLimitMb = 4096;
  const back = parseRecord(JSON.stringify(r));
  check("a record survives serialization", !!back);
  check("with its context", back?.context.phase === "live" && back?.context.sessionId === "s1");
  check("its breadcrumbs", back?.breadcrumbs.length === 1);
  check("and its heap sample", back?.heapMb === 812 && back?.heapLimitMb === 4096);
}
{
  check("garbage parses to nothing", parseRecord("{not json") === null);
  check("an empty slot parses to nothing", parseRecord(null) === null);
  check("a non-object parses to nothing", parseRecord("42") === null);
  check(
    "a record from an older version is discarded rather than guessed at",
    parseRecord(JSON.stringify({ ...live(), v: WATCH_VERSION - 1 })) === null,
  );
  check(
    "a half-written record with no timestamp is discarded",
    parseRecord(JSON.stringify({ v: WATCH_VERSION, bootId: "x" })) === null,
  );
  check(
    "but a record missing only its breadcrumbs still reads",
    parseRecord(JSON.stringify({ v: WATCH_VERSION, bootId: "x", at: T0 }))?.breadcrumbs.length === 0,
  );
}

// ---- the report itself -----------------------------------------------------
{
  const r = live();
  r.at = T0 + 600 * S;
  r.hidden = true;
  r.heapMb = 3900;
  r.heapLimitMb = 4096;
  r.breadcrumbs = pushBreadcrumb(r.breadcrumbs, "ran tests — 12/12", T0 + 120 * S);
  const d = diagnose(r, T0 + 4200 * S);
  const payload = reportPayload(d, T0 + 4200 * S) as Record<string, unknown>;

  check("the report names the phase that died", payload.phase === "live");
  check("carries the heap pressure", String(payload.heapPressure).startsWith("95%"), String(payload.heapPressure));
  check(
    "renders breadcrumbs relative to the page life",
    Array.isArray(payload.breadcrumbs) && (payload.breadcrumbs as string[])[0] === "+120s ran tests — 12/12",
    JSON.stringify(payload.breadcrumbs),
  );
  const text = summarize(d);
  check("and the summary says the tab was backgrounded", text.includes("background"), text);
  check("and does not claim to know the error", !text.includes("undefined"), text);
}
{
  const r = live();
  r.crash = { kind: "rejection", message: "Failed to fetch", at: T0 + S };
  const text = summarize(diagnose(r, T0 + 2 * S));
  check("a rejection is described as one", text.includes("promise rejection"), text);
}

// ---- not losing the log when the client walks away ------------------------
/**
 * Same theme as the rest of this file: a thing dies, and the question is
 * whether it left a record. When the browser disconnects, the runtime cancels
 * the stream and the controller is dead — measured directly, both `enqueue`
 * and `close` then throw `TypeError: Invalid state: Controller is already
 * closed`. Unguarded, that threw out of the route's `finally` BEFORE its
 * logDebug call, so an interrupted request left no trace of having happened.
 */
{
  /** Stands in for a controller the runtime has already torn down. */
  const dead = () => ({
    enqueue() {
      throw new TypeError("Invalid state: Controller is already closed");
    },
    close() {
      throw new TypeError("Invalid state: Controller is already closed");
    },
  });

  const alive = () => {
    const chunks: Uint8Array[] = [];
    let closed = false;
    return {
      chunks,
      get closed() {
        return closed;
      },
      enqueue(c: Uint8Array) {
        if (closed) throw new TypeError("Invalid state: Controller is already closed");
        chunks.push(c);
      },
      close() {
        if (closed) throw new TypeError("Invalid state: Controller is already closed");
        closed = true;
      },
    };
  };

  {
    const s = guardStream(dead());
    let threw = false;
    try {
      check("stream: sending to a dead controller returns false", s.send(new Uint8Array([1])) === false);
      check("stream: and marks the client gone", s.gone);
      s.close();
      check("stream: closing a dead controller does not throw", true);
    } catch {
      threw = true;
    }
    check("stream: nothing escaped the guard", !threw);
  }
  {
    const c = alive();
    const s = guardStream(c);
    check("stream: a live send succeeds", s.send(new Uint8Array([1, 2])) === true);
    check("stream: and is not marked gone", !s.gone);
    s.close();
    check("stream: close closes once", c.closed);
    s.close();
    check("stream: and a second close is a no-op rather than a throw", true);
    check("stream: sending after close returns false", s.send(new Uint8Array([3])) === false);
    check("stream: and does not reach the controller", c.chunks.length === 1);
  }
  {
    // The route's shape, now guarded: the body throws, the catch sends an error
    // note into a dead stream, finally closes — and execution must reach the
    // line after it, because that is where logDebug lives.
    const s = guardStream(dead());
    let reachedTheLog = false;
    try {
      try {
        throw new Error("model call failed");
      } catch {
        s.send(new Uint8Array([1]));
      } finally {
        s.close();
      }
      reachedTheLog = true;
    } catch {
      /* would mean the guard leaked */
    }
    check("stream: an interrupted request still reaches its log write", reachedTheLog);
  }
  {
    const s = guardStream(alive());
    const sendEvent = ndjsonSender(s);
    check("stream: ndjson events serialize and send", sendEvent({ type: "phase", stage: "write" }));
  }
  {
    const s = guardStream(dead());
    const sendEvent = ndjsonSender(s);
    check("stream: and report false once the client is gone", sendEvent({ type: "phase" }) === false);
  }
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
