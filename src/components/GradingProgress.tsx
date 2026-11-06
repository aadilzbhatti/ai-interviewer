"use client";

import ProgressPanel from "@/components/ProgressPanel";
import {
  gradingPercent,
  gradingStageStatuses,
  type GradingState,
} from "@/lib/gradingProgress";

export default function GradingProgress({
  state,
  elapsedMs,
}: {
  state: GradingState;
  elapsedMs: number;
}) {
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <ProgressPanel
      headline="Writing your review"
      pct={gradingPercent(state)}
      note={
        seconds < 5
          ? "This usually takes about a minute — it is writing a full committee debrief."
          : `${seconds}s elapsed`
      }
      steps={gradingStageStatuses(state)}
      issue={state.failed ? state.error : undefined}
      issueLabel="Grading failed"
    />
  );
}
