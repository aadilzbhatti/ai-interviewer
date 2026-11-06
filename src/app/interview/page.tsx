"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import CrashBoundary from "@/components/CrashBoundary";
import { installCrashWatch } from "@/lib/crashWatch";

const InterviewRoom = dynamic(() => import("@/components/InterviewRoom"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] items-center justify-center text-sm text-[var(--muted)]">
      Setting up…
    </div>
  ),
});

export default function Page() {
  // Installed before the room mounts so an error thrown during that mount is
  // still recorded. Reports on the PREVIOUS page life, which is the only way to
  // learn anything about a tab that died without warning.
  useEffect(() => {
    installCrashWatch({ phase: "booting" });
  }, []);

  return (
    <CrashBoundary>
      <InterviewRoom />
    </CrashBoundary>
  );
}
