/**
 * Interview clock. Elapsed time is banked rather than derived from a single
 * start timestamp, so pausing actually stops the clock and a session restored
 * from storage does not silently charge the candidate for the time the tab
 * was closed.
 *
 * Every function is pure and takes `now`, which is what makes the arithmetic
 * testable — see scripts/validate-timer.ts.
 */
export interface TimerState {
  /** Active milliseconds already banked by completed segments. */
  accumulatedMs: number;
  /** When the current active segment began, or null while paused. */
  runningSince: number | null;
}

export const startTimer = (now: number): TimerState => ({
  accumulatedMs: 0,
  runningSince: now,
});

/** A timer restored from storage always comes back paused. */
export const restoreTimer = (accumulatedMs: number): TimerState => ({
  accumulatedMs: Math.max(0, accumulatedMs || 0),
  runningSince: null,
});

/**
 * Restoring under a strict clock. There is no pause to hide behind, so the time
 * the tab was closed is charged and the clock keeps running.
 */
export function restoreStrict(startedAt: number, now: number): TimerState {
  return { accumulatedMs: Math.max(0, now - startedAt), runningSince: now };
}

export const isPaused = (t: TimerState): boolean => t.runningSince === null;

export function elapsedMs(t: TimerState, now: number): number {
  if (t.runningSince === null) return t.accumulatedMs;
  // A clock that jumped backwards must not rewind banked time.
  return t.accumulatedMs + Math.max(0, now - t.runningSince);
}

export const elapsedMin = (t: TimerState, now: number): number => elapsedMs(t, now) / 60000;

/** Idempotent: pausing an already-paused timer changes nothing. */
export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.runningSince === null) return t;
  return { accumulatedMs: elapsedMs(t, now), runningSince: null };
}

/** Idempotent: resuming a running timer does not restart the segment. */
export function resumeTimer(t: TimerState, now: number): TimerState {
  if (t.runningSince !== null) return t;
  return { accumulatedMs: t.accumulatedMs, runningSince: now };
}

/** mm:ss, for the header. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
