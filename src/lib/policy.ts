import type {
  HelpLevel,
  JobLevel,
  Difficulty,
  InterviewConfig,
  ClockMode,
  Concession,
  ConcessionKind,
} from "./types";

export const HELP_LEVELS: Record<
  HelpLevel,
  { label: string; blurb: string; base: number }
> = {
  none: {
    label: "Silent",
    blurb: "No hints. The interviewer only clarifies the problem statement.",
    base: 0,
  },
  minimal: {
    label: "Minimal",
    blurb: "Sparse nudges, and only after you are visibly stuck.",
    base: 30,
  },
  balanced: {
    label: "Balanced",
    blurb: "Realistic interview: nudges when stuck, questions your choices.",
    base: 60,
  },
  guided: {
    label: "Guided",
    blurb: "Teaching mode. Steers you toward the solution step by step.",
    base: 90,
  },
};

export const JOB_LEVELS: Record<
  JobLevel,
  {
    label: string;
    helpAdjust: number;
    difficultyBias: Difficulty;
    bar: string;
  }
> = {
  intern: {
    label: "Intern",
    helpAdjust: 15,
    difficultyBias: "easy",
    bar: "Can translate a clear spec into working code and reason about basic complexity.",
  },
  entry: {
    label: "Entry level (L3 / new grad)",
    helpAdjust: 8,
    difficultyBias: "easy",
    bar: "Reaches a correct solution unaided, knows common data structures, handles obvious edge cases.",
  },
  mid: {
    label: "Mid level (L4)",
    helpAdjust: 0,
    difficultyBias: "medium",
    bar: "Picks a near-optimal approach without prompting, writes clean code, tests their own work.",
  },
  senior: {
    label: "Senior (L5)",
    helpAdjust: -10,
    difficultyBias: "medium",
    bar: "Drives the problem: states assumptions, weighs trade-offs, optimizes deliberately, and self-corrects.",
  },
  staff: {
    label: "Staff (L6+)",
    helpAdjust: -18,
    difficultyBias: "hard",
    bar: "Treats the problem as ambiguous by default, designs for the general case, and reasons about scale and failure modes.",
  },
};

export const DIFFICULTIES: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: "Easy", blurb: "Single idea, one data structure, ~15 minutes." },
  medium: { label: "Medium", blurb: "Two ideas composed, non-obvious edge cases, ~30 minutes." },
  hard: { label: "Hard", blurb: "Requires an insight or a non-standard algorithm, ~45 minutes." },
};

export const ROLE_LABELS: Record<string, string> = {
  general: "General",
  backend: "Backend",
  frontend: "Frontend",
  data: "Data / analytics",
  infra: "Infrastructure",
  ml: "ML / AI",
};

export interface HelpPolicy {
  score: number;
  band: "silent" | "sparse" | "responsive" | "coaching";
  /** Hints the interviewer may volunteer over the whole interview. */
  hintBudget: number;
  /** Failed runs or idle turns before the interviewer speaks unprompted. */
  nudgeAfter: number;
  revealApproach: boolean;
  pointOutBugs: boolean;
  confirmApproachBeforeCoding: boolean;
  rules: string[];
}

