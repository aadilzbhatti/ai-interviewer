"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AssessmentReport from "@/components/AssessmentReport";
import {
  loadReviews,
  deleteReview,
  loadQuestions,
  deleteQuestion,
  loadConfig,
  saveConfig,
  clearSession,
  loadSessionBackups,
  deleteSessionBackup,
  restoreSessionBackup,
  DEFAULT_CONFIG,
  type SavedReview,
  type SavedQuestion,
} from "@/lib/store";
import { VERDICT_LABELS } from "@/lib/policy";
import type { InterviewSession, Verdict } from "@/lib/types";

const VERDICT_TONE: Record<string, string> = {
  strong_hire: "var(--ok)",
  leaning_strong_hire: "var(--ok)",
  hire: "var(--ok)",
  leaning_hire: "#7bb661",
  neutral: "var(--muted)",
  leaning_no_hire: "var(--warn)",
  no_hire: "var(--bad)",
  strong_no_hire: "var(--bad)",
};

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export default function HistoryBrowser() {
  const router = useRouter();
  const [reviews, setReviews] = useState<SavedReview[]>(() => loadReviews());
  const [questions, setQuestions] = useState<SavedQuestion[]>(() => loadQuestions());
  const [tab, setTab] = useState<"reviews" | "questions" | "recovered">("reviews");
  // Interviews that were set aside rather than deleted — see clearSession.
  const [backups, setBackups] = useState<InterviewSession[]>(() => loadSessionBackups());
  const [openId, setOpenId] = useState<string | null>(null);

  const open = reviews.find((r) => r.id === openId);

  /**
   * Starts a fresh interview on a question that already exists. Keeps whatever
   * level, language and help settings they last used — only the source changes.
   */
  const practice = (saved: SavedQuestion) => {
    const base = loadConfig() ?? DEFAULT_CONFIG;
    if (
      !confirm(
        `Start a new interview on "${saved.question.title}"?\n\nAny interview currently in progress will be discarded.`,
      )
    ) {
      return;
    }
    saveConfig({ ...base, source: "saved", savedQuestionId: saved.id });
    clearSession();
    router.push("/interview");
  };

  if (open) {
    return (
      <div>
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-[var(--panel)]/95 px-5 py-2.5 backdrop-blur">
          <button
            onClick={() => setOpenId(null)}
            className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
          >
            ← All reviews
          </button>
          <span className="truncate text-sm font-medium">{open.title}</span>
          <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{when(open.at)}</span>
        </div>
        <AssessmentReport
          assessment={open.assessment}
          question={open.question}
          language={open.language}
          code={open.code}
          savedPath={open.savedSolutionPath}
          saveMessage={
            open.savedSolutionPath
              ? `Saved to ${open.savedSolutionPath}`
              : "This solution was not written to disk."
          }
        />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <div className="mb-8 flex items-baseline gap-3">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          ←
        </button>
        <h1 className="text-2xl font-semibold tracking-tight">Your library</h1>
      </div>

      <div className="mb-6 flex gap-1 rounded-lg border bg-[var(--panel)] p-1">
        {(
          [
            ["reviews", `Past interviews${reviews.length ? ` (${reviews.length})` : ""}`],
            ["questions", `Saved questions${questions.length ? ` (${questions.length})` : ""}`],
            ["recovered", `Recoverable${backups.length ? ` (${backups.length})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
              tab === key
                ? "bg-[var(--panel-2)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "recovered" ? (
        backups.length === 0 ? (
          <div className="rounded-xl border bg-[var(--panel)] p-8 text-center">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Nothing set aside. When an interview in progress is replaced by a new one, it is kept
              here instead of being deleted, so starting something new can never cost you an hour of
              work again.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {backups.map((b) => {
              const lines = (b.code?.[b.config.language] ?? "").trim().split("\n").filter(Boolean).length;
              return (
                <li key={b.id} className="rounded-xl border bg-[var(--panel)] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{b.question.title}</div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {when(b.startedAt)} · {Math.round((b.accumulatedMs ?? 0) / 60000)} min ·{" "}
                        {lines} lines of {b.config.language} · {b.messages?.length ?? 0} messages
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (
                          !confirm(
                            `Restore "${b.question.title}" as your current interview?\n\nAnything currently in progress is set aside the same way.`,
                          )
                        ) {
                          return;
                        }
                        if (restoreSessionBackup(b.id)) router.push("/interview");
                      }}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[#04121f] hover:brightness-110"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete the set-aside interview on "${b.question.title}"?`)) return;
                        deleteSessionBackup(b.id);
                        setBackups(loadSessionBackups());
                      }}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                    >
                      Delete
                    </button>
                  </div>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg border bg-[var(--panel-2)] p-2.5 font-mono text-[11px] leading-relaxed">
                    <code>{(b.code?.[b.config.language] ?? "").trim() || "(no code)"}</code>
                  </pre>
                </li>
              );
            })}
          </ul>
        )
      ) : tab === "questions" ? (
        questions.length === 0 ? (
          <div className="rounded-xl border bg-[var(--panel)] p-8 text-center">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              No saved questions yet. Every question the generator builds for you is kept here
              automatically, so you can practise it again without waiting for it to be written and
              vetted a second time.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-[var(--panel)]">
              {questions.map((q) => (
                <li key={q.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{q.question.title}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                      {when(q.at)} · {q.difficulty} · {q.jobLevel} · {q.role}
                      {q.question.comparison === "validator" ? " · any valid answer" : ""}
                      {q.lastPracticedAt ? ` · practised ${when(q.lastPracticedAt)}` : ""}
                    </div>
                    {q.seedDescription && (
                      <div className="mt-1 truncate text-xs italic text-[var(--muted)]/70">
                        “{q.seedDescription}”
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => practice(q)}
                    className="shrink-0 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1.5 text-xs text-[var(--accent)]"
                  >
                    Practise
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Remove "${q.question.title}" from your library?`)) return;
                      deleteQuestion(q.id);
                      setQuestions(loadQuestions());
                    }}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              Kept in this browser, newest {questions.length} of up to 40. Practising one starts a
              fresh interview with no generation wait — it has already been vetted and executed.
            </p>
          </>
        )
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border bg-[var(--panel)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            No graded interviews yet. Finish one and its full review will be kept here — the
            debrief, the scores, your code, and the reference solution.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#04121f] hover:brightness-110"
          >
            Start one
          </button>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-[var(--panel)]">
          {reviews.map((r) => {
            const tone = VERDICT_TONE[r.verdict ?? "neutral"] ?? "var(--muted)";
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setOpenId(r.id)}
                  className="min-w-0 flex-1 text-left"
                  title="Open the full review"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    {r.verdict && (
                      <span className="shrink-0 text-xs" style={{ color: tone }}>
                        {VERDICT_LABELS[r.verdict as Verdict] ?? r.verdict.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {when(r.at)} · {r.difficulty} · {r.jobLevel} · {r.language}
                    {r.passed ? ` · ${r.passed} passing` : ""}
                    {r.elapsedMin ? ` · ${Math.round(r.elapsedMin)} min` : ""}
                  </div>
                  {r.savedSolutionPath && (
                    <div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]/70">
                      {r.savedSolutionPath}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`Delete the saved review for "${r.title}"? The solution file on disk is not touched.`)) return;
                    deleteReview(r.id);
                    setReviews(loadReviews());
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                  title="Remove this review from the browser. Does not delete the file on disk."
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "reviews" && reviews.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Kept in this browser, newest {reviews.length} of up to 20. Your solution files on disk are
          separate and are never removed from here.
        </p>
      )}
    </main>
  );
}
