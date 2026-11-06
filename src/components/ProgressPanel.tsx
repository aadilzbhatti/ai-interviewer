"use client";

/**
 * The shared look of a long wait: a bar, a percentage, and a checklist of what
 * is actually happening. Purely presentational — each caller reduces its own
 * progress model into these props.
 */
export interface ProgressStep {
  key: string;
  label: string;
  blurb: string;
  status: "done" | "active" | "pending";
}

export default function ProgressPanel({
  headline,
  pct,
  note,
  steps,
  issue,
  issueLabel = "Sent back for a revision",
  notice,
  noticeLabel = "Fixed automatically",
}: {
  headline: string;
  pct: number;
  /** The small line under the headline — elapsed time, attempt count, and so on. */
  note: string;
  steps: ProgressStep[];
  issue?: string;
  issueLabel?: string;
  /** Something that went wrong and was repaired without a rebuild. */
  notice?: string;
  noticeLabel?: string;
}) {
  return (
    <div className="w-full max-w-md text-left">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-medium">{headline}</h1>
        <span className="text-sm tabular-nums text-[var(--muted)]">{pct}%</span>
      </div>
      <p className="mb-4 text-xs text-[var(--muted)]">{note}</p>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={headline}
      >
        <div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${pct}%`, transition: "width 700ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </div>

      <ol className="mt-6 space-y-3.5">
        {steps.map((step) => (
          <li key={step.key} className="flex gap-3">
            <Marker status={step.status} />
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm ${
                  step.status === "pending"
                    ? "text-[var(--muted)]/60"
                    : step.status === "active"
                      ? "text-[var(--text)]"
                      : "text-[var(--muted)]"
                }`}
              >
                {step.label}
              </div>
              {step.status === "active" && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{step.blurb}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {issue && (
        <div className="mt-5 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/5 p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--warn)]">
            {issueLabel}
          </div>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{issue}</p>
        </div>
      )}

      {notice && (
        <div className="mt-3 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok)]/5 p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--ok)]">
            {noticeLabel}
          </div>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{notice}</p>
        </div>
      )}
    </div>
  );
}

function Marker({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--ok)]/15">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
          <path
            d="M2.5 6.5l2.5 2.5 4.5-5"
            fill="none"
            stroke="var(--ok)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute h-4 w-4 animate-ping rounded-full bg-[var(--accent)]/30" />
        <span className="relative h-2 w-2 rounded-full bg-[var(--accent)]" />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full border border-[var(--line)]" />
    </span>
  );
}
