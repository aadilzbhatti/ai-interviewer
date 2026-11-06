/* Shared comparison logic for the JavaScript test harness.
   Loaded by js-worker.js via importScripts, and by the bank validation script. */
(function (g) {
  function stableStringify(v) {
    if (v === null || v === undefined) return "null";
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    if (typeof v === "object") {
      const keys = Object.keys(v).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
    }
    if (typeof v === "number" && Number.isInteger(v)) return String(v);
    return JSON.stringify(v);
  }

  function normalize(v) {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(normalize);
    if (v instanceof Set) return [...v].map(normalize).sort(cmpKey);
    if (v instanceof Map) {
      const o = {};
      for (const [k, val] of v) o[String(k)] = normalize(val);
      return o;
    }
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = normalize(v[k]);
      return o;
    }
    return v;
  }

  function cmpKey(a, b) {
    const ka = stableStringify(a);
    const kb = stableStringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  function eq(a, b, approx) {
    if (typeof a === "boolean" || typeof b === "boolean") return a === b;
    if (typeof a === "number" && typeof b === "number") {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      if (!approx) return a === b;
      return Math.abs(a - b) <= 1e-9 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => eq(x, b[i], approx));
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const ka = Object.keys(a).sort();
      const kb = Object.keys(b).sort();
      return ka.length === kb.length && ka.every((k, i) => k === kb[i]) && ka.every((k) => eq(a[k], b[k], approx));
    }
    return a === b;
  }

  function compareValues(actual, expected, mode) {
    let a = normalize(actual);
    let e = normalize(expected);
    if ((mode === "sorted" || mode === "set") && Array.isArray(a) && Array.isArray(e)) {
      a = [...a].sort(cmpKey);
      e = [...e].sort(cmpKey);
    }
    return { passed: eq(a, e, mode === "approx"), actual: a, expected: e };
  }

  g.__interviewCompare = { compareValues, stringify: stableStringify, normalize };
})(typeof self !== "undefined" ? self : globalThis);
