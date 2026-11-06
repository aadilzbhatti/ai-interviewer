export type Language = "python" | "javascript";

export type Difficulty = "easy" | "medium" | "hard";

/** Target job level the interview is calibrated for. */
export type JobLevel = "intern" | "entry" | "mid" | "senior" | "staff";

/** How much the interviewer is willing to help. */
export type HelpLevel = "none" | "minimal" | "balanced" | "guided";

export type RoleFocus =
  | "general"
  | "backend"
  | "frontend"
  | "data"
  | "infra"
  | "ml";

/**
 * How a candidate's result is judged. "validator" is for problems with more
 * than one correct answer — a topological order, any valid path — where the
 * question ships a checker instead of a fixed expected value.
 */
export type Comparison = "exact" | "sorted" | "set" | "approx" | "validator";

/** Where the question for a session comes from. */
/** "saved" replays a question generated in an earlier session. */
export type QuestionSource = "bank" | "generated" | "described" | "saved";

/**
 * "pausable" lets the candidate stop the clock. "strict" runs it continuously
 * from the first question, including across a closed tab.
 */
export type ClockMode = "pausable" | "strict";

/**
 * A mid-interview request to make the interview easier. Every one is recorded
 * with the minute it was taken, because when it was taken is most of the signal.
 */
export type ConcessionKind = "enable_pause" | "raise_help" | "lower_level" | "extend_time";

export interface Concession {
  kind: ConcessionKind;
  /** Elapsed interview minutes when it was taken. */
  atMin: number;
  /** Human-readable before and after, e.g. "Balanced" -> "Guided". */
  from: string;
  to: string;
}

export interface TestCase {
  name?: string;
  /** Positional arguments passed to the candidate's function. */
  args: unknown[];
  /** Ignored under "validator" comparison, where there is no single right answer. */
  expected: unknown;
  /** Hidden cases run but their inputs are not shown to the candidate. */
  hidden?: boolean;
}

export interface Question {
  id: string;
  title: string;
  /** Markdown shown to the candidate. */
  prompt: string;
  difficulty: Difficulty;
  jobLevels: JobLevel[];
  roles: RoleFocus[];
  topics: string[];
  functionName: string;
  starter: Record<Language, string>;
  /** Known-good solution; used to validate generated tests. */
  reference: Record<Language, string>;
  tests: TestCase[];
  comparison?: Comparison;
  /**
   * Under "validator" comparison: code defining check(args, output) -> bool,
   * per language. Run against the candidate's result to decide the case.
   */
  validator?: Record<Language, string>;
  /** Graduated hints, least to most revealing. */
  hints: string[];
  followUps: string[];
  optimal: { time: string; space: string };
  source: QuestionSource;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  hidden: boolean;
  args?: string;
  expected?: string;
  actual?: string;
  error?: string;
  durationMs: number;
}

export interface RunResult {
  ok: boolean;
  language: Language;
  passed: number;
  total: number;
  results: TestCaseResult[];
  stdout: string;
  error?: string;
  durationMs: number;
  at: number;
  /** Elapsed interview time when the run happened, excluding paused time. */
  elapsedMs?: number;
}

/**
 * One private run of the candidate's own code.
 *
 * Deliberately not a RunResult: it has no cases, no pass count, and never
 * enters `runs`. The interviewer is not told it happened, because a candidate
 * poking at their own function is not an event in the room — it is what
 * anyone writing code does, and charging them for it pushed people into
 * pressing "Run tests" to find a typo.
 */
export interface ScratchResult {
  ok: boolean;
  language: Language;
  /** Which step failed: compiling their file, running it, or the call expression. */
  phase?: "compile" | "run" | "call";
  error?: string;
  /** Line and column in THEIR file, when the failure could be pinned down. */
  where?: { line: number; column: number };
  stdout: string;
  /** Serialized return value, present only when a call expression was given. */
  value?: string;
  hasValue?: boolean;
  /** The expression that produced it, echoed back for the output pane. */
  call?: string;
  durationMs: number;
  /** Wall clock, matching RunResult. */
  at: number;
}

