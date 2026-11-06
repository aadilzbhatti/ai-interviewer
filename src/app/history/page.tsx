"use client";

import dynamic from "next/dynamic";

const HistoryBrowser = dynamic(() => import("@/components/HistoryBrowser"), {
  ssr: false,
  loading: () => <div className="min-h-screen" />,
});

export default function Page() {
  return <HistoryBrowser />;
}
