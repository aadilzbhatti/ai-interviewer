/**
 * Keeps this browser's localStorage and the server's copy in step.
 *
 * localStorage stays the first place anything is saved, synchronously, so
 * nothing about saving got slower or more fragile. This runs beside it:
 *   - push: send whatever the outbox (store.ts) says changed;
 *   - pull: ask the server for every version since the last rev applied here.
 * Last write wins on both sides (syncModel.ts). If the server cannot be
 * reached, nothing is lost: the outbox survives in localStorage and is sent on
 * the next successful sync, from this tab or a later one.
 *
 * Client only. Call startSync() once, from SyncAgent in the root layout.
 */
import {
  ackChange,
  applyRemote,
  dropPending,
  loadSyncState,
  pendingChanges,
  pendingEntry,
  readRecord,
  saveSyncState,
  seedOutbox,
  setChangeListener,
  type LocalChange,
} from "./store";
import { shouldTakeRemote, type Collection, type Envelope } from "./syncModel";
import { withBase } from "./basePath";

const ENDPOINT = withBase("/api/storage");
const PULL_EVERY_MS = 60_000;
/** Quiet period after a change before pushing, and the most a busy editor waits. */
const DEBOUNCE_MS = 2_000;
const MAX_WAIT_MS = 10_000;
/** Browsers drop keepalive requests over 64 KB, so a flush on hide stays under it. */
const KEEPALIVE_LIMIT = 60_000;
const BATCH_BYTES = 2_000_000;
const BATCH_RECORDS = 100;

export interface SyncStatus {
  state: "idle" | "syncing" | "offline";
  lastSyncedAt?: number;
  error?: string;
  /** The machine holding the data, as the server reports it. */
  host?: string;
  /** Changes made here that the server does not have yet. */
  pending: number;
}

let status: SyncStatus = { state: "idle", pending: 0 };
const statusListeners = new Set<(s: SyncStatus) => void>();
const pullListeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, pending: pendingChanges().length };
  for (const fn of statusListeners) fn(status);
}

export const getSyncStatus = () => status;

export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Called after a pull changed something local, so open views can re-read. */
export function subscribePulled(fn: () => void): () => void {
  pullListeners.add(fn);
  return () => pullListeners.delete(fn);
}

function envelopeFor(c: Collection, id: string, at: number, deleted?: boolean): Envelope | null {
  if (deleted) return { collection: c, id, updatedAt: at, deleted: true };
  const value = readRecord(c, id);
  // Gone locally without a delete (evicted by a cap): the server keeps its copy.
  if (value === undefined) return null;
  return { collection: c, id, updatedAt: at, value };
}

async function postRecords(records: Envelope[], keepalive = false) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ records }),
    keepalive,
  });
  if (!res.ok) throw new Error(`push failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    results: { collection: Collection; id: string; status: string }[];
    server?: { host?: string };
  };
  // "stale" means the server already holds this version or a newer one, so it
  // is as done as "applied". "rejected" is never going to work: drop it rather
  // than retry it forever, and say so.
  const sent = new Map(records.map((r) => [`${r.collection}/${r.id}`, r.updatedAt]));
  for (const r of data.results) {
    const at = sent.get(`${r.collection}/${r.id}`);
    if (at === undefined) continue;
    if (r.status === "rejected") console.warn("storage rejected", r);
    ackChange(r.collection, r.id, at);
  }
  return data;
}

async function push() {
  const pending = pendingChanges();
  if (!pending.length) return;
  let batch: Envelope[] = [];
  let bytes = 0;
  for (const p of pending) {
    const env = envelopeFor(p.collection, p.id, p.at, p.deleted);
    if (!env) {
      dropPending(p.collection, p.id);
      continue;
    }
    const size = JSON.stringify(env).length;
    if (batch.length && (bytes + size > BATCH_BYTES || batch.length >= BATCH_RECORDS)) {
      await postRecords(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(env);
    bytes += size;
  }
  if (batch.length) {
    const data = await postRecords(batch);
    if (data.server?.host) setStatus({ host: data.server.host });
  }
}

async function pull() {
  const state = loadSyncState();
  const res = await fetch(`${ENDPOINT}?since=${state.rev}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
  const data = (await res.json()) as { rev: number; records: Envelope[]; server?: { host?: string } };
  if (data.rev < state.rev) {
    // The server's numbering went backwards: it was reset or replaced, and our
    // cursor means nothing there. Start over from zero, now.
    saveSyncState({ ...loadSyncState(), rev: 0 });
    return pull();
  }
  let changedHere = false;
  for (const env of data.records) {
    // An edit made while this pull was in flight is newer than anything the
    // server is echoing back, including our own push from a moment ago.
    const mine = pendingEntry(env.collection, env.id);
    if (!shouldTakeRemote(mine, env)) continue;
    if (mine) dropPending(env.collection, env.id);
    if (applyRemote(env)) changedHere = true;
  }
  saveSyncState({ ...loadSyncState(), rev: data.rev });
  if (data.server?.host) setStatus({ host: data.server.host });
  if (changedHere) for (const fn of pullListeners) fn();
}

