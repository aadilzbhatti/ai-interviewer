import { anthropic, MODEL, tryExtractJson } from "@/lib/anthropic";
import { assessmentSystemPrompt } from "@/lib/prompts";
import { reconcileAssessment } from "@/lib/verdict";
import { JOB_LEVELS, HELP_LEVELS, helpPolicy, timingRecord, isStrictTime } from "@/lib/policy";
import { checkChargedHelp, correctionMessage, findUnpromptedCharges, labelMessages, speakerTag } from "@/lib/assistance";
import { stagesFromText } from "@/lib/gradingProgress";
import { logDebug } from "@/lib/debugLog";
import { guardStream, ndjsonSender } from "@/lib/streamSafe";
import type {
  Assessment,
  ChatMessage,
  Concession,
  InterviewConfig,
  Question,
  RunResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  /** The configuration the candidate finished at. */
  config: InterviewConfig;
  /** What they started at, before any concession. */
  originalConfig?: InterviewConfig;
  concessions?: Concession[];
  question: Question;
  messages: ChatMessage[];
  code: string;
  runs: RunResult[];
  hintsUsed: number;
  /** Private runs of the candidate's own code. A count, never the code itself. */
  scratchRuns?: number;
  elapsedMin: number;
  startedAt: number;
}

/**
 * Minute offset into the interview, for the timeline. Prefers the elapsed
 * interview time recorded on the event, so a pause does not open a fake gap;
 * falls back to wall clock for sessions recorded before pausing existed.
 */
