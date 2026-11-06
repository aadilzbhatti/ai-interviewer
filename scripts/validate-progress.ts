/**
 * The generation progress model. A bar that lies is worse than no bar, so the
 * invariants are asserted directly: never goes backwards, never completes early,
 * always advances, and reaches 100% only when the question is in hand.
 * Run with: npm run validate:progress
 */
import {
  initialProgress,
  applyEvent,
  tickProgress,
  stageStatuses,
  percent,
  STAGES,
  type ProgressState,
  type GenerationEvent,
} from "../src/lib/generationProgress";
import {
  initialGrading,
  applyGradingEvent,
  tickGrading,
  gradingPercent,
  stagesFromText,
  GRADE_STAGES,
  FIELD_STAGES,
  type GradingEvent,
} from "../src/lib/gradingProgress";

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

/** Replays a script of [offsetMs, event] and samples the bar every 250ms. */
function replay(script: [number, GenerationEvent][], untilMs: number) {
  let state = initialProgress(T0);
  const samples: number[] = [];
  let next = 0;
  for (let t = 0; t <= untilMs; t += 250) {
    while (next < script.length && script[next][0] <= t) {
      state = applyEvent(state, script[next][1], T0 + t);
      next++;
    }
    state = tickProgress(state, T0 + t);
    samples.push(state.displayed);
  }
  return { state, samples };
}

const HAPPY: [number, GenerationEvent][] = [
  [0, { type: "phase", stage: "write", attempt: 1 }],
  [38 * S, { type: "phase", stage: "review", attempt: 1 }],
  [52 * S, { type: "verdict", approved: true }],
  [52 * S, { type: "phase", stage: "verify" }],
  [64 * S, { type: "result" }],
];

const RETRY: [number, GenerationEvent][] = [
  [0, { type: "phase", stage: "write", attempt: 1 }],
  [40 * S, { type: "phase", stage: "review", attempt: 1 }],
  [55 * S, { type: "verdict", approved: false, issue: "The worked example disagrees with the tests." }],
  [55 * S, { type: "phase", stage: "write", attempt: 2 }],
  [95 * S, { type: "phase", stage: "review", attempt: 2 }],
  [110 * S, { type: "verdict", approved: true }],
  [110 * S, { type: "phase", stage: "verify" }],
  [122 * S, { type: "result" }],
];

/**
 * What the client actually does, taken from a real debug log: the server's own
 * "result" is NOT a progress event — the browser still has to run the execution
 * check, and may send the question back for a repair, which starts a second
 * request whose attempt counter restarts at 1.
 */
const REPAIR_ROUNDTRIP: [number, GenerationEvent][] = [
  [0, { type: "phase", stage: "write", attempt: 1 }],
  [46 * S, { type: "phase", stage: "review", attempt: 1 }],
  [51 * S, { type: "verdict", approved: true }],
  // server result swallowed here
  [51 * S, { type: "phase", stage: "verify" }],
  [56 * S, { type: "verdict", approved: false, issue: "Its own tests disagreed with its own solution." }],
  [56 * S, { type: "phase", stage: "write", attempt: 2 }],
  [87 * S, { type: "phase", stage: "review", attempt: 2 }],
  [91 * S, { type: "verdict", approved: true }],
  [91 * S, { type: "phase", stage: "verify" }],
  [96 * S, { type: "result" }],
];

// --- the invariants ---------------------------------------------------------
for (const [name, script, until] of [
  ["happy path", HAPPY, 70 * S],
  ["one revision", RETRY, 130 * S],
  ["repair round-trip", REPAIR_ROUNDTRIP, 105 * S],
] as const) {
  const { state, samples } = replay(script, until);

  check(
    `${name}: never goes backwards`,
    samples.every((v, i) => i === 0 || v >= samples[i - 1]),
    String(samples.findIndex((v, i) => i > 0 && v < samples[i - 1])),
  );
  check(`${name}: never exceeds 100%`, samples.every((v) => v <= 1));
  check(`${name}: starts at zero`, samples[0] === 0);
  check(`${name}: finishes at exactly 100%`, state.displayed === 1 && percent(state) === 100);
  check(`${name}: reports done`, state.done && !state.failed);

  const beforeResult = samples[Math.floor((script[script.length - 1][0] - 250) / 250)];
  check(`${name}: does not reach 100% before the question exists`, beforeResult < 1, String(beforeResult));

  // No stall longer than 10s while a stage is running.
  let longestStall = 0;
  let run = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] === samples[i - 1]) run += 250;
    else run = 0;
    longestStall = Math.max(longestStall, run);
  }
  check(`${name}: never stalls for more than 10s`, longestStall <= 10_000, `${longestStall}ms`);
}

