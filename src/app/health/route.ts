import { logDebug } from "@/lib/debugLog";

export const runtime = "nodejs";

/**
 * Something on this machine polls GET /health and has done all day. It is not
 * part of this app, and until now it got a 404 — which is the last line in the
 * terminal before the dev server dies, every single time.
 *
 * A supervisor killing a process whose health check keeps failing would explain
 * that exactly: silent death, no stack trace, non-zero exit, once per server
 * life. So this endpoint does two jobs. It answers 200, which makes the theory
 * falsifiable — if the deaths stop, that was it. And it records who is asking,
 * because nothing else on the machine will tell us.
 *
 * Delete it once the caller is identified and the question is settled.
 */
let probes = 0;
let lastLoggedAt = 0;
const LOG_EVERY_MS = 30_000;

export async function GET(req: Request) {
  probes++;
  const ua = req.headers.get("user-agent") ?? "(no user-agent)";
  const from = req.headers.get("x-forwarded-for") ?? req.headers.get("host") ?? "(unknown)";

  // Straight to the terminal, so it is visible the moment it happens.
  console.log(`[health] probe #${probes} from ${from} — ${ua}`);

  const now = Date.now();
  if (probes <= 5 || now - lastLoggedAt > LOG_EVERY_MS) {
    lastLoggedAt = now;
    // Forced: if this probe is what precedes the process dying, the record has
    // to survive without anyone having remembered to set the debug flag.
    await logDebug(
      {
        route: "health",
        phase: "probe",
        data: {
          probe: probes,
          userAgent: ua,
          from,
          url: req.url,
          headers: Object.fromEntries(req.headers),
        },
      },
      { force: true },
    );
  }

  return Response.json({ ok: true, service: "ai-interviewer", probes });
}
