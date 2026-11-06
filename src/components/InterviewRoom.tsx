"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CodeEditor from "@/components/CodeEditor";
import ChatPanel from "@/components/ChatPanel";
import TestResults from "@/components/TestResults";
import ScratchPanel from "@/components/ScratchPanel";
import QuestionCard from "@/components/QuestionCard";
import AssessmentReport from "@/components/AssessmentReport";
import { runTests, runScratch, warmUp, disposeRunners } from "@/lib/exec/runner";
import {
  startTimer,
  restoreTimer,
  restoreStrict,
  pauseTimer,
  resumeTimer,
  elapsedMs as elapsedOf,
  formatClock,
  type TimerState,
} from "@/lib/timer";
import { pickFromBank } from "@/lib/questions/index";
import { buildSolutionFile, solutionLocation } from "@/lib/solutionFile";
import { initClientDebug } from "@/lib/clientDebug";
import GenerationProgress from "@/components/GenerationProgress";
import GradingProgress from "@/components/GradingProgress";
import { type ProgressState } from "@/lib/generationProgress";
import {
  getJob,
  startJob,
  clearJob,
  cancelJob,
  jobMatches,
  subscribeJob,
} from "@/lib/generationJob";
import {
  initialGrading,
  applyGradingEvent,
  tickGrading,
  type GradingState,
  type GradingEvent,
} from "@/lib/gradingProgress";
import { noteBreadcrumb, setWatchContext, markWatchClean } from "@/lib/crashWatch";
import {
  helpPolicy,
  availableConcessions,
  applyConcession,
  HELP_LEVELS,
  JOB_LEVELS,
  EXTENSION_MIN,
  MAX_EXTENSIONS,
  type ConcessionOption,
} from "@/lib/policy";
import {
  clearSession,
  loadConfig,
  loadQuestion,
  loadSession,
  markQuestionPracticed,
  pushHistory,
  saveQuestion,
  saveReview,
  saveSession,
} from "@/lib/store";
import type {
  Assessment,
  ChatMessage,
  Concession,
  InterviewConfig,
  InterviewSession,
  Question,
  RunResult,
  ScratchResult,
  VetVerdict,
} from "@/lib/types";

type Trigger = "start" | "message" | "run" | "hint" | "done" | "concession";
type Phase = "loading" | "live" | "grading" | "done";

/**
 * Reads the assess route's NDJSON stream. Same line-buffering discipline as the
 * generator: a chunk boundary can fall anywhere, including mid-object.
 */
