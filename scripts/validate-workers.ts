/**
 * Exercises the actual worker files (public/workers/js-worker.js and
 * public/workers/harness.py) outside a browser: happy path plus the failure
 * modes a candidate will actually hit. Run with: npm run validate:workers
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { byId } from "../src/lib/questions/index";
import { adversaries } from "../src/lib/exec/adversaries";
import { crossCheck } from "../src/lib/exec/crossCheck";
import type { Question, RunResult } from "../src/lib/types";

const root = path.resolve(import.meta.dirname, "..");

interface Reply {
  ok: boolean;
  error?: string;
  results: { name: string; passed: boolean; error?: string }[];
  stdout?: string;
}

function runJsWorker(q: Question, code: string): Reply {
  let reply: Reply | undefined;
  const ctx: Record<string, unknown> = {
    console: { log: console.log, error: console.error },
    structuredClone,
    Date,
    Math,
    JSON,
    postMessage: (p: Reply) => {
      reply = p;
    },
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.importScripts = (p: string) =>
    vm.runInContext(readFileSync(path.join(root, "public", p), "utf8"), ctx);
  vm.runInContext(readFileSync(path.join(root, "public/workers/js-worker.js"), "utf8"), ctx);
  const handler = ctx.onmessage as (ev: { data: unknown }) => void;
  handler({
    data: {
      code,
      tests: q.tests,
      functionName: q.functionName,
      comparison: q.comparison || "exact",
      validator: q.validator?.javascript,
    },
  });
  if (!reply) throw new Error("worker never posted a message");
  return reply;
}

function runPyWorkerLike(q: Question, code: string): Reply {
  const out = execFileSync("python3", [
    path.join(root, "scripts/py-driver.py"),
    path.join(root, "public/workers/harness.py"),
  ], {
    input: JSON.stringify({
      code,
      tests: q.tests,
      functionName: q.functionName,
      comparison: q.comparison || "exact",
      validator: q.validator?.python,
    }),
    encoding: "utf8",
    timeout: 60_000,
  });
  const parsed = JSON.parse(out.trim().split("\n").pop() as string);
  return { ok: !parsed.error, error: parsed.error, results: parsed.results };
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const q = byId("largest-swing")!;
const spiral = byId("spiral-seating")!;

// --- JavaScript worker ------------------------------------------------------
{
  const r = runJsWorker(q, q.reference.javascript);
  check("js: reference passes", r.ok && r.results.every((x) => x.passed), JSON.stringify(r).slice(0, 300));
}
{
  const r = runJsWorker(q, "function largest_swing(a) { return 0; }");
  const failed = r.results.filter((x) => !x.passed).length;
  check("js: wrong answer fails some cases", r.ok && failed > 0 && failed < r.results.length, `${failed} failed`);
}
{
  const r = runJsWorker(q, "function largest_swing(a) { return");
  check("js: syntax error is reported", !r.ok && !!r.error, r.error || "no error");
}
{
  const r = runJsWorker(q, "function something_else(a) { return 1; }");
  check("js: missing function is reported", !r.ok && /No function named/.test(r.error || ""), r.error || "");
}
{
  const r = runJsWorker(q, "function largest_swing(a) { throw new Error('boom'); }");
  check(
    "js: thrown error is per-case, not fatal",
    r.ok && r.results.every((x) => !x.passed && /boom/.test(x.error || "")),
    JSON.stringify(r.results[0]),
  );
}
{
  const r = runJsWorker(q, "function largest_swing(a) { console.log('hi', {x:1}); return 0; }");
  check("js: stdout is captured", (r.stdout || "").includes("hi"), r.stdout || "");
}
{
  const r = runJsWorker(
    spiral,
    "function spiral_order(g) { g.length = 0; return []; }",
  );
  check(
    "js: mutating the input does not corrupt later cases",
    r.ok && r.results.some((x) => x.passed) && r.results.some((x) => !x.passed),
    JSON.stringify(r.results.map((x) => x.passed)),
  );
}

// --- Python harness ---------------------------------------------------------
{
  const r = runPyWorkerLike(q, q.reference.python);
  check("py: reference passes", r.ok && r.results.every((x) => x.passed), JSON.stringify(r).slice(0, 300));
}
{
  const r = runPyWorkerLike(q, "def largest_swing(readings):\n    return 0\n");
  const failed = r.results.filter((x) => !x.passed).length;
  check("py: wrong answer fails some cases", r.ok && failed > 0 && failed < r.results.length, `${failed} failed`);
}
{
  const r = runPyWorkerLike(q, "def largest_swing(readings)\n    return 0\n");
  check("py: syntax error is reported", !r.ok && /SyntaxError/.test(r.error || ""), r.error || "");
}
{
  const r = runPyWorkerLike(q, "def other(readings):\n    return 0\n");
  check("py: missing function is reported", !r.ok && /No function named/.test(r.error || ""), r.error || "");
}
{
  const r = runPyWorkerLike(q, "def largest_swing(readings):\n    raise ValueError('boom')\n");
  check(
    "py: raised error is per-case, not fatal",
    r.ok && r.results.every((x) => !x.passed && /boom/.test(x.error || "")),
    JSON.stringify(r.results[0]),
  );
}
{
  const r = runPyWorkerLike(q, "def largest_swing(readings):\n    return 1 / 0\n");
  check("py: zero division is caught", r.ok && r.results.every((x) => !x.passed), "");
}
{
  const r = runPyWorkerLike(
    spiral,
    "def spiral_order(grid):\n    grid.clear()\n    return []\n",
  );
  check(
    "py: mutating the input does not corrupt later cases",
    r.ok && r.results.some((x) => x.passed) && r.results.some((x) => !x.passed),
    JSON.stringify(r.results.map((x) => x.passed)),
  );
}
{
  // Tuples returned from Python must compare equal to JSON arrays.
  const r = runPyWorkerLike(
    byId("merge-maintenance-windows")!,
    "def merge_windows(windows):\n    if not windows:\n        return []\n    o = sorted(windows)\n    out = [(o[0][0], o[0][1])]\n    for s, e in o[1:]:\n        if s <= out[-1][1]:\n            out[-1] = (out[-1][0], max(out[-1][1], e))\n        else:\n            out.append((s, e))\n    return out\n",
  );
  check("py: tuples compare equal to JSON arrays", r.ok && r.results.every((x) => x.passed), JSON.stringify(r.results.filter((x) => !x.passed)));
}


let MULTI_QUESTION: Question | null = null;

// --- validator comparison: problems with more than one right answer ---------
// The candidate's order need not match the reference's; it must merely be a
// correct order. This is the mode that exists so "return any valid execution
// order" can be asked at all.
{
  const PY_CHECK = [
    "def check(args, output):",
    "    jobs, deps = args[0], args[1]",
    "    indeg = {j: 0 for j in jobs}",
    "    out = {j: [] for j in jobs}",
    "    for a, b in deps:",
    "        out[a].append(b)",
    "        indeg[b] += 1",
    "    ready = [j for j in jobs if indeg[j] == 0]",
    "    seen = 0",
    "    while ready:",
    "        j = ready.pop()",
    "        seen += 1",
    "        for n in out[j]:",
    "            indeg[n] -= 1",
    "            if indeg[n] == 0:",
    "                ready.append(n)",
    "    if seen != len(jobs):",
    "        return output == []",
    "    if sorted(output) != sorted(jobs):",
    "        return False",
    "    pos = {j: i for i, j in enumerate(output)}",
    "    return all(pos[a] < pos[b] for a, b in deps)",
  ].join("\n");

  const JS_CHECK = [
    "function check(args, output) {",
    "  const jobs = args[0], deps = args[1];",
    "  const indeg = new Map(jobs.map((j) => [j, 0]));",
    "  const out = new Map(jobs.map((j) => [j, []]));",
    "  for (const [a, b] of deps) { out.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }",
    "  const ready = jobs.filter((j) => indeg.get(j) === 0);",
    "  let seen = 0;",
    "  while (ready.length) {",
    "    const j = ready.pop(); seen++;",
    "    for (const n of out.get(j)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) ready.push(n); }",
    "  }",
    "  if (seen !== jobs.length) return output.length === 0;",
    "  if ([...output].sort().join() !== [...jobs].sort().join()) return false;",
    "  const pos = new Map(output.map((j, i) => [j, i]));",
    "  return deps.every(([a, b]) => pos.get(a) < pos.get(b));",
    "}",
  ].join("\n");

  const PY_REF = [
    "def execution_order(jobs, deps):",
    "    indeg = {j: 0 for j in jobs}",
    "    out = {j: [] for j in jobs}",
    "    for a, b in deps:",
    "        out[a].append(b)",
    "        indeg[b] += 1",
    "    ready = [j for j in jobs if indeg[j] == 0]",
    "    order = []",
    "    while ready:",
    "        j = ready.pop()",  // pops from the end: deliberately not lexicographic
    "        order.append(j)",
    "        for n in out[j]:",
    "            indeg[n] -= 1",
    "            if indeg[n] == 0:",
    "                ready.append(n)",
    "    return order if len(order) == len(jobs) else []",
  ].join("\n");

  const JS_REF = [
    "function execution_order(jobs, deps) {",
    "  const indeg = new Map(jobs.map((j) => [j, 0]));",
    "  const out = new Map(jobs.map((j) => [j, []]));",
    "  for (const [a, b] of deps) { out.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }",
    "  const ready = jobs.filter((j) => indeg.get(j) === 0);",
    "  const order = [];",
    "  while (ready.length) {",
    "    const j = ready.pop(); order.push(j);",
    "    for (const n of out.get(j)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) ready.push(n); }",
    "  }",
    "  return order.length === jobs.length ? order : [];",
    "}",
  ].join("\n");

  const multi: Question = {
    id: "execution-order",
    title: "Execution order",
    prompt: "Return any valid execution order.",
    difficulty: "medium",
    jobLevels: ["mid"],
    roles: ["general"],
    topics: ["graphs"],
    functionName: "execution_order",
    starter: { python: "def execution_order(jobs, deps):\n    pass\n", javascript: "function execution_order(jobs, deps) {}" },
    reference: { python: PY_REF, javascript: JS_REF },
    tests: [
      // Input order is deliberately NOT a valid answer, so "return the input"
      // cannot pass by luck — the flaw a real generation shipped.
      { name: "chain", args: [["c", "a", "b"], [["a", "b"], ["b", "c"]]], expected: null },
      { name: "diamond", args: [["d", "b", "c", "a"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]], expected: null },
      { name: "independent", args: [["x", "y", "z"], []], expected: null },
      { name: "single", args: [["only"], []], expected: null },
      { name: "cycle yields empty", args: [["a", "b"], [["a", "b"], ["b", "a"]]], expected: null, hidden: true },
    ],
    comparison: "validator",
    validator: { python: PY_CHECK, javascript: JS_CHECK },
    hints: ["a", "b", "c"],
    followUps: [],
    optimal: { time: "O(V+E)", space: "O(V+E)" },
    source: "generated",
  };

  {
    const r = runPyWorkerLike(multi, multi.reference.python);
    check("validator/py: the reference is accepted", r.ok && r.results.every((x) => x.passed), JSON.stringify(r.results.filter((x) => !x.passed)));
  }
  {
    const r = runJsWorker(multi, multi.reference.javascript);
    check("validator/js: the reference is accepted", r.ok && r.results.every((x) => x.passed), JSON.stringify(r.results.filter((x) => !x.passed)));
  }
  {
    // A different-but-also-valid order must pass: that is the whole point.
    const reversedFirst = PY_REF.replace("j = ready.pop()", "j = ready.pop(0)");
    const r = runPyWorkerLike(multi, reversedFirst);
    check("validator/py: a different valid order also passes", r.ok && r.results.every((x) => x.passed), JSON.stringify(r.results.filter((x) => !x.passed)));
  }
  {
    const r = runPyWorkerLike(multi, "def execution_order(jobs, deps):\n    return list(reversed(jobs))\n");
    const failed = r.results.filter((x) => !x.passed).length;
    check("validator/py: an invalid order is rejected", r.ok && failed > 0, `${failed} failed of ${r.results.length}`);
  }
  {
    const r = runJsWorker(multi, "function execution_order(jobs, deps) { return [...jobs].reverse(); }");
    const failed = r.results.filter((x) => !x.passed).length;
    check("validator/js: an invalid order is rejected", r.ok && failed > 0, `${failed} failed`);
  }
  {
    const r = runPyWorkerLike(multi, multi.reference.python);
    check("validator/py: the report says any valid answer", r.results.every((x) => x.passed), "");
  }
  {
    const broken: Question = { ...multi, validator: { python: "def nope(): pass", javascript: "function nope() {}" } };
    const py = runPyWorkerLike(broken, broken.reference.python);
    check("validator/py: a missing check() is a clear error", !py.ok && /supplies no check/.test(py.error || ""), py.error || "");
    const js = runJsWorker(broken, broken.reference.javascript);
    check("validator/js: a missing check() is a clear error", !js.ok && /supplies no check/.test(js.error || ""), js.error || "");
  }
  {
    const broken: Question = { ...multi, validator: { python: "def check(args, output)\n    return True", javascript: "function check(args, output) { return" } };
    const py = runPyWorkerLike(broken, broken.reference.python);
    check("validator/py: a validator that will not compile is reported", !py.ok && /did not compile/.test(py.error || ""), py.error || "");
    const js = runJsWorker(broken, broken.reference.javascript);
    check("validator/js: a validator that will not parse is reported", !js.ok && /did not parse/.test(js.error || ""), js.error || "");
  }
  {
    const throwing: Question = { ...multi, validator: { python: "def check(args, output):\n    raise ValueError('bad checker')", javascript: "function check() { throw new Error('bad checker'); }" } };
    const py = runPyWorkerLike(throwing, throwing.reference.python);
    check("validator/py: a throwing validator fails cases rather than the run", py.ok && py.results.every((x) => !x.passed && /bad checker/.test(x.error || "")), JSON.stringify(py.results[0]));
    const js = runJsWorker(throwing, throwing.reference.javascript);
    check("validator/js: a throwing validator fails cases rather than the run", js.ok && js.results.every((x) => !x.passed && /bad checker/.test(x.error || "")), JSON.stringify(js.results[0]));
  }
  MULTI_QUESTION = multi;
}


// --- the payload contract between runner, workers and harness ---------------
// The Python path failed every validator question 0/12 because py-worker.js
// built the harness payload by hand and simply omitted `validator`. Nothing
// caught it: these tests drive harness.py directly, so the worker that feeds it
// was never exercised. This checks the seams instead of the pieces.
{
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  const runnerSrc = read("src/lib/exec/runner.ts");
  const pyWorker = read("public/workers/py-worker.js");
  const jsWorker = read("public/workers/js-worker.js");
  const harnessSrc = read("public/workers/harness.py");

  const keysIn = (block: string) =>
    [...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/gm)].map((m) => m[1]);

  // EVERY postMessage, not just the first. Scratch mode posts its own payload,
  // and checking only runTests' would have missed `mode` and `call` entirely —
  // which is exactly how `validator` went missing the first time.
  const messages = [...runnerSrc.matchAll(/worker\.postMessage\(\{([\s\S]*?)\}\);/g)].map(
    (m) => m[1],
  );
  check("contract: every runner entry point is checked", messages.length >= 2, `${messages.length} postMessage call(s)`);
  const posted = [...new Set(messages.flatMap(keysIn))];
  check("contract: the runner posts the expected fields", posted.length >= 5, posted.join(","));

  for (const [name, src] of [
    ["py-worker", pyWorker],
    ["js-worker", jsWorker],
  ] as const) {
    // A worker may destructure a field or reach for it as ev.data.x; either way
    // it has to actually read it.
    const destructured = /const \{([^}]*)\} = ev\.data;/.exec(src)?.[1] ?? "";
    for (const key of posted) {
      check(
        `contract: ${name} reads "${key}" off the message`,
        destructured.includes(key) || src.includes(`ev.data.${key}`),
        destructured.trim(),
      );
    }
  }

  // Everything harness.py pulls out of __payload must be put there by py-worker.
  const needed = [
    ...new Set(
      [...harnessSrc.matchAll(/payload(?:\[|\.get\()\s*["']([A-Za-z_]+)["']/g)].map((m) => m[1]),
    ),
  ];
  check("contract: the harness reads a payload at all", needed.length >= 4, needed.join(","));

  const payloadBlock = /JSON\.stringify\(\{([\s\S]*?)\}\)/.exec(pyWorker)?.[1] ?? "";
  for (const key of needed) {
    check(
      `contract: py-worker forwards "${key}" to harness.py`,
      payloadBlock.includes(key),
      payloadBlock.replace(/\s+/g, " ").trim().slice(0, 140),
    );
  }
}


const multi = MULTI_QUESTION!;

// --- trivial answers must fail --------------------------------------------
// A fixed expected value pins the answer down; a validator does not, so a
// question can accept "return the input" and test nothing. These prove the
// probe catches that.
{
  const probes = adversaries(multi.functionName);
  check("adversaries: three of them, in both languages", probes.length === 3 && probes.every((a) => a.code.python && a.code.javascript));

  for (const probe of probes) {
    const py = runPyWorkerLike(multi, probe.code.python);
    const js = runJsWorker(multi, probe.code.javascript);
    check(
      `adversary "${probe.key}": runs without breaking the harness (py)`,
      py.ok || !!py.error,
      py.error || "",
    );
    check(
      `adversary "${probe.key}": does not pass a sound question (py)`,
      !py.ok || py.results.some((r) => !r.passed),
      `${py.results.filter((r) => r.passed).length}/${py.results.length}`,
    );
    check(
      `adversary "${probe.key}": does not pass a sound question (js)`,
      !js.ok || js.results.some((r) => !r.passed),
      `${js.results.filter((r) => r.passed).length}/${js.results.length}`,
    );
  }

  // A validator that waves everything through is exactly what the probe is for.
  const weak: Question = {
    ...multi,
    validator: {
      python: "def check(args, output):\n    return True",
      javascript: "function check(args, output) { return true; }",
    },
  };
  const identity = probes.find((a) => a.key === "identity")!;
  const weakPy = runPyWorkerLike(weak, identity.code.python);
  const weakJs = runJsWorker(weak, identity.code.javascript);
  check(
    "adversary: a rubber-stamp validator is caught (py)",
    weakPy.ok && weakPy.results.every((r) => r.passed),
    "the probe should pass everything here, which is what trips the gate",
  );
  check(
    "adversary: a rubber-stamp validator is caught (js)",
    weakJs.ok && weakJs.results.every((r) => r.passed),
    "",
  );

  // And tests whose inputs are already in a valid order are equally weak, even
  // with a correct validator — the case found in a real generated question.
  const lazyTests: Question = {
    ...multi,
    tests: [
      { name: "already sorted", args: [["a", "b", "c"], [["a", "b"], ["b", "c"]]], expected: null },
      { name: "also already sorted", args: [["a", "b"], [["a", "b"]]], expected: null },
    ],
  };
  const lazy = runPyWorkerLike(lazyTests, identity.code.python);
  check(
    "adversary: inputs already in a valid order are caught too",
    lazy.ok && lazy.results.every((r) => r.passed),
    `${lazy.results.filter((r) => r.passed).length}/${lazy.results.length}`,
  );
}

// ---- the two harnesses must accept the same function-name spellings --------
/**
 * Found the hard way: a generated question declared functionName
 * "min_processing_rate" and shipped a JavaScript reference AND candidate
 * starter called "minProcessingRate". Every JavaScript run on it failed 0/N
 * with "No function named ...", which reads to a candidate as their own bug.
 * The generator writes idiomatically per language, so both spellings are legal.
 */
{
  const namesJs = (() => {
    const ctx: Record<string, unknown> = {};
    ctx.self = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync(path.join(root, "public/workers/names.js"), "utf8"), ctx);
    return (ctx.__interviewNames as { variants: (n: string) => string[] }).variants;
  })();

  const namesPy = (name: string): string[] =>
    JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          `import json,sys;__payload=json.dumps({"code":"","tests":[],"functionName":"x"});exec(open(${JSON.stringify(path.join(root, "public/workers/harness.py"))}).read());print(json.dumps(_name_variants(sys.argv[1])))`,
          name,
        ],
        { encoding: "utf8" },
      ),
    );

  for (const name of [
    "min_processing_rate",
    "minProcessingRate",
    "execution_order",
    "solve",
    "parseHTTPResponse",
    "count_words_2",
  ]) {
    const a = namesJs(name);
    const b = namesPy(name);
    check(
      `names: both harnesses agree on the spellings for "${name}"`,
      JSON.stringify(a) === JSON.stringify(b),
      `js=${JSON.stringify(a)} py=${JSON.stringify(b)}`,
    );
    check(`names: "${name}" is itself always accepted first`, a[0] === name, JSON.stringify(a));
  }
  check(
    "names: a snake_case declaration also accepts the camelCase spelling",
    namesJs("min_processing_rate").includes("minProcessingRate"),
    JSON.stringify(namesJs("min_processing_rate")),
  );
  check(
    "names: and a camelCase declaration accepts the snake_case spelling",
    namesJs("minProcessingRate").includes("min_processing_rate"),
    JSON.stringify(namesJs("minProcessingRate")),
  );

  // The regression itself, through the real workers.
  const sample = byId("two-sum-indices") ?? Object.values(byId as unknown as Record<string, Question>)[0];
  if (sample) {
    const snakeDeclared: Question = { ...sample, functionName: toSnakeCase(sample.functionName) };
    const camelCode = sample.reference.javascript.replace(
      new RegExp(`\\b${sample.functionName}\\b`, "g"),
      toCamelCase(sample.functionName),
    );
    const reply = runJsWorker(snakeDeclared, camelCode);
    check(
      "names: a camelCase JavaScript reference satisfies a snake_case functionName",
      reply.ok && reply.results.length > 0 && reply.results.every((r) => r.passed),
      reply.error || `${reply.results.filter((r) => r.passed).length}/${reply.results.length}`,
    );
  }
}

