/**
 * Question generation as a background job.
 *
 * Generation takes 30-90 seconds across two model calls, a possible repair
 * round and an in-browser execution check. It used to run inside the interview
 * screen, which meant navigating away killed it and threw the work away — so
 * the only way to get a question was to sit and watch a progress bar.
 *
 * This lives at module scope instead, outside React, so it keeps running while
 * you go back to the home page and do something else. The finished question is
 * banked into the library the moment it is verified, which is what makes it
 * selectable later.
 *
 * One honest limitation: this survives client-side navigation, not a full page
 * reload. A reload tears down the JS context and the in-flight model calls with
 * it. `startedAt` is persisted so a reloaded page can at least say that a build
 * was interrupted rather than pretending nothing happened.
 */
import {
  initialProgress,
  applyEvent,
  tickProgress,
  type ProgressState,
  type GenerationEvent,
} from "./generationProgress";
import { checkSoundness } from "./exec/soundness";
import { saveQuestion } from "./store";
import { noteBreadcrumb } from "./crashWatch";
import type { InterviewConfig, Question, VetVerdict } from "./types";

export type JobStatus = "running" | "done" | "failed" | "cancelled";

export interface GenerationJob {
  id: string;
  config: InterviewConfig;
  status: JobStatus;
  progress: ProgressState;
  /** Set when wrong expected values were corrected rather than regenerated. */
  notice?: string;
  question?: Question;
  verdict?: VetVerdict;
  /** Why it failed — or, when cancelled, that it was stopped on purpose. */
  error?: string;
  /**
   * True when generation failed but the settings allow a bank question
   * instead. A question the candidate described themselves is never swapped.
   */
  canFallBack?: boolean;
  startedAt: number;
}

const TICK_MS = 250;

let current: GenerationJob | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** Aborts the model call in flight, so stopping actually stops the spending. */
let inflight: AbortController | null = null;
const listeners = new Set<() => void>();

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function getJob(): GenerationJob | null {
  return current;
}

export function subscribeJob(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

function patch(next: Partial<GenerationJob>) {
  if (!current) return;
  current = { ...current, ...next };
  emit();
}

export function clearJob() {
  inflight?.abort();
  inflight = null;
  current = null;
  stopTicker();
  emit();
}

/**
 * The job, while it is still the one being built and nobody has stopped it.
 *
 * Every step of `run` checks this before doing the next one, because the parts
 * it awaits — a model call, the in-browser execution check — cannot all be
 * interrupted mid-flight. A cancelled build is allowed to finish computing in
 * the background; what it must never do is come back and bank a question, move
 * the bar, or announce itself as ready.
 */
function liveJob(jobId: string): GenerationJob | null {
  return current && current.id === jobId && current.status === "running" ? current : null;
}

/**
 * Stops the build in progress. The half-finished question is discarded rather
 * than banked: it has not passed its own tests yet, and a library full of
 * unverified questions would be worse than no question at all.
 */
export function cancelJob() {
  if (!current || current.status !== "running") return;
  noteBreadcrumb("generation stopped by the candidate");
  inflight?.abort();
  inflight = null;
  stopTicker();
  patch({ status: "cancelled", error: "You stopped this build." });
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Keeps the bar creeping between real events even with nobody watching. */
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!current || current.status !== "running") return stopTicker();
    const next = tickProgress(current.progress, Date.now());
    if (next !== current.progress) patch({ progress: next });
  }, TICK_MS);
}

/** Does an existing job already satisfy this request? */
export function jobMatches(config: InterviewConfig): boolean {
  if (!current) return false;
  const a = current.config;
  return (
    a.source === config.source &&
    a.difficulty === config.difficulty &&
    a.jobLevel === config.jobLevel &&
    a.role === config.role &&
    a.language === config.language &&
    a.seedDescription.trim() === config.seedDescription.trim()
  );
}

/**
 * Starts a build, or returns the one already running for these settings rather
 * than paying for a second identical generation.
 */
export function startJob(config: InterviewConfig): GenerationJob {
  if (current && current.status === "running" && jobMatches(config)) return current;

  inflight?.abort();
  inflight = new AbortController();
  current = {
    id: uid(),
    config,
    status: "running",
    progress: initialProgress(Date.now()),
    startedAt: Date.now(),
  };
  emit();
  startTicker();
  void run(current.id, config, inflight.signal);
  return current;
}

/** Applies a progress event, ignoring anything from a job that has been replaced or stopped. */
function pushEvent(jobId: string, event: GenerationEvent) {
  const job = liveJob(jobId);
  if (!job) return;
  patch({ progress: applyEvent(job.progress, event, Date.now()) });
  if (event.type === "phase" && event.stage) noteBreadcrumb(`generating: ${event.stage}`);
}

