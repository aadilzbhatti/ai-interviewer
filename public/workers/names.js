/* Function-name spellings the harness will accept.

   A question carries one `functionName`, but the generator writes idiomatic
   code in each language: functionName "min_processing_rate" arrives with a
   JavaScript reference AND candidate starter called "minProcessingRate".
   Demanding the declared spelling made every JavaScript session on such a
   question fail every test with "No function named ...", which looks to the
   candidate like their own code is broken.

   So both harnesses accept the declared name plus its snake_case and camelCase
   forms. Mirrored in harness.py — scripts/validate-workers.ts asserts the two
   implementations agree. */
(function (g) {
  function toSnake(name) {
    return name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
  }

  function toCamel(name) {
    const parts = toSnake(name).split("_").filter(Boolean);
    if (parts.length === 0) return name;
    return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  }

  /** The declared name first — it always wins when both are defined. */
  function variants(name) {
    const out = [];
    for (const candidate of [name, toSnake(name), toCamel(name)]) {
      if (candidate && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate) && out.indexOf(candidate) === -1) {
        out.push(candidate);
      }
    }
    return out;
  }

  g.__interviewNames = { variants, toSnake, toCamel };
})(typeof self !== "undefined" ? self : globalThis);
