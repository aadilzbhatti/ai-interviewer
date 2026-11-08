"use client";

import { useEffect, useState } from "react";
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
  loadSession,
  loadQuestion,
  saveQuestion,
  restoreSession,
  pendingChanges,
  DEFAULT_CONFIG,
  type SavedReview,
  type SavedQuestion,
} from "@/lib/store";
import { VERDICT_LABELS } from "@/lib/policy";
import type { InterviewSession, Verdict } from "@/lib/types";
import {
  fetchCollection,
  fetchRecord,
  getSyncStatus,
  subscribePulled,
  subscribeSyncStatus,
  type SyncStatus,
} from "@/lib/sync";
import { unionById, type Collection } from "@/lib/syncModel";

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

const byAt = <T extends { at: number }>(xs: T[]) => [...xs].sort((a, b) => b.at - a.at);

/** Unsent local changes for one collection, so a merge neither drops nor resurrects them. */
function pendingFor(c: Collection) {
  const mine = pendingChanges().filter((p) => p.collection === c);
  return {
    pendingIds: new Set(mine.filter((p) => !p.deleted).map((p) => p.id)),
    deletedIds: new Set(mine.filter((p) => p.deleted).map((p) => p.id)),
  };
}

function SyncLine({ status, serverOk }: { status: SyncStatus; serverOk: boolean | null }) {
  const host = status.host ?? "the server";
  if (status.state === "offline" || serverOk === false) {
    return (
      <p className="mb-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--warn)]">
        Can&apos;t reach {host}. Everything is still saved in this browser
        {status.pending ? `, and ${status.pending} change${status.pending === 1 ? "" : "s"} will sync` : " and will sync"} when
        it is back. This list may be missing interviews saved from other devices.
      </p>
    );
  }
  const synced =
    status.state === "syncing"
      ? "syncing…"
      : status.lastSyncedAt
        ? `synced ${new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "connecting…";
  return (
    <p className="mb-6 text-xs text-[var(--muted)]">
      Saved on {host}, so it follows you to any browser or device · {synced}
    </p>
  );
}

/**
 * The full lists live on the server; this browser keeps only the newest few.
 * Merges the two so the library shows everything, including anything changed
 * here that has not been sent yet. A null list means the server did not answer
 * and the local one should stand.
 */
async function loadLibrary() {
  const [r, q, s] = await Promise.all([
    fetchCollection<SavedReview>("reviews"),
    fetchCollection<SavedQuestion>("questions"),
    fetchCollection<InterviewSession>("sessions", 100),
  ]);
  let backups: InterviewSession[] | null = null;
  let remoteOnly = new Set<string>();
  if (s) {
    const local = loadSessionBackups();
    const localIds = new Set(local.map((b) => b.id));
    // Finished interviews are under Past interviews; only unfinished ones are recoverable.
    const remote = s.filter((x) => x.question && !x.endedAt && !localIds.has(x.id));
    const liveId = loadSession()?.id;
    backups = unionById(remote, local, pendingFor("sessions"))
      .filter((b) => b.id !== liveId)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    remoteOnly = new Set(remote.map((x) => x.id));
  }
  return {
    reviews: r ? byAt(unionById(r, loadReviews(), pendingFor("reviews"))) : null,
    questions: q ? byAt(unionById(q, loadQuestions(), pendingFor("questions"))) : null,
    backups,
    remoteOnly,
    ok: !!(r && q && s),
  };
}

export default function HistoryBrowser() {
  const router = useRouter();
  const [reviews, setReviews] = useState<SavedReview[]>(() => loadReviews());
  const [questions, setQuestions] = useState<SavedQuestion[]>(() => loadQuestions());
  const [tab, setTab] = useState<"reviews" | "questions" | "recovered">("reviews");
  // Interviews that were set aside rather than deleted — see clearSession.
  const [backups, setBackups] = useState<InterviewSession[]>(() => loadSessionBackups());
  const [openId, setOpenId] = useState<string | null>(null);
  // Sessions only the server has: started in another browser, or pushed out of
  // this one's 4-slot ring. null until the server answers; false if it cannot.
  const [remoteOnly, setRemoteOnly] = useState<Set<string>>(new Set());
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [status, setStatusState] = useState<SyncStatus>(() => getSyncStatus());
  useEffect(() => subscribeSyncStatus(setStatusState), []);

  useEffect(() => {
    let live = true;
    const apply = () =>
      void loadLibrary().then((lib) => {
        if (!live) return;
        if (lib.reviews) setReviews(lib.reviews);
        if (lib.questions) setQuestions(lib.questions);
        if (lib.backups) setBackups(lib.backups);
        setRemoteOnly(lib.remoteOnly);
        setServerOk(lib.ok);
      });
    apply();
    const unsubscribe = subscribePulled(apply);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

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
    // The interview page reads the question from this browser. One that only
    // the server had (older than the newest 40) has to be brought here first.
    if (!loadQuestion(saved.id)) saveQuestion(saved);
    saveConfig({ ...base, source: "saved", savedQuestionId: saved.id });
    clearSession();
    router.push("/interview");
  };

  /** Prefers the server's copy: it is the full one, where this browser's ring is trimmed. */
  const restore = async (b: InterviewSession) => {
    const full = await fetchRecord<InterviewSession>("sessions", b.id);
    const chosen = full ?? loadSessionBackups().find((x) => x.id === b.id) ?? null;
    if (!chosen) {
      alert("That interview could not be loaded. The server is unreachable and this browser has no copy.");
      return;
    }
    if (restoreSession(chosen)) router.push("/interview");
    else alert("This browser refused to save the interview (storage full?). Nothing was changed.");
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
      <SyncLine status={status} serverOk={serverOk} />

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
                        {remoteOnly.has(b.id) ? ` · from ${status.host ?? "the server"}, not this browser` : ""}
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
                        void restore(b);
                      }}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[#04121f] hover:brightness-110"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete the set-aside interview on "${b.question.title}"?`)) return;
                        deleteSessionBackup(b.id);
                        setBackups((prev) => prev.filter((x) => x.id !== b.id));
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
                      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
                    }}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              {serverOk
                ? `All ${questions.length} kept on ${status.host ?? "the server"}.`
                : `Kept in this browser, newest ${questions.length} of up to 40.`}{" "}
              Practising one starts a fresh interview with no generation wait — it has already been
              vetted and executed.
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
                    setReviews((prev) => prev.filter((x) => x.id !== r.id));
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--bad)]"
                  title="Remove this review from your library on every device. Does not delete the solution file on disk."
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
          {serverOk
            ? `All ${reviews.length} kept on ${status.host ?? "the server"}.`
            : `Kept in this browser, newest ${reviews.length} of up to 20.`}{" "}
          Your solution files on disk are separate and are never removed from here.
        </p>
      )}
    </main>
  );
}