export function helpPolicy(config: InterviewConfig): HelpPolicy {
  const base = HELP_LEVELS[config.helpLevel].base;
  const score = Math.max(0, Math.min(100, base + JOB_LEVELS[config.jobLevel].helpAdjust));

  if (score <= 12) {
    return {
      score,
      band: "silent",
      hintBudget: 0,
      nudgeAfter: Infinity,
      revealApproach: false,
      pointOutBugs: false,
      confirmApproachBeforeCoding: false,
      rules: [
        "Never volunteer a hint, a direction, or an observation about their code.",
        "Answer only questions about what the problem is asking. Decline, warmly, to answer questions about how to solve it: 'I'd like to see where you take it.'",
        "If they ask whether their approach is right, reflect it back: 'What do you think the worst case looks like?' Do not confirm or deny.",
        "Do not comment on failing tests beyond acknowledging that they ran.",
      ],
    };
  }
  if (score <= 40) {
    return {
      score,
      band: "sparse",
      hintBudget: 2,
      nudgeAfter: 3,
      revealApproach: false,
      pointOutBugs: false,
      confirmApproachBeforeCoding: false,
      rules: [
        "Stay quiet by default. Let silence do the work.",
        "Only intervene after they have been stuck for a while: two or more failing runs with no new idea, or an explicit request for help.",
        "When you do help, give the least revealing hint that unblocks them — a question about a case they have not considered, never the technique itself.",
        "Never name the algorithm or data structure. Never point at the specific line with the bug; at most say that one of the edge cases is not handled.",
      ],
    };
  }
  if (score <= 72) {
    return {
      score,
      band: "responsive",
      hintBudget: 4,
      nudgeAfter: 2,
      revealApproach: false,
      pointOutBugs: true,
      confirmApproachBeforeCoding: true,
      rules: [
        "Behave like a good real-world interviewer: engaged, curious, and willing to unblock rather than watch someone drown.",
        "Before they write code, ask them to walk through their approach and its complexity. Push back on it if it is wrong or wasteful, without handing over the right answer.",
        "When they are stuck, escalate gradually: first a clarifying question, then the case they are missing. Stop there. The technique itself is past what you may hand over unasked — offer it and wait, per the rule below.",
        "When tests fail, you may point at the category of the failure ('your handling of duplicates') but let them find the line.",
        "Ask at least one follow-up about complexity or a variant before ending.",
      ],
    };
  }
  return {
    score,
    band: "coaching",
    hintBudget: 99,
    nudgeAfter: 1,
    revealApproach: true,
    pointOutBugs: true,
    confirmApproachBeforeCoding: true,
    rules: [
      "This is a teaching session. Prioritize the candidate learning the pattern over evaluating them.",
      "Break the problem into steps and confirm each one before moving on.",
      "If they stall for even one turn, offer the next concrete step, and explain why it is the right one.",
      "When tests fail, walk them to the specific line and explain the defect.",
      "Name techniques explicitly and explain when the pattern generalizes.",
      "Still make them write the code. Do not paste a full solution unless they ask for it outright after a real attempt.",
    ],
  };
}

export function recommendedDifficulty(jobLevel: JobLevel): Difficulty {
  return JOB_LEVELS[jobLevel].difficultyBias;
}

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export const VERDICTS = [
  "strong_hire",
  "leaning_strong_hire",
  "hire",
  "leaning_hire",
  "neutral",
  "leaning_no_hire",
  "no_hire",
  "strong_no_hire",
] as const;

export const VERDICT_LABELS: Record<(typeof VERDICTS)[number], string> = {
  strong_hire: "Strong hire",
  leaning_strong_hire: "Leaning strong hire",
  hire: "Hire",
  leaning_hire: "Leaning hire",
  neutral: "Neutral",
  leaning_no_hire: "Leaning no hire",
  no_hire: "No hire",
  strong_no_hire: "Strong no hire",
};

const VERDICT_ANCHORS: Record<(typeof VERDICTS)[number], string> = {
  strong_hire: "Clearly above the bar. You would argue for them in the debrief and be surprised if the committee disagreed.",
  leaning_strong_hire: "Above the bar, with one reservation you can name specifically.",
  hire: "Meets the bar. You would vote yes without needing to argue.",
  leaning_hire: "Probably meets the bar, but the evidence is thin in at least one area you would want another interviewer to probe.",
  neutral: "Genuinely on the line. The interview did not produce enough signal to call it either way — say what was missing.",
  leaning_no_hire: "Probably below the bar, though something in the interview argues for them.",
  no_hire: "Below the bar. You would vote no and could point at why.",
  strong_no_hire: "Well below the bar, or something disqualifying: gave up, would not engage with the problem, would not test their own work, or was unable to write working code at all.",
};

