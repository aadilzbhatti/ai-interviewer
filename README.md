# Mock Interviewer

An AI-run mock coding interview: a live interviewer in chat, a real editor beside it, and tests that
execute in your browser. You set the bar — target job level, difficulty, and how much help you want —
and you are graded against that bar afterwards.

## Setup

```bash
cp .env.local.example .env.local   # then paste your Anthropic API key into it
npm install
npm run dev                        # http://localhost:3100
```

Run `npm install` on the machine you will run the dev server on. Several dependencies
(`lightningcss` via Tailwind, `@next/swc`) ship platform-specific native binaries, so a
`node_modules` populated on one OS or architecture will fail on another with
`Cannot find module '../lightningcss.<platform>.node'`. The fix is always the same:

```bash
rm -rf node_modules package-lock.json .next && npm install
```

The only required variable is `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` optionally overrides the model
used by all four agents (interviewer, grader, question generator, question vetter).

## How it works

**Help is calibrated, not a toggle.** The help level (Silent / Minimal / Balanced / Guided) is
combined with the target job level into a 0–100 score, which selects one of four behavioural bands in
`src/lib/policy.ts`. Aiming at Staff subtracts 18 points; aiming at Intern adds 15. Each band gets a
different set of hard rules in the interviewer's system prompt — how many hints it may volunteer, how
long it waits before speaking, whether it may point at a bug, whether it asks for your approach before
you code. "Balanced at Senior" and "Balanced at Entry" are genuinely different interviews.

**The clock has two modes.** *Pausable* lets you stop it whenever you want; elapsed time is banked
segment by segment rather than derived from a start timestamp (`src/lib/timer.ts`), so resuming does
not back-charge you for the break. Pausing hides the question and your editor — a pause you can read
through is free thinking time, not a pause. Close the tab and the session comes back paused, because
the app cannot know how long you were gone and will not guess in its own favour. *Strict* runs the
clock continuously from the first question, including across a closed tab. Either way, every message
and test run is stamped with elapsed *interview* time, so a break never opens a fake gap in the
debrief's timeline.

**You can tap out mid-interview.** Better to salvage a session than stall out in it. The "Ease up"
control offers what is still available to you: unlock pausing if you are on a strict clock, raise the
interviewer's helpfulness a step, or drop the target level a step. Each states its cost before you
take it, and takes effect on the interviewer's very next turn.

Every concession is recorded with the minute you took it, and the review is told about all of them.
It grades you against the configuration you *finished* at — that is what tapping out means — but it
must name each concession, say what the performance would have read as at your original bar, and
never let the final verdict imply the original bar was met. When you took it matters most: the
grader is given a cutoff derived from the interview length, before which asking for the problem to be
made easier says you did not engage with it, and after which it says much less. It is also told not
to moralise about it.

**Code runs in your browser.** Python goes through Pyodide in a web worker, JavaScript through a
sandboxed worker. No server, no containers. Each question ships with visible and hidden test cases;
hidden cases run and report pass/fail without revealing their inputs. The worker sources are in
`public/workers/` and the comparison logic (`compare.js`, `harness.py`) is shared between the browser
and the validation scripts, so what the scripts verify is what the browser runs.

**Questions come from one of three places.**

- *Question bank* — 21 curated questions in `src/lib/questions/`, tagged by difficulty, job level,
  and role.
