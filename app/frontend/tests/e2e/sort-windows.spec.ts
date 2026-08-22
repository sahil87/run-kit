import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { gotoWindow, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

// Real-tmux path (no mocks): windows live on the isolated e2e server, the
// palette verb POSTs to the backend, tmux physically reorders, and the SSE
// derive tick repaints the sidebar. See sort-windows.spec.md for intent +
// steps.

const SESSION = `e2e-sort-${Date.now()}`;
// One random alphanumeric token per run, embedded in every window name: the
// sidebar-order readout filters rows by it, so rows from other specs on the
// shared e2e server can never pollute the assertion.
const TAG = `rk${randomBytes(5).toString("hex")}`;
// Windows are created in this order, so window IDs ascend with creation —
// and alphabetical order of the names differs from it, so a name-sorted
// readout can never pass as created order.
const NAMES = [`mid-${TAG}`, `zed-${TAG}`, `alpha-${TAG}`] as const;

function tmux(args: string[]): string {
  return execFileSync("tmux", ["-L", TMUX_SERVER, ...args]).toString();
}

/** tmux-side window order for this spec's session (index order). */
function tmuxWindowOrder(): string[] {
  const out = tmux([
    "list-windows",
    "-t",
    `=${SESSION}`,
    "-F",
    "#{window_name}",
  ]).trim();
  return out ? out.split("\n") : [];
}

/** Swap two windows by name (exact-match, session-qualified targets). */
function swapWindows(nameA: string, nameB: string): void {
  tmux([
    "swap-window",
    "-s",
    `=${SESSION}:=${nameA}`,
    "-t",
    `=${SESSION}:=${nameB}`,
  ]);
}

/** This spec's sidebar window rows, in display order (raw read; callers poll). */
function sidebarWindowOrder(page: Page): Promise<string[]> {
  const sidebar = page.locator("nav[aria-label='Sessions']");
  return sidebar.evaluate(
    (el, tag) => {
      const rows = el.querySelectorAll("[data-window-id] button");
      return Array.from(rows)
        .map((b) => (b.textContent ?? "").trim())
        .filter((text) => text.includes(tag));
    },
    TAG,
  );
}

async function runPaletteSort(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill(label);
  await page.keyboard.press("Enter");
}

/** Wait until the app shows this spec's session in the sidebar — the current-
 *  session gate for the palette sort entries is the snapshot-derived
 *  sessionName, which needs the SSE session list to have landed. */
async function waitForSessionVisible(page: Page): Promise<void> {
  const sidebar = page.locator("nav[aria-label='Sessions']");
  await expect(sidebar.locator(`text=${TAG}`).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Session: Sort windows", () => {
  test.beforeAll(() => {
    createSession(SESSION, { windows: [...NAMES] });
  });

  test.afterAll(() => {
    killSession(SESSION);
  });

  test("sort by created restores ascending @N order after a scramble", async ({ page }) => {
    const first = await resolveWindow(page, TMUX_SERVER, SESSION, NAMES[0]);
    await gotoWindow(page, TMUX_SERVER, first.windowId);
    await waitForSessionVisible(page);

    // Scramble out of @N order: swap the first and last windows.
    swapWindows(NAMES[0], NAMES[2]);
    expect(tmuxWindowOrder()).toEqual([NAMES[2], NAMES[1], NAMES[0]]);

    await runPaletteSort(page, "Session: Sort windows by created");

    // The physical reorder flows back through the SSE derive tick.
    await expect.poll(tmuxWindowOrder).toEqual([...NAMES]);
    await expect.poll(() => sidebarWindowOrder(page)).toEqual([...NAMES]);
  });

  test("sort by status puts a waiting window first", async ({ page }) => {
    // Mark the LAST window's pane waiting (3-segment value carrying the pane's
    // own live pid — a 2-segment value on a shell pane is reconciled away).
    const pid = tmux([
      "list-panes",
      "-t",
      `=${SESSION}:=${NAMES[2]}`,
      "-F",
      "#{pane_pid}",
    ]).trim();
    tmux([
      "set-option",
      "-p",
      "-t",
      `=${SESSION}:=${NAMES[2]}`,
      "@rk_agent_state",
      `waiting:${Math.floor(Date.now() / 1000)}:${pid}`,
    ]);

    const first = await resolveWindow(page, TMUX_SERVER, SESSION, NAMES[0]);
    await gotoWindow(page, TMUX_SERVER, first.windowId);
    await waitForSessionVisible(page);

    await runPaletteSort(page, "Session: Sort windows by status");

    // Stable sort: the waiting window lands first; the two plain windows keep
    // their relative order.
    await expect
      .poll(tmuxWindowOrder)
      .toEqual([NAMES[2], NAMES[0], NAMES[1]]);
    await expect
      .poll(() => sidebarWindowOrder(page))
      .toEqual([NAMES[2], NAMES[0], NAMES[1]]);
  });
});
