import type { NextConfig } from "next";

/**
 * NEXT_PUBLIC_BASE_PATH serves the app under a sub-path ("/interviewer"), for a
 * host whose root belongs to something else. Read at build time, so the build
 * and the server must agree; src/lib/basePath.ts uses the same variable for the
 * requests Next does not prefix by itself.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
if (basePath && !/^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(basePath)) {
  throw new Error(`NEXT_PUBLIC_BASE_PATH must look like "/interviewer", got "${basePath}"`);
}

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
