/**
 * Server-side storage: nothing saved is lost, and two browsers agree.
 *
 * History used to live only in one browser's localStorage, capped, so a cleared
 * profile, a second device or the 21st interview lost it. This suite drives the
 * real route handler against a temp directory, with two simulated browsers that
 * each have their own localStorage, and checks the rules that keep it safe:
 * last write wins, a delete is a tombstone plus a copy in .trash, a cap is not a
 * delete, an unreachable server loses nothing, and an old browser cannot
 * overwrite newer work.
 *
 * Run with: npm run validate:storage
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  shouldApply,
  shouldTakeRemote,
  envelopeError,
  seedTime,
  unionById,
  upsertCapped,
  trimSession,
  type Envelope,
} from "../src/lib/syncModel";
import { DiskStore } from "../src/lib/storageDisk";
import { GET, POST } from "../src/app/api/storage/route";
import {
  saveReview,
  loadReviews,
  saveQuestion,
  loadQuestions,
  markQuestionPracticed,
  deleteReview,
  saveSession,
  loadSession,
  clearSession,
  saveConfig,
  loadConfig,
  pushHistory,
  loadHistory,
  restoreSession,
  pendingChanges,
  seedOutbox,
  loadSyncState,
  saveSyncState,
  setChangeListener,
  DEFAULT_CONFIG,
  type SavedReview,
  type SavedQuestion,
} from "../src/lib/store";
import { syncNow, getSyncStatus, fetchCollection, fetchRecord, handleLocalChange } from "../src/lib/sync";
import type { InterviewSession, Question } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

// ---- fixtures ----------------------------------------------------------------
const question = (id: string, title = id): Question =>
  ({ id, title, starter: { python: "", javascript: "" } }) as unknown as Question;

const savedQ = (id: string, at: number, extra: Partial<SavedQuestion> = {}): SavedQuestion => ({
  id,
  at,
  question: question(id),
  difficulty: "medium",
  jobLevel: "mid",
  role: "general",
  ...extra,
});

const review = (id: string, at: number): SavedReview =>
  ({
    id,
    at,
    title: `Review ${id}`,
    questionId: "q1",
    language: "python",
    difficulty: "medium",
    jobLevel: "mid",
    elapsedMin: 30,
    assessment: {} as never,
    question: question("q1"),
    code: "def f(): pass",
  }) as SavedReview;

const session = (id: string, code: string, startedAt = 1_000): InterviewSession =>
  ({
    id,
    config: DEFAULT_CONFIG,
    originalConfig: DEFAULT_CONFIG,
    concessions: [],
    question: question("q1", "Shelf capacity"),
    messages: [{ role: "assistant", content: "hi" }],
    code: { python: code, javascript: "" },
    runs: [{ at: 1, results: [{ name: "case 1", pass: true }], stdout: "lots of output" }],
    hintsUsed: 0,
    startedAt,
    accumulatedMs: 60_000,
    paused: false,
  }) as unknown as InterviewSession;

// ---- the pure rules ------------------------------------------------------------
{
  check("lww: newer wins", shouldApply({ updatedAt: 5 }, { updatedAt: 6 }));
  check("lww: older loses", !shouldApply({ updatedAt: 6 }, { updatedAt: 5 }));
  check("lww: first write applies", shouldApply(undefined, { updatedAt: 0 }));
  check("lww: an identical resend is a no-op", !shouldApply({ updatedAt: 5 }, { updatedAt: 5 }));
  check("lww: on a tie a delete beats a write", shouldApply({ updatedAt: 5 }, { updatedAt: 5, deleted: true }));
  check("lww: on a tie a write does not undo a delete", !shouldApply({ updatedAt: 5, deleted: true }, { updatedAt: 5 }));

  check("pull: no unsent change takes the server's", shouldTakeRemote(undefined, { updatedAt: 1 }));
  check("pull: an unsent newer edit is kept", !shouldTakeRemote({ at: 9 }, { updatedAt: 5 }));
  check("pull: a newer server version beats an unsent edit", shouldTakeRemote({ at: 5 }, { updatedAt: 9 }));

  const env = (e: Partial<Envelope>) => envelopeError({ collection: "reviews", id: "r1", updatedAt: 1, value: { id: "r1" }, ...e });
  check("ids: a normal id is fine", env({}) === null);
  check("ids: a uuid is fine", env({ id: "3f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f", value: {} }) === null);
  for (const bad of ["../etc/passwd", "a/b", ".hidden", "", "a\\b", "x".repeat(200)]) {
    check(`ids: refuses ${JSON.stringify(bad.slice(0, 20))}`, env({ id: bad }) !== null);
  }
  check("envelope: unknown collection refused", env({ collection: "passwords" as never }) !== null);
  check("envelope: a record filed under someone else's id is refused", env({ value: { id: "r2" } }) !== null);
  check("envelope: negative time refused", env({ updatedAt: -1 }) !== null);
  check("envelope: a write needs a value", env({ value: undefined }) !== null);
  check("envelope: a delete needs none", env({ value: undefined, deleted: true }) === null);

  check("seed: a review is stamped with when it was made", seedTime("reviews", { at: 1234 }) === 1234);
  check("seed: config is stamped lowest, so it never displaces a stored one", seedTime("config", {}) === 1);
  check(
    "seed: an ended session is stamped with its end",
    seedTime("sessions", { endedAt: 99, startedAt: 10, accumulatedMs: 5 }) === 99,
  );
  check("seed: an open session with start + active time", seedTime("sessions", { startedAt: 10, accumulatedMs: 5 }) === 15);

  const merged = unionById(
    [{ id: "a", v: "server" }, { id: "b", v: "server" }, { id: "gone", v: "server" }],
    [{ id: "b", v: "local" }, { id: "c", v: "local" }, { id: "a", v: "local-pending" }],
    { pendingIds: new Set(["a"]), deletedIds: new Set(["gone"]) },
  );
  const byId = Object.fromEntries(merged.map((x) => [x.id, x.v]));
  check("union: a local-only record is kept", byId.c === "local");
  check("union: otherwise the server's copy wins", byId.b === "server");
  check("union: but an unsent local edit wins", byId.a === "local-pending");
  check("union: a delete not yet sent hides it", !("gone" in byId));

  const capped = upsertCapped([{ id: "a", at: 3 }, { id: "b", at: 1 }], { id: "c", at: 2 }, 2, (x) => x.at);
  check("cap: newest first, capped", capped.map((x) => x.id).join() === "a,c");

  const trimmed = trimSession(session("s", "code"));
  check("trim: keeps the code", trimmed.code.python === "code");
  check("trim: drops per-case output", trimmed.runs[0].results.length === 0 && trimmed.runs[0].stdout === "");
}

// ---- the disk store --------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "interview-storage-"));

async function diskChecks() {
  const root = path.join(tmp, "disk");
  const store = new DiskStore(root);
  const put = (e: Partial<Envelope>) =>
    store.put([{ collection: "reviews", id: "r1", updatedAt: 10, value: { id: "r1", at: 10 }, ...e }]);

  let res = await put({});
  check("disk: a first write applies", res.results[0].status === "applied" && res.rev === 1);
  check("disk: and lands as a file", fs.existsSync(path.join(root, "reviews", "r1.json")));
  res = await put({ updatedAt: 5, value: { id: "r1", at: 5 } });
  check("disk: an older write is stale", res.results[0].status === "stale" && res.rev === 1);
  res = await put({ updatedAt: 20, value: { id: "r1", at: 20 } });
  check("disk: a newer write applies and gets a new rev", res.results[0].status === "applied" && res.rev === 2);

  res = await store.put([{ collection: "reviews", id: "../../escape", updatedAt: 1, value: {} }]);
  check("disk: a path in an id is rejected", res.results[0].status === "rejected");
  check("disk: and nothing is written outside the root", !fs.existsSync(path.join(tmp, "escape.json")));

  res = await put({ updatedAt: 30, deleted: true, value: undefined });
  check("disk: a delete applies", res.results[0].status === "applied");
  const trash = fs.readdirSync(path.join(root, ".trash", "reviews"));
  check("disk: the deleted version is kept in .trash", trash.length === 1 && trash[0].startsWith("r1."));
  const trashed = JSON.parse(fs.readFileSync(path.join(root, ".trash", "reviews", trash[0]), "utf8"));
  check("disk: and it is the last real version", trashed.value?.at === 20);
  check("disk: a deleted record is not listed", (await store.list("reviews")).records.length === 0);
  check("disk: nor fetched", (await store.get("reviews", "r1")) === null);
  const changes = await store.changesSince(0);
  check("disk: but the tombstone is in the change feed", changes.records.some((r) => r.id === "r1" && r.deleted));

  // Every write is serialised, so concurrent requests cannot lose each other's work.
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.put([{ collection: "questions", id: `q${i}`, updatedAt: i + 1, value: { id: `q${i}`, at: i + 1 } }]),
    ),
  );
  const qs = await store.list("questions");
  check("disk: 25 concurrent writes all land", qs.records.length === 25, String(qs.records.length));
  check("disk: with 25 distinct revs", new Set(qs.records.map((r) => r.rev)).size === 25);
  check("disk: listed newest first", qs.records[0].id === "q24");
  check(
    "disk: no temp files left behind",
    !fs.readdirSync(path.join(root, "questions")).some((n) => n.endsWith(".tmp")),
  );
  // The race that matters: many versions of ONE record arriving at once, in a
  // scrambled order. Without the queue, two can both pass the "is this newer?"
  // check before either writes, and an older one can land last.
  const order = Array.from({ length: 30 }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 31) - ((b * 7919) % 31));
  await Promise.all(
    order.map((t) =>
      store.put([{ collection: "reviews", id: "race", updatedAt: t, value: { id: "race", at: t } }]),
    ),
  );
  const raced = (await new DiskStore(root).get("reviews", "race"))?.value as { at: number } | undefined;
  check("disk: concurrent versions of one record end on the newest", raced?.at === 30, String(raced?.at));

  const since = await store.changesSince(qs.records[0].rev! - 1);
  check(
    "disk: the feed returns only what is newer than the cursor",
    since.records.every((r) => r.rev! > qs.records[0].rev! - 1) && since.records.some((r) => r.id === "q24"),
  );

  const s = session("s1", "full");
  await store.put([{ collection: "sessions", id: "s1", updatedAt: 1, value: s }]);
  const listed = (await store.list("sessions")).records[0].value as InterviewSession;
  check("disk: sessions are listed trimmed", listed.runs[0].results.length === 0);
  const full = (await store.get("sessions", "s1"))?.value as InterviewSession;
  check("disk: but fetched in full", full.runs[0].results.length === 1);

  // A restart rebuilds the index from the files and keeps numbering upward.
  const before = (await store.changesSince(0)).rev;
  const reopened = new DiskStore(root);
  check("disk: a restart sees every record", (await reopened.list("questions")).records.length === 25);
  const after = await reopened.put([{ collection: "history", id: "h1", updatedAt: 1, value: { id: "h1", at: 1 } }]);
  check("disk: and revs keep increasing after it", after.rev === before + 1, `${before} -> ${after.rev}`);
}

// ---- two browsers through the real route ------------------------------------------
const deviceA = new FakeStorage();
const deviceB = new FakeStorage();
let offline = false;
let posts = 0;
/** Runs once, right after the next POST is answered: a change made mid-sync. */
let afterNextPost: (() => void) | null = null;
const g = globalThis as unknown as { window: { localStorage: FakeStorage }; fetch: typeof fetch };
const onDevice = (d: FakeStorage) => {
  g.window = { localStorage: d };
};

