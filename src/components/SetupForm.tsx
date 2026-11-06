"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLOCK_MODES,
  DIFFICULTIES,
  HELP_LEVELS,
  JOB_LEVELS,
  ROLE_LABELS,
  helpPolicy,
  recommendedDifficulty,
} from "@/lib/policy";
import { bankCounts } from "@/lib/questions/index";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  clearSession,
  loadSession,
  loadHistory,
  type HistoryEntry,
} from "@/lib/store";
import {
  getJob,
  subscribeJob,
  clearJob,
  cancelJob,
  type GenerationJob,
} from "@/lib/generationJob";
import { percent } from "@/lib/generationProgress";
import type {
  ClockMode,
  InterviewSession,
  Difficulty,
  HelpLevel,
  InterviewConfig,
  JobLevel,
  Language,
  QuestionSource,
  RoleFocus,
} from "@/lib/types";

const SOURCE_COPY: Record<QuestionSource, string> = {
  bank: "A curated question is drawn to match your difficulty, level, and role focus.",
  generated:
    "A generator writes one for your exact settings, a separate vetting agent approves or rejects it, and its reference solution is executed against its own tests before you see it. Takes roughly half a minute.",
  described:
    "Say roughly what you want to practice and it gets built into a full question — worked example, edge cases, hidden tests, and a hint ladder — then vetted and executed before you see it. Well-known problems are fine here; you picked it.",
  saved:
    "Replay a question you generated earlier. No waiting and no model call — it is already built and already verified.",
};

const SEED_PLACEHOLDER =
  "e.g. something with a sliding window over a stream of events, where I have to keep a running aggregate and expire old entries";

const BAND_COPY: Record<string, string> = {
  silent: "The interviewer will not help you at all. Expect long silences.",
  sparse: "You will get a nudge only after you are genuinely stuck.",
  responsive: "A realistic interview: engaged, willing to unblock, and it will question your choices.",
  coaching: "A teaching session. The interviewer will walk you through it step by step.",
};

