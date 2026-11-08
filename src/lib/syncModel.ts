/**
 * Server-side storage: the rules. Pure, so the suite can pin them down.
 *
 * Everything the app keeps used to live only in one browser's localStorage,
 * capped (20 reviews, 40 questions, 4 set-aside sessions) and per origin. A
 * cleared profile, a new device, or simply the 21st interview lost history for
 * good. Now every record is also kept on the server's disk, uncapped, and
 * localStorage is the fast local copy that works offline.
 *
 * The model is deliberately small:
 *   - a record is one envelope: collection, id, the client time it was written,
 *     and either a value or a tombstone;
 *   - last write wins, by that time;
 *   - the server numbers every version it accepts (`rev`), so a client can ask
 *     for "everything since rev N" instead of downloading the lot each time.
 */
import type { InterviewSession } from "./types";

export const COLLECTIONS = ["config", "sessions", "questions", "reviews", "history"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface Envelope<T = unknown> {
  collection: Collection;
  id: string;
  /** Client wall clock when this version was written. Last write wins. */
  updatedAt: number;
  deleted?: boolean;
  value?: T;
  /** Assigned by the server, strictly increasing. Absent on what a client sends. */
  rev?: number;
}

/** The only id a single config record uses. */
export const CONFIG_ID = "default";

// Ids become file names on the server, so they are held to a strict shape:
// no slashes, no leading dot, nothing a path could be built out of.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const isCollection = (c: unknown): c is Collection =>
  typeof c === "string" && (COLLECTIONS as readonly string[]).includes(c);

export const isValidId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

/** Why an envelope is unacceptable, or null when it is fine. */
export function envelopeError(e: unknown): string | null {
  if (!e || typeof e !== "object" || Array.isArray(e)) return "not an object";
  const env = e as Partial<Envelope>;
  if (!isCollection(env.collection)) return "unknown collection";
  if (!isValidId(env.id)) return "bad id";
  if (typeof env.updatedAt !== "number" || !Number.isFinite(env.updatedAt) || env.updatedAt < 0) {
    return "bad updatedAt";
  }
  if (env.deleted) return null;
  const v = env.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return "missing value";
  // A record must be filed under its own id, or two ids would fight over one value.
  const ownId = (v as { id?: unknown }).id;
  if (env.collection !== "config" && ownId !== undefined && ownId !== env.id) return "id mismatch";
  return null;
}

type Version = { updatedAt: number; deleted?: boolean };

/**
 * Should `incoming` replace `existing`?
 *
 * Newer wins. On an exact tie a delete beats a write, so resending a write
 * from the same instant can never quietly undo a removal. An identical resend
 * is a no-op, which is what makes retrying a push safe.
 */
export function shouldApply(existing: Version | undefined, incoming: Version): boolean {
  if (!existing) return true;
  if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
  return !!incoming.deleted && !existing.deleted;
}

/**
 * Should a client take a version it pulled from the server?
 *
 * Only if it has no unsent change of its own to that record, or the server's
 * is newer than that change. Otherwise its own edit is the one that will win
 * once pushed, and overwriting it locally would lose it.
 */
export function shouldTakeRemote(pending: { at: number; deleted?: boolean } | undefined, remote: Version): boolean {
  if (!pending) return true;
  return shouldApply({ updatedAt: pending.at, deleted: pending.deleted }, remote);
}

/**
 * The time to file a record under when a browser syncs for the first time.
 *
 * That browser's data predates syncing, so it is stamped with the moment it was
 * actually made, not "now". Otherwise opening an old tab would overwrite a newer
 * copy another device had already sent. Config gets the lowest possible time:
 * a stored preference should never be displaced by a fresh device's defaults.
 */
export function seedTime(collection: Collection, value: unknown): number {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  switch (collection) {
    case "config":
      return 1;
    case "sessions": {
      const s = v as Partial<InterviewSession>;
      return num(s.endedAt) || num(s.startedAt) + num(s.accumulatedMs) || 1;
    }
    default:
      return num(v.at) || 1;
  }
}

/**
 * A session without its per-case run output.
 *
 * Run results are the bulk of a session and the least worth keeping; the code,
 * the transcript and the question are what nobody can retype. Used for the
 * local set-aside ring and for list views, never for the server's own copy.
 */
export function trimSession(s: InterviewSession): InterviewSession {
  return {
    ...s,
    runs: (s.runs ?? []).slice(-3).map((r) => ({ ...r, results: [], stdout: "" })),
  };
}

/**
 * The server's list plus anything only this browser has, minus anything
 * deleted here but not yet sent. Where both have a record, a local copy with
 * an unsent change wins; otherwise the server's does.
 */
export function unionById<T extends { id: string }>(
  server: T[],
  local: T[],
  opts: { pendingIds?: Set<string>; deletedIds?: Set<string> } = {},
): T[] {
  const pending = opts.pendingIds ?? new Set<string>();
  const deleted = opts.deletedIds ?? new Set<string>();
  const out = new Map<string, T>();
  for (const r of server) if (!deleted.has(r.id)) out.set(r.id, r);
  for (const r of local) {
    if (deleted.has(r.id)) continue;
    if (!out.has(r.id) || pending.has(r.id)) out.set(r.id, r);
  }
  return [...out.values()];
}

/** Insert or replace by id, newest first by `timeOf`, then cap. */
export function upsertCapped<T extends { id: string }>(
  list: T[],
  item: T,
  cap: number,
  timeOf: (x: T) => number,
): T[] {
  return [item, ...list.filter((x) => x.id !== item.id)]
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, cap);
}
