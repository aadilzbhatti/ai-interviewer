import { z } from "zod";
import { anthropic, MODEL, tryExtractJson } from "@/lib/anthropic";
import { generatorSystemPrompt, vettingSystemPrompt } from "@/lib/prompts";
import { JOB_LEVELS, HELP_LEVELS, DIFFICULTIES } from "@/lib/policy";
import { BANK } from "@/lib/questions/index";
import { logDebug } from "@/lib/debugLog";
import { guardStream, ndjsonSender } from "@/lib/streamSafe";
import type { InterviewConfig, Question, VetVerdict } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * A whole question — statement, starter and reference code in two languages,
 * 8-12 test cases — is a lot of JSON. Too small a budget truncates the reply
 * mid-object, which used to surface as an unterminated-JSON error.
 */
const GENERATION_MAX_TOKENS = Number(process.env.GENERATION_MAX_TOKENS || 16000);
const MAX_ATTEMPTS = 3;

const TestCase = z.object({
  name: z.string().optional(),
  args: z.array(z.unknown()),
  expected: z.unknown(),
  hidden: z.boolean().optional(),
});

/**
 * The harness only knows four comparison modes, but a model faced with a
 * multi-answer problem reaches for one that does not exist ("topological",
 * "custom"). That is a mislabel, not a broken question, so it is coerced rather
 * than fatal — the real defence against a genuinely multi-answer question is
 * the generator rule requiring a unique answer, and the vetter rejecting one
 * that has not.
 */
const COMPARISON_SYNONYMS: Record<string, "exact" | "sorted" | "set" | "approx" | "validator"> = {
  exact: "exact",
  strict: "exact",
  deep: "exact",
  deep_equal: "exact",
  equals: "exact",
  ordered: "exact",
  sorted: "sorted",
  unordered: "sorted",
  any_order: "sorted",
  order_insensitive: "sorted",
  set: "set",
  unique: "set",
  approx: "approx",
  approximate: "approx",
  float: "approx",
  tolerance: "approx",
  numeric: "approx",
  validator: "validator",
  checker: "validator",
  custom: "validator",
  any_valid: "validator",
  topological: "validator",
};

const normalizeKey = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, "_");

const ComparisonField = z.preprocess(
  (v) => (typeof v === "string" ? (COMPARISON_SYNONYMS[normalizeKey(v)] ?? "exact") : undefined),
  z.enum(["exact", "sorted", "set", "approx", "validator"]).optional(),
);

/**
 * Metadata the model may get wrong without the question being wrong. These fall
 * back to what the session asked for; anything affecting correctness — the
 * tests, the reference solutions, the function name — stays strict.
 */
const DifficultyField = z.enum(["easy", "medium", "hard"]).catch("medium");
const JobLevelsField = z
  .array(z.enum(["intern", "entry", "mid", "senior", "staff"]).catch("mid"))
  .min(1)
  .catch(["mid"]);
const RolesField = z
  .array(z.enum(["general", "backend", "frontend", "data", "infra", "ml"]).catch("general"))
  .min(1)
  .catch(["general"]);

const GeneratedQuestionShape = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(40),
  difficulty: DifficultyField,
  jobLevels: JobLevelsField,
  roles: RolesField,
  topics: z.array(z.string()).default([]),
  functionName: z.string().min(1),
  starter: z.object({ python: z.string().min(1), javascript: z.string().min(1) }),
  reference: z.object({ python: z.string().min(1), javascript: z.string().min(1) }),
  tests: z.array(TestCase).min(5),
  comparison: ComparisonField,
  validator: z.object({ python: z.string(), javascript: z.string() }).optional(),
  hints: z.array(z.string()).min(3),
  followUps: z.array(z.string()).default([]),
  optimal: z.object({ time: z.string(), space: z.string() }),
});

/**
 * Keeps the comparison mode and the validator consistent: a validator implies
 * validator comparison, and claiming validator comparison without supplying one
 * falls back to exact rather than reaching the harness broken.
 */
const GeneratedQuestion = GeneratedQuestionShape.transform((q) => {
  const hasValidator = !!(q.validator?.python?.trim() && q.validator?.javascript?.trim());
  return {
    ...q,
    validator: hasValidator ? q.validator : undefined,
    comparison: hasValidator ? ("validator" as const) : q.comparison === "validator" ? ("exact" as const) : q.comparison,
  };
});

