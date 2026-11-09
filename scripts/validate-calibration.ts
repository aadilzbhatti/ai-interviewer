/**
 * Checks the behaviour that only shows up in prompt text and stored config:
 * described-question mode, the stored-config migration, the help calibration,
 * and the grading rubric the assessment is held to.
 * Run with: npm run validate:calibration
 */
import {
  generatorSystemPrompt,
  vettingSystemPrompt,
  assessmentSystemPrompt,
  interviewerSystemPrompt,
} from "../src/lib/prompts";
import { BANK } from "../src/lib/questions/index";
import { tryExtractJson } from "../src/lib/anthropic";
import { normalizeConfig, DEFAULT_CONFIG } from "../src/lib/store";
import {
  helpPolicy,
  gradingBar,
  availableConcessions,
  applyConcession,
  concessionNote,
  nextHelpLevel,
  nextLowerJobLevel,
  HELP_LEVELS,
  JOB_LEVELS,
  VERDICTS,
  EXTENSION_MIN,
  MAX_EXTENSIONS,
  timingRecord,
  timeNote,
  isStrictTime,
} from "../src/lib/policy";
import type { Concession, Difficulty, HelpLevel, InterviewConfig, JobLevel } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

const SEED = "a sliding window over a stream of events where old entries expire";
const described: InterviewConfig = {
  ...DEFAULT_CONFIG,
  source: "described",
  seedDescription: SEED,
};
const generated: InterviewConfig = { ...DEFAULT_CONFIG, source: "generated" };

const FAMOUS_RULE = "Do not reproduce a well-known named problem verbatim";

// --- generator prompt -------------------------------------------------------
{
  const p = generatorSystemPrompt(described);
  check("generator: carries the candidate's words verbatim", p.includes(SEED));
  check("generator: drops the originality rule when they chose the problem", !p.includes(FAMOUS_RULE), p.slice(0, 0));
  check("generator: tells the model not to substitute a different problem", /Do not substitute a different problem/.test(p));
  check("generator: demands ambiguity be resolved in the prompt", /make every choice explicit in the prompt/.test(p));
  check(
    "generator: forbids worked examples that drift from the tests",
    /EVERY worked example shown in the prompt must be copied from one of your own test cases/.test(p),
  );
  check(
    "generator: makes it check expected values against the reference",
    /walk your reference solution through each test case by hand/.test(p),
  );
  check(
    "generator: keeps a stateful subject stateful despite the one-function rule",
    /REPLAYS a list of operations or events in order/.test(p) &&
      /Do not convert it into a static batch or range-query problem/.test(p),
  );
}
{
  const p = generatorSystemPrompt(generated);
  check("generator: keeps the originality rule for unseeded generation", p.includes(FAMOUS_RULE));
  check("generator: no request block when unseeded", !p.includes("What the candidate asked to practice"));
}
{
  // An empty description must not be treated as a request.
  const p = generatorSystemPrompt({ ...described, seedDescription: "   " });
  check("generator: blank description falls back to unseeded rules", p.includes(FAMOUS_RULE));
}

// --- vetting prompt ---------------------------------------------------------
{
  const p = vettingSystemPrompt(SEED);
  check("vetter: scores fidelity when seeded", p.includes("matchesRequest"));
  check("vetter: will not reject a famous problem the candidate chose", /Do NOT reject it for being a well-known/.test(p));
  check("vetter: rejects a question that is not what they asked for", /not actually the problem the candidate asked for/.test(p));
  check("vetter: drops the memorized-problem rejection", !/verbatim restatement of a famous problem/.test(p));
}
{
  const p = vettingSystemPrompt("");
  check("vetter: keeps the memorized-problem rejection when unseeded", /verbatim restatement of a famous problem/.test(p));
  check("vetter: no fidelity score when unseeded", !p.includes("matchesRequest"));
}