- *Generate a new one* — a generator agent writes one for your exact settings.
- *Describe it yourself* — you write a rough description of what you want to practice ("something
  with a sliding window where old entries expire") and it is built into a full question: worked
  example, constraints, visible and hidden tests, reference solutions, and a hint ladder.

The generated and described paths run the same gate. A separate vetting agent scores the question on
difficulty fit, level fit, clarity, test coverage, and self-containment — plus fidelity to your
description, when you wrote one — and can reject it, giving the generator one repair round. Then the
browser executes the reference solution against the generated tests before you ever see the question;
if they disagree, the generator gets one more attempt.

Two rules flip when you describe the question yourself. The generator is told not to substitute a
different problem because yours is well known, too easy, or too hard — you picked it deliberately —
and the vetter is told not to reject it for being a classic. In exchange the vetter starts judging
whether the question is actually the thing you asked for. When a described question cannot be built
soundly, the app stops and offers you a retry rather than quietly handing you a different question.

**The feedback is an interviewer's debrief, not a score card.** What comes back is the write-up an
interviewer would submit to a hiring committee: a verdict on an eight-point scale from strong hire to
strong no hire, 500-900 words of written analysis of both the conversation and the code, a 1-5 score
with written commentary under each of five criteria, a code review of your final solution with the
changes a reviewer would ask for, and a minute-by-minute timeline saying what each moment signalled.
Every judgement is required to cite evidence — something you said, something in your code, or a
specific test run.

**Harshness is derived, not vibes.** `gradingBar()` in `src/lib/policy.ts` builds the rubric from
three inputs. The target level supplies the bar. The question's difficulty *relative to that level's
usual difficulty* shifts it: an easy question at a senior bar makes correctness table stakes and
grades on speed, edge cases, and the complexity discussion instead, while a hard question at an entry
bar explicitly forgives not finishing without inflating for effort. The help band supplies the
discount: anything the interviewer handed you is not evidence about you, and in the silent bands you
are not penalised for a silence the format caused. The report opens by stating the bar it applied, so
"graded for senior" is never left vague.

**Solutions are saved as study files.** "Save solution" writes your code with the whole question
above it as a line-comment header: the problem statement, the signature, worked examples, every case
the tests cover, the complexity to beat, and the follow-ups — enough to reread the problem cold
months later without opening the app. No hints and no reference solution, so the file does not spoil
a re-practice. Files land in `<language>/<difficulty>/<snake_case>.py` under `SOLUTIONS_DIR`
(default `~/Documents/Workspace/interview-questions/solutions`). Saving happens on a button and
automatically when you end and grade; re-saving a session rewrites its own file rather than leaving
numbered copies. If the server cannot reach a disk — a deployed instance, a read-only volume — a
manual save falls back to a browser download.

**Debug logging.** `npm run dev:debug` sets `INTERVIEW_DEBUG_LOG=1`, which writes every raw model
request and response to `.logs/<date>/` plus an index at `.logs/calls.jsonl`. That covers each
generation round, each vetting verdict, the parse result of both, the approve/reject decision, every
interviewer turn, and the assessment — plus the in-browser execution check that verifies a generated
question, which happens in a worker and would otherwise be a hole in the trace. These files contain
full prompts; the directory is gitignored and the flag is off unless you set it.

**Generation shows real progress.** Building a question takes one to three minutes across two model
calls and an in-browser execution check, so the route streams NDJSON events as each phase begins and
the client renders a bar, a three-step checklist, an attempt counter, and — when a draft is sent back
— the reviewer's actual reason. The bar is driven by those events, not a timer: it never rewinds when
a draft is rejected, never stalls for more than ten seconds, and only reaches 100% when the question
is in hand. `src/lib/generationProgress.ts` holds the model; the invariants are asserted in
`validate:progress`.

**Trivial answers have to fail.** A fixed expected value pins an answer down, but a validator does
not — so a validator question can quietly accept "return the input unchanged" and never exercise the
algorithm. Before you see one, the browser runs three trivial solutions against it (return the input,
return it reversed, return an empty list). If any passes every case, the question goes back for a
repair. `src/lib/exec/adversaries.ts`.

**Questions can have more than one right answer.** Some good questions — return *any* valid
topological order, *any* shortest path — cannot be judged against a fixed expected value. Such a
question sets `comparison: "validator"` and ships a `check(args, output)` in both languages; the
harness runs it instead of comparing. The generator is told to take this route when you explicitly
asked for "any valid answer", and to constrain the problem to a single answer otherwise; the vetting
agent rejects a multi-answer question that does neither, and rejects a validator that does not really
verify.

## Verification

```bash
npm run validate             # all six of the below
npm run validate:bank        # every reference solution, in Python and JS, against its own tests
npm run validate:workers     # the actual worker files: happy path, syntax errors, missing functions,
                             # thrown exceptions, input mutation, stdout capture, tuple/array equality
npm run validate:calibration # described-question mode (which rules flip, and which do not), the
                             # stored-config migration, the help calibration, and the grading rubric
npm run validate:timer       # pause/resume arithmetic: idempotence, repeated cycles, restore from
                             # storage, backwards system clocks, formatting
npm run validate:solutions   # saved-file rendering (including a prompt full of comment delimiters),
                             # that the produced .py and .js actually compile, path sanitisation
                             # against traversal, and the save route against a real temp directory
npm run validate:progress    # the generation progress model: monotonicity across a revision, no
                             # long stalls, no early completion, and the checklist states
```

`validate:bank` executes all 21 questions in both languages — 42 runs, ~180 test cases — and also
checks structural invariants (hidden cases present, hint ladder long enough, starter code references
the right function name). It runs Python through the same `harness.py` the browser worker uses.

## Layout

```
src/lib/types.ts              domain model
src/lib/policy.ts             help/level calibration and the grading rubric — the core of the product
src/lib/prompts.ts            system prompts for all four agents
src/lib/questions/            the seed bank (easy/medium/hard) and selection
src/lib/timer.ts              pause/resume clock — pure, so the arithmetic is testable
src/lib/generationProgress.ts progress model for question generation — pure, event-driven
src/lib/solutionFile.ts       renders a saved solution and its question header
src/lib/solutionPaths.ts      sanitisation and containment for anything written to disk
src/lib/debugLog.ts           raw model request/response logging, off by default
src/lib/exec/runner.ts        client-side worker orchestration and timeouts
src/app/api/interviewer/      streaming interview turns
src/app/api/assess/           end-of-interview debrief, scored against the derived rubric
src/app/api/questions/generate/  generator + vetting agent, with one repair round
src/app/api/solutions/save/   writes a solution under SOLUTIONS_DIR
src/app/api/debug/log/        availability probe and a sink for client-side debug events
public/workers/               the sandboxes and the shared comparison logic
scripts/                      validation
```

## Known limits

- Python and JavaScript only; no third-party packages inside candidate solutions.
- Sessions are kept in `localStorage` — single browser, single user, no accounts. An in-progress
  interview resumes if you navigate away and come back, and comes back paused.
- The hint budget is enforced by the prompt, not by code.
- Voice is not implemented; the interviewer is text-only for now.
