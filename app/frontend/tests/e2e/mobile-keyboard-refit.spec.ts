// Mobile keyboard open/collapse refit — simulates the iOS on-screen keyboard
// via a width-constant viewport height drop/restore (the exact signal
// useVisualViewport keys on: height delta > KEYBOARD_DELTA_PX at constant
// width), with hasTouch for pointer:coarse. Guards two regressions at once:
// the surface-layout mobile tile must SIZE the terminal (a content-sized tile
// pins xterm at its 80×24 default — the canvas measures the tile, which
// measures the canvas — and the terminal goes deaf to every viewport change),
// and the bottom-bar safe floor must toggle with html.kb-open (260805-fi9m).
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-kbrefit-${Date.now()}`;
const WINDOW_NAME = "probe";
const FULL = { width: 375, height: 812 };
const KEYBOARDED = { width: 375, height: 512 }; // -300px > KEYBOARD_DELTA_PX(150)

test.use({ viewport: FULL, hasTouch: true });

function tmuxPaneHeight(): number {
  const out = execSync(
    `tmux -L ${TMUX_SERVER} display-message -p -t "=${TEST_SESSION}:${WINDOW_NAME}" "#{pane_height}"`,
    { encoding: "utf8" },
  );
  return Number(out.trim());
}

test.beforeAll(() => {
  createSession(TEST_SESSION);
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test("keyboard open/collapse: xterm+tmux refit and the bottom-bar floor toggles", async ({ page }) => {
  newWindow(TEST_SESSION, WINDOW_NAME);
  const { windowId } = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, WINDOW_NAME);
  // Direct goto — _ready's gotoWindow waits on the sidebar's Connected dot,
  // which a 375px viewport never shows (drawer closed). The rows poll below is
  // the mobile-compatible readiness signal.
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);

  // Terminal registered and painted.
  await expect
    .poll(() => page.evaluate((wid) => window.__rkTerminals?.[wid]?.rows ?? 0, windowId), {
      timeout: 15_000,
    })
    .toBeGreaterThan(10);

  const snapshot = () =>
    page.evaluate((wid) => {
      const term = window.__rkTerminals?.[wid];
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Terminal keys"]');
      return {
        rows: term?.rows ?? -1,
        appHeight: document.documentElement.style.getPropertyValue("--app-height"),
        kbOpen: document.documentElement.classList.contains("kb-open"),
        coarse: window.matchMedia("(pointer: coarse)").matches,
        toolbarPb: toolbar ? getComputedStyle(toolbar).paddingBottom : "NO-TOOLBAR",
      };
    }, windowId);

  const base = await snapshot();
  expect(base.coarse, "pointer:coarse must match for the floor to apply").toBe(true);
  expect(base.kbOpen).toBe(false);
  // The content-sized-tile fixed point is exactly 24 rows (xterm's default);
  // a properly sized tile at 812px yields far more (~50 at the 11px mobile
  // font). >30 is the regression tripwire with slack for font-metric drift.
  expect(base.rows, "mobile tile must size the terminal (24 = the content-sized fixed point)").toBeGreaterThan(30);
  // coarse + no keyboard → raised 1rem floor
  expect(base.toolbarPb).toBe("16px");

  // ── Keyboard opens ──
  await page.setViewportSize(KEYBOARDED);
  await expect.poll(async () => (await snapshot()).kbOpen, { timeout: 5_000 }).toBe(true);
  await expect
    .poll(async () => (await snapshot()).rows, { timeout: 10_000 })
    .toBeLessThan(base.rows);
  // keyboard open → floor drops to 6px
  expect((await snapshot()).toolbarPb).toBe("6px");

  // ── Keyboard collapses ──
  await page.setViewportSize(FULL);
  await expect.poll(async () => (await snapshot()).kbOpen, { timeout: 5_000 }).toBe(false);
  // xterm must re-expand to (at least) its baseline rows…
  await expect
    .poll(async () => (await snapshot()).rows, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(base.rows);
  // …tmux must have been told (pane_height = xterm rows − 2 tmux status lines)…
  await expect.poll(() => tmuxPaneHeight(), { timeout: 10_000 }).toBeGreaterThanOrEqual(base.rows - 2);
  const restored = await snapshot();
  // …and the raised floor must return, on the restored full-height viewport.
  expect(restored.toolbarPb).toBe("16px");
  expect(restored.appHeight).toBe("812px");
});