// --- config migration -------------------------------------------------------
{
  const old = { ...DEFAULT_CONFIG, generateFresh: true } as unknown as Record<string, unknown>;
  delete old.source;
  delete old.seedDescription;
  const migrated = normalizeConfig(old);
  check("migration: generateFresh true becomes generated", migrated.source === "generated", migrated.source);
  check("migration: seedDescription defaults to empty", migrated.seedDescription === "");
  check(
    "migration: the dead field is removed",
    !("generateFresh" in (migrated as unknown as Record<string, unknown>)),
  );
}
{
  const old = { ...DEFAULT_CONFIG, generateFresh: false } as unknown as Record<string, unknown>;
  delete old.source;
  check("migration: generateFresh false becomes bank", normalizeConfig(old).source === "bank");
}
{
  const partial = { difficulty: "hard" } as unknown as Record<string, unknown>;
  const migrated = normalizeConfig(partial);
  check(
    "migration: a partial config is filled from defaults",
    migrated.difficulty === "hard" && migrated.jobLevel === DEFAULT_CONFIG.jobLevel && migrated.source === "bank",
  );
}

// --- the calibration claim --------------------------------------------------
const LEVELS: JobLevel[] = ["intern", "entry", "mid", "senior", "staff"];
for (const help of Object.keys(HELP_LEVELS) as HelpLevel[]) {
  const scores = LEVELS.map((jobLevel) => helpPolicy({ ...DEFAULT_CONFIG, helpLevel: help, jobLevel }).score);
  const monotonic = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
  const strictInside = scores.some((s, i) => i > 0 && s < scores[i - 1]);
  check(
    `calibration: "${HELP_LEVELS[help].label}" gets less helpful as the level rises`,
    monotonic && strictInside,
    scores.join(" > "),
  );
}
{
  const silentStaff = helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "none", jobLevel: "staff" });
  check("calibration: the silent band volunteers no hints", silentStaff.band === "silent" && silentStaff.hintBudget === 0);
  const guidedIntern = helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "guided", jobLevel: "intern" });
  check("calibration: guided at intern is the coaching band", guidedIntern.band === "coaching");
  const same = helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "minimal", jobLevel: "entry" });
  const harder = helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "minimal", jobLevel: "staff" });
  check(
    "calibration: the same setting yields different bands across levels",
    same.band !== harder.band,
    `${same.band} vs ${harder.band}`,
  );
  check(
    "calibration: every job level carries a stated bar",
    LEVELS.every((l) => JOB_LEVELS[l].bar.length > 20),
  );
}


// --- the grading rubric -----------------------------------------------------
{
  // "easy at senior" must be graded harder than "easy at entry", not softer.
  const easyAtSenior = gradingBar({ ...DEFAULT_CONFIG, difficulty: "easy", jobLevel: "senior" });
  check(
    "rubric: a question below the level's usual difficulty raises the bar",
    /EASIER than the usual bar/.test(easyAtSenior.difficultyNote) &&
      /table stakes/.test(easyAtSenior.difficultyNote),
    easyAtSenior.difficultyNote.slice(0, 60),
  );

  const hardAtEntry = gradingBar({ ...DEFAULT_CONFIG, difficulty: "hard", jobLevel: "entry" });
  check(
    "rubric: a question above the level's usual difficulty forgives not finishing",
    /HARDER than the usual bar/.test(hardAtEntry.difficultyNote) &&
      /not by itself below the bar/.test(hardAtEntry.difficultyNote),
    hardAtEntry.difficultyNote.slice(0, 60),
  );
  check(
    "rubric: but it still refuses to inflate for effort",
    /Do not inflate for effort/.test(hardAtEntry.difficultyNote),
  );

  const atLevel = gradingBar({ ...DEFAULT_CONFIG, difficulty: "medium", jobLevel: "mid" });
  check(
    "rubric: a question at the level's usual difficulty expects a near-optimal solution",
    /sits at the usual bar/.test(atLevel.difficultyNote) && /near-optimal/.test(atLevel.difficultyNote),
  );

  // Every difficulty x level pairing must produce one of the three readings.
  const DIFFS: Difficulty[] = ["easy", "medium", "hard"];
  const covered = DIFFS.every((difficulty) =>
    LEVELS.every((jobLevel) => {
      const note = gradingBar({ ...DEFAULT_CONFIG, difficulty, jobLevel }).difficultyNote;
      return /EASIER than the usual bar|HARDER than the usual bar|sits at the usual bar/.test(note);
    }),
  );
  check("rubric: every difficulty x level pairing yields a stated expectation", covered);

  check("rubric: the scale has five anchors", atLevel.scaleAnchors.length === 5);
  check(
    "rubric: 3 is defined as being at the bar, not as a failure",
    /^3 — At the bar/.test(atLevel.scaleAnchors[2]) && /not a criticism/.test(atLevel.scaleAnchors[2]),
    atLevel.scaleAnchors[2],
  );
  check("rubric: all eight verdicts are anchored", atLevel.verdictAnchors.length === 8);
  check(
    "rubric: each anchor names its verdict",
    VERDICTS.every((v, i) => atLevel.verdictAnchors[i].startsWith(`${v} — `)),
  );

  const silent = gradingBar({ ...DEFAULT_CONFIG, helpLevel: "none", jobLevel: "staff" });
  check(
    "rubric: the silent band tells the grader not to punish silence",
    /do not penalise a candidate for silence that the band caused/.test(silent.helpNote),
  );
  const guided = gradingBar({ ...DEFAULT_CONFIG, helpLevel: "guided", jobLevel: "intern" });
  check(
    "rubric: a helpful band tells the grader to subtract the interviewer's work",
    /is NOT evidence about the candidate/.test(guided.helpNote) && /coaching/.test(guided.helpNote),
  );
}

