"use client";

import ProgressPanel from "@/components/ProgressPanel";
import { percent, stageStatuses, type ProgressState } from "@/lib/generationProgress";

export default function GenerationProgress({
  state,
  headline,
  elapsedMs,
  notice,
}: {
  state: ProgressState;
  headline: string;
  elapsedMs: number;
  notice?: string | null;
}) {
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <ProgressPanel
      headline={headline}
      pct={percent(state)}
      note={
        seconds < 5
          ? "This usually takes a minute or two."
          : `${seconds}s elapsed${state.attempt > 1 ? ` · attempt ${state.attempt}` : ""}`
      }
      steps={stageStatuses(state)}
      issue={state.done ? undefined : state.lastIssue}
      notice={notice ?? undefined}
    />
  );
}
