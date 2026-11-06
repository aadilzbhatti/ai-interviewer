import type { Assessment, InterviewConfig, InterviewSession, Language, Question } from "./types";

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
  delete merged.generateFresh;
  return merged;
}

export const loadConfig = (): InterviewConfig | null => {
  const raw = read<Record<string, unknown>>(CONFIG_KEY);
  return raw ? normalizeConfig(raw) : null;
};
export const saveConfig = (c: InterviewConfig) => write(CONFIG_KEY, c);

const BACKUPS_KEY = "mock-interviewer:session-backups";
const MAX_BACKUPS = 4;

export const loadSession = () => read<InterviewSession>(SESSION_KEY);

/** True when the session actually reached storage. */
export const saveSession = (s: InterviewSession): boolean => write(SESSION_KEY, s);

/**
 * A session set aside rather than destroyed.
 *
 * Trimmed on the way in: per-case run results are the bulkiest part of a
 * session and the least worth keeping, while the code, the transcript and the
 * question are the parts nobody can retype.
 */
function backupOf(s: InterviewSession): InterviewSession {
  return {
    ...s,
    runs: (s.runs ?? []).slice(-3).map((r) => ({ ...r, results: [], stdout: "" })),
  };
}

export const loadSessionBackups = (): InterviewSession[] =>
  read<InterviewSession[]>(BACKUPS_KEY) || [];

export function deleteSessionBackup(id: string) {
  write(BACKUPS_KEY, loadSessionBackups().filter((s) => s.id !== id));
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
  if (current?.question) {
    const rest = loadSessionBackups().filter((s) => s.id !== current.id);
    // Newest first, and never let the ring itself be what fills the quota.
    write(BACKUPS_KEY, [backupOf(current), ...rest].slice(0, MAX_BACKUPS));
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
  clearSession();
  return saveSession(found) ? found : null;
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
  write(QUESTIONS_KEY, all.slice(0, MAX_QUESTIONS));
}

export function markQuestionPracticed(id: string, at = Date.now()) {
  const all = loadQuestions();
  const found = all.find((q) => q.id === id);
  if (!found) return;
  found.lastPracticedAt = at;
  write(QUESTIONS_KEY, all);
}

export function deleteQuestion(id: string) {
  write(QUESTIONS_KEY, loadQuestions().filter((q) => q.id !== id));
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
  write(REVIEWS_KEY, all.slice(0, MAX_REVIEWS));
}

export function deleteReview(id: string) {
  write(REVIEWS_KEY, loadReviews().filter((r) => r.id !== id));
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

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(HISTORY_KEY) || [];

export function pushHistory(entry: HistoryEntry) {
  const all = loadHistory().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  write(HISTORY_KEY, all.slice(0, 25));
}