// --- the assessment prompt --------------------------------------------------
{
  const p = assessmentSystemPrompt({ ...DEFAULT_CONFIG, difficulty: "easy", jobLevel: "senior" });
  check("assessment: offers all eight verdicts", VERDICTS.every((v) => p.includes(v)));
  check("assessment: embeds the difficulty-adjusted bar", /EASIER than the usual bar/.test(p));
  check("assessment: demands evidence for every judgement", /must be anchored to evidence/.test(p));
  check(
    "assessment: asks for both the conversation and the code",
    /Analyse BOTH the conversation and the code/.test(p),
  );
  check("assessment: forbids the praise sandwich", /No praise sandwich/.test(p));
  check(
    "assessment: asks for a committee-facing debrief of real length",
    /hiring committee/.test(p) && /500-900 words/.test(p),
  );
  check(
    "assessment: requests per-criterion commentary",
    /"problemSolving":\s+\{ "score": 1-5, "commentary"/.test(p),
  );
  check(
    "assessment: requests a code review with change requests",
    /"codeReview"/.test(p) && /"changeRequests"/.test(p) && /"edgeCases"/.test(p),
  );
  check("assessment: requests a timeline keyed to minutes", /"atMin"/.test(p) && /chronological order/.test(p));
  check("assessment: separates the candidate's work from the interviewer's", /"helpAdjustment"/.test(p));
}


// --- clock mode -------------------------------------------------------------
{
  const partial = { difficulty: "hard" } as unknown as Record<string, unknown>;
  check("migration: clockMode defaults to pausable", normalizeConfig(partial).clockMode === "pausable");
  const strict = { ...DEFAULT_CONFIG, clockMode: "strict" } as unknown as Record<string, unknown>;
  check("migration: an explicit strict clock survives", normalizeConfig(strict).clockMode === "strict");
  const junk = { ...DEFAULT_CONFIG, clockMode: "nonsense" } as unknown as Record<string, unknown>;
  check("migration: an unknown clock mode falls back to pausable", normalizeConfig(junk).clockMode === "pausable");
}

// --- what the candidate can tap out of --------------------------------------
{
  const strict: InterviewConfig = { ...DEFAULT_CONFIG, clockMode: "strict" };
  check(
    "concessions: a strict clock can be traded for pausing",
    availableConcessions(strict).some((o) => o.kind === "enable_pause"),
  );
  check(
    "concessions: a pausable clock does not offer pausing again",
    !availableConcessions({ ...DEFAULT_CONFIG, clockMode: "pausable" }).some((o) => o.kind === "enable_pause"),
  );
  check(
    "concessions: the most helpful setting cannot be raised further",
    !availableConcessions({ ...DEFAULT_CONFIG, helpLevel: "guided" }).some((o) => o.kind === "raise_help"),
  );
  check(
    "concessions: the lowest level cannot be dropped further",
    !availableConcessions({ ...DEFAULT_CONFIG, jobLevel: "intern" }).some((o) => o.kind === "lower_level"),
  );
  {
    // Extra time is the one concession that can be asked for more than once,
    // so "everything given" now means every ONE-SHOT concession is exhausted.
    const maxedOut: InterviewConfig = {
      ...DEFAULT_CONFIG,
      clockMode: "pausable",
      helpLevel: "guided",
      jobLevel: "intern",
    };
    check(
      "concessions: no one-shot concession is offered once all have been given",
      availableConcessions(maxedOut).every((o) => o.kind === "extend_time"),
    );
    check(
      "concessions: but more time can still be asked for",
      availableConcessions(maxedOut).some((o) => o.kind === "extend_time"),
    );

    const taken = (n: number): Concession[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: "extend_time" as const,
        atMin: 10 + i,
        from: "x",
        to: "y",
      }));
    check(
      `concessions: extra time runs out after ${MAX_EXTENSIONS} requests`,
      availableConcessions(maxedOut, taken(MAX_EXTENSIONS)).length === 0,
      String(availableConcessions(maxedOut, taken(MAX_EXTENSIONS)).length),
    );
    check(
      "concessions: and is still offered one request short of the cap",
      availableConcessions(maxedOut, taken(MAX_EXTENSIONS - 1)).some((o) => o.kind === "extend_time"),
    );
  }
  check(
    "concessions: every option states what it costs",
    availableConcessions(strict).every((o) => o.cost.length > 15 && o.detail.length > 15 && o.from !== o.to),
  );
}

