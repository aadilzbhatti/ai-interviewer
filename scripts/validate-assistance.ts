/**
 * Who asked for help, as recorded by the app.
 *
 * The complaint: the interviewer handed out advice nobody asked for, and the
 * review then marked the candidate down for "extensive interviewer
 * assistance". The grader had to infer who asked, and inferred badly. Now the
 * app labels every turn and checks every charge the grader makes. These are the
 * rules that keep a charge from landing on help that was never requested.
 *
 * Run with: npm run validate:assistance
 */
import {
  isHelpRequest,
  labelMessages,
  checkChargedHelp,
  speakerTag,
  HINT_BUTTON_TEXT,
} from "../src/lib/assistance";
import type { ChatMessage } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

// --- what counts as asking --------------------------------------------------
{
  const asks = [
    "Can I get a hint?",
    "could you give me a hint",
    "any pointers?",
    "I'm stuck",
    "im stuck on the edge case",
    "What should I do here?",
    "How should I approach this?",
    "Am I on the right track?",
    "Is my approach correct?",
    "What am I missing?",
    "where's the bug",
    "Why is this failing?",
    "can you help me with the loop",
    "tell me how to handle duplicates",
  ];
  for (const a of asks) check(`asks: "${a}"`, isHelpRequest(a));

  const notAsks = [
    "Can the input list be empty?",
    "Are the weights always positive?",
    "I don't need a hint",
    "no hints please, let me think",
    "I'll do it without help",
    "I think it's O(n log n) because of the sort",
    "Let me try sorting first.",
    "Done.",
    "",
    "Is the output a count or a list?",
  ];
  for (const n of notAsks) check(`not asking: ${JSON.stringify(n)}`, !isHelpRequest(n));
}

// --- labelling the transcript ------------------------------------------------
const msg = (role: "user" | "assistant", content: string, min: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${min}-${content.length}`,
  role,
  content,
  at: 1_000_000 + min * 60_000,
  elapsedMs: min * 60_000,
  ...extra,
});

{
  const transcript: ChatMessage[] = [
    msg("assistant", "Hi! Here's the problem...", 0), // opening
    msg("user", "Can the list be empty?", 1),
    msg("assistant", "Yes, it can.", 1), // reply to a clarifying question
    msg("assistant", "Looks like your duplicates handling is off.", 6), // after a test run: no candidate message between
    msg("user", HINT_BUTTON_TEXT, 8, { hintRequest: true }),
    msg("assistant", "What happens when two boxes weigh the same?", 8),
    msg("user", "I'm stuck on the ordering", 12),
    msg("assistant", "Does the order you load them in matter?", 12),
    msg("assistant", "Want me to point you at the technique?", 15),
    msg("user", "yes please", 15),
    msg("assistant", "Sort ascending first.", 16),
    msg("user", HINT_BUTTON_TEXT, 20), // an old session, before the flag existed
    msg("assistant", "Think about the running total.", 20),
  ];
  const labels = labelMessages(transcript).map((l) => l.label);
  check("label: the opening is unprompted", labels[0] === "unprompted");
  check("label: a clarifying question is not a request", labels[1] === "other");
  check("label: and the answer to it is not help they asked for", labels[2] === "after_candidate");
  check("label: a turn after a test run with nothing said is UNPROMPTED", labels[3] === "unprompted");
  check("label: the Hint button is a request", labels[4] === "hint_button");
  check("label: and the reply answers it", labels[5] === "after_hint_button");
  check("label: saying you are stuck is a request", labels[6] === "asked" && labels[7] === "after_request");
  check("label: yes to an offer is a request", labels[9] === "accepted_offer" && labels[10] === "after_request");
  check("label: an old Hint button message without the flag still counts", labels[11] === "hint_button");
  check("label: the unprompted tag says so in capitals", /UNPROMPTED/.test(speakerTag("unprompted")));
  check(
    "label: a plain reply is marked as not a request for help",
    /not a request for help/.test(speakerTag("after_candidate")),
  );

  const yesWithoutOffer = labelMessages([
    msg("assistant", "Tell me about your approach.", 2),
    msg("user", "yes, I'd sort first", 3),
  ]);
  check("label: a yes with no offer before it is not a request", yesWithoutOffer[1].label === "other");

  // --- checking the grader's charges ----------------------------------------
  const startedAt = 1_000_000;
  const { kept, struck } = checkChargedHelp(
    [
      { atMin: 8, what: "edge case for equal weights", request: "Hint button" },
      { atMin: 12, what: "ordering", request: "I'm stuck on the ordering" },
      { atMin: 16, what: "the technique", request: "yes please" },
      { atMin: 6, what: "pointed at duplicates handling", request: "(none)" },
      { atMin: 2, what: "confirmed the list can be empty", request: "Can the list be empty?" },
      { atMin: Number.NaN, what: "junk", request: "" },
    ],
    transcript,
    startedAt,
  );
  check("charges: help after the Hint button stands", kept.some((k) => k.atMin === 8));
  check("charges: help after asking stands", kept.some((k) => k.atMin === 12));
  check("charges: help after accepting an offer stands", kept.some((k) => k.atMin === 16));
  check("charges: unprompted help after a test run is struck", struck.some((k) => k.atMin === 6));
  check("charges: answering a clarifying question is struck as a charge", struck.some((k) => k.atMin === 2));
  check("charges: junk entries are dropped, not kept", ![...kept, ...struck].some((k) => k.what === "junk"));
  check("charges: a missing list is fine", checkChargedHelp(undefined, transcript, startedAt).kept.length === 0);

  const late = checkChargedHelp([{ atMin: 30, what: "x", request: "Hint button" }], transcript, startedAt);
  check("charges: a request long before the help does not cover it", late.struck.length === 1);
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
