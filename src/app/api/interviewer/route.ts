import { anthropic, MODEL } from "@/lib/anthropic";
import { interviewerSystemPrompt, turnContext } from "@/lib/prompts";
import { logDebug } from "@/lib/debugLog";
import { guardStream } from "@/lib/streamSafe";
import type { ChatMessage, Concession, InterviewConfig, Question, RunResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Trigger = "start" | "message" | "run" | "hint" | "done" | "concession";

interface Body {
  config: InterviewConfig;
  question: Question;
  messages: ChatMessage[];
  code: string;
  lastRun?: RunResult;
  hintsUsed: number;
  elapsedMin: number;
  trigger: Trigger;
  concessions?: Concession[];
}

const TRIGGER_NOTE: Record<Trigger, string> = {
  start:
    "[The interview is starting. Greet the candidate briefly and present the problem in your own words with one concrete example.]",
  message: "",
  run: "[The candidate just ran the tests. React according to your helpfulness band.]",
  hint: "[The candidate has explicitly asked for a hint. Give the next one on the ladder that they have not already received — no further. If your band is Silent, decline warmly and redirect them to reason it out.]",
  done: "[The candidate says they are finished. Verify the tests actually pass, then run your closing questions.]",
  concession:
    "[The candidate has just asked to make the interview easier, and your rules have already changed to match. Acknowledge it in one short sentence, without judgement or reassurance, then pick the interview back up where it was.]",
};

function toApiMessages(body: Body) {
  const context = turnContext({
    code: body.code,
    language: body.config.language,
    lastRun: body.lastRun,
    hintsUsed: body.hintsUsed,
    elapsedMin: body.elapsedMin,
    config: body.config,
  });

  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of body.messages) {
    const prev = msgs[msgs.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n\n" + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }

  const note = TRIGGER_NOTE[body.trigger];
  const tail = [note, context].filter(Boolean).join("\n\n");

  const last = msgs[msgs.length - 1];
  if (last && last.role === "user") last.content += "\n\n" + tail;
  else msgs.push({ role: "user", content: tail });

  if (msgs.length === 0) msgs.push({ role: "user", content: tail });
  return msgs;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Malformed request body.", { status: 400 });
  }

  const encoder = new TextEncoder();
  const system = interviewerSystemPrompt(body.config, body.question, body.concessions ?? []);
  const messages = toApiMessages(body);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const out = guardStream(controller);
      const startedAt = Date.now();
      // The reply is streamed to the browser, so it is reassembled here purely
      // so the debug log holds the whole turn rather than nothing.
      let assembled = "";
      let failure: string | undefined;
      let abandoned = false;
      try {
        const events = await anthropic().messages.create({
          model: MODEL,
          max_tokens: 900,
          system,
          messages,
          stream: true,
        });
        for await (const ev of events) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            assembled += ev.delta.text;
            // Stop the moment the candidate's tab goes away; there is nobody
            // left to read the rest of the turn.
            if (!out.send(encoder.encode(ev.delta.text))) {
              abandoned = true;
              break;
            }
          }
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
        out.send(encoder.encode(`\n\n_(The interviewer could not respond: ${failure})_`));
      } finally {
        out.close();
        // Deliberately after close, and deliberately unguarded by it: the log
        // entry is the whole point, and losing it on a disconnect is what made
        // an interrupted turn invisible.
        await logDebug({
          route: "interviewer",
          phase: body.trigger,
          model: MODEL,
          system,
          messages,
          responseText: assembled,
          error: failure,
          durationMs: Date.now() - startedAt,
          data: {
            hintsUsed: body.hintsUsed,
            elapsedMin: Math.round(body.elapsedMin),
            concessions: body.concessions?.length ?? 0,
            abandoned: abandoned || undefined,
          },
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
