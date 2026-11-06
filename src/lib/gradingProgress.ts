/**
 * Progress model for the post-interview grade.
 *
 * Grading is a single model call that takes 60-90 seconds and returns one large
 * JSON document. A timer-driven bar would be theatre, so instead the route
 * streams the reply and announces each top-level field as the grader finishes
 * writing it. Every step on screen corresponds to something that has actually
 * been produced.
 *
 * The stage weights are not guesses about time — they follow the size of what
 * is being written. The debrief alone is 500-900 words, which is why it owns
 * the widest band.
 *
 * Same two rules as the generation bar: never backwards, never 100% until the
 * document is in hand. Pure and time-injected — see scripts/validate-progress.ts.
 */
export type GradeStage =
  | "read"
  | "verdict"
  | "debrief"
  | "scores"
  | "review"
  | "timeline"
  | "coaching";

export const GRADE_STAGES: GradeStage[] = [
  "read",
  "verdict",
  "debrief",
  "scores",
  "review",
  "timeline",
  "coaching",
];

export const GRADE_LABELS: Record<GradeStage, string> = {
  read: "Reading the transcript, your code and every test run",
  verdict: "Reaching a verdict against the bar",
  debrief: "Writing the debrief",
  scores: "Scoring the five criteria",
  review: "Reviewing your code as a pull request",
  timeline: "Rebuilding the interview minute by minute",
  coaching: "Pulling out strengths, gaps and what to practise",
};

export const GRADE_BLURBS: Record<GradeStage, string> = {
  read: "Everything you said, everything you wrote, and how it changed over the session.",
  debrief:
    "The long one — the written feedback a hiring committee would read, anchored to what you actually did.",
  verdict: "Where this performance lands on the eight-point scale for the level you targeted.",
  scores: "Problem solving, code quality, communication, testing rigor and complexity analysis.",
  review: "Correctness beyond the tests, real complexity, readability, and the edge cases.",
  timeline: "Each meaningful moment and what it signalled.",
  coaching: "The part addressed to you rather than to the committee.",
};

/** Paces the creep between real events. Measured against a 75s reference run. */
const EXPECTED_MS: Record<GradeStage, number> = {
  read: 14_000,
  verdict: 6_000,
  debrief: 30_000,
  scores: 14_000,
  review: 12_000,
  timeline: 10_000,
  coaching: 8_000,
};

/** Bands sized by how much text each field carries, not by clock time. */
const WINDOWS: Record<GradeStage, [number, number]> = {
  read: [0, 0.08],
  verdict: [0.08, 0.16],
  debrief: [0.16, 0.55],
  scores: [0.55, 0.7],
  review: [0.7, 0.82],
  timeline: [0.82, 0.92],
  coaching: [0.92, 0.97],
};

const CEILING = 0.97;

export interface GradingEvent {
  type: "phase" | "result" | "error";
  stage?: GradeStage;
  message?: string;
}

export interface GradingState {
  stage: GradeStage | null;
  done: boolean;
  failed: boolean;
  error?: string;
  reached: GradeStage[];
  floor: number;
  ceiling: number;
  startedAt: number;
  stageStartedAt: number;
  displayed: number;
}

export function initialGrading(now: number): GradingState {
  return {
    stage: null,
    done: false,
    failed: false,
    reached: [],
    floor: 0,
    ceiling: 0,
    startedAt: now,
    stageStartedAt: now,
    displayed: 0,
  };
}

export function applyGradingEvent(
  state: GradingState,
  event: GradingEvent,
  now: number,
): GradingState {
  const settled = tickGrading(state, now);

  switch (event.type) {
    case "phase": {
      const stage = event.stage ?? "read";
      const [from, to] = WINDOWS[stage];
      // Clamped to where the bar already is: a stage announced out of order
      // must not rewind it.
      return {
        ...settled,
        stage,
        floor: Math.max(from, settled.displayed),
        ceiling: Math.max(to, settled.displayed),
        stageStartedAt: now,
        reached: settled.reached.includes(stage) ? settled.reached : [...settled.reached, stage],
      };
    }
    case "result":
      return { ...settled, stage: null, done: true, displayed: 1, floor: 1, ceiling: 1 };
    case "error":
      return { ...settled, failed: true, error: event.message };
    default:
      return settled;
  }
}

/** Recomputes the creep within the current stage. Call on a timer. */
export function tickGrading(state: GradingState, now: number): GradingState {
  if (state.done) return state.displayed === 1 ? state : { ...state, displayed: 1 };
  if (!state.stage || state.failed) return state;

  const elapsed = Math.max(0, now - state.stageStartedAt);
  const fraction = 1 - Math.exp(-elapsed / EXPECTED_MS[state.stage]);
  const candidate = state.floor + (state.ceiling - state.floor) * fraction;
  const next = Math.min(CEILING, Math.max(state.displayed, candidate));
  return next === state.displayed ? state : { ...state, displayed: next };
}

export type GradeStageStatus = "done" | "active" | "pending";

export function gradingStageStatuses(
  state: GradingState,
): { key: GradeStage; label: string; blurb: string; status: GradeStageStatus }[] {
  const current = state.stage
    ? GRADE_STAGES.indexOf(state.stage)
    : state.done
      ? GRADE_STAGES.length
      : -1;
  return GRADE_STAGES.map((key, i) => ({
    key,
    label: GRADE_LABELS[key],
    blurb: GRADE_BLURBS[key],
    status: state.done || i < current ? "done" : i === current ? "active" : "pending",
  }));
}

export const gradingPercent = (state: GradingState): number =>
  Math.round(Math.min(1, Math.max(0, state.displayed)) * 100);

/**
 * The order the grader writes its fields, and which stage each one opens. The
 * route watches for these, and only ever looks for the next one — a key name
 * quoted inside the debrief prose should not jump the bar forward.
 */
export const FIELD_STAGES: { field: string; stage: GradeStage }[] = [
  { field: "verdict", stage: "verdict" },
  { field: "debrief", stage: "debrief" },
  { field: "scores", stage: "scores" },
  { field: "codeReview", stage: "review" },
  { field: "timeline", stage: "timeline" },
  { field: "strengths", stage: "coaching" },
];

/**
 * Given the text so far and how many fields have already been announced,
 * returns the stages to announce now. Pure so the scan is testable.
 */
export function stagesFromText(text: string, alreadySeen: number): GradeStage[] {
  const out: GradeStage[] = [];
  let index = alreadySeen;
  for (;;) {
    const next = FIELD_STAGES[index];
    if (!next) break;
    if (!new RegExp(`"${next.field}"\\s*:`).test(text)) break;
    out.push(next.stage);
    index++;
  }
  return out;
}