async function streamAssessment(
  payload: unknown,
  onEvent: (event: GradingEvent) => void,
): Promise<{ assessment?: Assessment; error?: string }> {
  const res = await fetch("/api/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return { error: text || `HTTP ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out: { assessment?: Assessment; error?: string } = {};

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: (GradingEvent & { assessment?: Assessment }) | undefined;
    try {
      event = JSON.parse(line);
    } catch {
      return; // one malformed line must not take the stream down
    }
    if (!event) return;
    if (event.type === "result") {
      out = { assessment: event.assessment };
    } else if (event.type === "error") {
      out = { error: event.message };
    }
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  handle(buffer);
  return out;
}

/** Fallback when the server cannot reach a disk of its own. */
function downloadFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default function InterviewRoom() {
  const router = useRouter();

  // Read once, on the client only — this component is never server-rendered.
  const [resumed] = useState<InterviewSession | null>(() => {
    const s = loadSession();
    return s && !s.endedAt && s.question ? s : null;
  });
  // `config` is live: tapping out mutates it mid-interview. `originalConfig` is
  // what they signed up for, and the review is told about both.
  const [config, setConfig] = useState<InterviewConfig | null>(
    () => resumed?.config ?? loadConfig(),
  );
  const [originalConfig] = useState<InterviewConfig | null>(
    () => resumed?.originalConfig ?? resumed?.config ?? loadConfig(),
  );
  const [concessions, setConcessions] = useState<Concession[]>(resumed?.concessions ?? []);
  const [easeOpen, setEaseOpen] = useState(false);
  const resumedStrict = !!resumed && resumed.config?.clockMode === "strict";
  const resumedCode =
    resumed && config
      ? resumed.code[config.language] ?? resumed.question.starter[config.language]
      : "";

  const [question, setQuestion] = useState<Question | null>(resumed?.question ?? null);
  const [verdict, setVerdict] = useState<VetVerdict | undefined>(resumed?.vetVerdict);
  const [messages, setMessages] = useState<ChatMessage[]>(resumed?.messages ?? []);
  const [code, setCode] = useState(resumedCode);
  const [runs, setRuns] = useState<RunResult[]>(resumed?.runs ?? []);
  const [hintsUsed, setHintsUsed] = useState(resumed?.hintsUsed ?? 0);
  // The scratchpad: private by construction. Only the COUNT survives into the
  // session, and only so the grader can credit self-testing — see the note it
  // is given. The code and output never leave this component.
  const [scratch, setScratch] = useState<ScratchResult | undefined>(undefined);
  const [scratching, setScratching] = useState(false);
  const [scratchCall, setScratchCall] = useState("");
  const [scratchRuns, setScratchRuns] = useState(resumed?.scratchRuns ?? 0);
  const scratchRunsRef = useRef(resumed?.scratchRuns ?? 0);
  const [pane, setPane] = useState<"tests" | "scratch">("tests");
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<Phase>(resumed ? "live" : "loading");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [note, setNote] = useState("Setting up…");
  const [fatal, setFatal] = useState<string | null>(null);
  const [buildFailure, setBuildFailure] = useState<string | null>(null);
  /** Something the build fixed rather than failed on, worth saying out loud. */
  const [buildNotice, setBuildNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(!resumedStrict);
  const [everResumed, setEverResumed] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(
    resumed?.savedSolutionPath ?? null,
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  /** Storage refused the session — usually the quota. The candidate must know. */
  const [saveFailed, setSaveFailed] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressRef = useRef<ProgressState | null>(null);
  const [gradeProgress, setGradeProgress] = useState<GradingState | null>(null);
  const gradeProgressRef = useRef<GradingState | null>(null);
  const [runWarning, setRunWarning] = useState(false);
  /** One reminder per interview. A nag on every run would be worse than none. */
  const runWarnedRef = useRef(false);

  const codeRef = useRef(resumedCode);
  const messagesRef = useRef<ChatMessage[]>(resumed?.messages ?? []);
  const runsRef = useRef<RunResult[]>(resumed?.runs ?? []);
  const hintsRef = useRef(resumed?.hintsUsed ?? 0);
  const startedRef = useRef(resumed?.startedAt ?? Date.now());
  // A restored session always comes back paused: we cannot know how long the
  // tab was closed, so the clock must not keep running through it.
  // A strict clock has no pause to hide behind: the time the tab was closed is
  // charged, and it keeps running.
  const timerRef = useRef<TimerState>(
    resumedStrict
      ? restoreStrict(resumed!.startedAt, Date.now())
      : restoreTimer(resumed?.accumulatedMs ?? 0),
  );
  const concessionsRef = useRef<Concession[]>(resumed?.concessions ?? []);
  const sessionIdRef = useRef(resumed?.id ?? uid());
  const bootedRef = useRef(false);
  const snapshotRef = useRef<InterviewSession | null>(null);
  const savedPathRef = useRef<string | null>(resumed?.savedSolutionPath ?? null);

  const elapsedMsNow = elapsedOf(timerRef.current, now);
  const elapsedMin = elapsedMsNow / 60000;

  /** Live elapsed time, for callbacks that must not wait for a render. */
  const readElapsed = useCallback(() => elapsedOf(timerRef.current, Date.now()), []);

  const pause = useCallback(() => {
    timerRef.current = pauseTimer(timerRef.current, Date.now());
    setPaused(true);
    noteBreadcrumb("paused");
  }, []);

  const resume = useCallback(() => {
    timerRef.current = resumeTimer(timerRef.current, Date.now());
    setPaused(false);
    setEverResumed(true);
    noteBreadcrumb("resumed");
  }, []);

  const pushMessage = useCallback((m: ChatMessage) => {
    messagesRef.current = [...messagesRef.current, m];
    setMessages(messagesRef.current);
  }, []);

  const setLastAssistant = useCallback((content: string) => {
    const arr = [...messagesRef.current];
    if (arr.length === 0) return;
    arr[arr.length - 1] = { ...arr[arr.length - 1], content };
    messagesRef.current = arr;
    setMessages(arr);
  }, []);

  const converse = useCallback(
    async (trigger: Trigger, q: Question, cfg: InterviewConfig) => {
      setStreaming(true);
      noteBreadcrumb(`interviewer turn (${trigger})`);
      try {
        const res = await fetch("/api/interviewer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: cfg,
            question: q,
            messages: messagesRef.current
              .filter((m) => !m.event)
              .map((m) => ({ role: m.role, content: m.content })),
            code: codeRef.current,
            lastRun: runsRef.current[runsRef.current.length - 1],
            hintsUsed: hintsRef.current,
            // Deliberately NOT scratchRuns: the interviewer is not told the
            // candidate has been running their own code, so it cannot react to
            // it, nudge on it, or hold it against them in the room.
            elapsedMin: readElapsed() / 60000,
            trigger,
            concessions: concessionsRef.current,
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
        }
        pushMessage({ id: uid(), role: "assistant", content: "", at: Date.now(), elapsedMs: readElapsed() });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setLastAssistant(acc);
        }
        if (!acc.trim()) setLastAssistant("_(The interviewer said nothing.)_");
      } catch (e) {
        pushMessage({
          id: uid(),
          role: "assistant",
          content: `_(Could not reach the interviewer: ${
            e instanceof Error ? e.message : String(e)
          })_`,
          at: Date.now(),
          elapsedMs: readElapsed(),
        });
      } finally {
        setStreaming(false);
      }
    },
    [pushMessage, setLastAssistant, readElapsed],
  );

  // ---- bootstrap -----------------------------------------------------------
  /** Opens the interview once a question is in hand, wherever it came from. */
  const openInterview = useCallback(
    (q: Question, v: VetVerdict | undefined, cfg: InterviewConfig) => {
      noteBreadcrumb(`question ready: ${q.title}`);
      codeRef.current = q.starter[cfg.language];
      startedRef.current = Date.now();
      timerRef.current = startTimer(Date.now());
      setPaused(false);
      setQuestion(q);
      setVerdict(v);
      setCode(codeRef.current);
      setPhase("live");
      void converse("start", q, cfg);
    },
    [converse],
  );

  /**
   * Acquires the question. Generation is handed to a background job so leaving
   * this screen does not throw the work away; the effect below adopts whatever
   * the job produces, whether or not anyone was watching when it finished.
   * `forceBank` is how the candidate escapes a failed build without losing
   * their settings.
   */
  const buildQuestion = useCallback(
    (cfg: InterviewConfig, forceBank: boolean) => {
      setBuildFailure(null);
      setBuildNotice(null);
      setPhase("loading");

      if (!forceBank && cfg.source === "saved") {
        const saved = cfg.savedQuestionId ? loadQuestion(cfg.savedQuestionId) : undefined;
        if (saved) {
          noteBreadcrumb(`replaying saved question: ${saved.question.title}`);
          openInterview(saved.question, undefined, cfg);
          return;
        }
        // Deleted from the library since the config was written. Say so rather
        // than silently handing over a different question.
        setNote("That saved question is no longer in your library. Falling back to the bank.");
      } else if (!forceBank && (cfg.source === "generated" || cfg.source === "described")) {
        setNote(
          cfg.source === "described"
            ? "Building the question you described…"
            : "Writing a question for your settings…",
        );
        const existing = getJob();
        // A stopped or failed job is not one to wait on — those start over.
        const adoptable = existing?.status === "running" || existing?.status === "done";
        if (existing && adoptable && jobMatches(cfg)) {
          // Already running, or already finished while we were elsewhere; the
          // subscription below picks it up either way.
          return;
        }
        clearJob();
        startJob(cfg);
        return;
      }

      const q = pickFromBank(cfg);
      if (!q) {
        setFatal("No question matched those settings.");
        return;
      }
      openInterview(q, undefined, cfg);
    },
    [openInterview],
  );

  /**
   * Mirrors the background job into this screen and adopts its result. Written
   * as a subscription rather than an await so a job that finished while the
   * candidate was on another page is picked up the moment they come back.
   */
  useEffect(() => {
    const sync = () => {
      const job = getJob();
      if (!job || phase !== "loading") return;
      setProgress(job.progress);
      progressRef.current = job.progress;
      if (job.notice) setBuildNotice(job.notice);

      if (job.status === "cancelled") {
        // Stopped on purpose, so there is nothing to report and nothing to
        // substitute: back to the settings that asked for it.
        clearJob();
        setProgress(null);
        progressRef.current = null;
        router.replace("/");
      } else if (job.status === "done" && job.question) {
        const cfg = job.config;
        const q = job.question;
        const v = job.verdict;
        clearJob();
        setProgress(null);
        progressRef.current = null;
        openInterview(q, v, cfg);
      } else if (job.status === "failed") {
        const cfg = job.config;
        const reason = job.error || "The generator failed.";
        const canFallBack = job.canFallBack;
        clearJob();
        setProgress(null);
        progressRef.current = null;
        if (!canFallBack) {
          // A question the candidate asked for is not interchangeable with a
          // random one, so never substitute quietly here.
          setBuildFailure(reason);
          return;
        }
        const fallback = pickFromBank(cfg);
        if (!fallback) {
          setFatal("No question matched those settings.");
          return;
        }
        setNote(`${reason} Falling back to the bank.`);
        openInterview(fallback, undefined, cfg);
      }
    };
    sync();
    return subscribeJob(sync);
  }, [phase, openInterview, router]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    const cfg = config;
    if (!cfg) {
      router.replace("/");
      return;
    }
    warmUp(cfg.language);
    void initClientDebug();
    if (resumed) {
      // A question generated before the library existed is only in the session
      // snapshot, which the next interview overwrites. Capture it on the way
      // past so resuming an in-flight interview also banks its question.
      const src = resumed.config?.source;
      if (resumed.question && (src === "generated" || src === "described")) {
        saveQuestion({
          id: resumed.question.id,
          at: resumed.startedAt || Date.now(),
          question: resumed.question,
          difficulty: resumed.config.difficulty,
          jobLevel: resumed.config.jobLevel,
          role: resumed.config.role,
          seedDescription:
            src === "described" ? resumed.config.seedDescription?.trim() || undefined : undefined,
        });
      }
      return;
    }
    // Kicking off the build is exactly what this effect is for: it drives two
    // external systems (the generator API and the Pyodide worker) and reports
    // progress. The only synchronous writes are the no-op resets and the first
    // progress note, so there is no cascade to avoid here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buildQuestion(cfg, false);
  }, [config, resumed, router, buildQuestion]);

  // ---- ticking clock -------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => disposeRunners(), []);

  // Creeps the grading bar between real events so a slow call still looks
  // alive. The generation bar is ticked by the background job itself, since it
  // has to keep moving whether or not this screen is mounted.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const grading = gradeProgressRef.current;
      if (grading && !grading.done && !grading.failed && grading.stage) {
        const next = tickGrading(grading, now);
        if (next !== grading) {
          gradeProgressRef.current = next;
          setGradeProgress(next);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Keeps the crash record labelled, so a postmortem says which phase died.
  useEffect(() => {
    setWatchContext({
      phase,
      sessionId: sessionIdRef.current,
      questionId: question?.id,
    });
  }, [phase, question]);

  // ---- persistence ---------------------------------------------------------
  // The snapshot is rebuilt synchronously so the pagehide flush below always
  // writes current state, but the write itself is debounced — this effect fires
  // on every keystroke in the editor.
  useEffect(() => {
    if (!config || !question || phase === "loading") return;
    snapshotRef.current = {
      id: sessionIdRef.current,
      config,
      originalConfig: originalConfig ?? config,
      concessions,
      question,
      messages,
      code: { ...question.starter, [config.language]: code },
      runs,
      hintsUsed,
      scratchRuns,
      startedAt: startedRef.current,
      accumulatedMs: readElapsed(),
      paused,
      savedSolutionPath: savedPath ?? undefined,
      endedAt: phase === "done" ? Date.now() : undefined,
      assessment: assessment ?? undefined,
      vetVerdict: verdict,
    };
    const t = setTimeout(() => {
      if (snapshotRef.current) setSaveFailed(!saveSession(snapshotRef.current));
    }, 400);
    return () => clearTimeout(t);
  }, [
    config,
    originalConfig,
    concessions,
    question,
    messages,
    code,
    runs,
    hintsUsed,
    scratchRuns,
    phase,
    assessment,
    verdict,
    paused,
    savedPath,
    readElapsed,
  ]);

  useEffect(() => {
    const flush = () => {
      if (!snapshotRef.current) return;
      setSaveFailed(
        !saveSession({ ...snapshotRef.current, accumulatedMs: readElapsed(), paused }),
      );
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [paused, readElapsed]);

  // ---- actions -------------------------------------------------------------
  /**
   * A real interviewer expects to hear the approach before they watch you
   * compile. Bands that ask for that (responsive, coaching) get one reminder;
   * the sparse and silent bands do not, because being left alone to sink or
   * swim is the whole point of those settings.
   */
  const handleRun = async () => {
    if (!question || !config || running || streaming) return;
    const spoken = messagesRef.current.some((m) => m.role === "user" && !m.event);
    if (helpPolicy(config).confirmApproachBeforeCoding && !spoken && !runWarnedRef.current) {
      setRunWarning(true);
      return;
    }
    await runNow();
  };

  const runNow = async () => {
    if (!question || !config || running || streaming) return;
    setRunWarning(false);
    setRunning(true);
    const result = await runTests({ language: config.language, code: codeRef.current, question });
    runsRef.current = [...runsRef.current, { ...result, elapsedMs: readElapsed() }];
    setRuns(runsRef.current);
    setRunning(false);
    noteBreadcrumb(
      result.error ? `ran tests — did not run` : `ran tests — ${result.passed}/${result.total}`,
    );
    pushMessage({
      id: uid(),
      role: "user",
      content: result.error ? "Ran the tests — they did not run" : `Ran the tests — ${result.passed}/${result.total} passing`,
      event: "run",
      at: Date.now(),
      elapsedMs: readElapsed(),
    });
    await converse("run", question, config);
  };

  /**
   * The private loop. Deliberately does none of the things runNow does: no
   * entry in `runs`, no chat message, no `converse` call, no breadcrumb naming
   * what they tried. The interviewer cannot react to something it is never
   * told about, which is the whole feature.
   */
  const handleScratch = async () => {
    if (!config || running || scratching || paused) return;
    setPane("scratch");
    setScratching(true);
    const result = await runScratch({
      language: config.language,
      code: codeRef.current,
      call: scratchCall,
    });
    setScratch(result);
    setScratching(false);
    scratchRunsRef.current += 1;
    setScratchRuns(scratchRunsRef.current);
  };

  const handleSend = async (text: string) => {
    if (!question || !config) return;
    pushMessage({ id: uid(), role: "user", content: text, at: Date.now(), elapsedMs: readElapsed() });
    await converse("message", question, config);
  };

  const handleHint = async () => {
    if (!question || !config || streaming) return;
    hintsRef.current += 1;
    setHintsUsed(hintsRef.current);
    pushMessage({ id: uid(), role: "user", content: "Can I get a hint?", at: Date.now(), elapsedMs: readElapsed() });
    await converse("hint", question, config);
  };

  const handleDone = async () => {
    if (!question || !config || streaming) return;
    pushMessage({ id: uid(), role: "user", content: "I think I'm done.", at: Date.now(), elapsedMs: readElapsed() });
    await converse("done", question, config);
  };

  /**
   * Writes the solution with the whole question above it as a comment. Re-saving
   * the same session rewrites its own file rather than leaving a trail of
   * numbered copies; if the server cannot reach the disk (a deployed instance,
   * a read-only volume) a manual save falls back to a download.
   */
  const saveSolution = useCallback(
    async (mode: "manual" | "auto") => {
      if (!question || !config) return;
      const q = question;
      const cfg = config;

      const content = buildSolutionFile({ question: q, config: cfg, code: codeRef.current });
      const location = solutionLocation(q, cfg);
      setSaveState("saving");
      setSaveMessage("Saving…");

      try {
        const res = await fetch("/api/solutions/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...location,
            content,
            overwritePath: savedPathRef.current ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        savedPathRef.current = data.path as string;
        setSavedPath(data.path as string);
        setSaveState("saved");
        setSaveMessage(`Saved to ${data.path}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setSaveState("error");
        if (mode === "manual") {
          downloadFile(location.filename, content);
          setSaveMessage(`Could not write to disk (${message}) — downloaded instead.`);
        } else {
          setSaveMessage(`Could not save to disk: ${message}`);
        }
      }
    },
    [question, config],
  );

  /**
   * Tapping out. The live config changes immediately so the interviewer's very
   * next turn runs under the easier rules, and the concession is recorded with
   * the minute it was taken — which is most of what the review weighs.
   */
  const handleConcede = async (option: ConcessionOption) => {
    if (!question || !config || streaming || running || paused) return;
    const next = applyConcession(config, option.kind);
    const entry: Concession = {
      kind: option.kind,
      atMin: readElapsed() / 60000,
      from: option.from,
      to: option.to,
    };
    concessionsRef.current = [...concessionsRef.current, entry];
    setConcessions(concessionsRef.current);
    setConfig(next);
    setEaseOpen(false);
    pushMessage({
      id: uid(),
      role: "user",
      content: `Eased up — ${option.label.toLowerCase()}: ${option.from} → ${option.to}`,
      event: "phase",
      at: Date.now(),
      elapsedMs: readElapsed(),
    });
    await converse("concession", question, next);
  };

  const handleGrade = async () => {
    if (!question || !config) return;
    // Save first: the code is worth keeping even if grading then fails.
    void saveSolution("auto");
    noteBreadcrumb("grading started");
    setPhase("grading");

    const pushGradeEvent = (event: GradingEvent) => {
      const base = gradeProgressRef.current ?? initialGrading(Date.now());
      const next = applyGradingEvent(base, event, Date.now());
      gradeProgressRef.current = next;
      setGradeProgress(next);
    };

    gradeProgressRef.current = initialGrading(Date.now());
    setGradeProgress(gradeProgressRef.current);

    try {
      const { assessment: graded, error } = await streamAssessment(
        {
          config,
          originalConfig: originalConfig ?? config,
          concessions: concessionsRef.current,
          question,
          messages: messagesRef.current.filter((m) => !m.event),
          code: codeRef.current,
          runs: runsRef.current,
          hintsUsed: hintsRef.current,
          scratchRuns: scratchRunsRef.current,
          elapsedMin: readElapsed() / 60000,
          startedAt: startedRef.current,
        },
        pushGradeEvent,
      );
      if (error) throw new Error(error);
      if (!graded) throw new Error("The grader returned nothing.");

      noteBreadcrumb(`graded: ${graded.verdict}`);
      setAssessment(graded);
      const last = runsRef.current[runsRef.current.length - 1];
      const passed = last ? `${last.passed}/${last.total}` : undefined;
      pushHistory({
        id: sessionIdRef.current,
        title: question.title,
        questionId: question.id,
        at: Date.now(),
        verdict: graded.verdict,
        passed,
        jobLevel: config.jobLevel,
        difficulty: config.difficulty,
      });
      // The session snapshot is overwritten by the next interview, so the
      // review is kept separately or it is gone the moment you start another.
      saveReview({
        id: sessionIdRef.current,
        at: Date.now(),
        title: question.title,
        questionId: question.id,
        language: config.language,
        difficulty: config.difficulty,
        jobLevel: config.jobLevel,
        verdict: graded.verdict,
        passed,
        elapsedMin: readElapsed() / 60000,
        savedSolutionPath: savedPathRef.current ?? undefined,
        assessment: graded,
        question,
        code: codeRef.current,
      });
      // So the library can show which ones have actually been attempted.
      markQuestionPracticed(question.id);
      setPhase("done");
      markWatchClean();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      noteBreadcrumb(`grading failed: ${message}`);
      setFatal(`Grading failed: ${message}`);
      setGradeProgress(null);
      gradeProgressRef.current = null;
      setPhase("live");
    }
  };

  // ---- render --------------------------------------------------------------
  if (fatal && phase === "loading") {
    return (
      <Centered>
        <p className="text-sm text-[var(--bad)]">{fatal}</p>
        <button onClick={() => router.replace("/")} className="mt-4 text-sm text-[var(--accent)] hover:underline">
          Back to setup
        </button>
      </Centered>
    );
  }

  if (buildFailure && config && phase === "loading") {
    return (
      <Centered>
        <h1 className="text-lg font-medium">Could not build that question</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">{buildFailure}</p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--muted)]">
          Rather than hand you a different question than the one you asked for, it stopped here. Trying
          again often works — the generator is not deterministic.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => void buildQuestion(config, false)}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#04121f] hover:brightness-110"
          >
            Try again
          </button>
          <button
            onClick={() => void buildQuestion(config, true)}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-[var(--panel-2)]"
          >
            Use a bank question
          </button>
          <button
            onClick={() => router.replace("/")}
            className="rounded-lg px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
          >
            Edit my description
          </button>
        </div>
      </Centered>
    );
  }

  if (phase === "loading" || !config || !question) {
    if (progress) {
      return (
        <Centered>
          <GenerationProgress
            state={progress}
            headline={
              config?.source === "described" ? "Building your question" : "Writing your question"
            }
            elapsedMs={Math.max(0, now - progress.startedAt)}
            notice={buildNotice}
          />
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="rounded-lg border px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
              title="The build keeps running. Pick the question up from your library when it is ready."
            >
              Continue in the background
            </button>
            <button
              onClick={() => cancelJob()}
              className="rounded-lg px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--bad)]"
              title="Ends the build now. The half-finished question is discarded."
            >
              Stop building
            </button>
          </div>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-[var(--muted)]/70">
            It carries on while you do something else, and lands in your library when it is done.
            Reloading the page is what would stop it.
          </p>
        </Centered>
      );
    }
    return (
      <Centered>
        <div className="flex items-center gap-2.5 text-sm text-[var(--muted)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
          {note}
        </div>
      </Centered>
    );
  }

  if (phase === "grading" && gradeProgress) {
    return (
      <Centered>
        <GradingProgress
          state={gradeProgress}
          elapsedMs={Math.max(0, now - gradeProgress.startedAt)}
        />
        <p className="mt-8 max-w-sm text-xs leading-relaxed text-[var(--muted)]">
          Your solution has already been saved. Leaving this page will not lose your work, but the
          review has to be written in one pass, so it would have to start again.
        </p>
      </Centered>
    );
  }

  if (phase === "done" && assessment) {
    return (
      <AssessmentReport
        assessment={assessment}
        concessions={concessions}
        question={question}
        language={config.language}
        code={codeRef.current}
        savedPath={savedPath}
        saveMessage={saveMessage}
        saving={saveState === "saving"}
        onSave={() => void saveSolution("manual")}
        onRestart={() => {
          clearSession();
          router.push("/");
        }}
      />
    );
  }

  const policy = helpPolicy(config);
  const lastRun = runs[runs.length - 1];
  const overtime = elapsedMin > config.durationMin;
  const pausable = config.clockMode === "pausable";
  const allConcessions = availableConcessions(config, concessions);
  // Extra time is split out of the Ease-up menu and given its own control next
  // to the clock. Needing five more minutes to finish typing something you have
  // already worked out is not the same act as lowering your target level, and
  // burying it three clicks deep behind "Ease up" meant people ran out of time
  // rather than found it. It is still recorded and still weighed — see the
  // grading note — it is just no longer hidden.
  const extendOption = allConcessions.find((o) => o.kind === "extend_time");
  const easeOptions = allConcessions.filter((o) => o.kind !== "extend_time");
  const extensionsTaken = concessions.filter((c) => c.kind === "extend_time").length;
  // Paused blocks every action that would advance the interview; ending it is
  // deliberately still allowed.
  const frozen = paused || streaming || running;

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-[var(--panel)] px-4 py-2.5">
        <button
          onClick={() => {
            if (confirm("Leave this interview? Your progress is saved and can be resumed.")) router.push("/");
          }}
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          ←
        </button>
        <span className="text-sm font-medium">{question.title}</span>
        <span className="hidden text-xs text-[var(--muted)] sm:inline">
          {JOB_LEVELS[config.jobLevel].label.split(" (")[0]} · {config.difficulty} ·{" "}
          {HELP_LEVELS[config.helpLevel].label} ({policy.score}/100)
        </span>
        {concessions.length > 0 && (
          <span
            className="rounded border border-[var(--warn)]/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--warn)]"
            title={concessions.map((c) => `${c.from} → ${c.to}`).join("; ")}
          >
            eased ×{concessions.length}
          </span>
        )}

        <span
          className={`ml-auto flex items-center gap-1.5 text-sm tabular-nums ${
            paused
              ? "text-[var(--muted)]/60"
              : overtime
                ? "text-[var(--warn)]"
                : "text-[var(--muted)]"
          }`}
          title={paused ? "The clock is stopped" : undefined}
        >
          {paused && <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />}
          {formatClock(elapsedMsNow)} / {config.durationMin}:00
        </span>

        {extendOption && phase !== "grading" && (
          <button
            onClick={() => void handleConcede(extendOption)}
            disabled={frozen}
            className={`rounded-lg border px-2 py-1 text-xs tabular-nums disabled:opacity-40 ${
              overtime
                ? "border-[var(--warn)]/60 bg-[var(--warn)]/10 text-[var(--warn)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
            title={`Adds ${EXTENSION_MIN} minutes (${extensionsTaken} of ${MAX_EXTENSIONS} used). Recorded with the minute you asked, and the review judges the work against the time it actually took.`}
          >
            +{EXTENSION_MIN}m
          </button>
        )}

        <div className="flex items-center gap-1.5">
          {pausable ? (
            <button
              onClick={paused ? resume : pause}
              disabled={streaming || running || phase === "grading"}
              className={`rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40 ${
                paused
                  ? "border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[var(--warn)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
              title={paused ? "Restart the clock and carry on" : "Stop the clock and hide the question"}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          ) : (
            <span
              className="rounded-lg border px-2.5 py-1.5 text-xs text-[var(--muted)]/60"
              title="Strict clock — it runs continuously. You can tap out below to unlock pausing."
            >
              Strict
            </span>
          )}

          {easeOptions.length > 0 && phase !== "grading" && (
            <div className="relative">
              <button
                onClick={() => setEaseOpen((o) => !o)}
                disabled={frozen}
                className="rounded-lg border px-2.5 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
                title="Make the rest of the interview easier. Recorded in your review."
              >
                Ease up
              </button>
              {easeOpen && (
                <EasePanel
                  options={easeOptions}
                  onPick={handleConcede}
                  onClose={() => setEaseOpen(false)}
                />
              )}
            </div>
          )}
          <button
            onClick={handleHint}
            disabled={frozen}
            className="rounded-lg border px-2.5 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            title={
              policy.hintBudget === 0
                ? "This help level gives no hints — the interviewer will decline."
                : `Hints used: ${hintsUsed}`
            }
          >
            Hint{hintsUsed > 0 ? ` (${hintsUsed})` : ""}
          </button>
          <button
            onClick={() => void handleScratch()}
            disabled={paused || running || scratching}
            className="rounded-lg border px-2.5 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            title="Run your own code privately. The interviewer is not told, and it costs you nothing."
          >
            {scratching ? "Trying…" : "Try it"}
          </button>
          <button
            onClick={handleRun}
            disabled={frozen || scratching}
            className="rounded-lg border border-[var(--accent)]/50 bg-[var(--accent)]/10 px-3 py-1.5 text-xs text-[var(--accent)] disabled:opacity-40"
          >
            {running ? "Running…" : "Run tests"}
          </button>
          <button
            onClick={handleDone}
            disabled={frozen}
            className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40"
          >
            I&apos;m done
          </button>
          <button
            onClick={handleGrade}
            disabled={streaming || running || phase === "grading"}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[#04121f] disabled:opacity-40"
          >
            {phase === "grading" ? "Grading…" : "End & grade"}
          </button>
        </div>
      </header>

      {fatal && (
        <div className="shrink-0 border-b border-[var(--bad)]/40 bg-[var(--bad)]/10 px-4 py-2 text-xs text-[var(--bad)]">
          {fatal}
        </div>
      )}

      {saveFailed && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--bad)]/40 bg-[var(--bad)]/10 px-4 py-2 text-xs text-[var(--bad)]">
          <span className="min-w-0 flex-1">
            This interview is <strong>not being saved</strong> — the browser refused to store it,
            usually because the space for this site is full. Closing the tab will lose your code.
            Save the solution to disk now.
          </span>
          <button
            onClick={() => void saveSolution("manual")}
            className="shrink-0 rounded-lg border border-[var(--bad)]/50 px-2.5 py-1 text-xs hover:bg-[var(--bad)]/10"
          >
            Save solution to disk
          </button>
        </div>
      )}

      <main className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {paused && <PauseCurtain elapsedMs={elapsedMsNow} restored={!everResumed} onResume={resume} />}
        {runWarning && (
          <RunWarning
            band={policy.band}
            onDiscuss={() => {
              runWarnedRef.current = true;
              setRunWarning(false);
            }}
            onRunAnyway={() => {
              runWarnedRef.current = true;
              void runNow();
            }}
          />
        )}
        <section className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
          <QuestionCard question={question} verdict={verdict} />
          <ChatPanel
            messages={messages}
            streaming={streaming}
            disabled={frozen || phase === "grading"}
            placeholder={
              phase === "grading"
                ? "Grading…"
                : paused
                  ? "Paused"
                  : streaming
                    ? "The interviewer is replying…"
                    : running
                      ? "Running your tests…"
                      : "Talk through your thinking…"
            }
            onSend={handleSend}
          />
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <CodeEditor
              language={config.language}
              value={code}
              readOnly={paused}
              onChange={(v) => {
                codeRef.current = v;
                setCode(v);
              }}
            />
          </div>
          <div className="flex h-[38%] min-h-0 shrink-0 flex-col border-t bg-[var(--panel)]">
            <div className="flex shrink-0 items-center gap-1 border-b px-2">
              <PaneTab active={pane === "tests"} onClick={() => setPane("tests")}>
                Tests
                {lastRun && !lastRun.error && (
                  <span
                    className={`ml-1.5 tabular-nums ${
                      lastRun.passed === lastRun.total ? "text-[var(--ok)]" : "text-[var(--warn)]"
                    }`}
                  >
                    {lastRun.passed}/{lastRun.total}
                  </span>
                )}
              </PaneTab>
              <PaneTab active={pane === "scratch"} onClick={() => setPane("scratch")}>
                Scratchpad
                {scratchRuns > 0 && (
                  <span className="ml-1.5 tabular-nums text-[var(--muted)]">{scratchRuns}</span>
                )}
              </PaneTab>
              <span className="ml-auto pr-1 text-[10px] text-[var(--muted)]/60">
                {pane === "scratch" ? "private — the interviewer sees none of this" : "part of the interview"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              {pane === "tests" ? (
                <TestResults run={lastRun} running={running} />
              ) : (
                <ScratchPanel
                  language={config.language}
                  functionName={question.functionName}
                  result={scratch}
                  running={scratching}
                  call={scratchCall}
                  onCallChange={setScratchCall}
                  onRun={() => void handleScratch()}
                  disabled={paused || running || scratching}
                  runs={scratchRuns}
                />
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t bg-[var(--panel)] px-3 py-1.5">
            <button
              onClick={() => void saveSolution("manual")}
              disabled={saveState === "saving"}
              className="shrink-0 rounded-lg border px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
              title="Write this solution to disk with the question above it as a comment"
            >
              {saveState === "saving" ? "Saving…" : savedPath ? "Save again" : "Save solution"}
            </button>
            <span
              className={`min-w-0 flex-1 truncate text-xs ${
                saveState === "error" ? "text-[var(--warn)]" : "text-[var(--muted)]"
              }`}
              title={saveMessage}
            >
              {saveMessage}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Tapping out mid-interview. Each option states what it costs before it is
 * taken — the point is an informed trade, not a free escape hatch.
 */
function EasePanel({
  options,
  onPick,
  onClose,
}: {
  options: ConcessionOption[];
  onPick: (o: ConcessionOption) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border bg-[var(--panel)] p-3 shadow-2xl">
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          Ease up
        </div>
        <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
          Better than stalling out. Each of these is recorded with the minute you took it, and the
          review weighs it — taking one late after real attempts costs far less than taking one early.
        </p>
        <ul className="space-y-1.5">
          {options.map((o) => (
            <li key={o.kind}>
              <button
                onClick={() => onPick(o)}
                className="w-full rounded-lg border bg-[var(--panel-2)] p-2.5 text-left transition hover:border-[var(--accent)]"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className="text-[11px] tabular-nums text-[var(--muted)]">
                    {o.from} → {o.to}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{o.detail}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]/80">{o.cost}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * Shown once, when the candidate reaches for the test runner without having
 * said anything yet. Not a blocker — running is still one click — but silence
 * followed by code is one of the most commonly marked-down patterns in a real
 * interview, and the review will notice it whether or not we do.
 */
function RunWarning({
  band,
  onDiscuss,
  onRunAnyway,
}: {
  band: string;
  onDiscuss: () => void;
  onRunAnyway: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--bg)]/85 px-6 backdrop-blur-sm">
      <div className="max-w-md rounded-xl border bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--warn)]/40 px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-[var(--warn)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
          Before you run
        </div>
        <h2 className="text-lg font-medium">You haven&apos;t talked through your approach yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          At the <span className="text-[var(--text)]">{band}</span> setting, the interviewer expects
          to hear your plan and its complexity before you start proving it with the test runner.
          Jumping straight to running is scored as weak communication, and you lose the chance to be
          steered off a wrong approach while it is still cheap.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Say what you intend to do and why, then run.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onDiscuss}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#04121f] hover:brightness-110"
          >
            Let me explain first
          </button>
          <button
            onClick={onRunAnyway}
            className="rounded-lg border px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
          >
            Run anyway
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]/70">
          You will only be asked this once.
        </p>
      </div>
    </div>
  );
}

/**
 * Pausing hides the question and the editor on purpose. A paused clock while
 * you keep reading the problem is not a pause, it is free thinking time.
 */
function PauseCurtain({
  elapsedMs,
  restored,
  onResume,
}: {
  elapsedMs: number;
  restored: boolean;
  onResume: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--bg)]/90 px-6 backdrop-blur-md">
      <div className="max-w-sm text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--warn)]/40 px-3 py-1 text-xs text-[var(--warn)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
          Clock stopped
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          {restored ? "Picked up where you left off" : "Paused"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          {restored
            ? "Your interview was restored. The clock has been stopped since you left, so the time away does not count against you."
            : "The question and your code are hidden while the clock is stopped — a pause you can read through is not a pause."}
        </p>
        <p className="mt-4 text-sm tabular-nums text-[var(--muted)]">
          {formatClock(elapsedMs)} elapsed
        </p>
        <button
          onClick={onResume}
          className="mt-5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#04121f] hover:brightness-110"
        >
          Resume
        </button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[100dvh] flex-col items-center justify-center px-6 text-center">{children}</div>;
}

/** The two halves of the bottom pane: what the interview sees, and what it does not. */
function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs ${
        active
          ? "border-[var(--accent)] text-[var(--text)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}
