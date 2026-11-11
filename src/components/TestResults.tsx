"use client";

import { useState } from "react";
import type { RunResult } from "@/lib/types";

export default function TestResults({
  run,
  running,
}: {
  run?: RunResult;
  running: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (running) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--muted)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
        Running tests…
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
        Run the tests whenever you want. Hidden cases run too — you see whether they pass, not what
        they contain.
      </div>
    );
  }

  if (run.error) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-sm">
          <div className="mb-1 font-medium text-[var(--bad)]">Could not run</div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--text)]">
            {run.error}
          </pre>
        </div>
        {run.stdout && <Stdout text={run.stdout} />}
      </div>
    );
  }

  const allPass = run.passed === run.total;

  return (
    <div className="h-full overflow-auto">
      <div
        className={`sticky top-0 flex items-center justify-between border-b px-4 py-2.5 text-sm backdrop-blur ${
          allPass ? "bg-[var(--ok)]/10" : "bg-[var(--panel)]"
        }`}
      >
        <span className={allPass ? "text-[var(--ok)]" : "text-[var(--text)]"}>
          {run.passed}/{run.total} passing
        </span>
        <span className="text-xs text-[var(--muted)]">{run.durationMs} ms</span>
      </div>

      <ul className="divide-y">
        {run.results.map((r, i) => {
          const key = `${i}-${r.name}`;
          const expandable = !r.passed;
          return (
            <li key={key}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpen(open === key ? null : key)}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-[var(--panel-2)] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.passed ? "bg-[var(--ok)]" : "bg-[var(--bad)]"
                  }`}
                />
                <span className={r.passed ? "text-[var(--muted)]" : ""}>{r.name}</span>
                {r.hidden && (
                  <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    hidden
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {expandable ? (open === key ? "hide" : "why") : ""}
                </span>
              </button>
              {open === key && (
                <div className="space-y-2 border-t bg-[var(--code-bg)] px-4 py-3 font-mono text-xs">
                  {!r.hidden && r.args && <Row label="input" value={r.args} />}
                  {r.error ? (
                    <Row label="error" value={r.error} tone="bad" />
                  ) : (
                    <>
                      <Row label="expected" value={r.hidden ? "(hidden)" : r.expected ?? ""} />
                      <Row label="got" value={r.actual ?? ""} tone="bad" />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {run.stdout && <Stdout text={run.stdout} />}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-[var(--muted)]">{label}</span>
      <span className={`break-all ${tone === "bad" ? "text-[var(--bad)]" : ""}`}>{value}</span>
    </div>
  );
}

function Stdout({ text }: { text: string }) {
  return (
    <div className="border-t p-4">
      <div className="mb-1 text-xs uppercase tracking-wider text-[var(--muted)]">Output</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--muted)]">
        {text}
      </pre>
    </div>
  );
}
