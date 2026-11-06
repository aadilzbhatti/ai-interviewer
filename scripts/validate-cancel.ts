/**
 * Stopping a question build.
 *
 * The thing that can go wrong here is not the button — it is what happens after
 * it. Generation is a chain of awaits (a model call, an execution check, maybe a
 * repair round), and none of them can be interrupted halfway. So a cancelled
 * build keeps computing for a while, and the only question that matters is
 * whether that zombie can still come back and act: bank a question the candidate
 * never asked to keep, move a progress bar on a screen that has moved on, or
 * announce itself as ready.
 *
 * These tests drive the real module with a fake generate endpoint, so they cover
 * the abort plumbing as well as the bookkeeping.
 * Run with: npm run validate:cancel
 */
import { DEFAULT_CONFIG } from "../src/lib/store";
import {
  startJob,
  cancelJob,
  clearJob,
  getJob,
  subscribeJob,
} from "../src/lib/generationJob";
import type { InterviewConfig } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const CONFIG: InterviewConfig = { ...DEFAULT_CONFIG, source: "generated" };

/** A localStorage good enough for the store, so "was it banked?" is observable. */
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
};

const banked = () => {
  const raw = store.get("mock-interviewer:questions");
  return raw ? (JSON.parse(raw) as unknown[]).length : 0;
};

/** Control of the fake stream: one line at a time, and it notices being aborted. */
interface Fake {
  send(line: string): void;
  end(): void;
  aborted(): boolean;
  reads: number;
}
let fake: Fake;

function installFetch() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let signal: AbortSignal | null = null;
  const enc = new TextEncoder();
  const state: Fake = {
    // Writing to a stream the abort already tore down throws, exactly as a real
    // late chunk would be dropped by the network. Swallow it: the point of the
    // test is what the JOB does with late work, not what the socket does.
    send: (line) => {
      try {
        controller?.enqueue(enc.encode(line + "\n"));
      } catch {
        /* stream already gone */
      }
    },
    end: () => {
      try {
        controller?.close();
      } catch {
        /* stream already gone */
      }
    },
    aborted: () => !!signal?.aborted,
    reads: 0,
  };
  fake = state;

  (globalThis as unknown as { fetch: unknown }).fetch = (
    _url: string,
    init: { signal?: AbortSignal },
  ) => {
    signal = init.signal ?? null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        // A real aborted fetch makes the pending read reject, which is what
        // carries the cancellation out of the stream loop.
        init.signal?.addEventListener("abort", () => {
          try {
            c.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* already closed */
          }
        });
      },
      pull() {
        state.reads++;
      },
    });
    return Promise.resolve({ ok: true, body, status: 200, text: async () => "" });
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

async function main() {
  installFetch();

  // ---- a build that is stopped mid-stream ---------------------------------
  let notifications = 0;
  const unsubscribe = subscribeJob(() => notifications++);

  const job = startJob(CONFIG);
  check("starting a build reports it as running", getJob()?.status === "running");
  await settle();
  fake.send(JSON.stringify({ type: "phase", stage: "write", attempt: 1 }));
  // Long enough for the 250ms ticker to have crept the bar at least once.
  await new Promise((r) => setTimeout(r, 600));
  check("the stage is picked up while it is running", getJob()?.progress.stage === "write");
  check("the bar moves while it is running", (getJob()?.progress.displayed ?? 0) > 0);

  const before = notifications;
  cancelJob();
  check("stopping marks the job cancelled", getJob()?.status === "cancelled");
  check("stopping tells the screens about it", notifications > before);
  check("stopping aborts the model call", fake.aborted());
  check("stopping says what happened", getJob()?.error === "You stopped this build.");

  // The half-finished work arrives anyway. None of it may take effect.
  const frozen = getJob()?.progress.displayed ?? 0;
  const id = job.id;
  fake.send(JSON.stringify({ type: "phase", stage: "review", attempt: 1 }));
  fake.send(
    JSON.stringify({
      type: "result",
      question: { id: "zombie", title: "Zombie", tests: [] },
    }),
  );
  fake.end();
  // Well past a ticker interval, so a ticker that failed to stop would show.
  await new Promise((r) => setTimeout(r, 600));

  check("a stopped build stays stopped", getJob()?.status === "cancelled");
  check("its bar does not move afterwards", (getJob()?.progress.displayed ?? 0) === frozen);
  check("it never reports itself as done", getJob()?.question === undefined);
  check("it does not turn into a failure to explain", getJob()?.id === id);
  check("nothing is banked to the library", banked() === 0, `${banked()} saved`);

  // ---- the next build is unaffected ---------------------------------------
  installFetch();
  const second = startJob(CONFIG);
  check("a matching request after a stop starts a new build", second.id !== id);
  check("the new build is running", getJob()?.status === "running");
  await settle();
  check("the new build has its own live connection", !fake.aborted());

  // ---- stopping is idempotent and only applies to a live build ------------
  cancelJob();
  const afterFirstCancel = getJob();
  cancelJob();
  check("stopping twice changes nothing", getJob() === afterFirstCancel);

  clearJob();
  check("clearing removes the banner entirely", getJob() === null);
  cancelJob();
  check("stopping with nothing running is harmless", getJob() === null);

  unsubscribe();
  await settle();

  console.log(failures === 0 ? "\nAll cancellation checks passed." : `\n${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
