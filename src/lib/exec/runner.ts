import type { Language, Question, RunResult, ScratchResult, TestCaseResult } from "../types";

const WORKER_SRC: Record<Language, string> = {
  python: "/workers/py-worker.js",
  javascript: "/workers/js-worker.js",
};

const workers: Partial<Record<Language, Worker>> = {};
const warmed: Partial<Record<Language, boolean>> = {};

function getWorker(language: Language): Worker {
  let w = workers[language];
  if (!w) {
    w = new Worker(WORKER_SRC[language]);
    workers[language] = w;
  }
  return w;
}

/** Start the runtime early so the candidate's first run is not a cold start. */
export function warmUp(language: Language) {
  if (typeof window === "undefined") return;
  try {
    getWorker(language);
  } catch {
    /* ignore */
  }
}

export function disposeRunners() {
  for (const key of Object.keys(workers) as Language[]) {
    workers[key]?.terminate();
    delete workers[key];
  }
}

interface WorkerReply {
  ok: boolean;
  error?: string;
  results: TestCaseResult[];
  stdout?: string;
  durationMs?: number;
}

export function runTests(opts: {
  language: Language;
  code: string;
  question: Question;
  timeoutMs?: number;
}): Promise<RunResult> {
  const { language, code, question } = opts;
  const tests = question.tests;
  const cold = !warmed[language];
  const limit =
    opts.timeoutMs ?? (language === "python" ? (cold ? 90_000 : 25_000) : 10_000);

  return new Promise<RunResult>((resolve) => {
    let worker: Worker;
    try {
      worker = getWorker(language);
    } catch (e) {
      resolve(errorResult(language, tests.length, `Could not start the ${language} runtime: ${String(e)}`));
      return;
    }

    let settled = false;
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      delete workers[language];
      warmed[language] = false;
      resolve(
        errorResult(
          language,
          tests.length,
          `Timed out after ${Math.round(limit / 1000)}s. Look for an infinite loop, or a runtime that failed to load.`,
          limit,
        ),
      );
    }, limit);

    const onMessage = (ev: MessageEvent<WorkerReply>) => {
      if (settled) return;
      settled = true;
      cleanup();
      warmed[language] = true;
      const data = ev.data;
      const results = data.results || [];
      resolve({
        ok: !!data.ok && !data.error,
        language,
        passed: results.filter((r) => r.passed).length,
        total: results.length || tests.length,
        results,
        stdout: data.stdout || "",
        error: data.error,
        durationMs: data.durationMs ?? 0,
        at: Date.now(),
      });
    };

    const onError = (ev: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      delete workers[language];
      resolve(errorResult(language, tests.length, ev.message || "The runtime crashed."));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      code,
      tests,
      functionName: question.functionName,
      comparison: question.comparison || "exact",
      validator: question.validator?.[language],
    });
  });
}

function errorResult(
  language: Language,
  total: number,
  error: string,
  durationMs = 0,
): RunResult {
  return {
    ok: false,
    language,
    passed: 0,
    total,
    results: [],
    stdout: "",
    error,
    durationMs,
    at: Date.now(),
  };
}

interface ScratchReply {
  ok: boolean;
  phase?: "compile" | "run" | "call";
  error?: string;
  where?: { line: number; column: number };
  stdout?: string;
  value?: string;
  hasValue?: boolean;
  durationMs?: number;
}

/**
 * Runs the candidate's buffer as a program, with one optional call expression
 * evaluated in the same scope.
 *
 * Shares the worker with runTests — same runtime, same sandbox, same warm
 * Pyodide — but the reply is a different shape on purpose. Nothing here can be
 * mistaken for a test run downstream, which is the entire point: this one is
 * private.
 */
export function runScratch(opts: {
  language: Language;
  code: string;
  call?: string;
  timeoutMs?: number;
}): Promise<ScratchResult> {
  const { language, code } = opts;
  const call = (opts.call || "").trim();
  const cold = !warmed[language];
  // Shorter than a test run: this is the fast loop, and a hang should be
  // reported quickly rather than sat through.
  const limit =
    opts.timeoutMs ?? (language === "python" ? (cold ? 90_000 : 15_000) : 8_000);

  return new Promise<ScratchResult>((resolve) => {
    const fail = (error: string, durationMs = 0): ScratchResult => ({
      ok: false,
      language,
      error,
      stdout: "",
      call: call || undefined,
      durationMs,
      at: Date.now(),
    });

    let worker: Worker;
    try {
      worker = getWorker(language);
    } catch (e) {
      resolve(fail(`Could not start the ${language} runtime: ${String(e)}`));
      return;
    }

    let settled = false;
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      delete workers[language];
      warmed[language] = false;
      resolve(
        fail(
          `Still running after ${Math.round(limit / 1000)}s — stopped it. Look for a loop that never ends.`,
          limit,
        ),
      );
    }, limit);

    const onMessage = (ev: MessageEvent<ScratchReply>) => {
      if (settled) return;
      settled = true;
      cleanup();
      warmed[language] = true;
      const d = ev.data;
      resolve({
        ok: !!d.ok,
        language,
        phase: d.phase,
        error: d.error,
        where: d.where,
        stdout: d.stdout || "",
        value: d.value,
        hasValue: !!d.hasValue,
        call: call || undefined,
        durationMs: d.durationMs ?? 0,
        at: Date.now(),
      });
    };

    const onError = (ev: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      delete workers[language];
      resolve(fail(ev.message || "The runtime crashed."));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      mode: "scratch",
      code,
      call,
    });
  });
}
