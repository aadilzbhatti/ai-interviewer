"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Question, VetVerdict } from "@/lib/types";

export default function QuestionCard({
  question,
  verdict,
}: {
  question: Question;
  verdict?: VetVerdict;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b bg-[var(--panel)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-sm font-medium">{question.title}</span>
        {question.source !== "bank" && (
          <span className="rounded border border-[var(--accent)]/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent)]">
            {question.source === "described" ? "your request · vetted" : "generated · vetted"}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--muted)]">{open ? "collapse" : "expand"}</span>
      </button>

      {open && (
        <div className="max-h-[38vh] overflow-auto px-4 pb-4">
          <div className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{question.prompt}</ReactMarkdown>
          </div>
          {verdict && (
            <details className="mt-3 text-xs text-[var(--muted)]">
              <summary className="cursor-pointer">Vetting report</summary>
              <div className="mt-1.5 space-y-1">
                <div>
                  Assessed difficulty: {verdict.assessedDifficulty} · clarity {verdict.scores.clarity}/5 ·
                  level fit {verdict.scores.levelFit}/5 · test coverage {verdict.scores.testCoverage}/5
                </div>
                {verdict.notes && <div>{verdict.notes}</div>}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