// --- applying them ----------------------------------------------------------
{
  check("apply: unlocking the clock makes it pausable",
    applyConcession({ ...DEFAULT_CONFIG, clockMode: "strict" }, "enable_pause").clockMode === "pausable");

  const harder: InterviewConfig = { ...DEFAULT_CONFIG, helpLevel: "minimal", jobLevel: "senior" };
  const moreHelp = applyConcession(harder, "raise_help");
  check("apply: more help moves one step up the scale", moreHelp.helpLevel === "balanced", moreHelp.helpLevel);
  check(
    "apply: more help actually raises the help score",
    helpPolicy(moreHelp).score > helpPolicy(harder).score,
    `${helpPolicy(harder).score} -> ${helpPolicy(moreHelp).score}`,
  );

  const lower = applyConcession(harder, "lower_level");
  check("apply: dropping a level moves one step down", lower.jobLevel === "mid", lower.jobLevel);
  check(
    "apply: dropping a level also makes the interviewer more forthcoming",
    helpPolicy(lower).score > helpPolicy(harder).score,
    `${helpPolicy(harder).score} -> ${helpPolicy(lower).score}`,
  );
  check(
    "apply: dropping a level moves the bar the grader uses",
    gradingBar(lower).headline !== gradingBar(harder).headline,
  );

  const maxed: InterviewConfig = { ...DEFAULT_CONFIG, helpLevel: "guided", jobLevel: "intern" };
  check("apply: raising past the top is a no-op", applyConcession(maxed, "raise_help").helpLevel === "guided");
  check("apply: dropping past the bottom is a no-op", applyConcession(maxed, "lower_level").jobLevel === "intern");

  check("steps: help tops out", nextHelpLevel("guided") === null);
  check("steps: level bottoms out", nextLowerJobLevel("intern") === null);
  check("steps: help climbs in order", nextHelpLevel("none") === "minimal" && nextHelpLevel("minimal") === "balanced");
  check("steps: level descends in order", nextLowerJobLevel("staff") === "senior" && nextLowerJobLevel("mid") === "entry");
}

