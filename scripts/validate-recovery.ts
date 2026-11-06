/**
 * Not losing someone's interview.
 *
 * This suite exists because it happened. A candidate closed a tab 90 seconds
 * from the end of a 35-minute interview; the session had been saved correctly,
 * but the home page never said so, and the obvious next move — start another
 * interview — called clearSession(), which deleted the only copy. 83 lines of
 * their work went with it, and it came back only by decompressing a LevelDB
 * block out of the browser profile.
 *
 * So clearing is non-destructive now, and these are the rules that keep it so.
 * Run with: npm run validate:recovery
 */
// store.ts touches localStorage only inside its functions, so a static import
// is safe as long as the stub above exists before any of them are called.
import {
  saveSession,
  loadSession,
  clearSession,
  loadSessionBackups,
  restoreSessionBackup,
  deleteSessionBackup,
  DEFAULT_CONFIG,
} from "../src/lib/store";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

/** A localStorage with a byte ceiling, because the real one has one too. */
class FakeStorage {
  map = new Map<string, string>();
  limit = Infinity;
  private size() {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const without = this.size() - (this.map.get(k)?.length ?? 0) - (this.map.has(k) ? k.length : 0);
    if (without + k.length + v.length > this.limit) {
      const e = new Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

type Session = ReturnType<typeof loadSession>;

const SESSION_KEY = "mock-interviewer:session";

function session(id: string, code: string, title = `Q ${id}`) {
  return {
    id,
    config: { ...DEFAULT_CONFIG },
    originalConfig: { ...DEFAULT_CONFIG },
    concessions: [],
    question: {
      id: `q-${id}`,
      title,
      prompt: "p",
      difficulty: "medium",
      jobLevels: ["mid"],
      roles: ["general"],
      topics: [],
      functionName: "f",
      starter: { python: "", javascript: "" },
      reference: { python: "", javascript: "" },
      tests: [],
      hints: [],
      followUps: [],
      optimal: { time: "O(n)", space: "O(1)" },
      source: "bank",
    },
    messages: [{ id: "m", role: "user", content: "hello", at: 1 }],
    code: { python: code, javascript: "" },
    runs: [
      {
        ok: true,
        language: "python",
        passed: 1,
        total: 2,
        results: [{ name: "a", passed: true, hidden: false, durationMs: 1 }],
        stdout: "noise".repeat(500),
        durationMs: 5,
        at: 1,
      },
    ],
    hintsUsed: 0,
    startedAt: 1,
    accumulatedMs: 60_000,
    paused: true,
  } as unknown as NonNullable<Session>;
}

const reset = () => {
  storage.map.clear();
  storage.limit = Infinity;
};

// --- clearing must not destroy ----------------------------------------------
{
  reset();
  const a = session("a", "print('work worth an hour')");
  saveSession(a);
  check("save: a session round-trips", loadSession()?.id === "a");

  clearSession();
  check("clear: the live session is gone", loadSession() === null);
  // The whole point.
  const kept = loadSessionBackups();
  check("clear: but it was kept, not deleted", kept.length === 1 && kept[0].id === "a", String(kept.length));
  check("clear: with the code intact", kept[0].code.python === a.code.python);
  check("clear: and the transcript", (kept[0].messages ?? []).length === 1);
  check(
    "clear: run details are dropped, since they are the bulk and the least missed",
    (kept[0].runs?.[0]?.results ?? []).length === 0 && kept[0].runs?.[0]?.stdout === "",
  );
  check("clear: but the run's score survives", kept[0].runs?.[0]?.passed === 1);
}

// --- restoring ---------------------------------------------------------------
{
  reset();
  saveSession(session("a", "alpha"));
  clearSession();
  const back = restoreSessionBackup("a");
  check("restore: returns the session", back?.id === "a");
  check("restore: and makes it live again", loadSession()?.code.python === "alpha");

  check("restore: an unknown id is a no-op", restoreSessionBackup("nope") === null);
  check("restore: and does not disturb the live session", loadSession()?.id === "a");
}

// --- restoring while something else is in progress ---------------------------
{
  reset();
  saveSession(session("a", "alpha"));
  clearSession();
  saveSession(session("b", "bravo"));
  restoreSessionBackup("a");
  check("restore: the displaced session is itself kept", loadSessionBackups().some((s) => s.id === "b"));
  check("restore: swapping cannot lose either side", loadSession()?.id === "a");
}

// --- the ring is bounded -----------------------------------------------------
{
  reset();
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    saveSession(session(id, id));
    clearSession();
  }
  const kept = loadSessionBackups();
  check("ring: is capped", kept.length === 4, String(kept.length));
  check("ring: newest first", kept[0].id === "f", kept.map((s) => s.id).join(","));
  check("ring: the oldest fall off", !kept.some((s) => s.id === "a" || s.id === "b"));
}

// --- re-clearing the same session does not fill the ring with copies ---------
{
  reset();
  const a = session("a", "alpha");
  saveSession(a);
  clearSession();
  saveSession(a);
  clearSession();
  check("ring: the same session is not duplicated", loadSessionBackups().length === 1);
}

// --- deleting on purpose -----------------------------------------------------
{
  reset();
  saveSession(session("a", "alpha"));
  clearSession();
  deleteSessionBackup("a");
  check("delete: removes it", loadSessionBackups().length === 0);
}

// --- a full disk is reported, not swallowed ----------------------------------
{
  reset();
  const big = session("a", "x".repeat(2000));
  storage.limit = 200; // far too small for any session
  check("quota: a refused save is reported to the caller", saveSession(big) === false);
  check("quota: and nothing is silently half-written", storage.getItem(SESSION_KEY) === null);

  storage.limit = Infinity;
  check("quota: a save that fits succeeds", saveSession(big) === true);
}

// --- clearing must survive a full ring ---------------------------------------
{
  reset();
  saveSession(session("a", "alpha"));
  // No room for the backup, but the clear itself must still work rather than
  // leaving a session the app believes is live.
  storage.limit = storage.getItem(SESSION_KEY)!.length + SESSION_KEY.length;
  clearSession();
  check("quota: clearing still clears when the backup cannot be written", loadSession() === null);
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
