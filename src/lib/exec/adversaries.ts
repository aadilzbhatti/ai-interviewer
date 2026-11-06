/**
 * Trivial solutions used to prove a question actually tests something.
 *
 * With a fixed expected value, a lazy answer cannot pass by luck — the value
 * pins it. Under "validator" comparison there is no expected value, so a
 * question can accept `return input` and never exercise the algorithm at all.
 * These are run against validator questions before the candidate ever sees one.
 *
 * Written with varargs so they apply to any signature.
 */
import type { Language } from "../types";

export interface Adversary {
  key: string;
  /** What a reviewer would call this if a candidate submitted it. */
  label: string;
  code: Record<Language, string>;
}

export function adversaries(functionName: string): Adversary[] {
  const py = (body: string) => `def ${functionName}(*args, **kwargs):\n${body}\n`;
  const js = (body: string) => `function ${functionName}(...args) {\n${body}\n}\n`;

  return [
    {
      key: "identity",
      label: "returns its first argument unchanged",
      code: {
        python: py("    return args[0] if args else None"),
        javascript: js("  return args.length ? args[0] : null;"),
      },
    },
    {
      key: "reversed",
      label: "returns its first argument reversed",
      code: {
        python: py(
          "    first = args[0] if args else None\n" +
            "    return list(reversed(first)) if isinstance(first, list) else first",
        ),
        javascript: js("  const a = args[0];\n  return Array.isArray(a) ? [...a].reverse() : a;"),
      },
    },
    {
      key: "empty",
      label: "always returns an empty list",
      code: { python: py("    return []"), javascript: js("  return [];") },
    },
  ];
}
