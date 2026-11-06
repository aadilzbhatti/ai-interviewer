/**
 * Raw request/response logging for the model calls, so a bad generation can be
 * read back rather than guessed at. Off unless INTERVIEW_DEBUG_LOG is set —
 * these files contain full prompts and are not something to leave running.
 *
 * Every function here is best-effort: logging must never fail a request.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let counter = 0;

export function debugEnabled(): boolean {
  const value = process.env.INTERVIEW_DEBUG_LOG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function debugRoot(): string {
  const configured = process.env.DEBUG_LOG_DIR?.trim();
  if (!configured) return path.join(process.cwd(), ".logs");
  const expanded = configured.startsWith("~")
    ? path.join(os.homedir(), configured.slice(1))
    : configured;
  return path.resolve(expanded);
}

function stamp(d: Date) {
  const iso = d.toISOString();
  return {
    day: iso.slice(0, 10),
    time: iso.slice(11, 23).replace(/[:.]/g, ""),
  };
}

export interface DebugEntry {
  /** Which route produced this, e.g. "questions/generate". */
  route: string;
  /** Where in that route, e.g. "generate:round1" or "vet:round1". */
  phase: string;
  model?: string;
  system?: string;
  messages?: unknown;
  /** The model's raw text, before any parsing. */
  responseText?: string;
  parsed?: unknown;
  error?: string;
  usage?: unknown;
  durationMs?: number;
  data?: unknown;
}

/**
 * Writes one JSON file per call plus an index line. Returns the file path, or
 * null when logging is off or the write failed.
 *
 * `force` is for crash reports only. A crash is the one event you cannot ask
 * someone to reproduce with the flag turned on, so it is always recorded.
 */
export async function logDebug(
  entry: DebugEntry,
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (!debugEnabled() && !opts.force) return null;
  const now = new Date();
  const { day, time } = stamp(now);
  const n = String(++counter).padStart(4, "0");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
  const name = `${time}__${safe(entry.route)}__${safe(entry.phase)}__${n}.json`;

  try {
    const dir = path.join(debugRoot(), day);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    const record = { at: now.toISOString(), ...entry };
    await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");

    const index = {
      at: now.toISOString(),
      route: entry.route,
      phase: entry.phase,
      durationMs: entry.durationMs,
      bytes: entry.responseText?.length,
      error: entry.error,
      file: path.relative(debugRoot(), file),
    };
    await fs.appendFile(path.join(debugRoot(), "calls.jsonl"), `${JSON.stringify(index)}\n`, "utf8");
    return file;
  } catch {
    // Logging is a convenience. Never let it take a request down.
    return null;
  }
}
