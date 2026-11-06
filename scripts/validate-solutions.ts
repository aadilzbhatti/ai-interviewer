/**
 * Saved-solution files: what goes in them, and where they are allowed to land.
 * The path checks matter most — this is the only code in the project that
 * writes to a directory the user cares about.
 * Run with: npm run validate:solutions
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSolutionFile, solutionLocation, toSnake, literal, signatureOf } from "../src/lib/solutionFile";
import {
  sanitizeSegment,
  sanitizeFilename,
  resolveWithin,
  safeRelativeParts,
  withSuffix,
} from "../src/lib/solutionPaths";
import { BANK, byId } from "../src/lib/questions/index";
import { DEFAULT_CONFIG } from "../src/lib/store";
import type { InterviewConfig, Question } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "solutions-"));

// --- naming -----------------------------------------------------------------
{
  check("snake: hyphens become underscores", toSnake("rate-limit-replay") === "rate_limit_replay");
  check("snake: spaces and case", toSnake("Largest Upward Swing") === "largest_upward_swing");
  check("snake: punctuation collapses", toSnake("k-th  Largest!! (v2)") === "k_th_largest_v2", toSnake("k-th  Largest!! (v2)"));
  check("snake: empty falls back", toSnake("") === "solution");
  check("snake: symbols only falls back", toSnake("***") === "solution");

  const q = byId("rate-limit-replay")!;
  const loc = solutionLocation(q, { ...DEFAULT_CONFIG, language: "python" });
  check(
    "location: language then difficulty then snake_case",
    loc.segments.join("/") === "python/medium" && loc.filename === "rate_limit_replay.py",
    `${loc.segments.join("/")}/${loc.filename}`,
  );
  const js = solutionLocation(q, { ...DEFAULT_CONFIG, language: "javascript" });
  check("location: javascript gets .js", js.filename === "rate_limit_replay.js" && js.segments[0] === "javascript");
  check(
    "location: difficulty comes from the question, not the config",
    solutionLocation(byId("cache-replay")!, { ...DEFAULT_CONFIG, difficulty: "easy" }).segments[1] === "hard",
  );
}

// --- literals ---------------------------------------------------------------
{
  check("literal: python booleans", literal(true, "python") === "True" && literal(false, "python") === "False");
  check("literal: js booleans", literal(true, "javascript") === "true");
  check("literal: python null", literal(null, "python") === "None");
  check("literal: js null", literal(null, "javascript") === "null");
  check("literal: nested", literal([[0, "a"], null], "python") === '[[0, "a"], None]', literal([[0, "a"], null], "python"));
}

// --- the file ---------------------------------------------------------------
const pyConfig: InterviewConfig = { ...DEFAULT_CONFIG, language: "python", jobLevel: "senior" };

{
  const q = byId("largest-swing")!;
  const code = "def largest_swing(readings):\n    return 0\n";
  const file = buildSolutionFile({ question: q, config: pyConfig, code, savedAt: new Date("2026-09-15T10:00:00Z") });

  check("file: keeps the title", file.includes(q.title));
  check("file: records when and at what bar", /practised 2026-09-15/.test(file) && /Senior bar/.test(file));
  // The prompt is wrapped into the comment block, so compare on flattened text.
  const flat = file.replace(/^[#/]+ ?/gm, "").replace(/\s+/g, " ");
  check(
    "file: carries the problem statement",
    flat.includes("Find the largest increase from an earlier reading to a later one"),
    flat.slice(0, 160),
  );
  check("file: states the signature", new RegExp(`IMPLEMENT`).test(file) && file.includes(signatureOf(q, "python")));
  check("file: shows worked examples", file.includes("largest_swing([7, 1, 5, 3, 6, 4])"));
  check("file: lists every case name", q.tests.every((t) => file.includes(`- ${t.name}`)));
  check("file: states the complexity to beat", file.includes(q.optimal.time) && file.includes(q.optimal.space));
  check("file: carries the follow-ups", q.followUps.every((f) => file.includes(f.slice(0, 30))));
  check("file: ends with the candidate's code", file.trimEnd().endsWith("return 0"));

  // The user asked for the question and considerations only.
  check("file: no hint ladder", q.hints.every((h) => !file.includes(h.slice(0, 30))));
  check("file: no reference solution", !file.includes("lowest = None"));

  const header = file.split("\n").slice(0, file.split("\n").findIndex((l) => l.startsWith("def")));
  check(
    "file: every header line is a comment",
    header.every((l) => l === "" || l.startsWith("#")),
    header.find((l) => l !== "" && !l.startsWith("#")) ?? "",
  );
}

{
  const q = byId("largest-swing")!;
  const file = buildSolutionFile({
    question: q,
    config: { ...DEFAULT_CONFIG, language: "javascript" },
    code: "function largest_swing(a) { return 0; }",
  });
  const header = file.split("\n").slice(0, 5);
  check("file: javascript uses line comments", header.every((l) => l.startsWith("//")));
}

// --- a hostile prompt cannot corrupt the file -------------------------------
{
  const nasty: Question = {
    ...byId("largest-swing")!,
    id: "nasty",
    title: 'Quote """ and close */ and \\ backslash',
    prompt: 'Contains """ triple quotes, */ a close comment, ``` fences\n```\nx = "*/"\n```\nand a very long line that should be wrapped somewhere sensible rather than running off the end of the screen forever and ever.',
  };
  for (const language of ["python", "javascript"] as const) {
    const file = buildSolutionFile({
      question: nasty,
      config: { ...DEFAULT_CONFIG, language },
      code: language === "python" ? "def largest_swing(a):\n    return 0\n" : "function largest_swing(a) { return 0; }",
    });
    const mark = language === "python" ? "#" : "//";
    const headerLines = file.split("\n").filter((l, i) => i < file.split("\n").indexOf("") );
    check(
      `hostile prompt: ${language} header stays commented`,
      headerLines.every((l) => l.startsWith(mark)),
    );
    check(
      `hostile prompt: ${language} wraps long lines`,
      file.split("\n").every((l) => l.length <= 100),
      String(Math.max(...file.split("\n").map((l) => l.length))),
    );
  }
}

