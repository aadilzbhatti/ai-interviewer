/**
 * Executes every reference solution in the question bank against its own test
 * cases, in both Python and JavaScript. Run with: npm run validate:bank
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { BANK } from "../src/lib/questions/index";
import type { Question, TestCaseResult } from "../src/lib/types";

const root = path.resolve(import.meta.dirname, "..");
const compareSrc = readFileSync(path.join(root, "public/workers/compare.js"), "utf8");
const harnessPath = path.join(root, "public/workers/harness.py");
const driverPath = path.join(root, "scripts/py-driver.py");

const sandbox: Record<string, unknown> = {};
vm.runInNewContext(compareSrc, sandbox);
const C = (sandbox as { __interviewCompare: {
  compareValues: (a: unknown, e: unknown, m: string) => { passed: boolean; actual: unknown; expected: unknown };
  stringify: (v: unknown) => string;
  normalize: (v: unknown) => unknown;
} }).__interviewCompare;

function runJs(q: Question): { error?: string; results: TestCaseResult[] } {
  let fn: ((...args: unknown[]) => unknown) | undefined;
  try {
    fn = new Function(
      '"use strict";\n' +
        q.reference.javascript +
        "\n;return typeof " + q.functionName + ' === "function" ? ' + q.functionName + " : undefined;",
    )() as ((...args: unknown[]) => unknown) | undefined;
  } catch (e) {
    return { error: `parse: ${(e as Error).message}`, results: [] };
  }
  if (typeof fn !== "function") {
    return { error: `reference does not define ${q.functionName}`, results: [] };
  }
  const results: TestCaseResult[] = [];
  for (const t of q.tests) {
    try {
      const out = fn(...(structuredClone(t.args) as unknown[]));
      const cmp = C.compareValues(out, t.expected, q.comparison || "exact");
      results.push({
        name: t.name || "case",
        passed: cmp.passed,
        hidden: !!t.hidden,
        expected: C.stringify(cmp.expected),
        actual: C.stringify(cmp.actual),
        durationMs: 0,
      });
    } catch (e) {
      results.push({
        name: t.name || "case",
        passed: false,
        hidden: !!t.hidden,
        expected: C.stringify(C.normalize(t.expected)),
        error: (e as Error).message,
        durationMs: 0,
      });
    }
  }
  return { results };
}

function runPy(q: Question): { error?: string; results: TestCaseResult[] } {
  const payload = JSON.stringify({
    code: q.reference.python,
    tests: q.tests,
    functionName: q.functionName,
    comparison: q.comparison || "exact",
  });
  try {
    const out = execFileSync("python3", [driverPath, harnessPath], {
      input: payload,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const lines = out.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  } catch (e) {
    return { error: `python driver failed: ${(e as Error).message}`, results: [] };
  }
}

let failures = 0;
const ids = new Set<string>();

for (const q of BANK) {
  if (ids.has(q.id)) {
    console.log(`DUPLICATE ID  ${q.id}`);
    failures++;
  }
  ids.add(q.id);

  for (const [label, run] of [
    ["js", runJs],
    ["py", runPy],
  ] as const) {
    const res = run(q);
    const bad = (res.results || []).filter((r) => !r.passed);
    if (res.error || bad.length) {
      failures++;
      console.log(`FAIL  ${q.id} [${label}]  ${res.error || `${bad.length}/${res.results.length} cases failed`}`);
      for (const b of bad.slice(0, 4)) {
        console.log(`        case "${b.name}": expected ${b.expected} got ${b.actual ?? "-"} ${b.error ? `(${b.error})` : ""}`);
      }
    } else {
      console.log(`ok    ${q.id} [${label}]  ${res.results.length} cases`);
    }
  }

  // Structural checks that the vetting agent also enforces on generated questions.
  const problems: string[] = [];
  if (q.tests.length < 5) problems.push("fewer than 5 tests");
  if (!q.tests.some((t) => t.hidden)) problems.push("no hidden tests");
  if (q.hints.length < 3) problems.push("hint ladder too short");
  if (!q.starter.python.includes(q.functionName)) problems.push("python starter missing the function name");
  if (!q.starter.javascript.includes(q.functionName)) problems.push("javascript starter missing the function name");
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${q.id} [structure]  ${problems.join("; ")}`);
  }
}

console.log(`\n${BANK.length} questions checked, ${failures} problem(s).`);
process.exit(failures ? 1 : 0);