export interface GradingBar {
  /** One line naming what is being measured. */
  headline: string;
  difficultyNote: string;
  helpNote: string;
  scaleAnchors: string[];
  verdictAnchors: string[];
}

/**
 * The rubric the grader is held to. Harshness is not a free parameter: it comes
 * from the target level's bar, how the question's difficulty sits relative to
 * that level's usual difficulty, and how much help the interviewer was allowed
 * to give.
 */
export function gradingBar(config: InterviewConfig): GradingBar {
  const level = JOB_LEVELS[config.jobLevel];
  const policy = helpPolicy(config);
  const stretch =
    DIFFICULTY_RANK[config.difficulty] - DIFFICULTY_RANK[level.difficultyBias];

  const difficultyNote =
    stretch < 0
      ? `This question is EASIER than the usual bar for ${level.label}. Reaching a correct solution is therefore table stakes and earns a 3 at most. The signal here is in speed, cleanliness, edge cases they anticipated without being asked, and the quality of the complexity discussion. Be harder to impress than you would be on a ${level.difficultyBias} question, and do not award a 4 or 5 for merely finishing.`
      : stretch > 0
        ? `This question is HARDER than the usual bar for ${level.label}. A partial solution with sound reasoning can still sit at or above the bar, and failing to finish is not by itself below the bar. Do not inflate for effort either — judge the quality of the reasoning, not the amount of it. Say explicitly in the debrief that the question was above level.`
        : `This question sits at the usual bar for ${level.label}. Expect a near-optimal solution reached substantially unaided, with edge cases handled and complexity stated correctly.`;

  const helpNote = `The interviewer was operating in the "${policy.band}" band (help score ${policy.score}/100) and could volunteer ${
    policy.hintBudget === 99 ? "unlimited" : policy.hintBudget
  } hint(s). Anything the interviewer supplied — an approach, a missed case, the location of a bug — is NOT evidence about the candidate. Subtract it before scoring, and name in the debrief what they would not have reached alone. Conversely, do not penalise a candidate for silence that the band caused: in the silent and sparse bands there was nobody to talk to.

Before you subtract anything, establish WHO ASKED. The candidate is accountable for help they sought and help they accepted; they are not accountable for help that arrived unbidden.
- Help they sought: they pressed the Hint button (it appears in the transcript as "Can I get a hint?"), asked a direct question about how to solve it, or said yes to an offer from the interviewer. Subtract it, and say so — this is the ordinary case.${
    policy.revealApproach
      ? ""
      : `
- Help nobody asked for: the interviewer named the technique, laid out the approach, or located a bug with no request and no accepted offer. At this help setting the interviewer was not permitted to do that, so it is the interview's error, not the candidate's. Do NOT lower any score for it, do NOT list it as a gap, and do NOT write it as something the candidate "needed". It is not a concession and carries none of the weight of one.
- What to do instead: that criterion loses its evidence from the moment of the leak. Score what the candidate demonstrated BEFORE it and say in helpAdjustment that the approach was volunteered unprompted. If too little was demonstrated beforehand to judge a criterion at all, say that plainly in the commentary and score it 3 as a non-judgement rather than inventing a number — a 3 recorded for this reason is explicitly NOT a below-the-bar signal and must not be read as one.
- If a criterion is unjudgeable for that reason and it mattered to the outcome, the honest verdict is "neutral", with the reason named: the interview did not produce the signal. Never convert missing signal into a penalty.`
  }`;

  return {
    headline: `${level.label} bar on a ${config.difficulty} question, in ${config.language}.`,
    difficultyNote,
    helpNote,
    scaleAnchors: [
      "1 — Did not demonstrate this at all, or demonstrated its opposite.",
      `2 — Below the bar: needed the interviewer to supply what a ${level.label} is expected to supply themselves.`,
      `3 — At the bar: exactly what a committee expects from a ${level.label} here. This is the default score, not a criticism.`,
      "4 — Above the bar: would be noted approvingly in a debrief.",
      "5 — Well above the bar: the thing you would quote to the committee. Rare; reserve it.",
    ],
    verdictAnchors: VERDICTS.map((v) => `${v} — ${VERDICT_ANCHORS[v]}`),
  };
}