const Verdict = z.object({
  approved: z.boolean(),
  scores: z.object({
    difficultyFit: z.number(),
    levelFit: z.number(),
    clarity: z.number(),
    testCoverage: z.number(),
    selfContained: z.number(),
    matchesRequest: z.number().optional(),
  }),
  assessedDifficulty: z.enum(["easy", "medium", "hard"]),
  issues: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

interface Body {
  config: InterviewConfig;
  exclude?: string[];
  /** Set when the client executed the reference solution and it failed. */
  repair?: { question: Question; failures: string[] };
}

async function callModel(system: string, user: string, maxTokens: number, phase: string) {
  const startedAt = Date.now();
  try {
    const reply = await anthropic().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = reply.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    await logDebug({
      route: "questions/generate",
      phase,
      model: MODEL,
      system,
      messages: [{ role: "user", content: user }],
      responseText: text,
      usage: reply.usage,
      durationMs: Date.now() - startedAt,
      data: { stopReason: reply.stop_reason, maxTokens },
    });
    return { text, stopReason: reply.stop_reason };
  } catch (e) {
    await logDebug({
      route: "questions/generate",
      phase,
      model: MODEL,
      system,
      messages: [{ role: "user", content: user }],
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    });
    throw e;
  }
}

const TRUNCATION_NOTES = [
  "Your previous reply was CUT OFF before the JSON closed, so none of it could be used.",
  "Return the complete object, and make it smaller so it fits: keep the problem statement under 200 words, use exactly 8 test cases, and keep each reference solution under 30 lines.",
  "Emit nothing before or after the JSON object.",
].join("\n");

function generationRequest(config: InterviewConfig, exclude: string[], notes?: string) {
  const described = config.source === "described";
  // When the candidate picked the problem, overlap with the bank is fine — and
  // telling the generator to avoid it would push it away from what they asked for.
  const avoidBlock = described
    ? ""
    : `Do not write anything close to these existing questions:\n${[...BANK.map((q) => q.title), ...exclude]
        .map((t) => `- ${t}`)
        .join("\n")}\n\n`;

  const ask = described
    ? `Write the question the candidate described (their words are in your instructions above), targeting: difficulty=${config.difficulty}, jobLevel=${config.jobLevel}, role=${config.role}, helpfulness=${config.helpLevel}.`
    : `Write one question for: difficulty=${config.difficulty}, jobLevel=${config.jobLevel}, role=${config.role}, helpfulness=${config.helpLevel}.`;

  return `${ask}

${avoidBlock}${notes ? `You have already had one attempt. Fix exactly these problems and return the complete corrected question:\n${notes}` : ""}`;
}

function vettingRequest(config: InterviewConfig, candidate: unknown) {
  const seed = config.source === "described" ? config.seedDescription.trim() : "";
  const seedBlock = seed
    ? `The candidate asked to practice this, in their own words:
"""
${seed}
"""

`
    : "";
  return `${seedBlock}Target for this question:
- difficulty: ${config.difficulty} (${DIFFICULTIES[config.difficulty].blurb})
- job level: ${JOB_LEVELS[config.jobLevel].label} — ${JOB_LEVELS[config.jobLevel].bar}
- role focus: ${config.role}
- interviewer helpfulness: ${HELP_LEVELS[config.helpLevel].label} — ${HELP_LEVELS[config.helpLevel].blurb}

Candidate question:
${JSON.stringify(candidate, null, 2)}`;
}

/** One NDJSON line per thing that happens, so the client can show real progress. */
type Emit = (event: Record<string, unknown>) => void;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const out = guardStream(controller);
      const send = ndjsonSender(out);
      try {
        await runGeneration(body, send);
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

async function runGeneration(body: Body, send: Emit): Promise<void> {
  const { config, exclude = [] } = body;
  const attempts: { issues: string[]; approved: boolean }[] = [];

  {
    let notes: string | undefined;
    let lastFailure = "";
    if (body.repair) {
      notes = [
        "Your previous question's own reference solutions did not pass your own test cases when executed.",
        "Failures:",
        ...body.repair.failures.map((f) => `- ${f}`),
        "Either the expected values or the reference solutions are wrong. Return a corrected complete question.",
        "Previous question:",
        JSON.stringify(body.repair.question),
      ].join("\n");
    }

    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      const phase = `generate:round${round + 1}`;
      send({ type: "phase", stage: "write", attempt: round + 1 });
      const { text: raw, stopReason } = await callModel(
        generatorSystemPrompt(config),
        generationRequest(config, exclude, notes),
        GENERATION_MAX_TOKENS,
        phase,
      );

      const extracted = tryExtractJson<unknown>(raw);
      if (!extracted.ok) {
        const cutOff = extracted.truncated || stopReason === "max_tokens";
        lastFailure = cutOff
          ? "The generator's reply was cut off before the JSON finished."
          : `The generator did not return usable JSON: ${extracted.error}`;
        await logDebug({
          route: "questions/generate",
          phase: `${phase}:parsed`,
          error: extracted.error,
          data: { truncated: cutOff, stopReason, chars: raw.length },
        });
        attempts.push({ issues: [lastFailure], approved: false });
        // Recoverable: ask again rather than ending the request.
        notes = cutOff
          ? TRUNCATION_NOTES
          : `Your previous reply could not be parsed as JSON (${extracted.error}). Return ONLY one complete JSON object, with no prose around it.`;
        continue;
      }

      const parsed = GeneratedQuestion.safeParse(extracted.value);
      await logDebug({
        route: "questions/generate",
        phase: `${phase}:parsed`,
        parsed: parsed.success ? parsed.data : undefined,
        error: parsed.success
          ? undefined
          : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        data: { stopReason, chars: raw.length },
      });
      if (!parsed.success) {
        notes = `Your previous output did not match the required schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`;
        lastFailure = "The generated question did not match the required shape.";
        attempts.push({ issues: [notes], approved: false });
        continue;
      }

      const candidate = parsed.data;
      send({ type: "phase", stage: "review", attempt: round + 1, title: candidate.title });
      const { text: vetRaw } = await callModel(
        vettingSystemPrompt(config.source === "described" ? config.seedDescription : ""),
        vettingRequest(config, candidate),
        2000,
        `vet:round${round + 1}`,
      );
      const vetExtracted = tryExtractJson<unknown>(vetRaw);
      const vetParsed = vetExtracted.ok ? Verdict.safeParse(vetExtracted.value) : null;
      await logDebug({
        route: "questions/generate",
        phase: `vet:round${round + 1}:parsed`,
        parsed: vetParsed?.success ? vetParsed.data : undefined,
        error: vetExtracted.ok
          ? vetParsed?.success
            ? undefined
            : "verdict did not match the schema"
          : vetExtracted.error,
      });
      const verdict: VetVerdict =
        vetParsed?.success
          ? vetParsed.data
          : {
              approved: false,
              scores: { difficultyFit: 0, levelFit: 0, clarity: 0, testCoverage: 0, selfContained: 0 },
              assessedDifficulty: config.difficulty,
              issues: [
                vetExtracted.ok
                  ? "The vetting agent returned a verdict in the wrong shape."
                  : `The vetting agent's reply was unreadable: ${vetExtracted.error}`,
              ],
              notes: "",
            };

      attempts.push({ issues: verdict.issues, approved: verdict.approved });
      send({
        type: "verdict",
        approved: verdict.approved,
        attempt: round + 1,
        issue: verdict.issues[0],
        title: candidate.title,
      });

      await logDebug({
        route: "questions/generate",
        phase: `decision:round${round + 1}`,
        data: {
          approved: verdict.approved,
          questionId: candidate.id,
          title: candidate.title,
          assessedDifficulty: verdict.assessedDifficulty,
          issues: verdict.issues,
        },
      });

      if (verdict.approved) {
        const question: Question = {
          ...candidate,
          source: config.source === "described" ? "described" : "generated",
        };
        send({ type: "result", question, verdict, attempts });
        return;
      }

      lastFailure = `The vetting agent rejected it: ${verdict.issues[0] ?? "no reason given"}`;
      notes = [
        "The reviewer rejected your question. Fix exactly these problems and return the complete corrected question:",
        ...verdict.issues.map((i) => `- ${i}`),
        verdict.notes ? `Reviewer notes: ${verdict.notes}` : "",
        "Your previous attempt:",
        JSON.stringify(candidate),
      ]
        .filter(Boolean)
        .join("\n");
    }

    send({
      type: "error",
      message:
        lastFailure || "The generator could not produce a question the vetting agent would approve.",
      attempts,
    });
  }
}
