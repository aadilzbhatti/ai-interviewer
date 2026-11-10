/**
 * The path the app is served under, e.g. "/interviewer" on the Mac mini, where
 * the bare hostname belongs to another service. Empty in development.
 *
 * Next adds it to routes and its own assets automatically (router.push, Link,
 * /_next), but not to a plain fetch() or a Worker URL. Those go through here.
 * Set NEXT_PUBLIC_BASE_PATH at build time; next.config.ts reads the same value.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** An app-absolute path ("/api/storage") as the browser must request it. */
export const withBase = (path: string) => `${BASE_PATH}${path}`;