export const CLOCK_MODES: Record<ClockMode, { label: string; blurb: string }> = {
  pausable: {
    label: "Pausable",
    blurb: "You can stop the clock whenever you want. Pausing hides the question and your code.",
  },
  strict: {
    label: "Strict",
    blurb:
      "The clock runs from the first question to the end, including if you close the tab. Closer to the real thing, and you can still tap out mid-interview to unlock pausing.",
  },
};

const HELP_ORDER: HelpLevel[] = ["none", "minimal", "balanced", "guided"];
const LEVEL_ORDER: JobLevel[] = ["intern", "entry", "mid", "senior", "staff"];

/** The next more helpful setting, or null if already at the most helpful. */
export function nextHelpLevel(help: HelpLevel): HelpLevel | null {
  const i = HELP_ORDER.indexOf(help);
  return i >= 0 && i < HELP_ORDER.length - 1 ? HELP_ORDER[i + 1] : null;
}

/** The next level down, or null if already at the lowest. */
export function nextLowerJobLevel(level: JobLevel): JobLevel | null {
  const i = LEVEL_ORDER.indexOf(level);
  return i > 0 ? LEVEL_ORDER[i - 1] : null;
}

/**
 * One "can I have a bit longer?", and how many times it may be asked.
 *
 * Five rather than ten: the usual need is a couple of minutes to finish typing
 * something you have already worked out, and charging ten for that overstates
 * what was taken. The ceiling is the same half hour either way — the finer step
 * just means the record says what actually happened.
 */
export const EXTENSION_MIN = 5;
export const MAX_EXTENSIONS = 6;

export interface ConcessionOption {
  kind: ConcessionKind;
  label: string;
  detail: string;
  /** What taking it costs, stated plainly before they take it. */
  cost: string;
  from: string;
  to: string;
}

/** What the candidate can still give themselves, given where they are now. */
export function availableConcessions(
  config: InterviewConfig,
  taken: Concession[] = [],
): ConcessionOption[] {
  const options: ConcessionOption[] = [];

  const extensions = taken.filter((c) => c.kind === "extend_time").length;
  if (extensions < MAX_EXTENSIONS) {
    options.push({
      kind: "extend_time",
      label: `Give me ${EXTENSION_MIN} more minutes`,
      detail:
        extensions === 0
          ? `Extends the interview to ${config.durationMin + EXTENSION_MIN} minutes. The interviewer paces itself against the new length.`
          : `Extends it again, to ${config.durationMin + EXTENSION_MIN} minutes. This would be extension ${extensions + 1} of ${MAX_EXTENSIONS}.`,
      cost:
        "Recorded with the minute you asked. The review judges the work against the time it actually took, not the time you were given.",
      from: `${config.durationMin} min`,
      to: `${config.durationMin + EXTENSION_MIN} min`,
    });
  }

  if (config.clockMode === "strict") {
    options.push({
      kind: "enable_pause",
      label: "Let me pause",
      detail: "Unlocks the pause button for the rest of the interview.",
      cost: "Recorded as a concession. The mildest of the three.",
      from: CLOCK_MODES.strict.label,
      to: CLOCK_MODES.pausable.label,
    });
  }

  const help = nextHelpLevel(config.helpLevel);
  if (help) {
    options.push({
      kind: "raise_help",
      label: "More help",
      detail: `The interviewer becomes ${HELP_LEVELS[help].label.toLowerCase()}: ${HELP_LEVELS[help].blurb.toLowerCase()}`,
      cost: "Anything the interviewer gives you from here is discounted from your result.",
      from: HELP_LEVELS[config.helpLevel].label,
      to: HELP_LEVELS[help].label,
    });
  }

  const level = nextLowerJobLevel(config.jobLevel);
  if (level) {
    options.push({
      kind: "lower_level",
      label: "Drop a level",
      detail: `Judge me at ${JOB_LEVELS[level].label.split(" (")[0]} instead. Also makes the interviewer slightly more forthcoming.`,
      cost: "You are graded at the lower bar, and the review says what it would have read as at the original one.",
      from: JOB_LEVELS[config.jobLevel].label.split(" (")[0],
      to: JOB_LEVELS[level].label.split(" (")[0],
    });
  }

  return options;
}

