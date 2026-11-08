"use client";

import { useEffect } from "react";
import { startSync } from "@/lib/sync";

/** Starts server sync once per page load. Renders nothing. */
export default function SyncAgent() {
  useEffect(() => startSync(), []);
  return null;
}