// --- how the review is told to weigh them -----------------------------------
{
  const original: InterviewConfig = { ...DEFAULT_CONFIG, jobLevel: "senior", helpLevel: "balanced" };
  const clean = concessionNote(original, original, []);
  check("note: a clean run says so plainly", /took no concessions/.test(clean));
  check("note: a clean run does not lecture", clean.length < 200);

  const taken: Concession[] = [
    { kind: "raise_help", atMin: 4, from: "Balanced", to: "Guided" },
    { kind: "lower_level", atMin: 21, from: "Senior", to: "Mid" },
  ];
  const final: InterviewConfig = { ...original, helpLevel: "guided", jobLevel: "mid" };
  const note = concessionNote(original, final, taken);
  check("note: lists each concession with its minute", /t\+04m/.test(note) && /t\+21m/.test(note));
  check("note: names what changed", /Balanced to Guided/.test(note) && /Senior to Mid/.test(note));
  check("note: states both the starting and finishing configuration",
    /Started at: .*Senior/.test(note) && /Finished at: .*Mid/.test(note));
  check("note: grades against the final configuration", /against the FINAL configuration/.test(note));
  check("note: weights how early the concession came", /WHEN it was taken/.test(note));
  check(
    "note: derives the early cutoff from the interview length",
    /t\+9m/.test(concessionNote({ ...original, durationMin: 35 }, final, taken)),
    concessionNote({ ...original, durationMin: 35 }, final, taken).match(/t\+\d+m,/)?.[0] ?? "?",
  );
  check("note: short interviews still get a sane cutoff",
    /t\+5m/.test(concessionNote({ ...original, durationMin: 20 }, final, taken)));
  check("note: demands the original bar be reported", /ORIGINAL bar/.test(note));
  check("note: forbids implying the original bar was met", /Never let the final verdict imply/.test(note));
  check("note: tells the grader not to moralise", /Do not moralise/.test(note));
}

// --- the prompts see them ---------------------------------------------------
{
  const taken: Concession[] = [{ kind: "raise_help", atMin: 4, from: "Balanced", to: "Guided" }];
  const withC = assessmentSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "guided" }, DEFAULT_CONFIG, taken);
  check("assessment: carries the concession note", /t\+04m/.test(withC) && /ORIGINAL bar/.test(withC));
  check("assessment: asks for a concession readout", /what the concessions cost them/.test(withC));

  const withoutC = assessmentSystemPrompt(DEFAULT_CONFIG);
  check("assessment: a clean run is told so", /took no concessions/.test(withoutC));
  check("assessment: a clean run returns an empty readout", /they took no concessions/.test(withoutC));

  const q = BANK[0];
  const iv = interviewerSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "guided" }, q, taken);
  check("interviewer: is told the candidate eased up", /has eased the interview/.test(iv) && /t\+04m/.test(iv));
  check("interviewer: is told not to make a thing of it", /do not congratulate them/.test(iv));
  check(
    "interviewer: a clean run has no such section",
    !/has eased the interview/.test(interviewerSystemPrompt(DEFAULT_CONFIG, q)),
  );
}


