/**
 * Browser-side crash recorder.
 *
 * The debug log only ever saw successful server calls, so anything that killed
 * the tab left no trace at all. This keeps a small record in localStorage,
 * refreshed on a heartbeat, and reports on the PREVIOUS page life at boot —
 * because a tab that dies cannot send anything itself. Whatever it managed to
 * write before dying is the evidence.
 *
 * The DOM wiring lives here; the reasoning lives in crashModel.ts, which is
 * pure and tested.
 */
import {
  diagnose,
  newRecord,
  parseRecord,
  pushBreadcrumb,
  reportPayload,
  summarize,
  worthReporting,
  type CrashKind,
  type Diagnosis,
  type WatchContext,
  type WatchRecord,
} from "./crashModel";
import { reportCrash } from "./clientDebug";

const KEY = "mock-interviewer:watch";
const BEAT_MS = 3000;

let record: WatchRecord | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let installed = false;
/** What the last page life left behind, kept so the UI can mention it. */
let lastDiagnosis: Diagnosis | null = null;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function persist() {
  if (!record) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* quota or private mode — the watch is best-effort by design */
  }
}

/** Chrome exposes this; nothing else does. Absent is fine, it is one more clue not the clue. */
function sampleHeap() {
  if (!record) return;
  const mem = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (!mem) return;
  record.heapMb = Math.round(mem.usedJSHeapSize / 1048576);
  record.heapLimitMb = Math.round(mem.jsHeapSizeLimit / 1048576);
}

function beat() {
  if (!record) return;
  record.at = Date.now();
  record.hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  sampleHeap();
  persist();
}

function noteCrash(kind: CrashKind, message: string, stack?: string, source?: string) {
  if (!record) return;
  // Write first. The report is a best-effort network call that a dying page
  // will very likely not finish; the localStorage line is what survives.
  record.crash = { kind, message: message.slice(0, 2000), stack: stack?.slice(0, 4000), source, at: Date.now() };
  record.at = Date.now();
  sampleHeap();
  persist();
  reportCrash(`crash:${kind}`, {
    kind,
    message,
    stack,
    source,
    phase: record.context.phase,
    sessionId: record.context.sessionId,
    questionId: record.context.questionId,
    heapMb: record.heapMb,
    heapLimitMb: record.heapLimitMb,
    breadcrumbs: record.breadcrumbs.map(
      (b) => `+${Math.round((b.at - record!.startedAt) / 1000)}s ${b.what}`,
    ),
  });
}

/** Called by the error boundary, which catches what window.onerror does not. */
export function noteRenderCrash(error: Error, componentStack?: string) {
  noteCrash("render", error.message, `${error.stack ?? ""}\n--- component stack ---${componentStack ?? ""}`);
}

/** A moment worth having in the log if the next thing that happens is death. */
export function noteBreadcrumb(what: string) {
  if (!record) return;
  record.breadcrumbs = pushBreadcrumb(record.breadcrumbs, what, Date.now());
  record.at = Date.now();
  persist();
}

export function setWatchContext(partial: Partial<WatchContext>) {
  if (!record) return;
  record.context = { ...record.context, ...partial };
  persist();
}

/** Normal navigation after a finished interview. Keeps the log free of non-events. */
export function markWatchClean() {
  if (!record) return;
  record.unload = { at: Date.now(), persisted: false };
  record.context = { ...record.context, phase: "done" };
  persist();
}

export function lastCrashDiagnosis(): Diagnosis | null {
  return lastDiagnosis;
}

/**
 * Reads what the last page life left, reports it, then starts recording this
 * one. Safe to call more than once.
 */
export function installCrashWatch(context: WatchContext): Diagnosis | null {
  if (installed || typeof window === "undefined") return lastDiagnosis;
  installed = true;

  let previous: WatchRecord | null = null;
  try {
    previous = parseRecord(window.localStorage.getItem(KEY));
  } catch {
    previous = null;
  }

  const now = Date.now();
  const d = diagnose(previous, now);
  lastDiagnosis = d;
  if (worthReporting(d)) {
    reportCrash(`postmortem:${d.kind}`, reportPayload(d, now));
    // Also to the console, so it is in front of whoever is sitting there.
    console.warn(`[crash-watch] ${summarize(d)}`);
  }

  record = newRecord(uid(), now, context, BEAT_MS);
  beat();

  window.addEventListener("error", (ev: ErrorEvent) => {
    // A failed <img> or <script> load also fires this with no error object.
    // Those are not what took the page down.
    if (!ev.error && !ev.message) return;
    noteCrash(
      "exception",
      ev.message || String(ev.error),
      ev.error instanceof Error ? ev.error.stack : undefined,
      ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined,
    );
  });

  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    noteCrash(
      "rejection",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    );
  });

  window.addEventListener("pagehide", (ev: PageTransitionEvent) => {
    if (!record) return;
    record.unload = { at: Date.now(), persisted: ev.persisted };
    persist();
  });

  document.addEventListener("visibilitychange", beat);

  timer = setInterval(beat, BEAT_MS);
  return d;
}

export function stopCrashWatch() {
  if (timer) clearInterval(timer);
  timer = null;
}
