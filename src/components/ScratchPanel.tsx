"use client";

import { useEffect, useRef } from "react";
import type { Language, ScratchResult } from "@/lib/types";

const PHASE_LABEL: Record<NonNullable<ScratchResult["phase"]>, string> = {
  compile: "Did not compile",
  run: "Threw while running",
  call: "The call failed",
};

/**
 * The private half of the editor: run your own code, your own way, as often as
 * you like. Nothing here reaches the interviewer, so a typo costs a second
 * rather than a line in the write-up.
 */
export default function ScratchPanel({
  language,
  functionName,
  result,
  running,
  call,
  onCallChange,
  onRun,
  disabled,
  runs,
}: {
  language: Language;
  /** Seeds the placeholder with a call they might actually want to make. */
  functionName: string;
  result?: ScratchResult;
  running: boolean;
  call: string;
  onCallChange: (v: string) => void;
  onRun: () => void;
  disabled: boolean;
  runs: number;
}) {
  const outRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    outRef.current?.scrollTo({ top: 0 });
  }, [result]);

  const example = `${functionName}(...)`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <input
          value={call}
          onChange={(e) => onCallChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled) {
              e.preventDefault();
              onRun();
            }
          }}
          spellCheck={false}
          placeholder={`${example}   — optional; leave empty to just run the file`}
          className="min-w-0 flex-1 rounded-lg border bg-[var(--panel-2)] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[var(--accent)] disabled:opacity-50"
          disabled={disabled}
        />
        <button
          onClick={onRun}
          disabled={disabled}
          className="shrink-0 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1.5 text-xs text-[var(--accent)] disabled:opacity-40"
        >
          {running ? "Running…" : "Try it"}
        </button>
      </div>

      <div ref={outRef} className="min-h-0 flex-1 overflow-auto p-3">
        {running ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
            Running your code…
          </div>
        ) : !result ? (
          <Intro language={language} runs={runs} />
        ) : (
          <div className="space-y-3">
            {result.error && (
              <div className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-[var(--bad)]">
                  {result.phase ? PHASE_LABEL[result.phase] : "Error"}
                  {result.where && (
                    <span className="font-normal text-[var(--muted)]">
                      line {result.where.line}
                      {result.where.column ? `, col ${result.where.column}` : ""}
                    </span>
                  )}
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--text)]">
                  {result.error}
                </pre>
              </div>
            )}

            {result.hasValue && (
              <div>
                <Label>
                  {result.call ? <code className="font-mono">{result.call}</code> : "returned"} →
                </Label>
                <pre className="mt-1 overflow-x-auto rounded-lg border bg-[var(--panel-2)] p-2.5 font-mono text-xs">
                  {result.value === undefined ? "undefined" : result.value}
                </pre>
              </div>
            )}

            {result.stdout ? (
              <div>
                <Label>Output</Label>
                <pre className="mt-1 overflow-x-auto rounded-lg border bg-[var(--panel-2)] p-2.5 font-mono text-xs whitespace-pre-wrap">
                  {result.stdout}
                </pre>
              </div>
            ) : (
              result.ok &&
              !result.hasValue && (
                <p className="text-xs text-[var(--muted)]">
                  Ran clean in {result.durationMs}ms and printed nothing. Add a{" "}
                  <code className="font-mono">
                    {language === "python" ? "print(...)" : "console.log(...)"}
                  </code>{" "}
                  or put a call in the box above to see a value.
                </p>
              )
            )}

            {result.ok && (result.stdout || result.hasValue) && (
              <p className="text-[11px] text-[var(--muted)]/70">{result.durationMs}ms · private</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] tracking-wide text-[var(--muted)] uppercase">{children}</div>
  );
}

function Intro({ language, runs }: { language: Language; runs: number }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-[var(--muted)]">
      <p className="text-sm text-[var(--text)]">Your scratchpad.</p>
      <p>
        Runs whatever is in the editor, exactly as written, and shows what it prints. Put a call in
        the box above to see what it returns. Syntax errors show up here too, so you can check that
        your code compiles without spending a test run.
      </p>
      <p>
        The interviewer is not told about any of this — run it as often as you like. Only{" "}
        <span className="text-[var(--text)]">Run tests</span> is part of the interview.
      </p>
      <p>
        One thing to know: this runs the whole file, so{" "}
        <code className="font-mono">
          {language === "python" ? "print(f(3))" : "console.log(f(3))"}
        </code>{" "}
        left at the bottom also runs when you press Run tests. Harmless, but a failing{" "}
        <code className="font-mono">assert</code> down there will stop the real run.
      </p>
      {runs > 0 && <p className="text-[var(--muted)]/70">{runs} run{runs === 1 ? "" : "s"} so far.</p>}
    </div>
  );
}
