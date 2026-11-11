/**
 * Which interview panels are on screen. Pure, so the suite can pin it down.
 *
 * Three panels: the problem statement, the chat, and the code editor (with
 * its tests and scratchpad underneath). Any one can fill the screen, and any
 * can be closed and reopened. Panels are hidden, never unmounted: the editor
 * is deliberately uncontrolled, and unmounting it would throw away the caret,
 * the selection and the undo history.
 *
 * Kept per browser in localStorage. It is a viewing preference, not interview
 * state, so it is not synced.
 */
export type PanelId = "prompt" | "chat" | "editor";

export const PANELS: PanelId[] = ["prompt", "chat", "editor"];

export const PANEL_LABELS: Record<PanelId, string> = {
  prompt: "Problem",
  chat: "Chat",
  editor: "Code",
};

export interface PanelLayout {
  /** The one panel filling the screen, or null for the normal layout. */
  maximized: PanelId | null;
  closed: PanelId[];
}

export const DEFAULT_LAYOUT: PanelLayout = { maximized: null, closed: [] };

const isPanel = (p: unknown): p is PanelId => typeof p === "string" && (PANELS as string[]).includes(p);

/** Tolerates anything a stale or hand-edited localStorage entry might hold. */
export function normalizeLayout(raw: unknown): PanelLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT;
  const r = raw as { maximized?: unknown; closed?: unknown };
  const closed = Array.isArray(r.closed) ? PANELS.filter((p) => (r.closed as unknown[]).includes(p)) : [];
  const maximized = isPanel(r.maximized) && !closed.includes(r.maximized) ? r.maximized : null;
  return { maximized, closed };
}

/** Full screen, or back to the normal layout if it already is. Reopens it if closed. */
export function toggleMaximize(l: PanelLayout, p: PanelId): PanelLayout {
  if (l.maximized === p) return { ...l, maximized: null };
  return { maximized: p, closed: l.closed.filter((c) => c !== p) };
}

/** Closing the full-screen panel also leaves full screen. */
export function closePanel(l: PanelLayout, p: PanelId): PanelLayout {
  return {
    maximized: l.maximized === p ? null : l.maximized,
    closed: l.closed.includes(p) ? l.closed : PANELS.filter((x) => x === p || l.closed.includes(x)),
  };
}

export function openPanel(l: PanelLayout, p: PanelId): PanelLayout {
  return { ...l, closed: l.closed.filter((c) => c !== p) };
}

/** What is on screen, in panel order. */
export function visiblePanels(l: PanelLayout): PanelId[] {
  if (l.maximized) return [l.maximized];
  return PANELS.filter((p) => !l.closed.includes(p));
}

/** Panels that can be brought back from the strip under the header. */
export function hiddenPanels(l: PanelLayout): PanelId[] {
  const shown = visiblePanels(l);
  return PANELS.filter((p) => !shown.includes(p));
}

/**
 * The two columns of the normal layout: problem and chat on the left, code on
 * the right. A column with nothing in it disappears and the other takes the
 * full width.
 */
export function columns(l: PanelLayout): { left: boolean; right: boolean } {
  const v = visiblePanels(l);
  return { left: v.includes("prompt") || v.includes("chat"), right: v.includes("editor") };
}
