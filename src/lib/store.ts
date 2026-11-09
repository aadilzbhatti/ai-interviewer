import type { Assessment, InterviewConfig, InterviewSession, Language, Question } from "./types";
import {
  CONFIG_ID,
  seedTime,
  trimSession,
  upsertCapped,
  type Collection,
  type Envelope,
} from "./syncModel";

const CONFIG_KEY = "mock-interviewer:config";
const SESSION_KEY = "mock-interviewer:session";
const HISTORY_KEY = "mock-interviewer:history";

export const DEFAULT_CONFIG: InterviewConfig = {
  difficulty: "medium",
  jobLevel: "mid",
  helpLevel: "balanced",
  role: "general",
  language: "python",
  durationMin: 35,
  clockMode: "pausable",
  strictTime: true,
  source: "bank",
  seedDescription: "",
};

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Returns whether the value actually landed.
 *
 * This used to swallow the failure and say nothing, which meant a session that
 * outgrew the quota silently stopped being saved while the interview carried on
 * looking fine. Callers that hold work the candidate cannot recreate check the
 * result and tell them.
 */
function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Tolerates configs saved by earlier versions, which had a boolean `generateFresh`. */
export function normalizeConfig(raw: Record<string, unknown>): InterviewConfig {
  const merged = { ...DEFAULT_CONFIG, ...raw } as InterviewConfig & { generateFresh?: boolean };
  // Test against `raw`, not `merged` — the spread has already supplied a default
  // `source`, so checking the merged value would silently discard the old flag.
  if (!raw.source) merged.source = merged.generateFresh ? "generated" : "bank";
  if (typeof merged.seedDescription !== "string") merged.seedDescription = "";
  if (merged.clockMode !== "strict") merged.clockMode = "pausable";
  // Configs from before the time-limit setting existed: the limit counted.
  if (typeof merged.strictTime !== "boolean") merged.strictTime = true;
  delete merged.generateFresh;
  return merged;
}

export const loadConfig = (): InterviewConfig | null => {
  const raw = read<Record<string, unknown>>(CONFIG_KEY);
  return raw ? normalizeConfig(raw) : null;
};
export const saveConfig = (c: InterviewConfig) => changed(write(CONFIG_KEY, c), "config", CONFIG_ID);

const BACKUPS_KEY = "mock-interviewer:session-backups";
const MAX_BACKUPS = 4;

export const loadSession = () => read<InterviewSession>(SESSION_KEY);

/** True when the session actually reached storage. */
export const saveSession = (s: InterviewSession): boolean =>
  changed(write(SESSION_KEY, s), "sessions", s.id);

/**
 * A session set aside rather than destroyed.
 *
 * Trimmed on the way in: per-case run results are the bulkiest part of a
 * session and the least worth keeping, while the code, the transcript and the
 * question are the parts nobody can retype.
 */
const backupOf = trimSession;

export const loadSessionBackups = (): InterviewSession[] =>
  read<InterviewSession[]>(BACKUPS_KEY) || [];

export function deleteSessionBackup(id: string) {
  write(BACKUPS_KEY, loadSessionBackups().filter((s) => s.id !== id));
  // Also gone from the server, which moves its copy to .trash rather than erasing it.
  changed(true, "sessions", id, true);
}

/**
 * Sets the live session aside instead of deleting it.
 *
 * The old version removed the key outright. Someone closed a tab mid-interview,
 * found nothing on the home page telling them the session was still there,
 * started a new interview to try again — and that click erased an hour of work
 * with no warning and no copy. Clearing is now non-destructive: the last few
 * sessions are kept and can be restored from the history page.
 */
