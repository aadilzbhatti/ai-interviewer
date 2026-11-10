importScripts("compare.js");
importScripts("names.js");

/**
 * How far `new Function` shifts the line numbers it reports.
 *
 * A function built this way is wrapped in a header the engine counts but the
 * candidate never sees, so a stack saying line 7 means something else in their
 * editor. The size of that header is an engine detail, so rather than hardcode
 * it, throw from a known line once and measure what comes back.
 */
let LINE_BASE = null;
function lineBase() {
  if (LINE_BASE !== null) return LINE_BASE;
  LINE_BASE = 0;
  try {
    // The throw is on line 2 of the body.
    new Function("\nthrow new Error('probe');")();
  } catch (e) {
    const m = ANON.exec((e && e.stack) || "");
    if (m) LINE_BASE = Number(m[1]) - 2;
  }
  return LINE_BASE;
}

/**
 * The frame for code the engine compiled from a string. The leading boundary
 * matters: without it this also matches "evalmachine.<anonymous>" and similar
 * host frames, and reports a line number from inside this worker as if it were
 * the candidate's.
 */
const ANON = /(?:^|[\s(,])<anonymous>:(\d+):(\d+)/;

/** Rewrites the engine's line numbers into the candidate's, given the prefix. */
function locate(err, prefixLines, lineCount) {
  const m = ANON.exec((err && err.stack) || "");
  if (!m) return null;
  const line = Number(m[1]) - lineBase() - prefixLines;
  // A line past the end of their file means the arithmetic is wrong, not that
  // they have a bug down there. Say nothing rather than point at empty space.
  if (line < 1 || line > lineCount) return null;
  return { line, column: Number(m[2]) };
}

function describe(e) {
  if (!e) return "Unknown error";
  if (e.name && e.message) return e.name + ": " + e.message;
  return e.message || String(e);
}

self.onmessage = function (ev) {
  const { code, tests, functionName, comparison, validator, mode, call } = ev.data;
  const C = self.__interviewCompare;
  const started = Date.now();
  let stdout = "";
  const originalLog = console.log;
  const originalErr = console.error;
  const capture = (...args) => {
    stdout += args.map((a) => (typeof a === "string" ? a : C.stringify(C.normalize(a)))).join(" ") + "\n";
    if (stdout.length > 20000) stdout = stdout.slice(0, 20000) + "\n...output truncated...";
  };
  console.log = capture;
  console.error = capture;

  const finish = (payload) => {
    console.log = originalLog;
    console.error = originalErr;
    self.postMessage({ ...payload, stdout, durationMs: Date.now() - started });
  };

  // A scratch run: the candidate's own file, their own checks, nothing to do
  // with the question's tests. Kept deliberately separate from the path above
  // so it can never post a results array that looks like a real run.
  if (mode === "scratch") return scratch(code, call, C, finish);

  // Each language has its own naming convention and the generator writes
  // idiomatically in both: a question whose functionName is "min_processing_rate"
  // ships a JavaScript reference and starter called "minProcessingRate". Insisting
  // on one spelling made every JavaScript session on such a question fail 0/N with
  // "No function named ...". Accept either, and say so when neither is there.
  const names = self.__interviewNames.variants(functionName);
  let fn;
  try {
    fn = new Function(
      '"use strict";\n' +
        code +
        "\n;" +
        names
          .map((n) => 'if (typeof ' + n + ' === "function") return ' + n + ";")
          .join("\n") +
        "\nreturn undefined;",
    )();
  } catch (e) {
    return finish({ ok: false, error: "Your code did not parse or run: " + (e && e.message ? e.message : String(e)), results: [] });
  }

  if (typeof fn !== "function") {
    return finish({
      ok: false,
      error:
        "No function named " +
        names.map((n) => "'" + n + "'").join(" or ") +
        " was defined.",
      results: [],
    });
  }

  // Questions with more than one correct answer ship a check(args, output).
  var checkFn = null;
  if (comparison === "validator") {
    try {
      checkFn = new Function('"use strict";\n' + (validator || "") + '\n;return typeof check === "function" ? check : undefined;')();
    } catch (e) {
      return finish({ ok: false, error: "The question's validator did not parse: " + (e && e.message ? e.message : String(e)), results: [] });
    }
    if (typeof checkFn !== "function") {
      return finish({ ok: false, error: "This question uses validator comparison but supplies no check() function.", results: [] });
    }
  }

  const results = [];
  for (const t of tests) {
    const t0 = Date.now();
    const name = t.name || "case";
    try {
      const args = typeof structuredClone === "function" ? structuredClone(t.args) : JSON.parse(JSON.stringify(t.args));
      const out = fn.apply(null, args);
      if (checkFn) {
        const fresh = typeof structuredClone === "function" ? structuredClone(t.args) : JSON.parse(JSON.stringify(t.args));
        const verdict = checkFn(fresh, out);
        results.push({
          name,
          passed: !!verdict,
          hidden: !!t.hidden,
          args: C.stringify(C.normalize(t.args)),
          expected: "any valid answer",
          actual: C.stringify(C.normalize(out)),
          durationMs: Date.now() - t0,
        });
      } else {
        const cmp = C.compareValues(out, t.expected, comparison || "exact");
        results.push({
          name,
          passed: cmp.passed,
          hidden: !!t.hidden,
          args: C.stringify(C.normalize(t.args)),
          expected: C.stringify(cmp.expected),
          actual: C.stringify(cmp.actual),
          durationMs: Date.now() - t0,
        });
      }
    } catch (e) {
      results.push({
        name,
        passed: false,
        hidden: !!t.hidden,
        args: C.stringify(C.normalize(t.args)),
        expected: C.stringify(C.normalize(t.expected)),
        error: e && e.message ? e.message : String(e),
        durationMs: Date.now() - t0,
      });
    }
  }
  finish({ ok: true, results });
};

/**
 * Runs the editor's contents as a plain script, then optionally evaluates one
 * call expression in the same scope. Compiling and running are attempted
 * separately so "this does not parse" is never reported as "this threw".
 */
function scratch(source, callExpr, C, finish) {
  const code = source || "";
  const call = (callExpr || "").trim();
  const PREFIX = '"use strict";\n';
  const PREFIX_LINES = 1;

  // 1. Does the file compile at all?
  try {
    new Function(PREFIX + code);
  } catch (e) {
    return finish({
      ok: false,
      phase: "compile",
      error: describe(e),
      // V8 reports no position for a `new Function` syntax error, and the
      // editor already underlines it, so do not invent one.
      results: [],
    });
  }

  // 2. Does the call expression itself parse? Attributed separately, so a typo
  //    in the box is never blamed on their code.
  let compiled;
  try {
    compiled = new Function(PREFIX + code + "\n;return (" + (call || "undefined") + ");");
  } catch (e) {
    return finish({ ok: false, phase: "call", error: describe(e), results: [] });
  }

  // 3. Run it.
  let value;
  try {
    value = compiled();
  } catch (e) {
    const at = locate(e, PREFIX_LINES, code.split("\n").length);
    return finish({
      ok: false,
      phase: call ? "call" : "run",
      error: describe(e),
      where: at || undefined,
      results: [],
    });
  }

  const settle = (v) =>
    finish({
      ok: true,
      hasValue: !!call,
      value: call ? C.stringify(C.normalize(v)) : undefined,
      results: [],
    });

  // An async solution is a legitimate thing to write; wait for it rather than
  // printing "[object Promise]" at them.
  if (value && typeof value.then === "function") {
    value.then(settle, (e) =>
      finish({ ok: false, phase: "call", error: describe(e), results: [] }),
    );
    return;
  }
  settle(value);
}