// --- a revision must not rewind the bar -------------------------------------
{
  let state = initialProgress(T0);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 1 }, T0);
  state = tickProgress(state, T0 + 40 * S);
  state = applyEvent(state, { type: "phase", stage: "review", attempt: 1 }, T0 + 40 * S);
  state = tickProgress(state, T0 + 55 * S);
  const beforeRetry = state.displayed;

  state = applyEvent(state, { type: "verdict", approved: false, issue: "nope" }, T0 + 55 * S);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 2 }, T0 + 55 * S);
  check("retry: the bar does not rewind", state.displayed >= beforeRetry, `${beforeRetry} -> ${state.displayed}`);

  state = tickProgress(state, T0 + 75 * S);
  check("retry: and keeps advancing", state.displayed > beforeRetry);
  check("retry: the reason is surfaced", state.lastIssue === "nope");
  check("retry: the attempt counter moves", state.attempt === 2);

  state = applyEvent(state, { type: "verdict", approved: true }, T0 + 90 * S);
  check("retry: an approval clears the revision note", state.lastIssue === undefined);
}

// --- a stalled call still creeps, but never completes a stage ---------------
{
  let state = initialProgress(T0);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 1 }, T0);
  const atOneMin = tickProgress(state, T0 + 60 * S).displayed;
  const atTenMin = tickProgress(state, T0 + 600 * S).displayed;
  check("stall: a very slow call keeps moving", atTenMin > atOneMin);
  check("stall: but never claims the stage finished", atTenMin < 0.45, String(atTenMin));
  check("stall: and never reaches 100%", tickProgress(state, T0 + 86_400 * S).displayed < 1);
}

// --- the checklist ----------------------------------------------------------
{
  let state = initialProgress(T0);
  check("steps: all pending before anything starts", stageStatuses(state).every((s) => s.status === "pending"));

  state = applyEvent(state, { type: "phase", stage: "write", attempt: 1 }, T0);
  let steps = stageStatuses(state);
  check("steps: writing is active", steps[0].status === "active" && steps[1].status === "pending");

  state = applyEvent(state, { type: "phase", stage: "review", attempt: 1 }, T0 + 30 * S);
  steps = stageStatuses(state);
  check("steps: writing done, review active", steps[0].status === "done" && steps[1].status === "active");

  state = applyEvent(state, { type: "phase", stage: "write", attempt: 2 }, T0 + 45 * S);
  steps = stageStatuses(state);
  check(
    "steps: a revision honestly shows writing again",
    steps[0].status === "active" && steps[1].status === "pending",
  );

  state = applyEvent(state, { type: "result" }, T0 + 90 * S);
  check("steps: everything done at the end", stageStatuses(state).every((s) => s.status === "done"));
  check("steps: one entry per stage", stageStatuses(state).length === STAGES.length);
}

// --- failure ----------------------------------------------------------------
{
  let state: ProgressState = initialProgress(T0);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 1 }, T0);
  state = tickProgress(state, T0 + 20 * S);
  const atFailure = state.displayed;
  state = applyEvent(state, { type: "error", message: "boom" }, T0 + 20 * S);
  check("failure: is recorded", state.failed && state.error === "boom");
  check("failure: freezes the bar", tickProgress(state, T0 + 400 * S).displayed === atFailure);
  check("failure: does not claim completion", state.displayed < 1 && !state.done);
}

// --- percentage -------------------------------------------------------------
{
  const state = { ...initialProgress(T0), displayed: 0.4567 };
  check("percent: rounds to a whole number", percent(state) === 46, String(percent(state)));
  check("percent: clamps low", percent({ ...state, displayed: -1 }) === 0);
  check("percent: clamps high", percent({ ...state, displayed: 5 }) === 100);
}


// --- the specific regressions the real run exposed ---------------------------
{
  // The bar must not complete when generation finishes: verification follows.
  const upToGeneration: [number, GenerationEvent][] = REPAIR_ROUNDTRIP.slice(0, 3);
  const { state } = replay(upToGeneration, 52 * S);
  check(
    "round-trip: generation finishing does not complete the bar",
    state.displayed < 1 && !state.done,
    String(state.displayed),
  );
}
{
  // The repair request restarts the server's attempt counter at 1. Before the
  // fix, that selected the first-pass window and froze the bar for ~35s.
  let state = initialProgress(T0);
  for (const [at, event] of REPAIR_ROUNDTRIP.slice(0, 6)) state = applyEvent(state, event, T0 + at);
  const atRepairStart = tickProgress(state, T0 + 56 * S).displayed;
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 2 }, T0 + 56 * S);
  const after20s = tickProgress(state, T0 + 76 * S).displayed;
  check(
    "round-trip: the bar keeps moving through the repair",
    after20s > atRepairStart,
    `${atRepairStart} -> ${after20s}`,
  );
  check("round-trip: and still has not completed", after20s < 1);
}
{
  // Even if a repair request reports attempt 1, the counter must not go back.
  let state = initialProgress(T0);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 2 }, T0);
  state = applyEvent(state, { type: "phase", stage: "write", attempt: 1 }, T0 + S);
  check("round-trip: the attempt counter never decreases", state.attempt === 2, String(state.attempt));
}