function toSnakeCase(s: string) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function toCamelCase(s: string) {
  const parts = toSnakeCase(s).split("_").filter(Boolean);
  return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

// ---- cross-language adjudication of a failed soundness check ---------------
/**
 * The fixture is a real failure, not an invented one: "Minimum GPU Processing
 * Rate", generated 17:02 on 15 Sep, whose binary-search reference was correct
 * and whose expected values were wrong on 3 of 12 cases. The strings below are
 * shaped exactly as the two harnesses emit them — note Python's `json.dumps`
 * spacing versus the JavaScript harness's, which is the trap this has to
 * survive.
 */
{
  const q = (tests: { name: string; expected: unknown }[]): Question =>
    ({
      id: "minimum-gpu-processing-rate",
      title: "Minimum GPU Processing Rate",
      comparison: "exact",
      tests: tests.map((t) => ({ name: t.name, args: [[1], 1], expected: t.expected })),
    }) as unknown as Question;

  const run = (
    rows: { name: string; passed: boolean; expected?: string; actual?: string; error?: string }[],
    error?: string,
  ): RunResult =>
    ({
      ok: !error,
      language: "python",
      passed: rows.filter((r) => r.passed).length,
      total: rows.length,
      results: rows.map((r) => ({ ...r, hidden: false, durationMs: 1 })),
      stdout: "",
      error,
      durationMs: 10,
      at: 0,
    }) as RunResult;

  {
    // The real case: both references return 4 where the question claims 3.
    const question = q([
      { name: "Small batches", expected: 4 },
      { name: "Many small batches", expected: 3 },
    ]);
    const py = run([
      { name: "Small batches", passed: true, expected: "4", actual: "4" },
      { name: "Many small batches", passed: false, expected: "3", actual: "4" },
    ]);
    const js = run([
      { name: "Small batches", passed: true, expected: "4", actual: "4" },
      { name: "Many small batches", passed: false, expected: "3", actual: "4" },
    ]);
    const verdict = crossCheck(question, py, js);
    check("cross: agreeing references correct the expectation", verdict.kind === "correct-expectations");
    if (verdict.kind === "correct-expectations") {
      check("cross: the corrected value is the one both produced", verdict.tests[1].expected === 4);
      check("cross: the passing case is left alone", verdict.tests[0].expected === 4);
      check("cross: and exactly one correction is reported", verdict.corrections.length === 1);
    }
  }
  {
    // The trap: Python writes "[1, 2]", JavaScript writes "[1,2]". Comparing
    // the raw strings would call these different and silently correct nothing.
    const question = q([{ name: "ordering", expected: [9, 9] }]);
    const py = run([{ name: "ordering", passed: false, expected: "[9, 9]", actual: "[1, 2]" }]);
    const js = run([{ name: "ordering", passed: false, expected: "[9,9]", actual: "[1,2]" }]);
    const verdict = crossCheck(question, py, js);
    check(
      "cross: harness spacing differences do not defeat the comparison",
      verdict.kind === "correct-expectations",
      verdict.kind === "inconclusive" ? verdict.reason : "",
    );
    if (verdict.kind === "correct-expectations") {
      check(
        "cross: and the corrected value is a real array, not its text",
        Array.isArray(verdict.tests[0].expected) &&
          JSON.stringify(verdict.tests[0].expected) === "[1,2]",
      );
    }
  }
  {
    // The safety case: if the two references disagree, the question is broken
    // and nothing may be adopted as truth.
    const question = q([{ name: "disputed", expected: 3 }]);
    const py = run([{ name: "disputed", passed: false, expected: "3", actual: "4" }]);
    const js = run([{ name: "disputed", passed: false, expected: "3", actual: "5" }]);
    check("cross: disagreeing references correct nothing", crossCheck(question, py, js).kind === "inconclusive");
  }
  {
    // One passes, one fails — also a disagreement, and a subtler one.
    const question = q([{ name: "disputed", expected: 3 }]);
    const py = run([{ name: "disputed", passed: true, expected: "3", actual: "3" }]);
    const js = run([{ name: "disputed", passed: false, expected: "3", actual: "4" }]);
    check(
      "cross: one reference passing and the other failing is inconclusive",
      crossCheck(question, py, js).kind === "inconclusive",
    );
  }
  {
    const question = q([{ name: "boom", expected: 1 }]);
    const py = run([{ name: "boom", passed: false, expected: "1", error: "ZeroDivisionError" }]);
    const js = run([{ name: "boom", passed: false, expected: "1", error: "TypeError" }]);
    check("cross: a throwing reference is never corrected", crossCheck(question, py, js).kind === "inconclusive");
  }
  {
    const question = q([{ name: "a", expected: 1 }]);
    check(
      "cross: a reference that did not run at all is inconclusive",
      crossCheck(question, run([], "SyntaxError"), run([{ name: "a", passed: false }])).kind ===
        "inconclusive",
    );
  }
  {
    // NaN and Python's repr() fallback are not JSON, so they cannot be adopted.
    const question = q([{ name: "weird", expected: 1 }]);
    const py = run([{ name: "weird", passed: false, expected: "1", actual: "NaN" }]);
    const js = run([{ name: "weird", passed: false, expected: "1", actual: "NaN" }]);
    check("cross: a value that is not JSON is never adopted", crossCheck(question, py, js).kind === "inconclusive");
  }
  {
    const question = { ...q([{ name: "a", expected: 1 }]), comparison: "validator" } as Question;
    const rows = [{ name: "a", passed: false, expected: "any valid answer", actual: "2" }];
    check(
      "cross: a validator question has no expectation to correct",
      crossCheck(question, run(rows), run(rows)).kind === "inconclusive",
    );
  }
  {
    // Result counts must line up with the tests, or the pairing is meaningless.
    const question = q([{ name: "a", expected: 1 }, { name: "b", expected: 2 }]);
    const short = run([{ name: "a", passed: false, expected: "1", actual: "9" }]);
    check(
      "cross: a truncated run is inconclusive",
      crossCheck(question, short, short).kind === "inconclusive",
    );
  }
}


// --- the private scratchpad -------------------------------------------------
// The candidate's own code, run their own way. It shares a worker with the test
// harness, so the thing worth proving is that it stays a different shape: no
// results array, and a compile failure that says so instead of being reported
// as a thrown exception.

interface ScratchReply {
  ok: boolean;
  phase?: string;
  error?: string;
  where?: unknown;
  stdout?: string;
  value?: string;
  hasValue?: boolean;
  results?: unknown[];
}

function scratchJs(code: string, call?: string): ScratchReply {
  let reply: ScratchReply | undefined;
  const ctx: Record<string, unknown> = {
    console: { log: () => {}, error: () => {} },
    structuredClone,
    Date,
    Math,
    JSON,
    postMessage: (p: ScratchReply) => {
      reply = p;
    },
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.importScripts = (p: string) =>
    vm.runInContext(readFileSync(path.join(root, "public", p), "utf8"), ctx);
  vm.runInContext(readFileSync(path.join(root, "public/workers/js-worker.js"), "utf8"), ctx);
  (ctx.onmessage as (ev: { data: unknown }) => void)({ data: { mode: "scratch", code, call } });
  if (!reply) throw new Error("worker never posted a message");
  return reply;
}

function scratchPy(code: string, call?: string): ScratchReply {
  const out = execFileSync(
    "python3",
    [path.join(root, "scripts/py-driver.py"), path.join(root, "public/workers/harness.py")],
    {
      input: JSON.stringify({ mode: "scratch", code, call }),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  return JSON.parse(out.trim().split("\n").pop() as string) as ScratchReply;
}

for (const [lang, scratch, print, bad, boom] of [
  ["js", scratchJs, "console.log(f(21));", "function f(x {", "null.x;"],
  ["py", scratchPy, "print(f(21))", "def f(x)", "1/0"],
] as [string, (c: string, call?: string) => ScratchReply, string, string, string][]) {
  const def = lang === "js" ? "function f(x){ return x * 2 }" : "def f(x):\n    return x * 2";

  {
    const r = scratch(`${def}\n${print}`);
    check(`scratch/${lang}: runs the file and returns what it printed`, r.ok && (r.stdout || "").includes("42"), JSON.stringify(r));
    check(`scratch/${lang}: is never shaped like a test run`, !r.results || r.results.length === 0);
    check(`scratch/${lang}: reports no value when no call was given`, !r.hasValue);
  }
  {
    // The question this feature exists to answer: does my code even compile?
    const r = scratch(bad);
    check(`scratch/${lang}: a syntax error is caught`, !r.ok && !!r.error, JSON.stringify(r));
    check(`scratch/${lang}: and is named as a compile failure, not a crash`, r.phase === "compile", String(r.phase));
    check(`scratch/${lang}: the message mentions the syntax`, /syntax/i.test(r.error || ""), r.error);
  }
  {
    const r = scratch(`${def}\n${boom}`);
    check(`scratch/${lang}: a runtime error is separated from a compile error`, r.phase === "run", String(r.phase));
    check(`scratch/${lang}: and points at the line it happened on`, !!r.where, JSON.stringify(r.where));
  }
  {
    const r = scratch(def, "f(4)");
    check(`scratch/${lang}: a call expression is evaluated`, r.ok && !!r.hasValue && r.value === "8", JSON.stringify(r));
  }
  {
    const r = scratch(def, "f(");
    check(`scratch/${lang}: a typo in the call box is blamed on the call`, !r.ok && r.phase === "call", JSON.stringify(r));
    check(`scratch/${lang}: and does not claim their code is broken`, !/did not compile/i.test(r.error || ""));
  }
  {
    const arr = lang === "js" ? "function g(){ return [3,1,2] }" : "def g():\n    return [3, 1, 2]";
    const r = scratch(arr, "g()");
    check(`scratch/${lang}: a structured value comes back readable`, r.value === "[3,1,2]" || r.value === "[3, 1, 2]", String(r.value));
  }
}


// --- py-worker.js itself ----------------------------------------------------
// Everything above drives harness.py directly, which is exactly how py-worker
// came to drop `validator` from the payload and fail every validator question
// silently. So run the worker's own source, with a pyodide stand-in that hands
// the payload to a real python3. The glue is what is under test here: what it
// puts in, and what shape it posts back.
async function pyWorkerReply(data: Record<string, unknown>): Promise<ScratchReply & { results?: unknown[] }> {
  let reply: (ScratchReply & { results?: unknown[] }) | undefined;
  let payload = "";
  const fakePyodide = {
    setStdout: () => {},
    setStderr: () => {},
    globals: { set: (_k: string, v: string) => { payload = v; } },
    runPython: () =>
      execFileSync(
        "python3",
        [path.join(root, "scripts/py-driver.py"), path.join(root, "public/workers/harness.py")],
        { input: payload, encoding: "utf8", timeout: 60_000 },
      )
        .trim()
        .split("\n")
        .pop() as string,
  };
  const ctx: Record<string, unknown> = {
    importScripts: () => {},
    loadPyodide: async () => fakePyodide,
    fetch: async () => ({ text: async () => readFileSync(path.join(root, "public/workers/harness.py"), "utf8") }),
    Date,
    JSON,
    postMessage: (p: ScratchReply) => { reply = p; },
    Promise,
    console,
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(root, "public/workers/py-worker.js"), "utf8"), ctx);
  await (ctx.onmessage as (ev: { data: unknown }) => Promise<void>)({ data });
  if (!reply) throw new Error("py-worker never posted a message");
  return reply;
}

async function pyWorkerChecks() {
  const r = await pyWorkerReply({
    mode: "scratch",
    code: "def f(x):\n    return x * 2\n\nprint(f(21))",
  });
  check("py-worker/scratch: the run reaches Python and its output comes back", r.ok && (r.stdout || "").includes("42"), JSON.stringify(r));

  const bad = await pyWorkerReply({ mode: "scratch", code: "def f(x)\n    return x" });
  check("py-worker/scratch: a syntax error survives the trip", !bad.ok && bad.phase === "compile", JSON.stringify(bad));
  check("py-worker/scratch: and carries a line number the UI can show", !!bad.where, JSON.stringify(bad.where));

  const called = await pyWorkerReply({ mode: "scratch", code: "def add(a, b):\n    return a + b", call: "add(2, 3)" });
  check("py-worker/scratch: the call expression is forwarded and evaluated", called.ok && !!called.hasValue && called.value === "5", JSON.stringify(called));

  // And the path that already existed still behaves.
  const tested = await pyWorkerReply({
    code: "def solve(a):\n    return sum(a)",
    tests: [{ name: "a", args: [[1, 2, 3]], expected: 6 }],
    functionName: "solve",
    comparison: "exact",
  });
  check("py-worker/tests: a normal run is unaffected", tested.ok && (tested.results?.length ?? 0) === 1, JSON.stringify(tested).slice(0, 160));
  check("py-worker/tests: and reports no scratch fields", !tested.hasValue && !tested.phase, JSON.stringify(tested).slice(0, 160));
}

void (async () => {
  await pyWorkerChecks();
  console.log(`\n${failures} problem(s).`);
  process.exit(failures ? 1 : 0);
})();
