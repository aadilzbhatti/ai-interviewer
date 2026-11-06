/**
 * The scores-to-verdict rules, as rules rather than as a request.
 *
 * Why this file exists: every assessment the app ever produced was whatever the
 * model chose to return. Four in a row came back "hire", one of them on scores
 * of 4,2,2,3,2 — three criteria below the bar. The caps were written into the
 * prompt, which is to say they were advice. These tests cover the code that now
 * enforces them, including the ways enforcement could itself be unfair.
 * Run with: npm run validate:verdict
 */
import {
  normalizeScore,
  verdictCeiling,
  reconcileAssessment,
  isVerdict,
  CRITERION_KEYS,
} from "../src/lib/verdict";
import { VERDICTS } from "../src/lib/policy";
import type { Assessment, CriterionKey, CriterionReview } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

/** Scores in the order they appear in the report. */
function scores(
  values: (number | null)[],
  voided: CriterionKey[] = [],
): Record<CriterionKey, CriterionReview> {
  const out = {} as Record<CriterionKey, CriterionReview>;
  CRITERION_KEYS.forEach((k, i) => {
    out[k] = {
      score: values[i] as number,
      commentary: "x",
      ...(voided.includes(k) ? { voided: true } : {}),
    };
  });
  return out;
}

const assessment = (verdict: unknown, values: (number | null)[], voided: CriterionKey[] = []) =>
  ({
    verdict,
    headline: "h",
    barJudgedAgainst: "b",
    debrief: "d",
    scores: scores(values, voided),
    codeReview: { summary: "", correctness: "", complexity: "", readability: "", edgeCases: "", changeRequests: [] },
    timeline: [],
    strengths: [],
    gaps: [],
    coaching: [],
    levelReadout: "",
    helpAdjustment: "",
    concessionReadout: "",
  }) as unknown as Assessment;

// --- reading a score off a model's JSON -------------------------------------
{
  check("score: a plain number passes through", normalizeScore(4) === 4);
  check("score: a stringified number is accepted", normalizeScore("3") === 3);
  check("score: whitespace does not break it", normalizeScore(" 5 ") === 5);
  check("score: a fraction rounds to the scale", normalizeScore(3.7) === 4);
  // Each of these used to reach the report as a number: 0/5 or NaN/5.
  check("score: a missing score is not a zero", normalizeScore(undefined) === null);
  check("score: null is not a zero", normalizeScore(null) === null);
  check("score: prose is not a NaN", normalizeScore("high") === null);
  check("score: 0 is off the scale, not the bottom of it", normalizeScore(0) === null);
  check("score: 6 is rejected rather than clamped to 5", normalizeScore(6) === null);
  check("score: a negative is rejected", normalizeScore(-2) === null);
  check("score: infinity is rejected", normalizeScore(Infinity) === null);
}

// --- what the scores allow --------------------------------------------------
{
  check("ceiling: all threes constrain nothing", verdictCeiling(scores([3, 3, 3, 3, 3])).cap === null);
  check("ceiling: all fives constrain nothing", verdictCeiling(scores([5, 5, 5, 5, 5])).cap === null);

  const one = verdictCeiling(scores([3, 3, 3, 2, 3]));
  check("ceiling: one 2 caps at leaning_no_hire", one.cap === "leaning_no_hire", String(one.cap));
  check("ceiling: and names the criterion", one.reason.includes("testing rigor"), one.reason);

  const two = verdictCeiling(scores([3, 2, 3, 2, 3]));
  check("ceiling: two 2s cap at no_hire", two.cap === "no_hire", String(two.cap));
  check("ceiling: and names both", two.reason.includes("code quality") && two.reason.includes("testing rigor"), two.reason);

  const one1 = verdictCeiling(scores([3, 3, 3, 3, 1]));
  check("ceiling: a single 1 caps at no_hire", one1.cap === "no_hire", String(one1.cap));

  // The real report that started this. 4,2,2,3,2 came back "hire".
  const real = verdictCeiling(scores([4, 2, 2, 3, 2]));
  check("ceiling: the report that started this caps at no_hire", real.cap === "no_hire", String(real.cap));
  check("ceiling: it lists all three failing criteria", real.below.length === 3, real.below.join(","));
}

