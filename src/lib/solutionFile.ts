/**
 * Renders a saved solution: the candidate's code with the whole question
 * written above it as a comment, so the file is worth rereading months later
 * without the app open.
 *
 * Line comments rather than block comments or docstrings on purpose — a prompt
 * containing a close-comment sequence or a triple quote cannot corrupt the file.
 */
import { DIFFICULTIES, JOB_LEVELS } from "./policy";
import type { InterviewConfig, Language, Question, TestCase } from "./types";

const COMMENT: Record<Language, string> = { python: "#", javascript: "//" };
const EXTENSION: Record<Language, string> = { python: "py", javascript: "js" };
const WIDTH = 76;

export function toSnake(value: string, fallback = "solution"): string {
  const out = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return out || fallback;
}

/** Where a solution belongs: language/difficulty/snake_case.ext */
export function solutionLocation(
  question: Question,
  config: InterviewConfig,
): { segments: string[]; filename: string } {
  return {
    segments: [config.language, question.difficulty],
    filename: `${toSnake(question.id || question.title)}.${EXTENSION[config.language]}`,
  };
}

/** A value as it would be written in the target language. */
export function literal(value: unknown, language: Language): string {
  if (value === null || value === undefined) return language === "python" ? "None" : "null";
  if (typeof value === "boolean") {
    return language === "python" ? (value ? "True" : "False") : String(value);
  }
  if (typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => literal(v, language)).join(", ")}]`;
  if (typeof value === "object") {
    const body = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${literal(v, language)}`)
      .join(", ");
    return `{${body}}`;
  }
  return String(value);
}

function callOf(question: Question, test: TestCase, language: Language): string {
  return `${question.functionName}(${test.args.map((a) => literal(a, language)).join(", ")})`;
}

/** The declared signature from the starter code, so the file reads like the exercise. */
export function signatureOf(question: Question, language: Language): string {
  const starter = question.starter[language] ?? "";
  const match =
    language === "python"
      ? /def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(starter)
      : /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(starter);
  if (match) return `${match[1]}(${match[2].trim()})`;
  return `${question.functionName}(...)`;
}

function wrap(line: string, width: number): string[] {
  if (line.trim() === "") return [""];
  if (/^\s/.test(line)) return [line.replace(/\s+$/, "")];

  const bullet = /^([-*]\s+|\d+\.\s+)/.exec(line);
  const hang = bullet ? " ".repeat(bullet[1].length) : "";
  const words = line.split(/\s+/).filter(Boolean);

  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      out.push(current);
      current = `${hang}${word}`;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Markdown down to something that reads well inside a comment block. */
export function promptToLines(markdown: string, width = WIDTH): string[] {
  const out: string[] = [];
  let inFence = false;

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(`  ${raw.replace(/\s+$/, "")}`);
      continue;
    }
    const cleaned = raw
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    out.push(...wrap(cleaned, width));
  }

  const collapsed: string[] = [];
  for (const line of out) {
    if (line === "" && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  while (collapsed.length && collapsed[0] === "") collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed;
}

function section(title: string, body: string[]): string[] {
  if (body.length === 0) return [];
  return ["", title, "", ...body.map((l) => (l ? `  ${l}` : ""))];
}

export function buildSolutionFile(args: {
  question: Question;
  config: InterviewConfig;
  code: string;
  savedAt?: Date;
}): string {
  const { question, config, code } = args;
  const mark = COMMENT[config.language];
  const rule = "=".repeat(WIDTH);
  const date = (args.savedAt ?? new Date()).toISOString().slice(0, 10);

  const visible = question.tests.filter((t) => !t.hidden).slice(0, 4);
  const examples = visible.map(
    (t) => `${callOf(question, t, config.language)}  ->  ${literal(t.expected, config.language)}`,
  );

  const lines: string[] = [
    rule,
    question.title,
    rule,
    `${DIFFICULTIES[question.difficulty].label.toLowerCase()} · ${
      JOB_LEVELS[config.jobLevel].label.split(" (")[0]
    } bar · ${config.language} · practised ${date}`,
    ...(question.topics.length ? [`topics: ${question.topics.join(", ")}`] : []),
    ...section("PROBLEM", promptToLines(question.prompt)),
    ...section("IMPLEMENT", [signatureOf(question, config.language)]),
    ...section("EXAMPLES", examples),
    ...section("CASES THAT MUST HOLD", question.tests.map((t) => `- ${t.name || "case"}`)),
    ...section("COMPLEXITY TO BEAT", [
      `time ${question.optimal.time} · space ${question.optimal.space}`,
    ]),
    ...section("WORTH THINKING ABOUT", question.followUps.map((f) => `- ${f}`)),
    rule,
  ];

  const header = lines.map((l) => (l ? `${mark} ${l}` : mark)).join("\n");
  return `${header}\n\n${code.replace(/\s+$/, "")}\n`;
}