// --- the produced files actually compile ------------------------------------
{
  const samples = [byId("largest-swing")!, byId("rate-limit-replay")!, byId("cache-replay")!];
  for (const q of samples) {
    const py = path.join(tmp, `${toSnake(q.id)}.py`);
    fs.writeFileSync(py, buildSolutionFile({ question: q, config: pyConfig, code: q.reference.python }));
    try {
      execFileSync("python3", ["-m", "py_compile", py], { stdio: "pipe" });
      check(`compiles: ${q.id} (python)`, true);
    } catch (e) {
      check(`compiles: ${q.id} (python)`, false, String(e).slice(0, 160));
    }

    const js = path.join(tmp, `${toSnake(q.id)}.js`);
    fs.writeFileSync(
      js,
      buildSolutionFile({
        question: q,
        config: { ...DEFAULT_CONFIG, language: "javascript" },
        code: q.reference.javascript,
      }),
    );
    try {
      execFileSync(process.execPath, ["--check", js], { stdio: "pipe" });
      check(`compiles: ${q.id} (javascript)`, true);
    } catch (e) {
      check(`compiles: ${q.id} (javascript)`, false, String(e).slice(0, 160));
    }
  }
  check("every bank question produces a non-empty file", BANK.every((q) => buildSolutionFile({ question: q, config: pyConfig, code: "pass" }).length > 200));
}

