"use client";

import dynamic from "next/dynamic";

const SetupForm = dynamic(() => import("@/components/SetupForm"), {
  ssr: false,
  loading: () => <div className="min-h-screen" />,
});

export default function Page() {
  return <SetupForm />;
}