export interface InterviewConfig {
  difficulty: Difficulty;
  jobLevel: JobLevel;
  helpLevel: HelpLevel;
  role: RoleFocus;
  language: Language;
  durationMin: number;
  clockMode: ClockMode;
  source: QuestionSource;
  /** Free text the candidate wrote when source is "described". */
  seedDescription: string;
  /** Which library question to replay, when source is "saved". */
  savedQuestionId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Structured event rendered differently (test runs, phase changes). */
  event?: "run" | "phase";
  /** Wall clock. */
  at: number;
  /** Elapsed interview time, which excludes anything spent paused. */
  elapsedMs?: number;
}

/** Eight-point hiring scale, strongest first. */
export type Verdict =
  | "strong_hire"
  | "leaning_strong_hire"
  | "hire"
  | "leaning_hire"
  | "neutral"
  | "leaning_no_hire"
  | "no_hire"
  | "strong_no_hire";

export type CriterionKey =
  | "problemSolving"
  | "codeQuality"
  | "communication"
  | "testingRigor"
  | "complexityAnalysis";

export interface CriterionReview {
  /** 1-5, where 3 is exactly at the bar for the target level. */
  score: number;
  /** Why that score, citing what the candidate actually did. */
  commentary: string;
  /**
   * Set when the evidence for this criterion was destroyed by help the
   * candidate never asked for. A voided criterion is excluded from the verdict
   * ceiling entirely — missing signal is the interview's failure, not a debt
   * the candidate pays.
   */
  voided?: boolean;
}

export interface TimelineEntry {
  /** Minutes from the start of the interview. */
  atMin: number;
  what: string;
  /** What that moment indicated about the candidate. */
  signal: string;
  weight: "positive" | "negative" | "neutral";
}

export interface CodeReview {
  summary: string;
  correctness: string;
  complexity: string;
  readability: string;
  edgeCases: string;
  /** Concrete changes a reviewer would ask for before merging. */
  changeRequests: string[];
}

export interface Assessment {
  verdict: Verdict;
  headline: string;
  /** The standard this performance was measured against, stated plainly. */
  barJudgedAgainst: string;
  /** The written feedback an interviewer would submit to the hiring committee. */
  debrief: string;
  scores: Record<CriterionKey, CriterionReview>;
  codeReview: CodeReview;
  timeline: TimelineEntry[];
  strengths: string[];
  gaps: string[];
  coaching: string[];
  levelReadout: string;
  /** How much of the result belonged to the interviewer rather than the candidate. */
  helpAdjustment: string;
  /** How mid-interview concessions moved the verdict. Empty when none were taken. */
  concessionReadout: string;
  /**
   * Present only when the verdict the grader wrote did not survive its own
   * scores, or was not on the scale. Shown to the candidate: a report that
   * silently rewrites its own conclusion is no better than one that contradicts
   * itself.
   */
  verdictAdjustment?: { from: string; to: Verdict; reason: string };
}

export interface VetVerdict {
  approved: boolean;
  scores: {
    difficultyFit: number;
    levelFit: number;
    clarity: number;
    testCoverage: number;
    selfContained: number;
    /** Only scored when the candidate described the question themselves. */
    matchesRequest?: number;
  };
  assessedDifficulty: Difficulty;
  issues: string[];
  notes: string;
}

export interface InterviewSession {
  id: string;
  /** The live configuration, which concessions mutate. */
  config: InterviewConfig;
  /** What they signed up for, before any concession. */
  originalConfig: InterviewConfig;
  concessions: Concession[];
  question: Question;
  messages: ChatMessage[];
  code: Record<Language, string>;
  runs: RunResult[];
  hintsUsed: number;
  /**
   * How many times they ran their own code in the scratchpad. The count only —
   * never the code or its output, and never shown to the interviewer. It exists
   * so the grader can credit self-testing that would otherwise be invisible.
   */
  scratchRuns?: number;
  /** Wall clock at the first question, for display only. */
  startedAt: number;
  /** Active interview time banked so far, excluding anything spent paused. */
  accumulatedMs: number;
  paused: boolean;
  /** Relative path of the solution file written for this session, if any. */
  savedSolutionPath?: string;
  endedAt?: number;
  assessment?: Assessment;
  vetVerdict?: VetVerdict;
}
