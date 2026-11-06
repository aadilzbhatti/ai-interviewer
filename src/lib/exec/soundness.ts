/**
 * Is a generated question actually usable? Lifted out of InterviewRoom so these
 * checks can run from a background job that outlives the screen that started it.
 * The reasoning below is unchanged from where it lived before.
 */
import { runTests } from "./runner";
import { adversaries } from "./adversaries";
import { crossCheck, describeCorrections } from "./crossCheck";
import { clientDebugLog } from "../clientDebug";
import type { Language, Question, RunResult } from "../types";

export type Soundness =
  | { kind: "ok" }
  /** The tests were wrong, not the solution, and both references agree on the fix. */
  | { kind: "corrected"; question: Question; note: string }
  | { kind: "unsound"; summary: string; failures: string[] };

const OTHER: Record<Language, Language> = { python: "javascript", javascript: "python" };

/**
 * Does this question hold up? Three gates.
 *
 * First the reference solution must pass the question's own tests. If it does
 * not, the second gate asks WHICH side is wrong — see crossCheck.ts — because
 * the usual answer is a hand-computed expected value, not the algorithm, and
 * throwing the question away to fix three numbers costs a 35-second rebuild.
 *
 * Then, for a validator question only, trivial answers must FAIL: with no
 * expected value to pin the answer down, a question can quietly accept "return
 * the input unchanged" and never exercise the algorithm. One real generation
 * produced exactly that — every acyclic input was already in a valid order, so
 * returning the input scored 8/12 without sorting anything.
 */
export async function checkSoundness(
  question: Question,
  language: Language,
  label: string,
): Promise<Soundness> {
  const check = await runTests({ language, code: question.reference[language], question });
  logExecCheck(label, question, language, check);

  if (!check.ok || check.passed !== check.total) {
    const rescued = await tryCorrectExpectations(question, language, check, label);
    if (rescued) return rescued;
    return {
      kind: "unsound",
      summary: "Its own tests disagreed with its own solution when run.",
      failures: check.error
        ? [check.error]
        : check.results
            .filter((r) => !r.passed)
            .map((r) => `case "${r.name}": expected ${r.expected}, reference returned ${r.actual ?? r.error}`),
    };
  }

  return adversaryGate(question, language, label);
}

/**
 * Asks the other language's reference whether the tests or the solution is
 * wrong, and if the tests are, rewrites them. The corrected question is then
 * re-verified from scratch: a correction that does not actually produce a clean
 * run is not a correction.
 */
async function tryCorrectExpectations(
  question: Question,
  language: Language,
  primary: RunResult,
  label: string,
): Promise<Soundness | null> {
  if (question.comparison === "validator" || primary.error) return null;

  const other = OTHER[language];
  const secondary = await runTests({ language: other, code: question.reference[other], question });
  const verdict = crossCheck(question, primary, secondary);

  clientDebugLog(`${label}:cross-check`, {
    questionId: question.id,
    language,
    otherLanguage: other,
    primary: `${primary.passed}/${primary.total}`,
    secondary: `${secondary.passed}/${secondary.total}`,
    verdict: verdict.kind,
    detail: verdict.kind === "inconclusive" ? verdict.reason : verdict.corrections,
  });

  if (verdict.kind === "inconclusive") return null;

  const fixed: Question = { ...question, tests: verdict.tests };
  const recheck = await runTests({ language, code: fixed.reference[language], question: fixed });
  logExecCheck(`${label}:after-correction`, fixed, language, recheck);
  if (!recheck.ok || recheck.passed !== recheck.total) return null;

  const gate = await adversaryGate(fixed, language, label);
  if (gate.kind !== "ok") return gate;
  return { kind: "corrected", question: fixed, note: describeCorrections(verdict.corrections) };
}

/** Trivial answers must fail a validator question, or its tests prove nothing. */
async function adversaryGate(
  question: Question,
  language: Language,
  label: string,
): Promise<Soundness> {
  if (question.comparison !== "validator") return { kind: "ok" };

  const report: Record<string, string> = {};
  const beaten: string[] = [];
  for (const probe of adversaries(question.functionName)) {
    const run = await runTests({ language, code: probe.code[language], question });
    report[probe.key] = `${run.passed}/${run.total}`;
    if (run.ok && run.total > 0 && run.passed === run.total) beaten.push(probe.label);
  }
  clientDebugLog(`${label}:adversary-probe`, { questionId: question.id, report, beaten });

  if (beaten.length === 0) return { kind: "ok" };
  return {
    kind: "unsound",
    summary: `A solution that ${beaten[0]} passes every test, so the tests never exercise the algorithm.`,
    failures: beaten.map(
      (label2) =>
        `A trivial solution that ${label2} passes EVERY test case. Your inputs do not defeat the lazy answer. Scramble the input order so it is not already a correct answer, and add cases where the trivial answers are clearly wrong.`,
    ),
  };
}

/**
 * The generated-question verification runs in a worker, so the debug log would
 * otherwise have a hole exactly where a bad question gets caught.
 */
export function logExecCheck(phase: string, q: Question, language: string, check: RunResult) {
  clientDebugLog(phase, {
    questionId: q.id,
    title: q.title,
    language,
    ok: check.ok,
    passed: check.passed,
    total: check.total,
    error: check.error,
    failing: check.results
      .filter((r) => !r.passed)
      .map((r) => ({ name: r.name, expected: r.expected, actual: r.actual, error: r.error })),
  });
}

