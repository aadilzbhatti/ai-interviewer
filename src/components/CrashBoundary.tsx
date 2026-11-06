"use client";

import React from "react";
import { noteRenderCrash } from "@/lib/crashWatch";

/**
 * A render-time exception in React unmounts the whole tree, which is why a
 * crash here showed up as a blank page with nothing in any log. This catches
 * it, records it, and says the one thing that matters: the work is saved.
 */
export default class CrashBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    noteRenderCrash(error, info.componentStack ?? undefined);
    console.error("[crash-watch] render crash", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--bad)]/40 px-3 py-1 text-xs text-[var(--bad)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--bad)]" />
            Something broke on screen
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Your interview is saved</h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            The page hit an error while drawing itself. Your question, code, transcript and clock
            were written to this browser before it happened, so reloading picks up where you left
            off. The error has been written to the debug log.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border bg-[var(--panel)] p-3 text-left text-xs leading-relaxed text-[var(--muted)]">
            {error.name}: {error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#04121f] hover:brightness-110"
          >
            Reload and carry on
          </button>
        </div>
      </div>
    );
  }
}