// --- pulling JSON out of a model reply --------------------------------------
// The generator's reply is the least trustworthy input in the system, and a
// failure here used to escape the retry loop and end the whole request.
{
  const ok = <T,>(text: string) => tryExtractJson<T>(text);

  {
    const r = ok<{ a: number }>('{"a": 1}');
    check("json: a bare object", r.ok && r.value.a === 1);
  }
  {
    const r = ok<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```\nHope that helps.');
    check("json: a fenced block with prose around it", r.ok && r.value.a === 1);
  }
  {
    const r = ok<{ a: number }>('```\n{"a": 2}\n```');
    check("json: a fence with no language tag", r.ok && r.value.a === 2);
  }
  {
    const r = ok<{ a: { b: number[] } }>('prefix {"a": {"b": [1, 2, 3]}} suffix');
    check("json: nested structures", r.ok && r.value.a.b[2] === 3);
  }
  {
    const r = ok<{ a: string }>('{"a": "}{ not a real brace"}');
    check("json: braces inside a string do not confuse the scan", r.ok && r.value.a === "}{ not a real brace");
  }
  {
    const r = ok<{ a: string }>('{"a": "she said \\"hi\\" and left"}');
    check("json: escaped quotes inside a string", r.ok && r.value.a === 'she said "hi" and left', JSON.stringify(r));
  }
  {
    const r = ok<{ a: string }>('{"a": "ends with a backslash \\\\"}');
    check("json: a trailing escaped backslash", r.ok && r.value.a === "ends with a backslash \\");
  }
  {
    const r = ok<number[]>("[1, 2, 3]");
    check("json: a top-level array", r.ok && r.value.length === 3);
  }

  // The regression that actually bit: a generated question's own prompt
  // contains markdown code fences, so slicing on the first ``` cut the JSON
  // mid-string and looked exactly like truncation.
  {
    const fence = "``" + "`";
    const inner = [
      "# Sliding Window Event Tracker",
      "",
      "An event at time t is in the window when q - w < t <= q.",
      "",
      "## Example",
      "",
      fence + "python",
      'events = [["e1", 100], ["e2", 140]]',
      "counts = {}",
      fence,
      "",
      "Constraints: 1 <= n <= 10^5",
    ].join("\n");
    const payload = JSON.stringify({
      id: "sliding-window",
      prompt: inner,
      tests: [{ name: "example", args: [[[1, 100]]], expected: [1] }],
    });
    const reply = fence + "json\n" + payload + "\n" + fence;

    const r = ok<{ id: string; prompt: string; tests: unknown[] }>(reply);
    check("json: a fenced reply whose payload contains its own fences", r.ok, r.ok ? "" : r.error);
    check(
      "json: and the inner markdown survives intact",
      r.ok && r.value.prompt === inner && r.value.tests.length === 1,
    );
    check(
      "json: that case is NOT misreported as truncated",
      r.ok || !r.truncated,
      r.ok ? "" : `truncated=${r.truncated}`,
    );
  }
  {
    const fence = "``" + "`";
    const payload = JSON.stringify({ prompt: "braces { } and brackets [ ] in prose" });
    const r = ok<{ prompt: string }>(fence + "json\n" + payload + "\n" + fence);
    check("json: braces inside a fenced payload", r.ok && r.value.prompt.includes("{ }"));
  }
  {
    const r = ok<{ a: number }>('I will return {the object} below:\n{"a": 7}');
    check("json: a brace-looking phrase before the real object is skipped", r.ok && r.value.a === 7, JSON.stringify(r));
  }

  // The reported failure: a reply that ran out of output budget.
  {
    const r = ok('{"id": "x", "tests": [{"name": "a", "args": [1], "expected": 2}, {"name":');
    check("json: a cut-off object is reported as truncated", !r.ok && r.truncated, JSON.stringify(r));
    check("json: and says so in words", !r.ok && /cut off/.test(r.error), !r.ok ? r.error : "");
  }
  {
    const r = ok('{"prompt": "a problem statement that stops mid-sen');
    check("json: a cut-off string is reported as truncated", !r.ok && r.truncated);
  }
  {
    const r = ok("no json here at all");
    check("json: no JSON is a failure but not a truncation", !r.ok && !r.truncated);
  }
  {
    const r = ok('{"a": }');
    check("json: balanced but invalid is a failure, not a truncation", !r.ok && !r.truncated, JSON.stringify(r));
  }
  {
    // A truncation must never be mistaken for a parse error, because the two
    // get different retry instructions.
    const big = `{"id": "q", "prompt": "${"x".repeat(500)}`;
    const r = ok(big);
    check("json: a large truncated payload still reads as truncated", !r.ok && r.truncated);
  }
}

// --- extra time -------------------------------------------------------------
// The complaint this encodes: asking for five more minutes was filed as a
// concession and the review judged the work against the original limit. Now
// +5 turns strict time off for the rest of the interview, the report says so,
// and the extra time is never weighed against the candidate.
{
  const base: InterviewConfig = { ...DEFAULT_CONFIG, durationMin: 35, strictTime: true };
  const extended = applyConcession(base, "extend_time");
  check(
    `time: an extension adds ${EXTENSION_MIN} minutes`,
    extended.durationMin === base.durationMin + EXTENSION_MIN,
    String(extended.durationMin),
  );
  check("time: and turns strict time off", extended.strictTime === false);
  check(
    "time: and nothing else about the interview moves",
    extended.jobLevel === base.jobLevel &&
      extended.helpLevel === base.helpLevel &&
      extended.clockMode === base.clockMode,
  );
  const twice = applyConcession(extended, "extend_time");
  check("time: extensions stack", twice.durationMin === 35 + 2 * EXTENSION_MIN, String(twice.durationMin));
  check(
    `time: at most ${MAX_EXTENSIONS * EXTENSION_MIN} extra minutes in total`,
    MAX_EXTENSIONS * EXTENSION_MIN === 30,
    String(MAX_EXTENSIONS * EXTENSION_MIN),
  );

  const ext: Concession[] = [
    { kind: "extend_time", atMin: 30, from: "35 min", to: "40 min" },
    { kind: "extend_time", atMin: 42, from: "40 min", to: "45 min" },
  ];
  check("time: extra time is not a concession", /took no concessions/.test(concessionNote(base, twice, ext)));
  check(
    "time: nor is it weighed as one",
    !/ACTUALLY took|extra minutes|a real loop would have been called/.test(concessionNote(base, twice, ext)),
  );

  const t = timingRecord(base, twice, ext, 44);
  check("time: the record says strict time was on at the start", t.strictAtStart);
  check("time: and off at the end", !t.strictAtEnd);
  check("time: from the minute of the first extension", t.relaxedAtMin === 30, String(t.relaxedAtMin));
  check("time: with the count and the budgets", t.extensions === 2 && t.plannedMin === 35 && t.finalBudgetMin === 45);

  const relaxedNote = timeNote(t);
  check("time: the grader is told not to count the time against them", /Do NOT count the time taken/.test(relaxedNote));
  check("time: nor to call it a concession", /do not call the extra time a concession/.test(relaxedNote));
  check("time: and to state it once, neutrally", /once, neutrally/.test(relaxedNote) && /t\+30m/.test(relaxedNote));

  const strict = timingRecord(base, base, [], 33);
  check("time: no extension keeps strict time on to the end", strict.strictAtEnd && strict.relaxedAtMin === undefined);
  check("time: and the grader is told the limit counts", /The limit counts/.test(timeNote(strict)));

  const chosenRelaxed = { ...base, strictTime: false };
  const relaxedFromStart = timingRecord(chosenRelaxed, chosenRelaxed, [], 50);
  check("time: relaxed by choice is never strict", !relaxedFromStart.strictAtStart && !relaxedFromStart.strictAtEnd);
  check("time: and the grader is told so", /chose a relaxed time limit/.test(timeNote(relaxedFromStart)));

  const option = availableConcessions(base).find((o) => o.kind === "extend_time")!;
  check("time: the +5 button says it costs nothing", /not held against you/.test(option.cost) && /strict time off/i.test(option.cost));

  const a = assessmentSystemPrompt(twice, base, ext, 44);
  check("time: the grading prompt carries the time section", /## Time/.test(a) && /Do NOT count the time taken/.test(a));
  check("time: and asks for no concession readout when only time was added", /they took no concessions/.test(a));

  const iv = interviewerSystemPrompt(twice, BANK[0], ext);
  check("time: the interviewer is not told the candidate eased up", !/has eased the interview/.test(iv));

  check("time: an old config without the setting counts as strict", normalizeConfig({}).strictTime === true);
  check("time: an explicit relaxed choice survives a reload", normalizeConfig({ strictTime: false }).strictTime === false);
  check("time: an old session config without it reads as strict", isStrictTime({ strictTime: undefined as unknown as boolean }));
}

// --- consent before the approach is revealed --------------------------------
// The complaint this encodes: in Balanced, the interviewer handed over the
// algorithm nobody asked for, and the grader then charged the candidate for
// having "needed" it. Both halves have to hold — the room must offer rather
// than give, and the debrief must not bill them for help they never chose.
{
  const q = BANK[0];
  const GATED: HelpLevel[] = ["minimal", "balanced"];

  for (const help of GATED) {
    const cfg = { ...DEFAULT_CONFIG, helpLevel: help };
    const iv = interviewerSystemPrompt(cfg, q);
    const label = HELP_LEVELS[help].label;

    check(`consent/${help}: the band may not reveal the approach`, !helpPolicy(cfg).revealApproach);
    check(`consent/${help}: "${label}" is told to offer rather than hand over`, /## Help they did not ask for/.test(iv));
    check(`consent/${help}: it is told to wait for the answer`, /stop and wait for their answer/i.test(iv));
    check(`consent/${help}: silence is not consent`, /Anything that is not a yes is a no/.test(iv));
    check(`consent/${help}: a refusal is respected`, /they have chosen to keep the problem/.test(iv));
    check(`consent/${help}: the Hint button still counts as asking`, /Hint button/.test(iv));
    check(
      `consent/${help}: an offer cannot be repeated indefinitely`,
      /not offer more than twice/.test(iv),
    );
  }

  // The specific line that produced the complaint: Balanced used to be told to
  // escalate all the way to "the shape of the technique" on its own initiative.
  const balanced = interviewerSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "balanced" }, q);
  check(
    "consent/balanced: no longer escalates to the technique unprompted",
    !/then the shape of the technique/.test(balanced),
  );

  // Coaching is teaching mode; volunteering is the whole point there.
  const guided = interviewerSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "guided" }, q);
  check("consent/guided: teaching mode is not gated", !/## Help they did not ask for/.test(guided));
  check("consent/guided: and is still allowed to reveal", helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "guided" }).revealApproach);

  // The room: nothing volunteered below teaching mode, enforced in code where it can be.
  for (const help of GATED) {
    const cfg = { ...DEFAULT_CONFIG, helpLevel: help };
    const iv = interviewerSystemPrompt(cfg, q);
    const rules = helpPolicy(cfg).rules.join("\n");
    check(`unasked/${help}: the interviewer gets no turn after a test run`, !helpPolicy(cfg).speaksAfterRuns);
    check(`unasked/${help}: is told it does not volunteer help`, /You do not volunteer help/.test(iv));
    check(`unasked/${help}: not even when the clock is short`, /not when the clock is short/.test(iv));
    check(`unasked/${help}: help comes only on request`, /Help is given only when they ask/.test(iv));
    check(`unasked/${help}: at most a content-free mention that a hint is available`, /with no content, that a hint is there/.test(iv));
    check(`unasked/${help}: its hints are on request only`, /and only when they ask/.test(iv));
    check(
      `unasked/${help}: no rule lets it step in on its own`,
      !/Only intervene after|Push back on it if it is wrong|When tests fail, you may point/.test(rules),
    );
  }
  check(
    "unasked/silent: no turn after a test run either",
    !helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "none", jobLevel: "staff" }).speaksAfterRuns,
  );
  check("unasked/guided: teaching mode still reacts to runs", helpPolicy({ ...DEFAULT_CONFIG, helpLevel: "guided" }).speaksAfterRuns);

  // Silent has nothing to offer in the first place.
  const silent = interviewerSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "none", jobLevel: "staff" }, q);
  check("consent/silent: a band with no hints offers nothing", !/## Help they did not ask for/.test(silent));

  // The grader half.
  for (const help of GATED) {
    const a = assessmentSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: help });
    check(`consent/${help}: the grader is told to establish who asked`, /establish WHO ASKED/.test(a));
    check(
      `consent/${help}: unrequested help does not lower a score`,
      /Do NOT lower any score for it/.test(a),
    );
    check(
      `consent/${help}: and is not written up as a gap`,
      /do NOT list it as a gap/.test(a),
    );
    check(
      `consent/${help}: voided evidence cannot trigger a verdict cap`,
      /do not let it trigger a cap/.test(a),
    );
    check(
      `consent/${help}: missing signal resolves to neutral, not a penalty`,
      /Never convert missing signal into a penalty/.test(a),
    );
    check(
      `consent/${help}: a 3 recorded for that reason is not a below-bar signal`,
      /explicitly NOT a below-the-bar signal/.test(a),
    );
  }

  // Accepted help is still chargeable — the rule must not become a loophole
  // that writes off every hint the candidate asked for.
  const balancedGrade = assessmentSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "balanced" });
  check(
    "consent: help they asked for is still subtracted",
    /help they sought/i.test(balancedGrade) && /Subtract it/.test(balancedGrade),
  );
  check(
    "consent: saying yes to an offer counts as asking",
    /CANDIDATE \[accepted an offer of help\]" are requests/.test(balancedGrade),
  );
  // Changed on request: help nobody asked for is never charged, in any band,
  // teaching mode included. Guided may still teach unasked; it just cannot bill.
  const guidedGrade = assessmentSystemPrompt({ ...DEFAULT_CONFIG, helpLevel: "guided", jobLevel: "intern" });
  check("consent: guided grading gets the exemption too", /Help nobody asked for is the interview's error, not the candidate's, in every band/.test(guidedGrade));
  check("consent: the grader is told the app labelled every turn", /the app has labelled every turn/.test(balancedGrade) && /UNPROMPTED/.test(balancedGrade));
  check("consent: a clarifying question is not a request for help", /clarifying question about the problem has not asked for help/.test(balancedGrade));
  check("consent: \"interviewer assistance\" may not be held against them", /do NOT describe "interviewer assistance"/.test(balancedGrade));
  check("consent: every charge must be listed and is checked", /List in chargedHelp every piece of help/.test(balancedGrade) && /"chargedHelp"/.test(balancedGrade));
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
