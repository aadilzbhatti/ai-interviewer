/**
 * Progress model for building a question.
 *
 * The honest problem: generation takes 1-3 minutes across two model calls, a
 * possible revision round, and an in-browser execution check. A bar driven by a
 * timer alone would be a lie, so the server streams the phases as they happen
 * and this reduces them into something a person can read.
 *
 * Two rules the maths has to respect:
 *   - it never goes backwards, including when a draft is rejected and rewritten
 *   - it never reaches 100% until the question is actually in hand
 *
 * Pure and time-injected, so the invariants can be tested — see
 * scripts/validate-progress.ts.
 */
export type GenStage = "write" | "review" | "verify";

export const STAGES: GenStage[] = ["write", "review", "verify"];

export const STAGE_LABELS: Record<GenStage, string> = {
  write: "Writing your question",
  review: "A second agent is reviewing it",
  verify: "Running its tests against its own solution",
};

export const STAGE_BLURBS: Record<GenStage, string> = {
  write: "Turning what you asked for into a full problem — statement, examples, tests and reference solutions.",
  review: "Checking it for difficulty fit, clarity, test coverage, and whether it is really what you asked for.",
  verify: "Executing the reference solution against the generated tests in your browser, before you ever see it.",
};

/** Measured on real runs; used only to pace the creep between events. */
const EXPECTED_MS: Record<GenStage, number> = {
  write: 40_000,
  review: 18_000,
  verify: 14_000,
};

/** First-attempt plan. Later attempts eat into what is left instead. */
const FIRST_PASS: Record<GenStage, [number, number]> = {
  write: [0, 0.45],
  review: [0.45, 0.64],
  verify: [0.64, 0.95],
};

/** A retry consumes this share of the remaining gap, so the bar keeps moving. */
const RETRY_SHARE = 0.5;
const CEILING = 0.97;

export interface GenerationEvent {
  type: "phase" | "verdict" | "result" | "error";
  stage?: GenStage;
  attempt?: number;
  approved?: boolean;
  issue?: string;
  message?: string;
}

export interface ProgressState {
  stage: GenStage | null;
  attempt: number;
  done: boolean;
  failed: boolean;
  /** Why the last draft was sent back, in the reviewer's words. */
  lastIssue?: string;
  error?: string;
  /** Stages finished at least once, for the checklist. */
  reached: GenStage[];
  floor: number;
  ceiling: number;
  /** When the whole build began, for the elapsed readout. */
  startedAt: number;
  stageStartedAt: number;
  displayed: number;
}

export function initialProgress(now: number): ProgressState {
  return {
    stage: null,
    attempt: 1,
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

function windowFor(stage: GenStage, attempt: number, displayed: number): [number, number] {
  // A repair round-trip starts a second request, whose own attempt counter
  // restarts at 1 — so the attempt number alone cannot tell us this is a first
  // pass. Having already advanced past this stage's first-pass window is the
  // reliable signal, and without it the bar froze for the whole repair.
  const isFirstPass = attempt <= 1 && displayed < FIRST_PASS[stage][1];
  if (isFirstPass) {
    const [from, to] = FIRST_PASS[stage];
    return [Math.max(from, displayed), Math.max(to, displayed)];
  }
  const room = Math.max(0, CEILING - displayed);
  return [displayed, displayed + room * RETRY_SHARE];
}

export function applyEvent(
  state: ProgressState,
  event: GenerationEvent,
  now: number,
): ProgressState {
  const settled = tickProgress(state, now);

  switch (event.type) {
    case "phase": {
      const stage = event.stage ?? "write";
      // Monotonic: a repair request's counter restarts, and the bar must not
      // appear to go back to attempt 1.
      const attempt = Math.max(settled.attempt, event.attempt ?? settled.attempt);
      const [floor, ceiling] = windowFor(stage, attempt, settled.displayed);
      return {
        ...settled,
        stage,
        attempt,
        floor,
        ceiling,
        stageStartedAt: now,
        reached: settled.reached.includes(stage) ? settled.reached : [...settled.reached, stage],
      };
    }
    case "verdict":
      return event.approved
        ? { ...settled, lastIssue: undefined }
        : { ...settled, lastIssue: event.issue || "The reviewer asked for a revision." };
    case "result":
      return { ...settled, stage: null, done: true, displayed: 1, floor: 1, ceiling: 1 };
    case "error":
      return { ...settled, failed: true, error: event.message };
    default:
      return settled;
  }
}

/** Recomputes the creep within the current stage. Call on a timer. */
export function tickProgress(state: ProgressState, now: number): ProgressState {
  if (state.done) return state.displayed === 1 ? state : { ...state, displayed: 1 };
  if (!state.stage || state.failed) return state;

  const elapsed = Math.max(0, now - state.stageStartedAt);
  // Asymptotic: approaches the stage ceiling without ever arriving, so an
  // unexpectedly slow call cannot make the bar claim the stage is finished.
  const fraction = 1 - Math.exp(-elapsed / EXPECTED_MS[state.stage]);
  const candidate = state.floor + (state.ceiling - state.floor) * fraction;
  const next = Math.min(CEILING, Math.max(state.displayed, candidate));
  return next === state.displayed ? state : { ...state, displayed: next };
}

export type StageStatus = "done" | "active" | "pending";

/**
 * A retry genuinely puts us back at "writing", so the checklist shows that.
 * The bar does not rewind; the steps do, because that is what is happening.
 */
export function stageStatuses(
  state: ProgressState,
): { key: GenStage; label: string; blurb: string; status: StageStatus }[] {
  const current = state.stage ? STAGES.indexOf(state.stage) : state.done ? STAGES.length : -1;
  return STAGES.map((key, i) => ({
    key,
    label: STAGE_LABELS[key],
    blurb: STAGE_BLURBS[key],
    status: state.done || i < current ? "done" : i === current ? "active" : "pending",
  }));
}

export const percent = (state: ProgressState): number =>
  Math.round(Math.min(1, Math.max(0, state.displayed)) * 100);