// --- enforcement can only move a verdict DOWN -------------------------------
{
  const r = reconcileAssessment(assessment("hire", [4, 2, 2, 3, 2]));
  check("reconcile: an unsupported hire is corrected", r.verdict === "no_hire", r.verdict);
  check("reconcile: and the correction is disclosed", !!r.verdictAdjustment, JSON.stringify(r.verdictAdjustment));
  check("reconcile: the original verdict is preserved for the report", r.verdictAdjustment?.from === "hire");
  check("reconcile: the reason cites the scores", /scored 2/.test(r.verdictAdjustment?.reason ?? ""), r.verdictAdjustment?.reason);

  const kept = reconcileAssessment(assessment("no_hire", [3, 3, 3, 3, 3]));
  check("reconcile: a harsh verdict on fine scores is LEFT ALONE", kept.verdict === "no_hire", kept.verdict);
  check("reconcile: nothing is disclosed when nothing changed", !kept.verdictAdjustment);

  const worse = reconcileAssessment(assessment("strong_no_hire", [3, 3, 3, 2, 3]));
  check(
    "reconcile: a verdict already below the cap is not raised to meet it",
    worse.verdict === "strong_no_hire",
    worse.verdict,
  );

  const exact = reconcileAssessment(assessment("leaning_no_hire", [3, 3, 3, 2, 3]));
  check("reconcile: a verdict exactly at the cap is untouched", exact.verdict === "leaning_no_hire" && !exact.verdictAdjustment);

  // Every verdict above the cap must land ON the cap, not somewhere else.
  for (const v of VERDICTS) {
    const out = reconcileAssessment(assessment(v, [3, 3, 3, 2, 3]));
    const capped = VERDICTS.indexOf(out.verdict) >= VERDICTS.indexOf("leaning_no_hire");
    check(`reconcile: "${v}" ends at or below the cap`, capped, out.verdict);
  }
}

// --- a verdict that is not a verdict ----------------------------------------
{
  check("verdict: the eight are recognised", VERDICTS.every(isVerdict));
  check("verdict: an invented one is not", !isVerdict("definitely_hire"));
  check("verdict: an object is not", !isVerdict({ verdict: "hire" }));

  const junk = reconcileAssessment(assessment("definitely_hire", [3, 3, 3, 3, 3]));
  check("verdict: junk becomes neutral rather than a guess", junk.verdict === "neutral", junk.verdict);
  check("verdict: and says so", /not on the scale/.test(junk.verdictAdjustment?.reason ?? ""));

  const missing = reconcileAssessment(assessment(undefined, [3, 3, 3, 3, 3]));
  check("verdict: a missing verdict becomes neutral", missing.verdict === "neutral");
  check("verdict: recorded as missing, not invented", missing.verdictAdjustment?.from === "(missing)");

  // Junk AND unsupported scores: the cap still has to win.
  const both = reconcileAssessment(assessment("amazing", [3, 2, 2, 3, 3]));
  check("verdict: junk plus failing scores lands on the cap", both.verdict === "no_hire", both.verdict);
}

// --- the ways enforcement could itself be unfair ----------------------------
{
  // A voided criterion is the unrequested-help case. It must not cap anything,
  // even if the grader also wrote a low number next to it.
  const voided = verdictCeiling(scores([3, 3, 3, 2, 3], ["testingRigor"]));
  check("fairness: a voided criterion cannot cap the verdict", voided.cap === null, String(voided.cap));
  check("fairness: and is recorded as ignored", voided.ignored.includes("testingRigor"));

  const r = reconcileAssessment(assessment("hire", [3, 3, 3, 2, 3], ["testingRigor"]));
  check("fairness: so the verdict stands untouched", r.verdict === "hire" && !r.verdictAdjustment, r.verdict);

  // Two 2s where one is voided is a single 2, not a no_hire.
  const mixed = verdictCeiling(scores([3, 2, 3, 2, 3], ["codeQuality"]));
  check("fairness: voiding one of two 2s leaves the milder cap", mixed.cap === "leaning_no_hire", String(mixed.cap));

  // A score the grader failed to return must not be read as a failure.
  const absent = verdictCeiling(scores([3, 3, 3, null, 3]));
  check("fairness: a missing score does not cap anything", absent.cap === null, String(absent.cap));
  check("fairness: it is ignored, not counted as a 2", absent.ignored.includes("testingRigor"));

  const garbage = verdictCeiling({
    problemSolving: { score: "unrated" as unknown as number, commentary: "" },
  });
  check("fairness: a fully unusable score set caps nothing", garbage.cap === null, String(garbage.cap));

  // And the empty case: no scores at all is no evidence, not a no_hire.
  check("fairness: no scores at all caps nothing", verdictCeiling(undefined).cap === null);
}

// --- the scores themselves are never touched --------------------------------
{
  const before = assessment("hire", [4, 2, 2, 3, 2]);
  const after = reconcileAssessment(before);
  const same = CRITERION_KEYS.every((k) => after.scores[k].score === before.scores[k].score);
  check("integrity: enforcement never edits a score", same);
  check("integrity: nor the commentary", after.scores.problemSolving.commentary === "x");
  check("integrity: nor the debrief", after.debrief === "d");
  check("integrity: the input object is not mutated", (before.verdict as string) === "hire");
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