function offset(elapsedMs: number | undefined, at: number, startedAt: number): string {
  const ms = typeof elapsedMs === "number" ? elapsedMs : at - startedAt;
  const min = Math.max(0, Math.round(ms / 60000));
  return `t+${String(min).padStart(2, "0")}m`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const startedAt = body.startedAt || (body.messages[0]?.at ?? Date.now());
  const policy = helpPolicy(body.config);
  const lastRun = body.runs[body.runs.length - 1];

  // Every turn says who it was answering, as recorded by the app, so the grader
  // does not have to guess whether help was asked for.
  const transcript = labelMessages(body.messages)
    .map(({ message: m, label }) => `[${offset(m.elapsedMs, m.at, startedAt)}] ${speakerTag(label)}: ${m.content}`)
    .join("\n\n");

  const runLog = body.runs
    .map((r, i) => {
      const failing = r.results.filter((x) => !x.passed);
      const detail = r.error
        ? `did not run — ${r.error}`
        : `${r.passed}/${r.total} passing${
            failing.length ? ` (failing: ${failing.map((x) => x.name).join(", ")})` : ""
          }`;
      return `[${offset(r.elapsedMs, r.at, startedAt)}] Run ${i + 1}: ${detail}`;
    })
    .join("\n");

  const userContent = `## Interview parameters
Target level: ${JOB_LEVELS[body.config.jobLevel].label}
Bar for that level: ${JOB_LEVELS[body.config.jobLevel].bar}
Question difficulty: ${body.config.difficulty}
Question source: ${
    body.config.source === "described"
      ? `the candidate asked for this problem themselves ("${body.config.seedDescription.trim()}")`
      : body.config.source
  }
Clock: ${body.config.clockMode === "strict" ? "strict — it ran continuously" : "pausable"}
Time limit: ${isStrictTime(body.config) ? "strict — the limit counts" : "relaxed — the limit was a pacing guide (see ## Time)"}
Interviewer helpfulness setting: ${HELP_LEVELS[body.config.helpLevel].label} (effective help score ${policy.score}/100, band "${policy.band}")
Times the candidate pressed the Hint button: ${body.hintsUsed}
Private runs of their own code (scratchpad): ${body.scratchRuns ?? 0}
Time used: ${Math.round(body.elapsedMin)} of ${body.config.durationMin} minutes
Language: ${body.config.language}

## Question
${body.question.title}

${body.question.prompt}

Known optimal complexity: time ${body.question.optimal.time}, space ${body.question.optimal.space}.

Reference solution, for your comparison only — the candidate never saw it:
\`\`\`${body.config.language}
${body.question.reference[body.config.language]}
\`\`\`

## The candidate's final code
\`\`\`${body.config.language}
${body.code || "(the candidate wrote nothing)"}
\`\`\`

## Test runs (${body.runs.length} total)
${runLog || "The candidate never ran the tests."}
Final state: ${lastRun ? `${lastRun.passed}/${lastRun.total} passing` : "no run"}

## Their own checks
${
    body.scratchRuns
      ? `The candidate ran their own code privately ${body.scratchRuns} time${body.scratchRuns === 1 ? "" : "s"} in the scratchpad — their own calls and print statements, not this question's tests. You are given the count only; the scratchpad is private and neither you nor the interviewer sees what they ran.

Read this ONE WAY ONLY: as evidence FOR them under testing rigor, that they checked their own work as they went rather than pushing straight to the tests. It is exactly what an engineer does with a terminal open. It is NOT evidence of floundering, of trial-and-error, or of anything else, and a high count says nothing against them — do not speculate about what they were running or why. A candidate with zero scratchpad runs is not penalised either; they simply tested another way, or not at all, and the rest of the record shows which.`
      : "The candidate did not use the private scratchpad. That is not a mark against them — judge their testing from the transcript and the runs above."
  }

## Transcript
Timestamps are minutes of ACTIVE interview time — any time the candidate spent paused is already excluded, so do not read a gap as hesitation unless the transcript supports it. Use them for the timeline.

${transcript || "(no conversation)"}`;

  const system = assessmentSystemPrompt(
    body.config,
    body.originalConfig ?? body.config,
    body.concessions ?? [],
    body.elapsedMin,
  );
  // Facts the app owns. Attached to the result whatever the grader writes.
  const facts = {
    timing: timingRecord(body.originalConfig ?? body.config, body.config, body.concessions ?? [], body.elapsedMin),
    check: (a: Assessment) => checkChargedHelp(a.chargedHelp, body.messages, startedAt),
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const out = guardStream(controller);
      const send = ndjsonSender(out);
      try {
        await runAssessment(system, userContent, send, (a) => {
          const { kept, struck } = facts.check(a);
          return { ...a, chargedHelp: kept, struckHelp: struck.length ? struck : undefined, timing: facts.timing };
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        out.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

type Emit = (event: Record<string, unknown>) => void;
type Turn = { role: "user" | "assistant"; content: string };

/**
 * One grading call, streamed. When `announce` is set, each stage announced
 * corresponds to a field the grader has genuinely finished writing — the
 * alternative, a bar driven by a timer through a 75-second silence, is the
 * thing that makes a working app look like a hung one.
 */
async function gradeOnce(
  system: string,
  messages: Turn[],
  send: Emit,
  announce: boolean,
  phase: string,
): Promise<{ text: string; assessment?: Assessment; error?: string }> {
  const startedAt = Date.now();
  let text = "";
  let announced = 0;
  let stopReason: string | null = null;
  let usage: unknown;
  try {
    const stream = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 6000,
      system,
      messages,
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        if (announce) {
          for (const stage of stagesFromText(text, announced)) {
            send({ type: "phase", stage });
            announced++;
          }
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? stopReason;
        usage = event.usage;
      }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logDebug({ route: "assess", phase: `${phase}:error`, error, responseText: text, durationMs: Date.now() - startedAt });
    return { text, error };
  }

  const extracted = tryExtractJson<Assessment>(text);
  const assessment = extracted.ok ? extracted.value : undefined;
  const error = extracted.ok
    ? undefined
    : extracted.truncated
      ? `The debrief was cut off before it finished (${extracted.error}). Try grading again.`
      : extracted.error;
  await logDebug({
    route: "assess",
    phase,
    model: MODEL,
    system,
    messages,
    responseText: text,
    parsed: assessment,
    error,
    usage,
    durationMs: Date.now() - startedAt,
    data: { stopReason, stagesAnnounced: announced },
  });
  return { text, assessment, error };
}

/**
 * Grades, checks the result against the unrequested-help rule, and sends a
 * draft that breaks it back once with the offending statements quoted. A
 * second draft that still breaks it is kept, and the statements are shown to
 * the candidate as a warning rather than silently passed through.
 */
async function runAssessment(
  system: string,
  userContent: string,
  send: Emit,
  addFacts: (a: Assessment) => Assessment,
): Promise<void> {
  send({ type: "phase", stage: "read" });
  const asked: Turn[] = [{ role: "user", content: userContent }];
  const first = await gradeOnce(system, asked, send, true, "assess");
  if (!first.assessment) {
    send({ type: "error", message: first.error || "The grader returned no usable JSON." });
    return;
  }

  let final = first.assessment;
  let helpRuleCheck: Assessment["helpRuleCheck"];
  const firstDraft = findUnpromptedCharges(first.assessment);
  if (firstDraft.length) {
    send({ type: "phase", stage: "recheck" });
    const second = await gradeOnce(
      system,
      [...asked, { role: "assistant", content: first.text }, { role: "user", content: correctionMessage(firstDraft) }],
      send,
      false,
      "assess:recheck",
    );
    // If the rewrite fails outright, the first draft stands and every statement stays flagged.
    if (second.assessment) final = second.assessment;
    helpRuleCheck = {
      firstDraft,
      remaining: second.assessment ? findUnpromptedCharges(second.assessment) : firstDraft,
    };
  }

  // The scores-to-verdict rules are stated in the prompt, but a prompt is a
  // request. This is where they are actually applied.
  const reconciled = addFacts(reconcileAssessment(final));
  send({ type: "result", assessment: helpRuleCheck ? { ...reconciled, helpRuleCheck } : reconciled });
}
