/**
 * Panel layout and theme.
 *
 * Panels: any of the problem, chat and code editor can fill the screen or be
 * closed and brought back, and the rules for what is on screen are pure.
 * Theme: the page follows the system light/dark setting, which only works if
 * every color comes from a token that has both a dark and a light value.
 *
 * Run with: npm run validate:layout
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_LAYOUT,
  closePanel,
  columns,
  hiddenPanels,
  normalizeLayout,
  openPanel,
  toggleMaximize,
  visiblePanels,
} from "../src/lib/panelLayout";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`ok    ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}  ${detail}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- panels -----------------------------------------------------------------
{
  check("panels: everything shows by default", same(visiblePanels(DEFAULT_LAYOUT), ["prompt", "chat", "editor"]));
  check("panels: both columns by default", same(columns(DEFAULT_LAYOUT), { left: true, right: true }));

  const full = toggleMaximize(DEFAULT_LAYOUT, "editor");
  check("full screen: only that panel shows", same(visiblePanels(full), ["editor"]));
  check("full screen: the other column goes", same(columns(full), { left: false, right: true }));
  check("full screen: the rest can be brought back", same(hiddenPanels(full), ["prompt", "chat"]));
  check("full screen: pressing it again restores the layout", same(toggleMaximize(full, "editor"), DEFAULT_LAYOUT));
  check("full screen: switching to another panel", same(visiblePanels(toggleMaximize(full, "chat")), ["chat"]));

  const noChat = closePanel(DEFAULT_LAYOUT, "chat");
  check("close: the panel goes", same(visiblePanels(noChat), ["prompt", "editor"]));
  check("close: its column stays while the problem is still in it", columns(noChat).left);
  const noLeft = closePanel(noChat, "prompt");
  check("close: an empty column disappears", same(columns(noLeft), { left: false, right: true }));
  check("close: in panel order whatever order they were closed", same(noLeft.closed, ["prompt", "chat"]));
  check("close: closing twice is harmless", same(closePanel(noChat, "chat"), noChat));
  check("reopen: brings it back", same(visiblePanels(openPanel(noLeft, "chat")), ["chat", "editor"]));

  const closedWhileFull = closePanel(full, "editor");
  check("close: closing the full-screen panel leaves full screen", closedWhileFull.maximized === null);
  check("close: and the others come back", same(visiblePanels(closedWhileFull), ["prompt", "chat"]));
  check("full screen: a closed panel reopens when made full screen", same(visiblePanels(toggleMaximize(noChat, "chat")), ["chat"]) && !toggleMaximize(noChat, "chat").closed.includes("chat"));

  const everything = closePanel(closePanel(closePanel(DEFAULT_LAYOUT, "prompt"), "chat"), "editor");
  check("close: all three closed leaves nothing on screen, all reopenable", visiblePanels(everything).length === 0 && hiddenPanels(everything).length === 3);

  check("storage: junk becomes the default", same(normalizeLayout("nonsense"), DEFAULT_LAYOUT) && same(normalizeLayout(null), DEFAULT_LAYOUT));
  check("storage: unknown panels are dropped", same(normalizeLayout({ maximized: "sidebar", closed: ["chat", "x"] }), { maximized: null, closed: ["chat"] }));
  check("storage: a panel cannot be both closed and full screen", normalizeLayout({ maximized: "chat", closed: ["chat"] }).maximized === null);
  check("storage: a valid layout survives", same(normalizeLayout({ maximized: "prompt", closed: [] }), { maximized: "prompt", closed: [] }));
}

// --- the interview screen hides panels rather than unmounting them ------------
{
  const room = readFileSync(path.join(__dirname, "../src/components/InterviewRoom.tsx"), "utf8");
  check("room: panels are hidden with CSS, not conditionally rendered", /isShown\("chat"\) \? "flex min-h-0 flex-1 flex-col" : "hidden"/.test(room));
  check("room: the editor stays mounted whatever the layout", !/isShown\("editor"\)\s*&&/.test(room) && !/cols\.right\s*&&\s*\(/.test(room));
}

// --- theme --------------------------------------------------------------------
{
  const css = readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  const tokens = (block: string) => new Set([...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  const lightBlock = lightStart >= 0 ? css.slice(lightStart, css.indexOf("}", css.indexOf(":root {", lightStart))) : "";
  const dark = tokens(darkBlock);
  const light = tokens(lightBlock);
  check("theme: there is a light theme for the system setting", lightStart >= 0 && light.size > 0);
  const missing = [...dark].filter((t) => !light.has(t));
  check("theme: every dark token has a light value", missing.length === 0, missing.join(", "));
  check("theme: the light theme tells the browser it is light", /color-scheme:\s*light/.test(lightBlock));

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".tsx") ? [path.join(dir, d.name)] : [],
    );
  const offenders = walk(path.join(__dirname, "../src")).filter((f) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(readFileSync(f, "utf8").replace(/&#\d+;/g, "")));
  check("theme: no component hard-codes a color", offenders.length === 0, offenders.map((f) => path.basename(f)).join(", "));
  const outsideTokens = css.slice(css.indexOf("}", lightStart) + 1).match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  check("theme: the stylesheet uses tokens outside the token blocks", outsideTokens.length === 0, outsideTokens.join(", "));

  const ed = readFileSync(path.join(__dirname, "../src/components/CodeEditor.tsx"), "utf8");
  check("theme: the editor follows the system setting", /prefers-color-scheme: dark/.test(ed) && /dark \? "vs-dark" : "light"/.test(ed));
  check("theme: and keeps following it when it changes", /addEventListener\("change"/.test(ed));
}

console.log(`\n${failures} problem(s).`);
process.exit(failures ? 1 : 0);