export function applyConcession(config: InterviewConfig, kind: ConcessionKind): InterviewConfig {
  switch (kind) {
    case "enable_pause":
      return { ...config, clockMode: "pausable" };
    case "raise_help": {
      const next = nextHelpLevel(config.helpLevel);
      return next ? { ...config, helpLevel: next } : config;
    }
    case "lower_level": {
      const next = nextLowerJobLevel(config.jobLevel);
      return next ? { ...config, jobLevel: next } : config;
    }
    case "extend_time":
      return { ...config, durationMin: config.durationMin + EXTENSION_MIN };
    default:
      return config;
  }
}

const CONCESSION_VERB: Record<ConcessionKind, string> = {
  enable_pause: "unlocked pausing",
  raise_help: "raised the interviewer's helpfulness",
  lower_level: "dropped the target level",
  extend_time: "took extra time",
};

export function describeConcession(c: Concession): string {
  return `t+${String(Math.max(0, Math.round(c.atMin))).padStart(2, "0")}m — ${
    CONCESSION_VERB[c.kind] ?? c.kind
  } from ${c.from} to ${c.to}`;
}

/**
 * What the grader is told about concessions. The verdict is measured against
 * the configuration the candidate finished at — that is what tapping out means
 * — but the debrief has to say what was given up and when.
 */
export function concessionNote(
  original: InterviewConfig,
  final: InterviewConfig,
  concessions: Concession[],
): string {
  if (concessions.length === 0) {
    return "The candidate took no concessions. They ran the whole interview at the settings they chose at the start.";
  }

  const earlyCutoff = Math.max(3, Math.round(original.durationMin / 4));
  const extensions = concessions.filter((c) => c.kind === "extend_time").length;
  const extraMinutes = final.durationMin - original.durationMin;

  return `The candidate eased the interview mid-session.

Started at: ${JOB_LEVELS[original.jobLevel].label}, ${HELP_LEVELS[original.helpLevel].label} help, ${CLOCK_MODES[original.clockMode].label.toLowerCase()} clock, ${original.durationMin} minutes.
Finished at: ${JOB_LEVELS[final.jobLevel].label}, ${HELP_LEVELS[final.helpLevel].label} help, ${CLOCK_MODES[final.clockMode].label.toLowerCase()} clock, ${final.durationMin} minutes.

Concessions taken:
${concessions.map((c) => `- ${describeConcession(c)}`).join("\n")}

How to weigh this:
- Score and decide against the FINAL configuration. That is the bar the candidate asked to be measured at, and it is the bar the rubric above describes.
- A concession is itself signal, and WHEN it was taken carries most of that signal. Before roughly t+${earlyCutoff}m, it says the candidate asked for the problem to be made easier before genuinely engaging with it. Late in the interview, after real attempts, it says much less and may say nothing against them at all.
- In the debrief, and in concessionReadout, state what this performance would have read as at the ORIGINAL bar. Never let the final verdict imply the original bar was met.${
    extraMinutes > 0
      ? `
- The candidate took ${extraMinutes} extra minutes across ${extensions} request${extensions === 1 ? "" : "s"}, taking the budget from ${original.durationMin} to ${final.durationMin} minutes. Judge the work against the time it ACTUALLY took. A solution that needed ${final.durationMin} minutes is not a ${original.durationMin}-minute solution, and a real loop would have been called at ${original.durationMin}. Say plainly in concessionReadout where they stood when the original time ran out — if they were far from working, that matters more than where they finished.`
      : ""
  }
- Do not moralise about it. Tapping out exists so a candidate can salvage a session rather than stall out; note it, weigh it, and move on.`;
}
