"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VERDICTS, VERDICT_LABELS, describeConcession, easingConcessions } from "@/lib/policy";
import { normalizeScore } from "@/lib/verdict";
import type {
  Assessment,
  Concession,
  CriterionKey,
  Language,
  Question,
  TimelineEntry,
  TimingRecord,
  Verdict,
} from "@/lib/types";

const mins = (m: number) => `t+${String(Math.max(0, Math.round(m))).padStart(2, "0")}m`;

/** The clock, in the app's words rather than the grader's, so it is always said. */
function timingSentence(t: TimingRecord): string {
  const used = `You used ${Math.round(t.usedMin)} of ${t.finalBudgetMin} minutes`;
  if (t.strictAtEnd) return `Strict time was on throughout. ${used}, and the limit counted.`;
  if (t.strictAtStart) {
    return `Strict time was turned off at ${mins(t.relaxedAtMin ?? 0)} when you added time (${t.extensions} × 5 min; planned ${t.plannedMin}). ${used}. The extra time was not held against you.`;
  }
  return `Relaxed time: the ${t.plannedMin}-minute plan was a pacing guide. ${used}${
    t.extensions ? `, including ${t.extensions} × 5 min you added` : ""
  }. Time taken was not held against you.`;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  strong_hire: "var(--ok)",
  leaning_strong_hire: "var(--ok)",
  hire: "var(--ok)",
  leaning_hire: "var(--ok-soft)",
  neutral: "var(--muted)",
  leaning_no_hire: "var(--warn)",
  no_hire: "var(--bad)",
  strong_no_hire: "var(--bad)",
};

const CRITERIA: { key: CriterionKey; label: string }[] = [
  { key: "problemSolving", label: "Problem solving" },
  { key: "codeQuality", label: "Code quality" },
  { key: "communication", label: "Communication" },
  { key: "testingRigor", label: "Testing rigor" },
  { key: "complexityAnalysis", label: "Complexity analysis" },
];

const CODE_REVIEW_ROWS: { key: keyof Assessment["codeReview"]; label: string }[] = [
  { key: "correctness", label: "Correctness" },
  { key: "complexity", label: "Complexity" },
  { key: "readability", label: "Readability" },
  { key: "edgeCases", label: "Edge cases" },
];

