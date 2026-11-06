import fs from "node:fs/promises";
import path from "node:path";
import {
  solutionsRoot,
  sanitizeSegment,
  sanitizeFilename,
  resolveWithin,
  safeRelativeParts,
  withSuffix,
} from "@/lib/solutionPaths";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

/**
 * Whether saving to disk is possible at all. On a deployed instance the
 * filesystem is read-only or ephemeral, so this answers false and the browser
 * falls back to a download.
 */
export async function GET() {
  const root = solutionsRoot();
  try {
    await fs.mkdir(root, { recursive: true });
    return Response.json({ available: true, root });
  } catch (e) {
    return Response.json({
      available: false,
      root,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

interface Body {
  segments?: string[];
  filename?: string;
  content?: string;
  /** Set to rewrite a file this session already created, instead of adding another. */
  overwritePath?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const content = body.content;
  if (typeof content !== "string" || content.length === 0) {
    return Response.json({ error: "Nothing to write." }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
    return Response.json({ error: "Solution file is too large to save." }, { status: 413 });
  }

  const root = solutionsRoot();

  try {
    await fs.mkdir(root, { recursive: true });

    // Rewriting this session's own file.
    if (body.overwritePath) {
      const parts = safeRelativeParts(body.overwritePath);
      const target = parts && resolveWithin(root, parts);
      if (!parts || !target) {
        return Response.json({ error: "Refusing that path." }, { status: 400 });
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return Response.json({ path: parts.join("/"), absolutePath: target, root });
    }

    const segments = (body.segments ?? []).slice(0, 4).map((s) => sanitizeSegment(s));
    const filename = sanitizeFilename(body.filename ?? "solution.txt");

    const dir = resolveWithin(root, segments);
    if (!dir) return Response.json({ error: "Refusing that path." }, { status: 400 });
    await fs.mkdir(dir, { recursive: true });

    // Never clobber a file this session did not write.
    let chosen: string | null = null;
    for (let n = 1; n <= 200; n++) {
      const candidate = withSuffix(filename, n);
      const full = resolveWithin(root, [...segments, candidate]);
      if (!full) break;
      try {
        await fs.access(full);
      } catch {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      return Response.json({ error: "Too many files with that name already." }, { status: 409 });
    }

    const target = resolveWithin(root, [...segments, chosen]);
    if (!target) return Response.json({ error: "Refusing that path." }, { status: 400 });
    await fs.writeFile(target, content, "utf8");

    return Response.json({
      path: [...segments, chosen].join("/"),
      absolutePath: target,
      root,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
