/**
 * Deciding which side of a failed soundness check is actually wrong.
 *
 * The recurring generator failure is not bad code — it is bad arithmetic. The
 * model writes a correct reference solution and then hand-computes the expected
 * values, getting some of them wrong. One real question came back with three of
 * twelve expectations wrong (3 vs 4, 38 vs 45, 60 vs 67) around a binary search
 * that was perfectly correct. Discarding that question costs a full ~35s
 * regeneration to fix three numbers.
 *
 * So when the reference disagrees with the tests, ask the OTHER language's
 * reference. Two separately written implementations do not independently
 * miscompute the same constant in the same way, so:
 *
 *   both references agree with each other, and differ from `expected`
 *       → the expectation is what is wrong. Correct it in place.
 *   the two references disagree with each other
 *       → the question is genuinely broken. Reject it.
 *
 * Deliberately all-or-nothing: if any failing case cannot be explained this
 * way, nothing is corrected and the question goes back for a repair. A
 * half-corrected question is worse than a rejected one.
 *
 * Pure — see scripts/validate-workers.ts.
 */
import type { Question, RunResult, TestCase } from "../types";

export interface Correction {
  name: string;
  /** Canonical JSON of what the question claimed. */
  was: string;
  /** Canonical JSON of what both references actually produce. */
  now: string;
}

export type CrossVerdict =
  | { kind: "correct-expectations"; tests: TestCase[]; corrections: Correction[] }
  | { kind: "inconclusive"; reason: string };

/**
 * Re-serializes a harness's JSON string into one canonical form.
 *
 * Necessary, not cosmetic: Python's json.dumps writes `[1, 2]` and the
 * JavaScript harness writes `[1,2]`. Comparing the raw strings across languages
 * would never match, and the whole check would silently do nothing.
 */
function canonical(raw: string | undefined): { ok: true; value: unknown; text: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  try {
    const value = JSON.parse(raw) as unknown;
    return { ok: true, value, text: stable(value) };
  } catch {
    // NaN, Infinity and Python's repr() fallback all land here. Not correctable.
    return { ok: false };
  }
}

function stable(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function crossCheck(
  question: Question,
  primary: RunResult,
  secondary: RunResult,
): CrossVerdict {
  if (question.comparison === "validator") {
    return { kind: "inconclusive", reason: "a validator question has no expected value to correct" };
  }
  if (primary.error || secondary.error) {
    return { kind: "inconclusive", reason: "a reference solution did not run at all" };
  }
  const n = question.tests.length;
  if (primary.results.length !== n || secondary.results.length !== n) {
    return { kind: "inconclusive", reason: "the two runs did not produce one result per test" };
  }

  const corrections: Correction[] = [];
  const tests: TestCase[] = [...question.tests];

  for (let i = 0; i < n; i++) {
    const a = primary.results[i];
    const b = secondary.results[i];
    const label = a.name || b.name || `case ${i + 1}`;

    if (a.passed && b.passed) continue;

    // One reference accepts the expectation and the other does not: the two
    // implementations genuinely disagree, so neither can be trusted as truth.
    if (a.passed !== b.passed) {
      return {
        kind: "inconclusive",
        reason: `the two reference solutions disagree on "${label}" — one passes it and the other does not`,
      };
    }
    if (a.error || b.error) {
      return { kind: "inconclusive", reason: `"${label}" threw inside a reference solution` };
    }

    const actualA = canonical(a.actual);
    const actualB = canonical(b.actual);
    if (!actualA.ok || !actualB.ok) {
      return { kind: "inconclusive", reason: `"${label}" produced a value that cannot be read back as JSON` };
    }
    if (actualA.text !== actualB.text) {
      return {
        kind: "inconclusive",
        reason: `the two reference solutions return different answers for "${label}" (${actualA.text} vs ${actualB.text})`,
      };
    }

    const claimed = canonical(a.expected);
    if (claimed.ok && claimed.text === actualA.text) {
      // They match but the case still failed — the disagreement is in the
      // comparison itself, not the value. Not ours to fix.
      return { kind: "inconclusive", reason: `"${label}" failed despite matching values` };
    }

    corrections.push({
      name: label,
      was: claimed.ok ? claimed.text : String(a.expected),
      now: actualA.text,
    });
    tests[i] = { ...tests[i], expected: actualA.value };
  }

  if (corrections.length === 0) {
    return { kind: "inconclusive", reason: "nothing failed that could be corrected" };
  }
  return { kind: "correct-expectations", tests, corrections };
}

/** One line per correction, for the log and the build screen. */
export function describeCorrections(corrections: Correction[]): string {
  const list = corrections.map((c) => `${c.name}: ${c.was} → ${c.now}`).join("; ");
  return `${corrections.length === 1 ? "One test case" : `${corrections.length} test cases`} had the wrong expected value (${list}). Both reference solutions agree on the corrected values.`;
}
