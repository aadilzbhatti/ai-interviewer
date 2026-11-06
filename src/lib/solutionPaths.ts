/**
 * Path handling for saved solutions. Kept separate from the route so the
 * sanitisation can be tested directly — this is the code standing between a
 * question title and someone's filesystem.
 */
import path from "node:path";
import os from "node:os";

export const DEFAULT_SOLUTIONS_DIR = path.join(
  os.homedir(),
  "Documents",
  "Workspace",
  "interview-questions",
  "solutions",
);

export function solutionsRoot(): string {
  const configured = process.env.SOLUTIONS_DIR?.trim();
  if (!configured) return DEFAULT_SOLUTIONS_DIR;
  const expanded = configured.startsWith("~")
    ? path.join(os.homedir(), configured.slice(1))
    : configured;
  return path.resolve(expanded);
}

/** One path component: lowercase, snake_case, nothing that can escape a directory. */
export function sanitizeSegment(value: string, fallback = "unsorted"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return cleaned || fallback;
}

/** A filename, preserving a single known extension. */
export function sanitizeFilename(value: string, fallback = "solution"): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(value)?.[1]?.toLowerCase();
  const stem = ext ? value.slice(0, -(ext.length + 1)) : value;
  const safeStem = sanitizeSegment(stem, fallback);
  return ext ? `${safeStem}.${ext}` : safeStem;
}

/**
 * Resolves `parts` under `root`, refusing anything that lands outside it.
 * Returns null rather than throwing so callers handle it as a normal rejection.
 */
export function resolveWithin(root: string, parts: string[]): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** Splits a stored relative path back into sanitised components. */
export function safeRelativeParts(relative: string): string[] | null {
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 8) return null;
  if (parts.some((p) => p === "." || p === "..")) return null;
  const segments = parts.slice(0, -1).map((p) => sanitizeSegment(p));
  const file = sanitizeFilename(parts[parts.length - 1]);
  return [...segments, file];
}

/** `foo.py` -> `foo_2.py` -> `foo_3.py`, for a directory that already has one. */
export function withSuffix(filename: string, n: number): string {
  if (n <= 1) return filename;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return `${filename}_${n}`;
  return `${filename.slice(0, dot)}_${n}${filename.slice(dot)}`;
}
