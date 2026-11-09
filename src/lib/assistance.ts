/**
 * Who asked for help, as a matter of record rather than the grader's opinion.
 *
 * The complaint this exists for: the interviewer handed out advice nobody asked
 * for, and the review then marked the candidate down for "extensive interviewer
 * assistance". The grader was left to infer from the transcript who had asked,
 * and inferred badly. So the app now says, for every interviewer turn, what it
 * was replying to, and checks every charge the grader makes against the
 * requests the transcript actually contains. Pure, so the suite pins it down.
 */
import type { ChargedHelp, ChatMessage } from "./types";

/** The Hint button's message. Older sessions have no hintRequest flag. */
export const HINT_BUTTON_TEXT = "Can I get a hint?";

const NEGATED = /\b(no|not|don'?t|do not|without|never)\b[^.?!]{0,20}\b(hints?|help|clues?|nudges?|spoil)/i;

const ASKS = [
  /\b(hint|clue|nudge|pointer)s?\b/i,
  /\bhelp me\b/i,
  /\bcan you help\b/i,
  /\b(i'?m|i am|im) (stuck|lost|blanking)\b/i,
  /\bwhat should i (do|try|use)\b/i,
  /\bhow (do|should|would|can) i (approach|solve|start|fix|handle|do)\b/i,
  /\bam i on the right track\b/i,
  /\bis (this|my) (approach|idea|solution|code) (right|correct|ok|okay|good|optimal|on track)\b/i,
  /\bwhat am i missing\b/i,
  /\bwhere('?s| is) (the|my) (bug|mistake|error)\b/i,
  /\bwhy (is|does) (this|it|my code) (fail|failing|not work|break)/i,
  /\b(any|some) (tips?|ideas|suggestions)\b/i,
  /\b(tell|show) me (how|what|the)\b/i,
];

/**
 * Does this candidate message ask for help with the solution?
 *
 * Deliberately narrow. A clarifying question about the problem ("can the list
 * be empty?") is not a request for help, and "I don't need a hint" is not one
 * either. A false positive here would let help be charged that was never asked
 * for, which is the exact harm this module exists to prevent; a false negative
 * only means the grader cannot charge it.
 */
export function isHelpRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === HINT_BUTTON_TEXT) return true;
  if (NEGATED.test(t)) return false;
  return ASKS.some((re) => re.test(t));
}

const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead|do it|i'?d like that|that would help)\b/i;
const OFFER = /\b(hint|nudge|point you|pointer|want (me|a)|would you like|shall i|should i (tell|give|show))\b/i;

export type CandidateLabel = "hint_button" | "asked" | "accepted_offer" | "other";
export type InterviewerLabel = "after_hint_button" | "after_request" | "after_candidate" | "unprompted";

export interface LabeledMessage {
  message: ChatMessage;
  label: CandidateLabel | InterviewerLabel;
  /** True when this candidate message is a request help may be charged against. */
  isRequest: boolean;
}

/**
 * Labels every message with what it was. An interviewer turn is classified by
 * the candidate message it answered, if any: a turn with no candidate message
 * since the interviewer last spoke (the opening, a reply to a test run, a
 * concession acknowledgement) is unprompted, and help in it can never be
 * charged.
 */
export function labelMessages(messages: ChatMessage[]): LabeledMessage[] {
  const out: LabeledMessage[] = [];
  let pending: CandidateLabel | null = null; // the candidate message the next interviewer turn answers
  let lastInterviewer = "";
  for (const m of messages) {
    if (m.role === "user") {
      let label: CandidateLabel = "other";
      if (m.hintRequest || m.content.trim() === HINT_BUTTON_TEXT) label = "hint_button";
      else if (isHelpRequest(m.content)) label = "asked";
      else if (AFFIRMATIVE.test(m.content.trim()) && OFFER.test(lastInterviewer) && /\?\s*$/.test(lastInterviewer.trim()))
        label = "accepted_offer";
      out.push({ message: m, label, isRequest: label !== "other" });
      // Several candidate messages in a row: the strongest one is what was answered.
      if (pending === null || label !== "other") pending = label;
    } else {
      const label: InterviewerLabel =
        pending === null
          ? "unprompted"
          : pending === "hint_button"
            ? "after_hint_button"
            : pending === "other"
              ? "after_candidate"
              : "after_request";
      out.push({ message: m, label, isRequest: false });
      lastInterviewer = m.content;
      pending = null;
    }
  }
  return out;
}

const TAG: Record<CandidateLabel | InterviewerLabel, string> = {
  hint_button: "CANDIDATE [pressed the Hint button]",
  asked: "CANDIDATE [asked for help]",
  accepted_offer: "CANDIDATE [accepted an offer of help]",
  other: "CANDIDATE",
  after_hint_button: "INTERVIEWER [replying to the Hint button]",
  after_request: "INTERVIEWER [replying to a request for help]",
  after_candidate: "INTERVIEWER [replying to the candidate; not a request for help]",
  unprompted: "INTERVIEWER [UNPROMPTED: the candidate had said nothing since the last turn]",
};

export function speakerTag(label: CandidateLabel | InterviewerLabel): string {
  return TAG[label];
}

/** Interview minute of a message, preferring active time over wall clock. */
export function minuteOf(m: ChatMessage, startedAt: number): number {
  const ms = typeof m.elapsedMs === "number" ? m.elapsedMs : m.at - startedAt;
  return Math.max(0, ms / 60000);
}

/**
 * Splits the grader's charges into those a request supports and those none
 * does. A charge stands only if the candidate asked within a minute before the
 * help was given: within two minutes before it, with a minute of slack after for rounding.
 */
export function checkChargedHelp(
  charged: ChargedHelp[] | undefined,
  messages: ChatMessage[],
  startedAt: number,
): { kept: ChargedHelp[]; struck: ChargedHelp[] } {
  const requests = labelMessages(messages)
    .filter((l) => l.isRequest)
    .map((l) => minuteOf(l.message, startedAt));
  const kept: ChargedHelp[] = [];
  const struck: ChargedHelp[] = [];
  for (const c of Array.isArray(charged) ? charged : []) {
    if (!c || typeof c.atMin !== "number" || !Number.isFinite(c.atMin)) continue;
    const supported = requests.some((r) => r <= c.atMin + 1 && r >= c.atMin - 2);
    (supported ? kept : struck).push(c);
  }
  return { kept, struck };
}