export default function SetupForm() {
  const router = useRouter();
  const [config, setConfig] = useState<InterviewConfig>(() => loadConfig() || DEFAULT_CONFIG);
  const [history] = useState<HistoryEntry[]>(() => loadHistory());
  // A build started here and left to run keeps going at module scope; this just
  // mirrors it so the home page can say so and offer the result.
  const [job, setJob] = useState<GenerationJob | null>(() => getJob());
  useEffect(() => {
    const sync = () => setJob(getJob());
    sync();
    return subscribeJob(sync);
  }, []);

  /**
   * An interview left running.
   *
   * It was always being saved — a closed tab flushes the snapshot on pagehide —
   * but nothing on this page said so, and /interview was the only door back to
   * it. Someone who closed a tab mid-interview arrived here, saw a blank setup
   * form, concluded their work was gone, and pressed Start; Start called
   * clearSession() and made that true. This banner is the door, and the
   * confirm below is the lock on the other one.
   *
   * Read once, on mount: nothing on this page changes it, and re-reading on
   * every render would make the banner flicker as the form is edited.
   */
  const [resumable, setResumable] = useState(() => {
    if (typeof window === "undefined") return null;
    const s = loadSession();
    return s && !s.endedAt && s.question ? s : null;
  });

  const discardResumable = () => {
    if (!resumable) return;
    if (!confirm(`Discard the interview in progress on "${resumable.question.title}"? This cannot be undone.`)) return;
    clearSession();
    setResumable(null);
  };

  /**
   * Anything that starts a new interview destroys the saved one, so it has to
   * ask first. Silently clearing it is what made a recoverable session
   * unrecoverable.
   */
  const confirmOverwrite = () =>
    !resumable ||
    confirm(
      `You have an interview in progress on "${resumable.question.title}". Starting a new one discards it. Continue?`,
    );

  /** Opens an interview on a question that already exists — no generation wait. */
  const startSavedQuestion = (questionId: string) => {
    if (!confirmOverwrite()) return;
    const base = loadConfig() ?? DEFAULT_CONFIG;
    saveConfig({ ...base, source: "saved", savedQuestionId: questionId });
    clearSession();
    clearJob();
    router.push("/interview");
  };

  const policy = useMemo(() => helpPolicy(config), [config]);
  const counts = bankCounts();
  const set = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const canStart = config.source !== "described" || config.seedDescription.trim().length >= 10;

  const start = () => {
    if (!canStart) return;
    if (!confirmOverwrite()) return;
    saveConfig(config);
    clearSession();
    router.push("/interview");
  };

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Mock coding interview</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          A live interviewer, a real editor, and tests that actually run in your browser. Set the bar,
          then get graded against it.
        </p>
      </header>

      {resumable && (
        <section className="mb-10">
          <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  Interview in progress — {resumable.question.title}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                  {describeResumable(resumable)}
                </p>
              </div>
              <button
                onClick={() => router.push("/interview")}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[#04121f] hover:brightness-110"
              >
                Resume
              </button>
              <button
                onClick={discardResumable}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
              >
                Discard
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-6">
        <Field
          label="Target job level"
          hint={JOB_LEVELS[config.jobLevel].bar}
        >
          <Segmented
            options={(Object.keys(JOB_LEVELS) as JobLevel[]).map((k) => ({
              value: k,
              label: JOB_LEVELS[k].label.split(" (")[0],
            }))}
            value={config.jobLevel}
            onChange={(v) => set("jobLevel", v)}
          />
          {config.difficulty !== recommendedDifficulty(config.jobLevel) && (
            <button
              type="button"
              onClick={() => set("difficulty", recommendedDifficulty(config.jobLevel))}
              className="mt-2 text-xs text-[var(--accent)] hover:underline"
            >
              Use the usual difficulty for this level ({recommendedDifficulty(config.jobLevel)})
            </button>
          )}
        </Field>

        <Field
          label="Difficulty"
          hint={DIFFICULTIES[config.difficulty].blurb}
        >
          <Segmented
            options={(Object.keys(DIFFICULTIES) as Difficulty[]).map((k) => ({
              value: k,
              label: `${DIFFICULTIES[k].label} (${counts[k]})`,
            }))}
            value={config.difficulty}
            onChange={(v) => set("difficulty", v)}
          />
        </Field>

        <Field label="How much help do you want?" hint={HELP_LEVELS[config.helpLevel].blurb}>
          <Segmented
            options={(Object.keys(HELP_LEVELS) as HelpLevel[]).map((k) => ({
              value: k,
              label: HELP_LEVELS[k].label,
            }))}
            value={config.helpLevel}
            onChange={(v) => set("helpLevel", v)}
          />
          <div className="mt-3 rounded-lg border bg-[var(--panel)] p-3">
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${policy.score}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                {policy.score}/100 · {policy.band}
              </span>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {BAND_COPY[policy.band]} Aiming at {JOB_LEVELS[config.jobLevel].label.split(" (")[0]} shifts
              this by {JOB_LEVELS[config.jobLevel].helpAdjust >= 0 ? "+" : ""}
              {JOB_LEVELS[config.jobLevel].helpAdjust}.
            </p>
          </div>
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Role focus" hint="Steers which questions are drawn.">
            <Select
              value={config.role}
              onChange={(v) => set("role", v as RoleFocus)}
              options={Object.keys(ROLE_LABELS).map((k) => ({ value: k, label: ROLE_LABELS[k] }))}
            />
          </Field>
          <Field label="Language" hint="Runs in your browser — no server, no setup.">
            <Select
              value={config.language}
              onChange={(v) => set("language", v as Language)}
              options={[
                { value: "python", label: "Python 3" },
                { value: "javascript", label: "JavaScript" },
              ]}
            />
          </Field>
        </div>

        <Field label="Length" hint="The interviewer paces itself against this.">
          <Segmented
            options={[20, 35, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))}
            value={String(config.durationMin)}
            onChange={(v) => set("durationMin", Number(v))}
          />
        </Field>

        <Field label="Clock" hint={CLOCK_MODES[config.clockMode].blurb}>
          <Segmented
            options={(Object.keys(CLOCK_MODES) as ClockMode[]).map((k) => ({
              value: k,
              label: CLOCK_MODES[k].label,
            }))}
            value={config.clockMode}
            onChange={(v) => set("clockMode", v)}
          />
        </Field>

        <Field label="Where the question comes from">
          <Segmented
            options={[
              { value: "bank", label: "Question bank" },
              { value: "generated", label: "Generate a new one" },
              { value: "described", label: "Describe it yourself" },
            ]}
            value={config.source}
            onChange={(v) => set("source", v as QuestionSource)}
          />
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{SOURCE_COPY[config.source]}</p>
        </Field>

        {config.source === "described" && (
          <div>
            <textarea
              value={config.seedDescription}
              onChange={(e) => set("seedDescription", e.target.value)}
              rows={4}
              placeholder={SEED_PLACEHOLDER}
              className="w-full resize-y rounded-lg border bg-[var(--panel)] px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-[var(--muted)]/70 focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              Rough is fine — a sentence works. Anything you leave open gets pinned down for you, and the
              choices are spelled out in the problem statement so you are never guessing at a hidden test.
            </p>
          </div>
        )}

        <button
          onClick={start}
          disabled={!canStart}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-medium text-[#04121f] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start interview
        </button>
        {!canStart && (
          <p className="-mt-4 text-center text-xs text-[var(--muted)]">
            Describe the question you want to practice first.
          </p>
        )}
      </section>

      {job && (
        <section className="mt-10">
          <div
            className={`rounded-xl border p-4 ${
              job.status === "done"
                ? "border-[var(--ok)]/40 bg-[var(--ok)]/5"
                : job.status === "failed"
                  ? "border-[var(--bad)]/40 bg-[var(--bad)]/5"
                  : "bg-[var(--panel)]"
            }`}
          >
            <div className="flex items-center gap-3">
              {job.status === "running" && (
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-[var(--accent)]/40" />
                  <span className="relative m-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {job.status === "running"
                    ? `Building a question in the background — ${percent(job.progress)}%`
                    : job.status === "done"
                      ? `Ready: ${job.question?.title ?? "your question"}`
                      : job.status === "cancelled"
                        ? "Build stopped"
                        : "That build did not produce a usable question"}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                  {job.status === "running"
                    ? "Carry on here — it keeps going. Reloading the page is what would stop it."
                    : job.status === "done"
                      ? "Saved to your library, so it is yours whether or not you start now."
                      : job.error}
                </p>
              </div>
              {job.status === "done" && job.question && (
                <button
                  onClick={() => startSavedQuestion(job.question!.id)}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[#04121f] hover:brightness-110"
                >
                  Start interview
                </button>
              )}
              {job.status === "running" && (
                <>
                  <button
                    onClick={() => router.push("/interview")}
                    className="shrink-0 rounded-lg border px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    Watch
                  </button>
                  <button
                    onClick={() => {
                      // Cancel first so the in-flight call is actually dropped;
                      // clearing alone would only stop showing it.
                      cancelJob();
                      clearJob();
                      setJob(null);
                    }}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                    title="Ends the build now. The half-finished question is discarded."
                  >
                    Stop
                  </button>
                </>
              )}
              {job.status !== "running" && (
                <button
                  onClick={() => {
                    clearJob();
                    setJob(null);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Dismiss
                </button>
              )}
            </div>
            {job.status === "running" && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{
                    width: `${percent(job.progress)}%`,
                    transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-12">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Recent sessions
            </h2>
            <button
              onClick={() => router.push("/history")}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              View past reviews →
            </button>
          </div>
          <ul className="divide-y rounded-lg border bg-[var(--panel)]">
            {history.slice(0, 6).map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => router.push("/history")}
                  className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left text-sm hover:bg-[var(--panel-2)]"
                >
                  <span className="truncate">{h.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {h.difficulty} · {h.jobLevel}
                    {h.verdict ? ` · ${h.verdict.replace(/_/g, " ")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-right text-xs text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            value === o.value
              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]"
              : "bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** What is actually still in there, so "Resume" is an informed click. */
function describeResumable(s: InterviewSession): string {
  const mins = Math.round((s.accumulatedMs ?? 0) / 60000);
  const lines = (s.code?.[s.config.language] ?? "").trim().split("\n").filter(Boolean).length;
  const last = s.runs?.[s.runs.length - 1];
  const parts = [
    `${mins} min on the clock`,
    lines ? `${lines} lines written` : "nothing written yet",
    last && !last.error ? `last run ${last.passed}/${last.total}` : null,
    s.paused ? "paused" : null,
  ].filter(Boolean);
  return `${parts.join(" · ")}. Saved when you closed the tab.`;
}
