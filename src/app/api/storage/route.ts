import os from "node:os";
import { storeFor } from "@/lib/storageDisk";
import { isCollection, isValidId } from "@/lib/syncModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A full sync of a busy library is a few MB; anything far past that is a mistake. */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_RECORDS = 500;

/**
 * Set STORAGE_UPSTREAM to another instance's origin (for example the Mac
 * mini's tailnet URL) and this one keeps nothing itself: every storage call is
 * forwarded there. That is how a dev server on a laptop shares one library with
 * the deployed copy, and how data stranded in a laptop browser gets moved over.
 */
function upstream(): string | null {
  const u = process.env.STORAGE_UPSTREAM?.trim().replace(/\/+$/, "");
  return u || null;
}

async function forward(req: Request, base: string): Promise<Response> {
  const url = new URL(req.url);
  try {
    const res = await fetch(`${base}/api/storage${url.search}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      cache: "no-store",
    });
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return Response.json(
      { error: `storage upstream ${base} unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

const server = () => ({ host: os.hostname().replace(/\.local$/, "") });

/**
 * GET ?since=N             every version after rev N (what a browser syncs with)
 * GET ?collection=C        live records in C, newest first (sessions trimmed)
 * GET ?collection=C&id=X   one record in full
 */
export async function GET(req: Request) {
  const up = upstream();
  if (up) return forward(req, up);

  const params = new URL(req.url).searchParams;
  const store = storeFor();
  const c = params.get("collection");
  const id = params.get("id");
  try {
    if (c !== null) {
      if (!isCollection(c)) return Response.json({ error: "unknown collection" }, { status: 400 });
      if (id !== null) {
        if (!isValidId(id)) return Response.json({ error: "bad id" }, { status: 400 });
        const record = await store.get(c, id);
        return record ? Response.json({ record, server: server() }) : Response.json({ error: "not found" }, { status: 404 });
      }
      const limit = Math.min(Math.max(Number(params.get("limit")) || 500, 1), 2000);
      return Response.json({ ...(await store.list(c, limit)), server: server() });
    }
    const since = Math.max(Number(params.get("since")) || 0, 0);
    return Response.json({ ...(await store.changesSince(since)), server: server() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** POST { records: Envelope[] }: last write wins per record. */
export async function POST(req: Request) {
  const up = upstream();
  if (up) return forward(req, up);

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let body: { records?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.records)) return Response.json({ error: "records must be an array" }, { status: 400 });
  if (body.records.length > MAX_RECORDS) return Response.json({ error: "too many records" }, { status: 413 });
  try {
    return Response.json({ ...(await storeFor().put(body.records)), server: server() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
