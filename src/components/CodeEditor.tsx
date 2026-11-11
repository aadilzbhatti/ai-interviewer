"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import type { Language } from "@/lib/types";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
      Loading editor…
    </div>
  ),
});

/**
 * The editor, deliberately NOT handed a controlled `value`.
 *
 * @monaco-editor/react reacts to a changing `value` prop like this:
 *
 *     value !== editor.getValue() && editor.executeEdits("", [{
 *       range: model.getFullModelRange(), text: value, forceMoveMarkers: true,
 *     }])
 *
 * which replaces the entire document and drags the caret to the end of what it
 * just inserted — the last line. That is fine for a genuine external change and
 * awful if the prop is merely a render behind the keystrokes, which is the
 * reported "my cursor jumps to the bottom while I'm typing".
 *
 * Passing `defaultValue` instead of `value` makes that effect a no-op (it
 * early-returns when `value` is undefined), so the library can never rewrite
 * the document underneath the person typing. External changes — a new question,
 * a restored session — are applied here instead, and restore the caret and
 * scroll position afterwards.
 */
export default function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
}: {
  language: Language;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const edRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const dark = usePrefersDark();
  /** The last text the editor itself produced, so its own echo is ignored. */
  const emitted = useRef(value);
  /** Captured once: what the model is created with. Later changes go through the effect. */
  const [initial] = useState(value);

  const handleChange = useCallback(
    (v: string | undefined) => {
      const next = v ?? "";
      emitted.current = next;
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    // Our own change coming back around the loop: nothing to do, and touching
    // the document here is exactly what moved the caret.
    if (value === emitted.current) return;
    if (value === ed.getValue()) return;

    const position = ed.getPosition();
    const scroll = ed.getScrollTop();
    emitted.current = value;
    ed.setValue(value);
    if (position) ed.setPosition(position);
    ed.setScrollTop(scroll);
  }, [value]);

  return (
    <Monaco
      language={language === "python" ? "python" : "javascript"}
      theme={dark ? "vs-dark" : "light"}
      defaultValue={initial}
      onChange={handleChange}
      onMount={(ed) => {
        edRef.current = ed;
        // A late-arriving question can land before the editor mounts.
        if (value !== ed.getValue()) {
          emitted.current = value;
          ed.setValue(value);
        }
      }}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: language === "python" ? 4 : 2,
        renderLineHighlight: "line",
        padding: { top: 12, bottom: 12 },
        smoothScrolling: true,
      }}
    />
  );
}

/** Follows the system light/dark setting live, like the rest of the page. */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window === "undefined" || window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}
