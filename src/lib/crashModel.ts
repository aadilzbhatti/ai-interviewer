/**
 * What a page life leaves behind, and how to read it after the fact.
 *
 * The problem this solves: when the interview tab dies, nothing is logged. The
 * server only ever sees successful API calls, so a session that was working and
 * then stopped looks identical in the log to one the candidate simply walked
 * away from. That happened — a real session went quiet for 68 minutes with a
 * clean server log, and the cause had to be inferred from the shape of the
 * silence rather than read.
 *
 * So the browser keeps a small record in localStorage and updates it on a
 * heartbeat. The next page life reads whatever the last one left and works out
 * which of three things happened:
 *
 *   exception — an error handler fired and wrote a stack. We know exactly what.
 *   orderly   — pagehide ran, so the page was navigated, reloaded or discarded
 *               by the browser in the normal way. Teardown had its turn.
 *   vanished  — neither. The process died without running a single handler:
 *               a renderer crash, an out-of-memory kill, a force quit.
 *
 * That third case is the one worth having. It cannot be distinguished from
 * "user closed the laptop" by any server-side signal, and it is exactly what a
 * memory-hungry tab running a WASM Python runtime does when the browser decides
 * to reclaim it.
 *
 * Pure and time-injected so every branch can be tested — see
 * scripts/validate-crashwatch.ts.
 */

/** Bumped when the record shape changes; an older record is discarded, not guessed at. */
export const WATCH_VERSION = 1;

export type CrashKind = "exception" | "rejection" | "render";

export interface Breadcrumb {
  at: number;
  what: string;
}

export interface CrashNote {
  kind: CrashKind;
  message: string;
  stack?: string;
  /** File and position, when the error event carried them. */
  source?: string;
  at: number;
}

export interface UnloadNote {
  at: number;
  /** True when the page went into the back/forward cache rather than being torn down. */
  persisted: boolean;
}

export interface WatchContext {
  /** The interview's own phase: loading, live, grading, done. */
  phase: string;
  sessionId?: string;
  questionId?: string;
}

export interface WatchRecord {
  v: number;
  /** Identifies one page life, so two tabs do not read as one. */
  bootId: string;
  startedAt: number;
  /** Last heartbeat. The gap between this and the next boot is the evidence. */
  at: number;
  /** Whether the tab was in the background at the last heartbeat. */
  hidden: boolean;
  /** Heartbeat period, so a throttled background beat is not read as a stall. */
  beatMs: number;
  context: WatchContext;
  breadcrumbs: Breadcrumb[];
  /** Chrome only; the shape of this curve is what an OOM kill looks like. */
  heapMb?: number;
  heapLimitMb?: number;
  crash?: CrashNote;
  unload?: UnloadNote;
}

export type Diagnosis =
  | { kind: "first-run" }
  | { kind: "exception"; crash: CrashNote; record: WatchRecord; silentMs: number }
  | { kind: "orderly"; awayMs: number; record: WatchRecord }
  | { kind: "vanished"; silentMs: number; wasHidden: boolean; record: WatchRecord };

export const MAX_BREADCRUMBS = 40;

export function pushBreadcrumb(
  list: Breadcrumb[],
  what: string,
  at: number,
  max = MAX_BREADCRUMBS,
): Breadcrumb[] {
  const next = [...list, { at, what }];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function newRecord(
  bootId: string,
  now: number,
  context: WatchContext,
  beatMs: number,
): WatchRecord {
  return {
    v: WATCH_VERSION,
    bootId,
    startedAt: now,
    at: now,
    hidden: false,
    beatMs,
    context,
    breadcrumbs: [],
  };
}

/**
 * Tolerant by design: a half-written record, a record from an older version of
 * the app, or anything that is not a record at all reads as "nothing to go on"
 * rather than throwing during boot.
 */
export function parseRecord(raw: string | null | undefined): WatchRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<WatchRecord>;
  if (r.v !== WATCH_VERSION) return null;
  if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
  if (typeof r.bootId !== "string") return null;
  return {
    v: WATCH_VERSION,
    bootId: r.bootId,
    startedAt: typeof r.startedAt === "number" ? r.startedAt : r.at,
    at: r.at,
    hidden: !!r.hidden,
    beatMs: typeof r.beatMs === "number" && r.beatMs > 0 ? r.beatMs : 3000,
    context:
      r.context && typeof r.context === "object"
        ? { ...r.context, phase: String((r.context as WatchContext).phase ?? "unknown") }
        : { phase: "unknown" },
    breadcrumbs: Array.isArray(r.breadcrumbs)
      ? r.breadcrumbs.filter(
          (b): b is Breadcrumb =>
            !!b && typeof b === "object" && typeof (b as Breadcrumb).what === "string",
        )
      : [],
    heapMb: typeof r.heapMb === "number" ? r.heapMb : undefined,
    heapLimitMb: typeof r.heapLimitMb === "number" ? r.heapLimitMb : undefined,
    crash: r.crash && typeof r.crash === "object" ? (r.crash as CrashNote) : undefined,
    unload: r.unload && typeof r.unload === "object" ? (r.unload as UnloadNote) : undefined,
  };
}

