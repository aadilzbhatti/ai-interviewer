/**
 * Client half of the debug log. Silent and free when the server says logging
 * is off, which is the normal case.
 */
let enabled: boolean | null = null;

export async function initClientDebug(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    const res = await fetch("/api/debug/log");
    const data = (await res.json()) as { enabled?: boolean };
    enabled = !!data.enabled;
  } catch {
    enabled = false;
  }
  return enabled;
}

export function clientDebugLog(phase: string, data: unknown): void {
  if (enabled !== true) return;
  void fetch("/api/debug/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: "client", phase, data }),
  }).catch(() => {});
}

/**
 * Deliberately not gated on the debug flag, and deliberately using keepalive:
 * this is called from a page that may be seconds from death, and a crash you
 * only capture when someone remembered to set an environment variable is a
 * crash you do not capture.
 */
export function reportCrash(phase: string, data: unknown): void {
  try {
    void fetch("/api/debug/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route: "client", phase, data, crash: true }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let reporting a crash cause one */
  }
}