// --- path safety ------------------------------------------------------------
{
  check("sanitize: traversal is neutralised", sanitizeSegment("../../etc") === "etc", sanitizeSegment("../../etc"));
  check("sanitize: separators are stripped", sanitizeSegment("a/b\\c") === "a_b_c");
  check("sanitize: dotfiles cannot be made", sanitizeSegment(".ssh") === "ssh");
  check("sanitize: empty falls back", sanitizeSegment("") === "unsorted");
  check("sanitize: dots alone fall back", sanitizeSegment("..") === "unsorted");
  check("sanitize: long names are truncated", sanitizeSegment("a".repeat(500)).length === 64);
  check("sanitize: filename keeps its extension", sanitizeFilename("Two Sum.py") === "two_sum.py");
  check("sanitize: filename traversal is neutralised", sanitizeFilename("../../../etc/passwd") === "etc_passwd");
  check("sanitize: filename with no extension", sanitizeFilename("notes") === "notes");

  const root = "/tmp/root";
  check("resolve: a normal path is allowed", resolveWithin(root, ["python", "easy", "a.py"]) === "/tmp/root/python/easy/a.py");
  check("resolve: traversal is refused", resolveWithin(root, ["..", "escape"]) === null);
  check("resolve: deep traversal is refused", resolveWithin(root, ["a", "..", "..", "b"]) === null);
  check("resolve: an absolute part is refused", resolveWithin(root, ["/etc/passwd"]) === null);
  check("resolve: a sibling prefix is refused", resolveWithin(root, ["../root-evil/x"]) === null);

  check("relative: traversal is refused", safeRelativeParts("../../x.py") === null);
  check("relative: a normal path survives", safeRelativeParts("python/easy/a.py")?.join("/") === "python/easy/a.py");
  check("relative: components are sanitised", safeRelativeParts("Python/Easy/Two Sum.py")?.join("/") === "python/easy/two_sum.py");
  check("relative: empty is refused", safeRelativeParts("") === null);

  check("suffix: first save is unsuffixed", withSuffix("a.py", 1) === "a.py");
  check("suffix: later saves are numbered", withSuffix("a.py", 3) === "a_3.py");
  check("suffix: no extension", withSuffix("a", 2) === "a_2");
}

// --- the route, against a real directory ------------------------------------
// Wrapped rather than top-level await: this file is transpiled as CommonJS.
async function routeChecks() {
  const root = path.join(tmp, "root");
  process.env.SOLUTIONS_DIR = root;
  const { POST, GET } = await import("../src/app/api/solutions/save/route");

  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/solutions/save", { method: "POST", body: JSON.stringify(body) }));

  const availability = await (await GET()).json();
  check("route: reports itself available for a writable root", availability.available === true, JSON.stringify(availability));

  const first = await (await post({ segments: ["python", "medium"], filename: "two_sum.py", content: "# one\n" })).json();
  check("route: writes where it says", first.path === "python/medium/two_sum.py", JSON.stringify(first));
  check("route: the file is really there", fs.readFileSync(path.join(root, first.path), "utf8") === "# one\n");

  const second = await (await post({ segments: ["python", "medium"], filename: "two_sum.py", content: "# two\n" })).json();
  check("route: a second save does not clobber the first", second.path === "python/medium/two_sum_2.py", JSON.stringify(second));
  check("route: the original is untouched", fs.readFileSync(path.join(root, first.path), "utf8") === "# one\n");

  const rewrite = await (await post({ overwritePath: first.path, content: "# rewritten\n" })).json();
  check("route: overwriting its own file reuses the path", rewrite.path === first.path);
  check("route: and actually rewrites it", fs.readFileSync(path.join(root, first.path), "utf8") === "# rewritten\n");

  const dirty = await (await post({ segments: ["../../evil", "x"], filename: "y.py", content: "# nope\n" })).json();
  check("route: a traversal segment is sanitised, not honoured", dirty.path === "evil/x/y.py", JSON.stringify(dirty));
  check("route: nothing escaped the root", !fs.existsSync(path.join(tmp, "evil")));

  const escape = await post({ overwritePath: "../../escape.py", content: "# nope\n" });
  check("route: a traversal overwrite is refused", escape.status === 400, String(escape.status));
  check("route: and wrote nothing", !fs.existsSync(path.join(tmp, "escape.py")));

  const empty = await post({ segments: [], filename: "x.py", content: "" });
  check("route: refuses empty content", empty.status === 400);

  const huge = await post({ segments: [], filename: "x.py", content: "x".repeat(600 * 1024) });
  check("route: refuses an oversized file", huge.status === 413, String(huge.status));
}

void routeChecks().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${failures} problem(s).`);
  process.exit(failures ? 1 : 0);
});