export function clearSession() {
  if (typeof window === "undefined") return;
  const current = loadSession();
  // The ring below keeps a trimmed copy. If the full one has not reached the
  // server yet, send it now, before the only full copy is gone from here.
  if (current?.id && pendingEntry("sessions", current.id)) {
    listener?.({ collection: "sessions", id: current.id, urgent: current });
  }
  if (current?.question) {
    const rest = loadSessionBackups().filter((s) => s.id !== current.id);
    // Newest first, and never let the ring itself be what fills the quota.
    write(BACKUPS_KEY, capList("sessions", [backupOf(current), ...rest], MAX_BACKUPS));
  }
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Puts a set-aside session back as the live one. */
export function restoreSessionBackup(id: string): InterviewSession | null {
  const found = loadSessionBackups().find((s) => s.id === id);
  if (!found) return null;
  return restoreSession(found);
}

/**
 * Makes `s` the live session, setting aside whatever was live.
 *
 * For a session that came from the server: it may have been started in
 * another browser, so it was never in this one's ring, and the server's copy is
 * the full one where the ring's is trimmed.
 */
export function restoreSession(s: InterviewSession): InterviewSession | null {
  clearSession();
  return saveSession(s) ? s : null;
}

const QUESTIONS_KEY = "mock-interviewer:questions";
const MAX_QUESTIONS = 40;

/**
 * A generated question, kept so it outlives the session that produced it.
 *
 * Generating one costs 30-60 seconds and two model calls, and it used to exist
 * only inside the running interview — close the tab before finishing and the
 * question was gone for good. These are saved the moment a question passes its
 * soundness check, so a session can be started from one later for free.
 */
export interface SavedQuestion {
  id: string;
  at: number;
  question: Question;
  /** What it was generated for, so the library reads sensibly. */
  difficulty: string;
  jobLevel: string;
  role: string;
  /** The candidate's own words, when they described the problem. */
  seedDescription?: string;
  /** Set once an interview on this question has been graded. */
  lastPracticedAt?: number;
}

export const loadQuestions = (): SavedQuestion[] => read<SavedQuestion[]>(QUESTIONS_KEY) || [];

export const loadQuestion = (id: string): SavedQuestion | undefined =>
  loadQuestions().find((q) => q.id === id);

/** Keyed by the question's own id, so regenerating the same one does not duplicate it. */
export function saveQuestion(entry: SavedQuestion) {
  const all = loadQuestions().filter((q) => q.id !== entry.id);
  all.unshift(entry);
  changed(write(QUESTIONS_KEY, capList("questions", all, MAX_QUESTIONS)), "questions", entry.id);
}

export function markQuestionPracticed(id: string, at = Date.now()) {
  const all = loadQuestions();
  const found = all.find((q) => q.id === id);
  if (!found) return;
  found.lastPracticedAt = at;
  changed(write(QUESTIONS_KEY, all), "questions", id);
}

export function deleteQuestion(id: string) {
  write(QUESTIONS_KEY, loadQuestions().filter((q) => q.id !== id));
  changed(true, "questions", id, true);
}

const REVIEWS_KEY = "mock-interviewer:reviews";
const MAX_REVIEWS = 20;

/**
 * A finished interview, kept in full.
 *
 * The session snapshot is overwritten by the next interview, so until now a
 * graded review existed only until you started another one — the history list
 * kept a one-line summary and the debrief itself was gone. This keeps the whole
 * thing: the report, the question it was about, and the code as submitted.
 */
export interface SavedReview {
  id: string;
  at: number;
  title: string;
  questionId: string;
  language: Language;
  difficulty: string;
  jobLevel: string;
  verdict?: string;
  /** e.g. "12/12", or undefined if they never ran the tests. */
  passed?: string;
  elapsedMin: number;
  savedSolutionPath?: string;
  assessment: Assessment;
  question: Question;
  code: string;
}

export const loadReviews = (): SavedReview[] => read<SavedReview[]>(REVIEWS_KEY) || [];

export const loadReview = (id: string): SavedReview | undefined =>
  loadReviews().find((r) => r.id === id);

/**
 * Newest first, capped. Re-grading the same session replaces its entry rather
 * than stacking up duplicates.
 */
export function saveReview(review: SavedReview) {
  const all = loadReviews().filter((r) => r.id !== review.id);
  all.unshift(review);
  changed(write(REVIEWS_KEY, capList("reviews", all, MAX_REVIEWS)), "reviews", review.id);
}

export function deleteReview(id: string) {
  write(REVIEWS_KEY, loadReviews().filter((r) => r.id !== id));
  changed(true, "reviews", id, true);
}

export interface HistoryEntry {
  id: string;
  title: string;
  questionId: string;
  at: number;
  verdict?: string;
  passed?: string;
  jobLevel: string;
  difficulty: string;
}

const MAX_HISTORY = 25;

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(HISTORY_KEY) || [];

export function pushHistory(entry: HistoryEntry) {
  const all = loadHistory().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  changed(write(HISTORY_KEY, capList("history", all, MAX_HISTORY)), "history", entry.id);
}

// ---- sync bookkeeping --------------------------------------------------------
//
// Everything above still saves to localStorage first and synchronously, exactly
// as before; that copy is what the app reads and what works offline. What is new
// is an outbox: each change also records "this record changed at time T", and
// sync.ts sends those to the server. The outbox lives in localStorage too, so a
// change made just before the tab closed is sent the next time it opens.
//
// The local lists keep their caps. The server keeps everything, and the library
// asks it for the full lists, so falling off the end here no longer means gone.
// A record evicted by a cap is NOT a delete: only the delete functions above
// write a tombstone.

const OUTBOX_KEY = "mock-interviewer:sync-outbox";
/**
 * Records a cap pushed out of a local list before the server had them.
 *
 * Without this, ten interviews while the server was unreachable would push the
 * oldest unsent review off the end of the local list, and the push would find
 * nothing to send. The suite caught exactly that. They wait here until the
 * server confirms it has them.
 */
const SPILL_KEY = "mock-interviewer:sync-spill";
const SYNC_STATE_KEY = "mock-interviewer:sync-state";

export interface OutboxEntry {
  at: number;
  deleted?: boolean;
}
type Outbox = Record<string, OutboxEntry>;

export interface PendingChange extends OutboxEntry {
  collection: Collection;
  id: string;
}

export interface LocalChange {
  collection: Collection;
  id: string;
  /** Set when the change must go out at once, with the value to send. */
  urgent?: unknown;
}

let listener: ((c: LocalChange) => void) | null = null;

/** sync.ts registers here to hear about every local change. */
export function setChangeListener(fn: ((c: LocalChange) => void) | null) {
  listener = fn;
}

const outboxKey = (c: Collection, id: string) => `${c}/${id}`;
const readOutbox = (): Outbox => read<Outbox>(OUTBOX_KEY) || {};

function markPending(c: Collection, id: string, entry: OutboxEntry) {
  const box = readOutbox();
  box[outboxKey(c, id)] = entry;
  write(OUTBOX_KEY, box);
}

const readSpill = () => read<Record<string, unknown>>(SPILL_KEY) || {};

function unspill(k: string) {
  const spill = readSpill();
  if (k in spill) {
    delete spill[k];
    write(SPILL_KEY, spill);
  }
}

/**
 * `list.slice(0, cap)`, except that anything cut off with an unsent change is
 * moved to the spill rather than lost. Takes a list already in keep-order.
 */
function capList<T extends { id: string }>(c: Collection, list: T[], cap: number): T[] {
  const evicted = list.slice(cap);
  if (evicted.length && typeof window !== "undefined") {
    const box = readOutbox();
    const unsent = evicted.filter((x) => box[outboxKey(c, x.id)] && !box[outboxKey(c, x.id)].deleted);
    if (unsent.length) {
      const spill = readSpill();
      for (const x of unsent) spill[outboxKey(c, x.id)] = x;
      write(SPILL_KEY, spill);
    }
  }
  return list.slice(0, cap);
}

/** Passes `ok` through, recording the change when the write landed. */
function changed(ok: boolean, c: Collection, id: string, deleted = false): boolean {
  if (!ok || typeof window === "undefined") return ok;
  const prev = readOutbox()[outboxKey(c, id)];
  // Strictly increasing per record, so two changes in one millisecond still order.
  const at = Math.max(Date.now(), (prev?.at ?? 0) + 1);
  markPending(c, id, deleted ? { at, deleted: true } : { at });
  listener?.({ collection: c, id });
  return ok;
}

export function pendingEntry(c: Collection, id: string): OutboxEntry | undefined {
  return readOutbox()[outboxKey(c, id)];
}

export function pendingChanges(): PendingChange[] {
  return Object.entries(readOutbox()).map(([k, v]) => {
    const slash = k.indexOf("/");
    return { collection: k.slice(0, slash) as Collection, id: k.slice(slash + 1), ...v };
  });
}

/** The server has this version or a newer one; forget it unless it changed again since. */
export function ackChange(c: Collection, id: string, at: number) {
  const box = readOutbox();
  const k = outboxKey(c, id);
  if (box[k] && box[k].at <= at) {
    delete box[k];
    write(OUTBOX_KEY, box);
    unspill(k);
  }
}

/** The server's version beat ours; ours is no longer worth sending. */
export function dropPending(c: Collection, id: string) {
  const box = readOutbox();
  const k = outboxKey(c, id);
  if (box[k]) {
    delete box[k];
    write(OUTBOX_KEY, box);
  }
  unspill(k);
}

export interface SyncState {
  /** Highest server rev this browser has applied. */
  rev: number;
  /** Whether this browser's pre-sync data has been queued for upload. */
  seeded: boolean;
}

export const loadSyncState = (): SyncState => ({ rev: 0, seeded: false, ...read<SyncState>(SYNC_STATE_KEY) });
export const saveSyncState = (s: SyncState) => write(SYNC_STATE_KEY, s);

/** The current local value of one record, as it should be sent. */
export function readRecord(c: Collection, id: string): unknown {
  return readLive(c, id) ?? readSpill()[outboxKey(c, id)];
}

function readLive(c: Collection, id: string): unknown {
  switch (c) {
    case "config":
      return id === CONFIG_ID ? read<Record<string, unknown>>(CONFIG_KEY) ?? undefined : undefined;
    case "sessions": {
      const live = loadSession();
      if (live?.id === id) return live;
      return loadSessionBackups().find((s) => s.id === id);
    }
    case "questions":
      return loadQuestion(id);
    case "reviews":
      return loadReview(id);
    case "history":
      return loadHistory().find((h) => h.id === id);
  }
}

/**
 * Queues everything this browser already holds, once, the first time it syncs.
 *
 * Stamped with when each record was made (seedTime), not now, so an old tab
 * cannot overwrite something newer another device already sent. This is the
 * migration path for data saved before sync existed.
 */
export function seedOutbox(): number {
  if (typeof window === "undefined") return 0;
  const box = readOutbox();
  let n = 0;
  const add = (c: Collection, id: string | undefined, value: unknown) => {
    if (!id || box[outboxKey(c, id)]) return;
    box[outboxKey(c, id)] = { at: seedTime(c, value) };
    n++;
  };
  const config = read<Record<string, unknown>>(CONFIG_KEY);
  if (config) add("config", CONFIG_ID, config);
  const live = loadSession();
  if (live) add("sessions", live.id, live);
  for (const s of loadSessionBackups()) add("sessions", s.id, s);
  for (const q of loadQuestions()) add("questions", q.id, q);
  for (const r of loadReviews()) add("reviews", r.id, r);
  for (const h of loadHistory()) add("history", h.id, h);
  write(OUTBOX_KEY, box);
  return n;
}

/**
 * Applies one version pulled from the server to the local copy, without
 * queueing it to be sent back. Returns whether anything here changed.
 *
 * Sessions are only updated where this browser already has them, live or set
 * aside. Every other browser's sessions stay on the server, where the library's
 * Recoverable tab finds them; pulling them all into a 4-slot ring would only
 * push out this browser's own.
 */
export function applyRemote(env: Envelope): boolean {
  if (typeof window === "undefined") return false;
  const { collection: c, id, deleted, value } = env;
  switch (c) {
    case "config":
      return !deleted && id === CONFIG_ID && !!value && write(CONFIG_KEY, value);
    case "sessions": {
      const live = loadSession();
      if (live?.id === id) {
        // Never remove the live session because another browser deleted its copy.
        return !deleted && !!value && write(SESSION_KEY, value);
      }
      const ring = loadSessionBackups();
      if (!ring.some((s) => s.id === id)) return false;
      return write(
        BACKUPS_KEY,
        deleted || !value
          ? ring.filter((s) => s.id !== id)
          : ring.map((s) => (s.id === id ? trimSession(value as InterviewSession) : s)),
      );
    }
    case "questions":
      return applyToList<SavedQuestion>(QUESTIONS_KEY, MAX_QUESTIONS, env, (q) => q.at);
    case "reviews":
      return applyToList<SavedReview>(REVIEWS_KEY, MAX_REVIEWS, env, (r) => r.at);
    case "history":
      return applyToList<HistoryEntry>(HISTORY_KEY, MAX_HISTORY, env, (h) => h.at);
  }
}

function applyToList<T extends { id: string }>(
  storageKey: string,
  cap: number,
  env: Envelope,
  timeOf: (x: T) => number,
): boolean {
  const list = read<T[]>(storageKey) || [];
  if (env.deleted || !env.value) {
    if (!list.some((x) => x.id === env.id)) return false;
    return write(storageKey, list.filter((x) => x.id !== env.id));
  }
  const sorted = upsertCapped(list, env.value as T, Infinity, timeOf);
  return write(storageKey, capList(collectionOf(storageKey), sorted, cap));
}

function collectionOf(storageKey: string): Collection {
  if (storageKey === QUESTIONS_KEY) return "questions";
  if (storageKey === REVIEWS_KEY) return "reviews";
  return "history";
}