// ---- grading ---------------------------------------------------------------
/**
 * The grade is one long model call. The bar is driven by fields the grader has
 * actually finished writing, so the invariants are the same as above and the
 * replay below is taken from a real 75-second run recorded in the debug log.
 */
function replayGrading(script: [number, GradingEvent][], untilMs: number) {
  let state = initialGrading(T0);
  const samples: number[] = [];
  let next = 0;
  for (let t = 0; t <= untilMs; t += 250) {
    while (next < script.length && script[next][0] <= t) {
      state = applyGradingEvent(state, script[next][1], T0 + t);
      next++;
    }
    state = tickGrading(state, T0 + t);
    samples.push(state.displayed);
  }
  return { state, samples };
}

/** Field arrival times from the 16:30 assess call: 75s total, 3316 output tokens. */
const REAL_GRADE: [number, GradingEvent][] = [
  [0, { type: "phase", stage: "read" }],
  [11 * S, { type: "phase", stage: "verdict" }],
  [15 * S, { type: "phase", stage: "debrief" }],
  [44 * S, { type: "phase", stage: "scores" }],
  [55 * S, { type: "phase", stage: "review" }],
  [64 * S, { type: "phase", stage: "timeline" }],
  [71 * S, { type: "phase", stage: "coaching" }],
  [75 * S, { type: "result" }],
];

{
  const { state, samples } = replayGrading(REAL_GRADE, 80 * S);
  let monotonic = true;
  for (let i = 1; i < samples.length; i++) if (samples[i] < samples[i - 1]) monotonic = false;
  check("grading: the bar never goes backwards", monotonic);
  check("grading: it ends at 100%", gradingPercent(state) === 100, String(gradingPercent(state)));

  const beforeResult = replayGrading(REAL_GRADE.slice(0, -1), 74 * S);
  check(
    "grading: and is not at 100% before the document is in hand",
    beforeResult.samples[beforeResult.samples.length - 1] < 1,
    String(beforeResult.samples[beforeResult.samples.length - 1]),
  );
  check(
    "grading: every stage is marked reached",
    state.reached.length === GRADE_STAGES.length,
    state.reached.join(","),
  );
}
{
  // The debrief is the long silence — nearly 30 seconds with nothing arriving.
  // A frozen bar there is exactly what makes a working app look hung.
  let state = initialGrading(T0);
  state = applyGradingEvent(state, { type: "phase", stage: "debrief" }, T0);
  const at5 = tickGrading(state, T0 + 5 * S).displayed;
  const at25 = tickGrading(state, T0 + 25 * S).displayed;
  check("grading: the bar keeps moving through the debrief", at25 > at5, `${at5} -> ${at25}`);
  check("grading: without escaping its band", at25 < 0.56, String(at25));
}
{
  // A grader that stalls for five minutes must not reach 100%.
  let state = initialGrading(T0);
  state = applyGradingEvent(state, { type: "phase", stage: "coaching" }, T0);
  const stalled = tickGrading(state, T0 + 300 * S).displayed;
  check("grading: a stall cannot complete the bar", stalled < 1, String(stalled));
}
{
  let state = initialGrading(T0);
  state = applyGradingEvent(state, { type: "phase", stage: "timeline" }, T0);
  state = applyGradingEvent(state, { type: "phase", stage: "verdict" }, T0 + S);
  check(
    "grading: a stage announced out of order cannot rewind the bar",
    state.displayed >= 0.82,
    String(state.displayed),
  );
}
{
  const failed = applyGradingEvent(initialGrading(T0), { type: "error", message: "nope" }, T0 + S);
  check("grading: an error stops the bar", failed.failed && failed.displayed < 1);
  check("grading: and keeps the reason", failed.error === "nope");
}

// ---- the field scan the route uses -----------------------------------------
{
  const head = '```json\n{\n  "verdict": "hire",\n  "headline": "x",';
  check("scan: the first field opens the verdict stage", stagesFromText(head, 0).join(",") === "verdict");
  check("scan: and is not announced twice", stagesFromText(head, 1).length === 0);
}
{
  // Several fields can land inside one chunk; all of them should be announced.
  const chunk = '{"verdict":"hire","headline":"h","barJudgedAgainst":"b","debrief":"d","scores":{';
  check(
    "scan: a chunk carrying three fields announces three stages",
    stagesFromText(chunk, 0).join(",") === "verdict,debrief,scores",
    stagesFromText(chunk, 0).join(","),
  );
}
{
  // Fields must never be skipped: the scan stops at the first one missing.
  const skipped = '{"verdict":"hire","timeline":[';
  check(
    "scan: a later field alone does not skip the ones before it",
    stagesFromText(skipped, 0).join(",") === "verdict",
    stagesFromText(skipped, 0).join(","),
  );
}
{
  check("scan: nothing to announce from an empty reply", stagesFromText("", 0).length === 0);
  check(
    "scan: and nothing once every field has been seen",
    stagesFromText('{"strengths":[]}', FIELD_STAGES.length).length === 0,
  );
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