/**
 * Precedence matters. A page can both throw and then unload — the throw is the
 * story, so a crash note always wins over an unload note.
 */
export function diagnose(previous: WatchRecord | null, now: number): Diagnosis {
  if (!previous) return { kind: "first-run" };
  if (previous.crash) {
    return {
      kind: "exception",
      crash: previous.crash,
      record: previous,
      silentMs: Math.max(0, now - previous.at),
    };
  }
  if (previous.unload) {
    return { kind: "orderly", awayMs: Math.max(0, now - previous.unload.at), record: previous };
  }
  return {
    kind: "vanished",
    silentMs: Math.max(0, now - previous.at),
    wasHidden: previous.hidden,
    record: previous,
  };
}

/**
 * An orderly reload of a finished interview is just someone closing a tab.
 * Everything else earns a line in the log.
 */
export function worthReporting(d: Diagnosis): boolean {
  if (d.kind === "first-run") return false;
  if (d.kind === "orderly") return d.record.context.phase !== "done";
  return true;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${(m / 60).toFixed(1)} hours`;
}

/** One sentence naming what happened, for the log line and the recovery screen. */
export function summarize(d: Diagnosis): string {
  switch (d.kind) {
    case "first-run":
      return "No previous page life to report on.";
    case "exception":
      return `The page threw an uncaught ${d.crash.kind === "rejection" ? "promise rejection" : "error"} during "${d.record.context.phase}": ${d.crash.message}`;
    case "orderly":
      return `The page was closed or reloaded during "${d.record.context.phase}" and came back ${duration(d.awayMs)} later.`;
    case "vanished":
      return `The page stopped without running any teardown during "${d.record.context.phase}" — no error, no unload, ${duration(d.silentMs)} of silence${
        d.wasHidden ? ", and the tab was in the background" : " while the tab was in the foreground"
      }. That is what a renderer crash, an out-of-memory kill or a force quit looks like.`;
  }
}

/** The payload written to the debug log. Flat on purpose: it gets read in a terminal. */
export function reportPayload(d: Diagnosis, now: number): Record<string, unknown> {
  const base = {
    kind: d.kind,
    summary: summarize(d),
    reportedAt: new Date(now).toISOString(),
  };
  if (d.kind === "first-run") return base;
  const r = d.record;
  return {
    ...base,
    phase: r.context.phase,
    sessionId: r.context.sessionId,
    questionId: r.context.questionId,
    pageLifeMs: Math.max(0, r.at - r.startedAt),
    lastBeatAt: new Date(r.at).toISOString(),
    lastBeatHidden: r.hidden,
    beatMs: r.beatMs,
    heapMb: r.heapMb,
    heapLimitMb: r.heapLimitMb,
    heapPressure:
      r.heapMb && r.heapLimitMb ? `${Math.round((r.heapMb / r.heapLimitMb) * 100)}% of limit` : undefined,
    silentMs: d.kind === "orderly" ? undefined : d.silentMs,
    awayMs: d.kind === "orderly" ? d.awayMs : undefined,
    crash: d.kind === "exception" ? d.crash : undefined,
    breadcrumbs: r.breadcrumbs.map((b) => `+${Math.round((b.at - r.startedAt) / 1000)}s ${b.what}`),
  };
}