export default function AssessmentReport({
  assessment,
  concessions = [],
  savedPath,
  saveMessage,
  saving = false,
  question,
  language,
  code,
  onSave,
  onRestart,
}: {
  assessment: Assessment;
  concessions?: Concession[];
  savedPath?: string | null;
  saveMessage?: string;
  saving?: boolean;
  /** Carries the reference solution, revealed only on request. */
  question?: Question | null;
  language?: Language;
  /** What the candidate submitted, shown next to the reference. */
  code?: string;
  onSave?: () => void;
  /** Absent when the report is being re-read from history rather than just earned. */
  onRestart?: () => void;
}) {
  const verdict: Verdict = VERDICTS.includes(assessment.verdict) ? assessment.verdict : "neutral";
  const color = VERDICT_COLOR[verdict];
  const timeline = assessment.timeline ?? [];
  const review = assessment.codeReview;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 pb-24">
      <header className="mb-9">
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
          style={{ borderColor: color, color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          {VERDICT_LABELS[verdict]}
        </div>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight">{assessment.headline}</h1>
        <VerdictScale verdict={verdict} />
        {assessment.verdictAdjustment && (
          <div className="mt-4 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-3.5">
            <div className="text-xs font-medium tracking-wider text-[var(--warn)] uppercase">
              Verdict corrected
            </div>
            <p className="mt-1.5 text-sm leading-relaxed">
              The grader wrote{" "}
              <span className="font-medium">
                {VERDICT_LABELS[assessment.verdictAdjustment.from as Verdict] ??
                  assessment.verdictAdjustment.from}
              </span>
              . {assessment.verdictAdjustment.reason}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              You are seeing this because the correction happened, not instead of it. The scores and
              commentary below are exactly as the grader wrote them — only the headline verdict moved.
            </p>
          </div>
        )}
        {assessment.struckHelp && assessment.struckHelp.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-3.5">
            <div className="text-xs font-medium tracking-wider text-[var(--warn)] uppercase">
              Help charged that you did not ask for
            </div>
            <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
              {assessment.struckHelp.map((h, i) => (
                <li key={i}>
                  <span className="tabular-nums text-[var(--muted)]">{mins(h.atMin)}</span> {h.what}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              The grader held this against you, but the transcript shows no request from you at that
              point: no Hint button and no question asking for help. Help you did not ask for is not
              supposed to count. It is struck here; read the scores below knowing they may still
              reflect it.
            </p>
          </div>
        )}
        {assessment.helpRuleCheck && assessment.helpRuleCheck.remaining.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/5 p-3.5">
            <div className="text-xs font-medium tracking-wider text-[var(--warn)] uppercase">
              This review still counts help you did not ask for
            </div>
            <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
              {assessment.helpRuleCheck.remaining.map((s, i) => (
                <li key={i}>&ldquo;{s}&rdquo;</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              The grader was sent back once to remove this and did not. Help nobody asked for is not
              supposed to lower a score, appear as a gap, or move the verdict. Discount these lines and
              whatever they drove.
            </p>
          </div>
        )}
        {assessment.helpRuleCheck &&
          assessment.helpRuleCheck.firstDraft.length > 0 &&
          assessment.helpRuleCheck.remaining.length === 0 && (
            <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
              The first draft of this review held help you did not ask for against you (
              {assessment.helpRuleCheck.firstDraft.length} statement
              {assessment.helpRuleCheck.firstDraft.length === 1 ? "" : "s"}). It was sent back and
              rewritten without it.
            </p>
          )}
        {assessment.timing && (
          <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
            <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wider">Time</span>
            {timingSentence(assessment.timing)}
          </p>
        )}
        {assessment.barJudgedAgainst && (
          <p className="mt-5 border-l-2 pl-3 text-sm leading-relaxed text-[var(--muted)]">
            <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wider">
              Judged against
            </span>
            {assessment.barJudgedAgainst}
          </p>
        )}
      </header>

      {assessment.debrief && (
        <Section title="Debrief">
          <div className="prose-chat rounded-xl border bg-[var(--panel)] p-5 text-[0.925rem] leading-[1.75]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{assessment.debrief}</ReactMarkdown>
          </div>
        </Section>
      )}

      <Section title="Scores">
        <div className="divide-y rounded-xl border bg-[var(--panel)]">
          {CRITERIA.map(({ key, label }) => {
            const entry = assessment.scores?.[key];
            // null rather than 0: an omitted or malformed score used to render
            // as "0/5" — off the bottom of a scale that starts at 1 — or as
            // "NaN/5". Neither is a judgement anyone made.
            const value = normalizeScore(entry?.score);
            const voided = !!entry?.voided;
            return (
              <div key={key} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{label}</span>
                  {voided && (
                    <span
                      className="rounded border border-[var(--muted)]/40 px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--muted)] uppercase"
                      title="The interviewer gave this away unasked, so there was nothing left to judge. It does not count against you."
                    >
                      no signal
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className="h-1.5 w-7 rounded-full"
                          style={{
                            background:
                              value !== null && n <= value
                                ? voided
                                  ? "var(--muted)"
                                  : n <= 2
                                    ? "var(--warn)"
                                    : "var(--accent)"
                                : "var(--panel-2)",
                          }}
                        />
                      ))}
                    </div>
                    <span className="w-8 text-right text-sm tabular-nums text-[var(--muted)]">
                      {value === null ? "—" : `${value}/5`}
                    </span>
                  </div>
                </div>
                {value === null && !voided && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--warn)]">
                    The grader did not return a usable score for this. It is recorded as no
                    judgement rather than a low one, and it did not affect the verdict.
                  </p>
                )}
                {entry?.commentary && (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{entry.commentary}</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          3 means exactly at the bar for the level you targeted — not a criticism.
        </p>
      </Section>

      {review && (
        <Section title="Code review">
          <div className="rounded-xl border bg-[var(--panel)] p-4">
            {review.summary && <p className="text-sm leading-relaxed">{review.summary}</p>}
            <dl className="mt-4 space-y-3">
              {CODE_REVIEW_ROWS.map(({ key, label }) => {
                const text = review[key];
                if (typeof text !== "string" || !text) return null;
                return (
                  <div key={key} className="grid gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
                    <dt className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:pt-0.5">
                      {label}
                    </dt>
                    <dd className="text-sm leading-relaxed">{text}</dd>
                  </div>
                );
              })}
            </dl>
            {review.changeRequests?.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                  Changes requested before approval
                </div>
                <ul className="space-y-1.5">
                  {review.changeRequests.map((c, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {question && language && question.reference?.[language] && (
        <SolutionPane question={question} language={language} code={code} />
      )}

      {timeline.length > 0 && (
        <Section title="How it went, minute by minute">
          <ol className="relative rounded-xl border bg-[var(--panel)] p-4 pl-5">
            <span className="absolute bottom-6 left-[1.45rem] top-6 w-px bg-[var(--line)]" aria-hidden />
            {timeline.map((e, i) => (
              <TimelineRow key={i} entry={e} />
            ))}
          </ol>
        </Section>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Block title="What went well" items={assessment.strengths} dot="var(--ok)" />
        <Block title="Where it fell short" items={assessment.gaps} dot="var(--bad)" />
      </div>

      <div className="mt-6">
        <Block title="Practice before the real thing" items={assessment.coaching} dot="var(--accent)" />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {assessment.levelReadout && <Note title="Level read" body={assessment.levelReadout} />}
        {assessment.helpAdjustment && (
          <Note title="How much was you" body={assessment.helpAdjustment} />
        )}
      </div>

      {(easingConcessions(concessions).length > 0 || assessment.concessionReadout) && (
        <Section title="Where you eased up">
          <div className="rounded-xl border border-[var(--warn)]/30 bg-[var(--panel)] p-4">
            {easingConcessions(concessions).length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {easingConcessions(concessions).map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" />
                    <span>{describeConcession(c)}</span>
                  </li>
                ))}
              </ul>
            )}
            {assessment.concessionReadout && (
              <p className="text-sm leading-relaxed">{assessment.concessionReadout}</p>
            )}
          </div>
        </Section>
      )}

      {onSave && (
        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border bg-[var(--panel)] p-3">
          <button
            onClick={onSave}
            disabled={saving}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
          >
            {saving ? "Saving…" : savedPath ? "Save again" : "Save solution"}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" title={saveMessage}>
            {saveMessage || "Your code, with the question written above it as a comment."}
          </span>
        </div>
      )}

      {onRestart && (
        <button
          onClick={onRestart}
          className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-medium text-[var(--on-accent)] hover:brightness-110"
        >
          Run another interview
        </button>
      )}
    </div>
  );
}

/**
 * What they wrote, and one correct answer, in the same place.
 *
 * Their own code is open by default: it is theirs, most of the debrief above
 * refers to it, and scrolling up to a paragraph about "your inner loop" with
 * nothing to look at is useless.
 *
 * The reference stays behind a deliberate click, which is the one thing worth
 * protecting here. Plenty of people read the debrief and then want to attempt
 * the problem again properly; an answer sitting open on the page takes that
 * choice away. Once revealed it stays revealed, including the side-by-side —
 * the decision was made, and re-asking would just be ceremony.
 */
function SolutionPane({
  question,
  language,
  code,
}: {
  question: Question;
  language: Language;
  /** What the candidate actually submitted. Absent on very old saved reviews. */
  code?: string;
}) {
  const reference = question.reference[language];
  const [revealed, setRevealed] = useState(false);
  const [tab, setTab] = useState<"yours" | "reference" | "both">("yours");

  // Switching tabs does NOT reveal anything. Only the gate's own button does —
  // otherwise a stray click on "Reference" spends a choice the person meant to
  // make deliberately, and there is no un-seeing it.
  const show = setTab;

  const mine = (code ?? "").trim();
  const showReference = tab !== "yours" && revealed;
  const showMine = tab !== "reference";

  return (
    <Section title="The code">
      {/* Two columns of code do not fit a prose-width column, so side-by-side
          breaks out of it on a wide screen and stays stacked on a narrow one. */}
      <div
        className={`overflow-hidden rounded-xl border bg-[var(--panel)] ${
          tab === "both"
            ? "lg:relative lg:left-1/2 lg:w-[min(78rem,92vw)] lg:-translate-x-1/2"
            : ""
        }`}
      >
        <div className="flex items-center gap-1 border-b px-2">
          <CodeTab active={tab === "yours"} onClick={() => show("yours")}>
            Yours
          </CodeTab>
          <CodeTab active={tab === "reference"} onClick={() => show("reference")}>
            Reference{!revealed && <span className="ml-1.5 text-[var(--muted)]">hidden</span>}
          </CodeTab>
          <CodeTab active={tab === "both"} onClick={() => show("both")}>
            <span className="hidden sm:inline">Side by side</span>
            <span className="sm:hidden">Both</span>
          </CodeTab>
          <span className="ml-auto pr-2 text-[11px] tracking-wider text-[var(--muted)] uppercase">
            {language}
          </span>
        </div>

        {tab !== "yours" && !revealed ? (
          <RevealGate onReveal={() => setRevealed(true)} />
        ) : (
          <div className={tab === "both" ? "grid gap-px bg-[var(--line)] lg:grid-cols-2" : ""}>
            {showMine && (
              <CodeColumn
                heading="What you submitted"
                sub={
                  mine
                    ? `${mine.split("\n").length} lines`
                    : "You did not leave any code in the editor."
                }
                code={mine || "(empty)"}
              />
            )}
            {showReference && (
              <CodeColumn
                heading="One correct approach"
                sub={`Not the only one, and not necessarily better than yours · optimal ${question.optimal.time} time, ${question.optimal.space} space`}
                code={reference}
              />
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function RevealGate({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="p-5 text-center">
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-[var(--muted)]">
        The reference answer is hidden so you can attempt this again first, if you would rather.
        Reading it now is a choice, not an accident.
      </p>
      <button
        onClick={onReveal}
        className="mt-3.5 rounded-lg border px-3.5 py-1.5 text-xs hover:bg-[var(--panel-2)]"
      >
        Show me the reference
      </button>
    </div>
  );
}

function CodeColumn({
  heading,
  sub,
  code,
}: {
  heading: string;
  sub: string;
  code: string;
}) {
  return (
    <div className="min-w-0 bg-[var(--panel)]">
      <div className="border-b px-4 py-2">
        <div className="text-xs font-medium">{heading}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">{sub}</div>
      </div>
      <pre className="max-h-[28rem] overflow-auto p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-3 py-2 text-xs ${
        active
          ? "border-[var(--accent)] text-[var(--text)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function VerdictScale({ verdict }: { verdict: Verdict }) {
  const index = VERDICTS.indexOf(verdict);
  return (
    <div className="mt-4">
      <div className="flex gap-1">
        {VERDICTS.map((v, i) => (
          <span
            key={v}
            title={VERDICT_LABELS[v]}
            className="h-1.5 flex-1 rounded-full transition"
            style={{ background: i === index ? VERDICT_COLOR[v] : "var(--panel-2)" }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <span>Strong hire</span>
        <span>Strong no hire</span>
      </div>
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const color =
    entry.weight === "positive"
      ? "var(--ok)"
      : entry.weight === "negative"
        ? "var(--bad)"
        : "var(--muted)";
  return (
    <li className="relative flex gap-3 py-2.5">
      <span
        className="relative z-10 mt-[0.4rem] h-2 w-2 shrink-0 rounded-full ring-4 ring-[var(--panel)]"
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs tabular-nums text-[var(--muted)]">
            t+{String(Math.max(0, Math.round(entry.atMin ?? 0))).padStart(2, "0")}m
          </span>
          <span className="text-sm">{entry.what}</span>
        </div>
        {entry.signal && (
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--muted)]">{entry.signal}</p>
        )}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-[var(--panel)] p-4">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function Block({ title, items, dot }: { title: string; items?: string[]; dot: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-xl border bg-[var(--panel)] p-4">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
