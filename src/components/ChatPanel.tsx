"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";

/** Roughly eight lines. Past this the box stops growing and scrolls instead. */
const DRAFT_MAX_PX = 180;

export default function ChatPanel({
  messages,
  streaming,
  disabled,
  placeholder = "Talk through your thinking…",
  onSend,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  disabled: boolean;
  /** Says why the box is unavailable, when it is. */
  placeholder?: string;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  // A fixed one-row box silently swallowed anything longer than a line: the
  // text scrolled out of reach with no way to get back to it mid-thought.
  // Grow with the content up to a ceiling, then let it scroll.
  useEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, DRAFT_MAX_PX)}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {messages.map((m) =>
          m.event ? (
            <div key={m.id} className="flex justify-center">
              <span className="rounded-full border bg-[var(--panel-2)] px-3 py-1 text-[11px] text-[var(--muted)]">
                {m.content}
              </span>
            </div>
          ) : m.role === "assistant" ? (
            <div key={m.id} className="flex gap-2.5">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-[var(--panel-2)] text-[10px] font-medium text-[var(--accent)]">
                IV
              </div>
              <div className="prose-chat min-w-0 flex-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--panel-2)] px-3.5 py-2 text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ),
        )}
        {streaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2.5 text-sm text-[var(--muted)]">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-[var(--panel-2)] text-[10px] text-[var(--accent)]">
              IV
            </div>
            <span className="animate-pulse">thinking…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-xl border bg-[var(--panel)] p-2 focus-within:border-[var(--accent)]">
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            style={{ maxHeight: DRAFT_MAX_PX }}
            className="min-h-[1.5rem] flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-relaxed outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={disabled || !draft.trim()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[#04121f] disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
