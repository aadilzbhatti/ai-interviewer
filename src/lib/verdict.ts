/**
 * Turning the grader's answer into a defensible one.
 *
 * Until now the rules connecting the 1-5 scores to the eight-point verdict
 * lived only in the assessment prompt — which is to say they were a request,
 * not a rule. The route parsed the model's JSON and forwarded it untouched, so
 * every assessment ever produced was whatever the model felt like returning:
 * four in a row came back "hire", one of them on scores of 4,2,2,3,2.
 *
 * This module is the part that actually holds. It is pure and time-free so the
 * rules can be tested directly, and every adjustment it makes is recorded and
 * shown to the candidate rather than applied behind their back — a report that
 * quietly disagrees with its own scores is the problem, and so is one that
 * quietly rewrites them.
 *
 * What it deliberately does NOT do: touch the scores. If the model wants a
 * gentler verdict it has to write scores that support it, in commentary the
 * candidate can read and argue with. Moving that pressure into the open is the
 * point.
 */
import { VERDICTS } from "./policy";
import type { Assessment, CriterionKey, CriterionReview, Verdict } from "./types";

export const CRITERION_KEYS: CriterionKey[] = [
  "problemSolving",
  "codeQuality",
  "communication",
  "testingRigor",
  "complexityAnalysis",
];

/** Strongest first, so a HIGHER index is a worse verdict. */
const RANK = new Map<Verdict, number>(VERDICTS.map((v, i) => [v, i]));

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && RANK.has(v as Verdict);
}

/**
 * A score the report can render, or null when the grader did not supply a
 * usable one.
 *
 * Null matters: the old code coerced a missing criterion to 0 and a
 * non-numeric one to NaN, so an omission was displayed as "0/5" — off the
 * bottom of a scale that starts at 1 — and a typo as "NaN/5". Neither is a
 * judgement anybody made about the candidate.
 */
export function normalizeScore(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

export interface Ceiling {
  /** The best verdict these scores can support, or null for no constraint. */
  cap: Verdict | null;
  /** Why, in words the candidate reads. Empty when there is no cap. */
  reason: string;
  /** Criteria that counted against the ceiling. */
  below: CriterionKey[];
  /** Criteria excluded because their evidence was voided, or absent. */
  ignored: CriterionKey[];
}

const LABEL: Record<CriterionKey, string> = {
  problemSolving: "problem solving",
  codeQuality: "code quality",
  communication: "communication",
  testingRigor: "testing rigor",
  complexityAnalysis: "complexity analysis",
};

const list = (keys: CriterionKey[]) => {
  const names = keys.map((k) => LABEL[k]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/**
 * The best verdict a set of scores can support.
 *
 * A 2 is defined on the scale as falling short of what this level is expected
 * to supply themselves, alone or with help they asked for. One
 * of those caps at leaning_no_hire; two, or any 1, caps at no_hire.
 *
 * A criterion marked `voided` is skipped entirely. That is the other half of
 * the unrequested-help rule: if the interviewer volunteered the approach, the
 * evidence for that criterion is gone, and missing evidence must never be
 * converted into a penalty.
 */
export function verdictCeiling(scores: Partial<Record<CriterionKey, CriterionReview>> | undefined): Ceiling {
  const below: CriterionKey[] = [];
  const failing: CriterionKey[] = [];
  const ignored: CriterionKey[] = [];

  for (const key of CRITERION_KEYS) {
    const entry = scores?.[key];
    const score = normalizeScore(entry?.score);
    if (entry?.voided || score === null) {
      ignored.push(key);
      continue;
    }
    if (score <= 1) failing.push(key);
    else if (score === 2) below.push(key);
  }

  if (failing.length > 0) {
    return {
      cap: "no_hire",
      reason: `${list(failing)} scored 1, which is not meeting the bar at all.`,
      below: [...failing, ...below],
      ignored,
    };
  }
  if (below.length >= 2) {
    return {
      cap: "no_hire",
      reason: `${list(below)} each scored 2 — below the bar on more than one count.`,
      below,
      ignored,
    };
  }
  if (below.length === 1) {
    return {
      cap: "leaning_no_hire",
      reason: `${list(below)} scored 2, meaning the interviewer supplied something this level is expected to supply themselves.`,
      below,
      ignored,
    };
  }
  return { cap: null, reason: "", below: [], ignored };
}

export interface VerdictAdjustment {
  from: string;
  to: Verdict;
  reason: string;
}

/**
 * Applies the ceiling, and repairs a verdict that is not on the scale at all.
 *
 * Returns a new assessment rather than mutating, with the adjustment recorded
 * on it. Nothing here silently improves a verdict: the ceiling can only move
 * one down.
 */
export function reconcileAssessment(assessment: Assessment): Assessment {
  const raw = assessment.verdict as unknown;
  const ceiling = verdictCeiling(assessment.scores);

  let verdict: Verdict;
  let adjustment: VerdictAdjustment | undefined;

  if (!isVerdict(raw)) {
    // Not a verdict at all. "neutral" is the only honest substitute: it is the
    // one value that claims nothing, and the reason says what happened.
    verdict = "neutral";
    adjustment = {
      from: typeof raw === "string" && raw ? raw : "(missing)",
      to: "neutral",
      reason:
        "The grader returned a verdict that is not on the scale, so this is recorded as neutral rather than guessed at.",
    };
  } else {
    verdict = raw;
  }

  if (ceiling.cap && (RANK.get(verdict) ?? 0) < (RANK.get(ceiling.cap) ?? 0)) {
    adjustment = {
      from: adjustment?.from ?? verdict,
      to: ceiling.cap,
      reason: `${ceiling.reason} The scores cap the verdict here; the grader wrote something more favourable and it was brought back in line.`,
    };
    verdict = ceiling.cap;
  }

  return adjustment ? { ...assessment, verdict, verdictAdjustment: adjustment } : { ...assessment, verdict };
}