let running: Promise<void> | null = null;
let again = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Push, then pull. Calls that arrive mid-sync fold into one more pass. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus({ state: "syncing" });
    try {
      do {
        again = false;
        await push();
        await pull();
      } while (again);
      failures = 0;
      setStatus({ state: "idle", lastSyncedAt: Date.now(), error: undefined });
    } catch (e) {
      failures++;
      setStatus({ state: "offline", error: e instanceof Error ? e.message : String(e) });
      // Back off: 5s, 10s, 20s ... capped at the regular pull interval.
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void syncNow(), Math.min(5_000 * 2 ** (failures - 1), PULL_EVERY_MS));
    } finally {
      running = null;
    }
  })();
  return running;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstChangeAt = 0;

function schedulePush() {
  const now = Date.now();
  if (!firstChangeAt) firstChangeAt = now;
  if (debounceTimer) clearTimeout(debounceTimer);
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstChangeAt + MAX_WAIT_MS - now));
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    firstChangeAt = 0;
    void syncNow();
  }, wait);
}

/** What a local change triggers. Exported so the suite can drive it without timers. */
export function handleLocalChange(change: LocalChange) {
  setStatus({});
  if (change.urgent !== undefined) {
    // clearSession is about to replace the full session with a trimmed copy.
    const entry = pendingEntry(change.collection, change.id);
    if (entry) {
      const env: Envelope = { collection: change.collection, id: change.id, updatedAt: entry.at, value: change.urgent };
      void postRecords([env]).catch(() => undefined);
    }
    return;
  }
  schedulePush();
}

/** Best effort when the tab is hidden or closing; anything left goes next time. */
function flushOnHide() {
  if (document.visibilityState !== "hidden") return;
  const envs = pendingChanges()
    .map((p) => envelopeFor(p.collection, p.id, p.at, p.deleted))
    .filter((e): e is Envelope => !!e);
  if (!envs.length) return;
  const body = JSON.stringify({ records: envs });
  if (body.length <= KEEPALIVE_LIMIT) void postRecords(envs, true).catch(() => undefined);
  else void syncNow();
}

let started = false;

export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  setChangeListener(handleLocalChange);
  const state = loadSyncState();
  if (!state.seeded) {
    seedOutbox();
    saveSyncState({ ...state, seeded: true });
  }
  void syncNow();
  setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, PULL_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
    else flushOnHide();
  });
  window.addEventListener("pagehide", flushOnHide);
}

/** Every live record in a collection from the server, or null if it is unreachable. */
export async function fetchCollection<T>(c: Collection, limit?: number): Promise<T[] | null> {
  try {
    const res = await fetch(`${ENDPOINT}?collection=${c}${limit ? `&limit=${limit}` : ""}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { records: Envelope<T>[]; server?: { host?: string } };
    if (data.server?.host) setStatus({ host: data.server.host });
    return data.records.map((r) => r.value as T);
  } catch {
    return null;
  }
}

/** One record in full from the server, or null. */
export async function fetchRecord<T>(c: Collection, id: string): Promise<T | null> {
  try {
    const res = await fetch(`${ENDPOINT}?collection=${c}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { record: Envelope<T> }).record.value ?? null;
  } catch {
    return null;
  }
}
