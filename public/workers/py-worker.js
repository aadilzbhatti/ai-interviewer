const PYODIDE_VERSION = "0.26.4";
importScripts("https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/pyodide.js");

function truncate(text) {
  const s = text || "";
  return s.length > 20000 ? s.slice(0, 20000) + "\n...output truncated..." : s;
}

let pyodidePromise = null;
let harnessPromise = null;

function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/",
    });
  }
  return pyodidePromise;
}

function getHarness() {
  if (!harnessPromise) {
    harnessPromise = fetch("/workers/harness.py").then((r) => r.text());
  }
  return harnessPromise;
}

self.onmessage = async function (ev) {
  const started = Date.now();
  const { code, tests, functionName, comparison, validator, mode, call } = ev.data;
  let stdout = "";
  try {
    const [py, harness] = await Promise.all([getPyodide(), getHarness()]);
    py.setStdout({
      batched: (s) => {
        stdout += s + "\n";
      },
    });
    py.setStderr({
      batched: (s) => {
        stdout += s + "\n";
      },
    });
    py.globals.set(
      "__payload",
      JSON.stringify({
        code,
        tests,
        functionName,
        comparison: comparison || "exact",
        validator,
        // Building this object by hand once cost every validator question a 0/12,
        // because `validator` was simply left out. Anything harness.py reads has
        // to be listed here — scripts/validate-workers.ts asserts exactly that.
        mode,
        call,
      }),
    );
    const raw = py.runPython(harness);
    const parsed = JSON.parse(raw);
    self.postMessage({
      ok: mode === "scratch" ? !!parsed.ok : !parsed.error,
      error: parsed.error || undefined,
      phase: parsed.phase,
      where: typeof parsed.where === "number" ? { line: parsed.where, column: 0 } : undefined,
      value: parsed.value,
      hasValue: !!parsed.hasValue,
      results: parsed.results || [],
      // In scratch mode Python captures its own output, so the run's prints are
      // attributed to that run rather than to whatever pyodide last flushed.
      stdout: truncate(typeof parsed.stdout === "string" ? parsed.stdout : stdout),
      durationMs: Date.now() - started,
    });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: "Python runtime failed: " + (e && e.message ? e.message : String(e)),
      results: [],
      stdout: truncate(stdout),
      durationMs: Date.now() - started,
    });
  }
};
