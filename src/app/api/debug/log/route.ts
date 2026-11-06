import { debugEnabled, debugRoot, logDebug } from "@/lib/debugLog";

export const runtime = "nodejs";

/** Lets the browser find out whether to bother sending anything. */
export async function GET() {
  return Response.json({ enabled: debugEnabled(), dir: debugEnabled() ? debugRoot() : null });
}

/**
 * Client-side debug events — chiefly the in-browser execution check that
 * verifies a generated question, which happens in the worker and would
 * otherwise never reach the log.
 */
export async function POST(req: Request) {
  let body: { phase?: string; data?: unknown; route?: string; crash?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ logged: false });
  }
  // A crash report is written whether or not debug logging was switched on:
  // nobody reproduces a crash on request, and the run where it happened is the
  // only chance to record it.
  if (!debugEnabled() && !body.crash) return Response.json({ logged: false });
  try {
    const file = await logDebug(
      {
        route: body.route || "client",
        phase: body.phase || "event",
        data: body.data,
        error: body.crash ? "client crash" : undefined,
      },
      { force: !!body.crash },
    );
    return Response.json({ logged: !!file });
  } catch {
    return Response.json({ logged: false });
  }
}