g.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (offline) throw new TypeError("fetch failed");
  const url = `http://test${String(input)}`;
  if ((init?.method ?? "GET") === "POST") {
    posts++;
    const res = await POST(new Request(url, { method: "POST", body: init!.body as string, headers: { "content-type": "application/json" } }));
    const hook = afterNextPost;
    afterNextPost = null;
    hook?.();
    return res;
  }
  return GET(new Request(url));
}) as typeof fetch;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function twoBrowsers() {
  process.env.INTERVIEW_DATA_DIR = path.join(tmp, "server");
  delete process.env.STORAGE_UPSTREAM;
  // Only the urgent path, so no debounce timer can fire mid-test on the wrong browser.
  setChangeListener((c) => {
    if (c.urgent !== undefined) handleLocalChange(c);
  });

  // Browser A has history from before sync existed.
  onDevice(deviceA);
  saveReview(review("r1", 1_000));
  saveQuestion(savedQ("q1", 1_000));
  saveConfig({ ...DEFAULT_CONFIG, language: "javascript" });
  pushHistory({ id: "r1", title: "Review r1", questionId: "q1", at: 1_000, jobLevel: "mid", difficulty: "medium" });
  saveSession(session("live-a", "print('a')"));
  // Pretend this data predates sync: no outbox yet, then seed it as startSync does.
  deviceA.removeItem("mock-interviewer:sync-outbox");
  const seeded = seedOutbox();
  saveSyncState({ ...loadSyncState(), seeded: true });
  check("seed: an existing browser queues everything it holds", seeded === 5, String(seeded));
  await syncNow();
  check("push: the outbox empties once the server has it", pendingChanges().length === 0);
  check("push: status says synced", getSyncStatus().state === "idle" && !!getSyncStatus().lastSyncedAt);

  // Browser B is brand new.
  onDevice(deviceB);
  await syncNow();
  check("pull: a new browser gets the reviews", loadReviews().some((r) => r.id === "r1"));
  check("pull: and the questions", loadQuestions().some((q) => q.id === "q1"));
  check("pull: and the history list", loadHistory().some((h) => h.id === "r1"));
  check("pull: and the preferences", loadConfig()?.language === "javascript");
  check("pull: another browser's live session is not forced on this one", loadSession() === null);
  check("pull: nothing it pulled is queued to send back", pendingChanges().length === 0);

  // Cross-device resume: B restores A's session from the server's full copy.
  const remote = await fetchRecord<InterviewSession>("sessions", "live-a");
  check("resume: the server has A's session in full", remote?.runs?.[0]?.results?.length === 1);
  restoreSession(remote!);
  check("resume: it is live on B", loadSession()?.code.python === "print('a')");

  // A delete on B reaches A, and the server keeps a copy in .trash.
  deleteReview("r1");
  await syncNow();
  onDevice(deviceA);
  await syncNow();
  check("delete: removed on the other browser too", !loadReviews().some((r) => r.id === "r1"));
  check(
    "delete: the server kept it in .trash",
    fs.readdirSync(path.join(tmp, "server", ".trash", "reviews")).some((n) => n.startsWith("r1.")),
  );

  // Offline: nothing is lost, and it goes up when the server is back.
  offline = true;
  saveReview(review("r-offline", 2_000));
  await syncNow();
  check("offline: status says so", getSyncStatus().state === "offline");
  check("offline: the change waits in the outbox", pendingChanges().some((p) => p.id === "r-offline"));
  check("offline: and is still saved locally", loadReviews().some((r) => r.id === "r-offline"));
  offline = false;
  await syncNow();
  check("offline: it is sent once the server is back", pendingChanges().length === 0);
  check(
    "offline: and the server has it",
    ((await fetchCollection<SavedReview>("reviews")) ?? []).some((r) => r.id === "r-offline"),
  );

  // Conflict: both edit q1; the later edit wins on both, whatever order they sync in.
  offline = true;
  markQuestionPracticed("q1", 5_000); // A, earlier, stuck offline
  await syncNow();
  offline = false;
  await wait(5);
  onDevice(deviceB);
  await syncNow();
  markQuestionPracticed("q1", 9_000); // B, later, online
  await syncNow();
  onDevice(deviceA);
  await syncNow(); // A's older edit goes up, loses, and A takes B's
  check("conflict: the later edit wins on the browser that lost", loadQuestions().find((q) => q.id === "q1")?.lastPracticedAt === 9_000);
  check("conflict: and on the server", (await fetchRecord<SavedQuestion>("questions", "q1"))?.lastPracticedAt === 9_000);
  check("conflict: the loser has nothing left to send", pendingChanges().length === 0);

  // An old browser seeding stale data cannot overwrite newer work.
  const deviceC = new FakeStorage();
  onDevice(deviceC);
  saveQuestion(savedQ("q1", 1_000, { lastPracticedAt: 1 })); // an old copy
  deviceC.removeItem("mock-interviewer:sync-outbox");
  seedOutbox();
  saveSyncState({ ...loadSyncState(), seeded: true });
  await syncNow();
  check("seed: an old copy does not overwrite the newer one", (await fetchRecord<SavedQuestion>("questions", "q1"))?.lastPracticedAt === 9_000);
  check("seed: and the old browser is brought up to date", loadQuestions().find((q) => q.id === "q1")?.lastPracticedAt === 9_000);

  // A cap is not a delete: the 21st review pushes the 1st out of this browser only.
  onDevice(deviceA);
  for (let i = 0; i < 25; i++) saveReview(review(`bulk${i}`, 10_000 + i));
  await syncNow();
  check("cap: this browser keeps only its newest 20", loadReviews().length === 20);
  const all = (await fetchCollection<SavedReview>("reviews")) ?? [];
  check("cap: the server keeps all of them", all.filter((r) => r.id.startsWith("bulk")).length === 25, String(all.length));

  // The same while offline: interviews pile up, the cap evicts unsent ones, none are lost.
  offline = true;
  for (let i = 0; i < 25; i++) saveReview(review(`away${i}`, 20_000 + i));
  await syncNow();
  check("offline cap: this browser still keeps only 20", loadReviews().length === 20);
  check("offline cap: all 25 are waiting to send", pendingChanges().filter((p) => p.id.startsWith("away")).length === 25);
  offline = false;
  await syncNow();
  const away = ((await fetchCollection<SavedReview>("reviews")) ?? []).filter((r) => r.id.startsWith("away"));
  check("offline cap: the server gets all 25, including the evicted ones", away.length === 25, String(away.length));
  check("offline cap: and the holding area is emptied once sent", deviceA.getItem("mock-interviewer:sync-spill") === "{}");

  // clearSession sends the full session before trimming it into the ring.
  onDevice(deviceA);
  posts = 0;
  saveSession(session("full-me", "x = 1", 50_000));
  clearSession(); // pending change, so the full copy goes out immediately
  await wait(20);
  check("clear: the full session was sent at once", posts >= 1);
  const kept = await fetchRecord<InterviewSession>("sessions", "full-me");
  check("clear: the server's copy is the full one", kept?.runs?.[0]?.results?.length === 1);
  await syncNow();
  const after = await fetchRecord<InterviewSession>("sessions", "full-me");
  check("clear: and a later sync does not overwrite it with the trimmed copy", after?.runs?.[0]?.results?.length === 1);

  // An edit made between this sync's push and its pull must survive the pull,
  // which echoes back the version just pushed.
  saveQuestion(savedQ("mid", 30_000, { lastPracticedAt: 1 }));
  afterNextPost = () => markQuestionPracticed("mid", 2);
  await syncNow();
  check("mid-sync: an edit made during the pull is not overwritten", loadQuestions().find((q) => q.id === "mid")?.lastPracticedAt === 2);
  check("mid-sync: and it is still queued", pendingChanges().some((p) => p.id === "mid"));
  await syncNow();
  check("mid-sync: and it reaches the server next time", (await fetchRecord<SavedQuestion>("questions", "mid"))?.lastPracticedAt === 2);

  // A replaced server: a browser whose cursor is past the server's numbering
  // starts over at once, rather than skipping everything the server has.
  const deviceD = new FakeStorage();
  onDevice(deviceD);
  saveSyncState({ rev: 10_000, seeded: true });
  await syncNow();
  check("reset: a cursor past the server's rev is reset", loadSyncState().rev < 10_000);
  check("reset: and the server's records arrive in the same sync", loadReviews().some((r) => r.id === "away24"));

  // The upstream setting forwards rather than storing locally.
  process.env.STORAGE_UPSTREAM = "http://127.0.0.1:9";
  const realFetch = g.fetch;
  g.fetch = (async () => {
    throw new TypeError("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  const res = await GET(new Request("http://test/api/storage?since=0"));
  check("upstream: an unreachable upstream is a 502, not a local write", res.status === 502);
  g.fetch = realFetch;
  delete process.env.STORAGE_UPSTREAM;

  setChangeListener(null);
}

diskChecks()
  .then(twoBrowsers)
  .then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${failures} problem(s).`);
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.log("CRASH", e);
    process.exit(1);
  });
