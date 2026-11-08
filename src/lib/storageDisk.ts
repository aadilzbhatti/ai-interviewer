/**
 * The server's copy of everything, as plain JSON files.
 *
 *   <root>/<collection>/<id>.json        one envelope per record
 *   <root>/.trash/<collection>/<id>.<time>.json   what a delete replaced
 *   <root>/meta.json                      the last rev handed out
 *
 * One file per record keeps a bad write from taking anything else with it, and
 * leaves the data readable and backed up by whatever backs up the disk. Writes
 * are atomic (temp file, then rename) and serialised through one queue, so two
 * requests can never interleave a read-modify-write.
 *
 * Deletes are not destructive. Removing a review in the library writes a
 * tombstone so other browsers drop it too, but the last real version is moved
 * into .trash first. Same rule as clearSession(): a click should never be the
 * thing that destroys the only copy.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COLLECTIONS,
  envelopeError,
  shouldApply,
  trimSession,
  type Collection,
  type Envelope,
} from "./syncModel";
import type { InterviewSession } from "./types";

export const DEFAULT_DATA_DIR = path.join(os.homedir(), "Documents", "Workspace", "interview-questions", "data");

export function dataRoot(): string {
  const configured = process.env.INTERVIEW_DATA_DIR?.trim();
  if (!configured) return DEFAULT_DATA_DIR;
  if (configured === "~" || configured.startsWith("~/")) return path.join(os.homedir(), configured.slice(1));
  return path.resolve(configured);
}

interface IndexEntry {
  rev: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface PutResult {
  collection: Collection;
  id: string;
  status: "applied" | "stale" | "rejected";
  error?: string;
}

const key = (c: string, id: string) => `${c}/${id}`;

async function writeAtomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export class DiskStore {
  private index: Map<string, IndexEntry> | null = null;
  private rev = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string) {}

  private file(c: Collection, id: string) {
    return path.join(this.root, c, `${id}.json`);
  }

  /** Builds the in-memory index once per process, from the files themselves. */
  private async load(): Promise<Map<string, IndexEntry>> {
    if (this.index) return this.index;
    const index = new Map<string, IndexEntry>();
    let maxRev = (await readJson<{ rev?: number }>(path.join(this.root, "meta.json")))?.rev ?? 0;
    for (const c of COLLECTIONS) {
      let names: string[] = [];
      try {
        names = await fs.readdir(path.join(this.root, c));
      } catch {
        continue; // collection not created yet
      }
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const env = await readJson<Envelope>(path.join(this.root, c, name));
        if (!env || env.collection !== c || typeof env.rev !== "number") continue;
        index.set(key(c, env.id), { rev: env.rev, updatedAt: env.updatedAt, deleted: env.deleted });
        maxRev = Math.max(maxRev, env.rev);
      }
    }
    this.rev = maxRev;
    this.index = index;
    return index;
  }

  /** Runs `fn` after every earlier write has finished. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  put(envelopes: unknown[]): Promise<{ rev: number; results: PutResult[] }> {
    return this.serial(async () => {
      const index = await this.load();
      const results: PutResult[] = [];
      let wrote = false;
      for (const raw of envelopes) {
        const err = envelopeError(raw);
        const e = raw as Envelope;
        if (err) {
          results.push({ collection: e?.collection, id: e?.id, status: "rejected", error: err });
          continue;
        }
        const k = key(e.collection, e.id);
        const existing = index.get(k);
        if (!shouldApply(existing, e)) {
          results.push({ collection: e.collection, id: e.id, status: "stale" });
          continue;
        }
        const file = this.file(e.collection, e.id);
        if (e.deleted && existing && !existing.deleted) {
          // Keep the last real version before the tombstone replaces it.
          const trash = path.join(this.root, ".trash", e.collection, `${e.id}.${Date.now()}.json`);
          await fs.mkdir(path.dirname(trash), { recursive: true });
          await fs.copyFile(file, trash).catch(() => undefined);
        }
        const rev = ++this.rev;
        const stored: Envelope = e.deleted
          ? { collection: e.collection, id: e.id, updatedAt: e.updatedAt, deleted: true, rev }
          : { collection: e.collection, id: e.id, updatedAt: e.updatedAt, value: e.value, rev };
        await writeAtomic(file, JSON.stringify(stored));
        index.set(k, { rev, updatedAt: e.updatedAt, deleted: e.deleted });
        results.push({ collection: e.collection, id: e.id, status: "applied" });
        wrote = true;
      }
      if (wrote) await writeAtomic(path.join(this.root, "meta.json"), JSON.stringify({ rev: this.rev }));
      return { rev: this.rev, results };
    });
  }

  /** Every version accepted after `since`, tombstones included. */
  async changesSince(since: number): Promise<{ rev: number; records: Envelope[] }> {
    const index = await this.load();
    const wanted = [...index.entries()].filter(([, v]) => v.rev > since).sort((a, b) => a[1].rev - b[1].rev);
    const records: Envelope[] = [];
    for (const [k] of wanted) {
      const [c, id] = k.split("/") as [Collection, string];
      const env = await readJson<Envelope>(this.file(c, id));
      if (env) records.push(env);
    }
    return { rev: this.rev, records };
  }

  /** Live records in one collection, newest first. Sessions come back trimmed. */
  async list(c: Collection, limit = 500): Promise<{ rev: number; records: Envelope[] }> {
    const index = await this.load();
    const live = [...index.entries()]
      .filter(([k, v]) => k.startsWith(`${c}/`) && !v.deleted)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, limit);
    const records: Envelope[] = [];
    for (const [k] of live) {
      const env = await readJson<Envelope>(this.file(c, k.slice(c.length + 1)));
      if (!env || env.deleted) continue;
      if (c === "sessions" && env.value) env.value = trimSession(env.value as InterviewSession);
      records.push(env);
    }
    return { rev: this.rev, records };
  }

  async get(c: Collection, id: string): Promise<Envelope | null> {
    await this.load();
    const env = await readJson<Envelope>(this.file(c, id));
    return env && !env.deleted ? env : null;
  }
}

// One store per root for the life of the process: the index and the write
// queue only protect anything if every request shares them.
const stores = new Map<string, DiskStore>();
export function storeFor(root = dataRoot()): DiskStore {
  let s = stores.get(root);
  if (!s) stores.set(root, (s = new DiskStore(root)));
  return s;
}
