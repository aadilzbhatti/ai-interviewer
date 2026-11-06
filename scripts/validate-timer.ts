/**
 * The pause/resume arithmetic. Small surface, but the failure mode is a clock
 * that lies to the candidate, so it gets tested directly.
 * Run with: npm run validate:timer
 */
import {
  startTimer,
  restoreTimer,
  restoreStrict,
  pauseTimer,
  resumeTimer,
  elapsedMs,
  isPaused,
  formatClock,
} from "../src/lib/timer";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const S = 1000;
const M = 60 * S;
const T0 = 1_700_000_000_000;

// --- running ----------------------------------------------------------------
{
  const t = startTimer(T0);
  check("a fresh timer starts at zero", elapsedMs(t, T0) === 0);
  check("a running timer accrues", elapsedMs(t, T0 + 90 * S) === 90 * S);
  check("a fresh timer is not paused", !isPaused(t));
}

// --- pausing ----------------------------------------------------------------
{
  const t = pauseTimer(startTimer(T0), T0 + 2 * M);
  check("pausing banks the time so far", elapsedMs(t, T0 + 2 * M) === 2 * M);
  check("a paused clock does not advance", elapsedMs(t, T0 + 60 * M) === 2 * M, String(elapsedMs(t, T0 + 60 * M)));
  check("a paused timer reports itself paused", isPaused(t));
}

// --- resuming ---------------------------------------------------------------
{
  const paused = pauseTimer(startTimer(T0), T0 + 2 * M);
  const resumed = resumeTimer(paused, T0 + 50 * M); // away for 48 minutes
  check(
    "resuming does not charge for the time spent paused",
    elapsedMs(resumed, T0 + 51 * M) === 3 * M,
    String(elapsedMs(resumed, T0 + 51 * M) / M),
  );
  check("resuming clears the paused flag", !isPaused(resumed));
}

// --- idempotence ------------------------------------------------------------
{
  const once = pauseTimer(startTimer(T0), T0 + 5 * M);
  const twice = pauseTimer(once, T0 + 9 * M);
  check("pausing twice does not bank the gap twice", elapsedMs(twice, T0 + 9 * M) === 5 * M);
  check("pausing twice returns the same state", once === twice);

  const running = startTimer(T0);
  const again = resumeTimer(running, T0 + 5 * M);
  check("resuming a running timer does not restart the segment", elapsedMs(again, T0 + 10 * M) === 10 * M);
  check("resuming a running timer returns the same state", running === again);
}

// --- several cycles ---------------------------------------------------------
{
  let t = startTimer(T0);
  t = pauseTimer(t, T0 + 10 * M); // 10 active
  t = resumeTimer(t, T0 + 40 * M); // 30 away
  t = pauseTimer(t, T0 + 45 * M); // 5 active
  t = resumeTimer(t, T0 + 100 * M); // 55 away
  check(
    "time accumulates across repeated cycles",
    elapsedMs(t, T0 + 103 * M) === 18 * M,
    `${elapsedMs(t, T0 + 103 * M) / M} min`,
  );
}

// --- restore ----------------------------------------------------------------
{
  const t = restoreTimer(7 * M);
  check("a restored timer keeps its banked time", elapsedMs(t, T0) === 7 * M);
  check("a restored timer comes back paused", isPaused(t));
  check("a restored timer does not run until resumed", elapsedMs(t, T0 + 99 * M) === 7 * M);
  const going = resumeTimer(t, T0);
  check("a restored timer continues from where it stopped", elapsedMs(going, T0 + M) === 8 * M);
  check("a corrupt banked value is floored at zero", elapsedMs(restoreTimer(-5), T0) === 0);
  check(
    "a missing banked value is treated as zero",
    elapsedMs(restoreTimer(undefined as unknown as number), T0) === 0,
  );
}

// --- clock skew -------------------------------------------------------------
{
  const t = startTimer(T0);
  check("a backwards system clock never rewinds the timer", elapsedMs(t, T0 - 10 * M) === 0);
}

// --- formatting -------------------------------------------------------------
{
  check("formats under a minute", formatClock(9 * S) === "0:09", formatClock(9 * S));
  check("pads seconds", formatClock(65 * S) === "1:05", formatClock(65 * S));
  check("does not wrap at an hour", formatClock(75 * M) === "75:00", formatClock(75 * M));
  check("clamps negatives", formatClock(-1) === "0:00");
}


// --- strict clock -----------------------------------------------------------
{
  const t = restoreStrict(T0, T0 + 40 * M);
  check("a strict clock charges the time the tab was closed", elapsedMs(t, T0 + 40 * M) === 40 * M);
  check("a strict clock comes back running, not paused", !isPaused(t));
  check("a strict clock keeps running after restore", elapsedMs(t, T0 + 42 * M) === 42 * M);
  check(
    "a strict clock restored twice does not double-count",
    elapsedMs(restoreStrict(T0, T0 + 40 * M), T0 + 40 * M) === elapsedMs(t, T0 + 40 * M),
  );
  check("a strict clock floors a start time in the future", elapsedMs(restoreStrict(T0 + M, T0), T0) === 0);
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