async function run(jobId: string, cfg: InterviewConfig, signal: AbortSignal) {
  const described = cfg.source === "described";
  noteBreadcrumb(`generation started (${cfg.source})`);

  try {
    const first = await streamGeneration({ config: cfg }, (e) => pushEvent(jobId, e), 0, signal);
    if (!liveJob(jobId)) return;
    if (first.error) throw new Error(first.error);
    if (!first.question) throw new Error("The generator returned nothing.");

    let q = first.question;
    let v = first.verdict;

    pushEvent(jobId, { type: "phase", stage: "verify" });
    let sound = await checkSoundness(q, cfg.language, "exec-check");
    if (!liveJob(jobId)) return;

    if (sound.kind === "corrected") {
      q = sound.question;
      patch({ notice: sound.note });
      noteBreadcrumb("corrected wrong expected values");
    }

    if (sound.kind === "unsound") {
      noteBreadcrumb(`unsound: ${sound.summary}`);
      pushEvent(jobId, { type: "verdict", approved: false, issue: sound.summary });

      const fixed = await streamGeneration(
        { config: cfg, repair: { question: q, failures: sound.failures } },
        (e) => pushEvent(jobId, e),
        current?.progress.attempt ?? 1,
        signal,
      );
      if (!liveJob(jobId)) return;
      if (fixed.question) {
        q = fixed.question;
        v = fixed.verdict;
        pushEvent(jobId, { type: "phase", stage: "verify" });
        sound = await checkSoundness(q, cfg.language, "exec-check:after-repair");
        if (!liveJob(jobId)) return;
        if (sound.kind === "corrected") {
          q = sound.question;
          patch({ notice: sound.note });
          noteBreadcrumb("corrected wrong expected values after repair");
        }
      }
      if (sound.kind === "unsound") {
        noteBreadcrumb("gave up on the generated question");
        finishFailed(
          jobId,
          `${sound.summary} The question is not sound, so it was not used.`,
          !described,
        );
        return;
      }
    }

    if (!liveJob(jobId)) return;
    // Banked before anyone is told it is ready, so a question is never
    // announced that cannot be found again afterwards.
    saveQuestion({
      id: q.id,
      at: Date.now(),
      question: q,
      difficulty: cfg.difficulty,
      jobLevel: cfg.jobLevel,
      role: cfg.role,
      seedDescription: described ? cfg.seedDescription.trim() || undefined : undefined,
    });
    noteBreadcrumb(`question ready: ${q.title}`);
    pushEvent(jobId, { type: "result" });
    patch({ status: "done", question: q, verdict: v });
    stopTicker();
  } catch (e) {
    // A stopped build throws from the aborted fetch. That is the outcome the
    // candidate asked for, not a failure to report back to them.
    if (!liveJob(jobId)) return;
    finishFailed(jobId, e instanceof Error ? e.message : String(e), !described);
  }
}

function finishFailed(jobId: string, error: string, canFallBack: boolean) {
  if (!liveJob(jobId)) return;
  noteBreadcrumb(`generation failed: ${error}`);
  pushEvent(jobId, { type: "error", message: error });
  patch({ status: "failed", error, canFallBack });
  stopTicker();
}

/**
 * Reads the generate route's NDJSON stream, handing each event to the progress
 * model as it lands. Partial lines are buffered — a chunk boundary can fall
 * anywhere, including inside a JSON object.
 */
export async function streamGeneration(
  payload: unknown,
  onEvent: (event: GenerationEvent) => void,
  /** A repair request restarts the server's round counter; keep the UI honest. */
  attemptOffset = 0,
  /** Aborting it closes the connection, which is what ends the model call. */
  signal?: AbortSignal,
): Promise<{ question?: Question; verdict?: VetVerdict; error?: string }> {
  const res = await fetch("/api/questions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return { error: text || `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out: { question?: Question; verdict?: VetVerdict; error?: string } = {};

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: (GenerationEvent & { question?: Question; verdict?: VetVerdict }) | undefined;
    try {
      event = JSON.parse(line);
    } catch {
      return; // a malformed line should not take the stream down
    }
    if (!event) return;
    if (event.type === "result") {
      // The server is done, but the execution check and any repair round are
      // still ahead — completing the bar here would be a lie. Completion is
      // marked once the question has actually passed its own tests.
      out = { question: event.question, verdict: event.verdict };
      return;
    }
    if (event.type === "error") out = { error: event.message };
    onEvent(
      event.attempt === undefined ? event : { ...event, attempt: event.attempt + attemptOffset },
    );
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  handle(buffer);
  return out;
}
