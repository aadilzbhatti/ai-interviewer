import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and add your key.",
    );
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/** Override with ANTHROPIC_MODEL in .env.local. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

export type JsonExtraction<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; truncated: boolean };

/** Walks one JSON value from `start`, tracking string state so delimiters inside strings are inert. */
function scanValue(text: string, start: number): { end: number } | { ranOut: true } {
  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return { end: i };
    }
  }
  return { ranOut: true };
}

const MAX_CANDIDATES = 50;

/**
 * Pulls the first JSON value out of a model response.
 *
 * Deliberately does NOT pre-slice on ``` fences. A generated question's prompt
 * contains its own markdown code fences, so a fenced-block regex stops at the
 * first inner fence and cuts the JSON mid-string — which then looks exactly
 * like a truncated response. Brace matching that understands JSON strings
 * ignores fences, backticks and braces inside string values, and a trailing
 * closing fence simply falls outside the matched value.
 *
 * Returns a result rather than throwing: a malformed response is an ordinary,
 * recoverable outcome here, and an exception escaping a retry loop is how one
 * bad reply used to kill a whole request.
 */
export function tryExtractJson<T>(text: string): JsonExtraction<T> {
  const starts: number[] = [];
  for (let i = 0; i < text.length && starts.length < MAX_CANDIDATES; i++) {
    if (text[i] === "{" || text[i] === "[") starts.push(i);
  }
  if (starts.length === 0) {
    return { ok: false, error: "No JSON found in the response.", truncated: false };
  }

  // The outermost value decides. If it never closes the reply was cut off, and
  // nothing inside it can be trusted — salvaging an inner fragment would hand
  // back a piece of a question and call it a whole one.
  const outermost = scanValue(text, starts[0]);
  if ("ranOut" in outermost) {
    return {
      ok: false,
      truncated: true,
      error: "The response ended before the JSON closed — it was cut off.",
    };
  }

  let lastParseError = "";
  for (const start of starts) {
    const scanned = scanValue(text, start);
    if ("ranOut" in scanned) continue;
    try {
      return { ok: true, value: JSON.parse(text.slice(start, scanned.end + 1)) as T };
    } catch (e) {
      // Probably prose that merely looked like a brace; try the next opener.
      lastParseError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    ok: false,
    truncated: false,
    error: `No parsable JSON in the response${lastParseError ? ` (${lastParseError})` : ""}.`,
  };
}

/** Throwing form, for callers that treat bad JSON as fatal. */
export function extractJson<T>(text: string): T {
  const result = tryExtractJson<T>(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
