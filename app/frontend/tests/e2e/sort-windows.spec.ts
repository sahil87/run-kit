import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { gotoWindow, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

// Real-tmux path (no mocks): windows live on the isolated e2e server, the
// palette sub-step POSTs to the backend, tmux physically reorders, and the SSE
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

/** Mark one window's pane waiting (3-segment value carrying the pane's own
 *  live pid — a 2-segment value on a shell pane is reconciled away). */
function setWaiting(name: string): void {
  const pid = tmux([
    "list-panes",
    "-t",
    `=${SESSION}:=${name}`,
    "-F",
    "#{pane_pid}",
  ]).trim();
  tmux([
    "set-option",
    "-p",
    "-t",
    `=${SESSION}:=${name}`,
    "@rk_agent_state",
    `waiting:${Math.floor(Date.now() / 1000)}:${pid}`,
  ]);
}

/** Clear a window's agent-state option. */
function clearAgentState(name: string): void {
  tmux(["set-option", "-p", "-u", "-t", `=${SESSION}:=${name}`, "@rk_agent_state"]);
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

/** Open the palette and select `Session: Sort windows…` — leaves the picker
 *  sub-step active. */
async function openSortPicker(page: Page): Promise<void> {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill("Session: Sort windows");
  await page.keyboard.press("Enter");
  await expect(
    page.getByPlaceholder("Pick sort keys — Space toggle · Enter apply"),
  ).toBeVisible({ timeout: 5_000 });
}

/** In the picker sub-step: toggle each named option row (Space), then Enter. */
async function pickSortKeys(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole("option", { name: label }).click();
  }
  await page.keyboard.press("Enter");
}

/** Wait until the app shows this spec's session in the sidebar — the current-
 *  session gate for the palette sort entry is the snapshot-derived
 *  sessionName, which needs the SSE session list to have landed. */
async function waitForSessionVisible(page: Page): Promise<void> {
  const sidebar = page.locator("nav[aria-label='Sessions']");
  await expect(sidebar.locator(`text=${TAG}`).first()).toBeVisible({ timeout: 10_000 });
}

async function gotoSessionWindow(page: Page, name: string): Promise<void> {
  const win = await resolveWindow(page, TMUX_SERVER, SESSION, name);
  await gotoWindow(page, TMUX_SERVER, win.windowId);
  await waitForSessionVisible(page);
}

test.describe("Session: Sort windows", () => {
  test.beforeAll(() => {
    createSession(SESSION, { windows: [...NAMES] });
  });

  test.afterAll(() => {
    killSession(SESSION);
  });

  test("sort by created restores ascending @N order after a scramble", async ({ page }) => {
    await gotoSessionWindow(page, NAMES[0]);

    // Scramble out of @N order: swap the first and last windows.
    swapWindows(NAMES[0], NAMES[2]);
    expect(tmuxWindowOrder()).toEqual([NAMES[2], NAMES[1], NAMES[0]]);

    await openSortPicker(page);
    await pickSortKeys(page, ["By created"]);

    // The physical reorder flows back through the SSE derive tick.
    await expect.poll(tmuxWindowOrder).toEqual([...NAMES]);
    await expect.poll(() => sidebarWindowOrder(page)).toEqual([...NAMES]);
  });

  test("sort by status puts a waiting window first", async ({ page }) => {
    setWaiting(NAMES[2]);
    try {
      await gotoSessionWindow(page, NAMES[0]);

      await openSortPicker(page);
      await pickSortKeys(page, ["By status"]);

      // Stable sort: the waiting window lands first; the two plain windows keep
      // their relative order.
      await expect
        .poll(tmuxWindowOrder)
        .toEqual([NAMES[2], NAMES[0], NAMES[1]]);
      await expect
        .poll(() => sidebarWindowOrder(page))
        .toEqual([NAMES[2], NAMES[0], NAMES[1]]);
    } finally {
      clearAgentState(NAMES[2]);
    }
  });

  test("composite status+name orders idle ties case-insensitively", async ({ page }) => {
    setWaiting(NAMES[1]);
    try {
      await gotoSessionWindow(page, NAMES[0]);

      await openSortPicker(page);
      await pickSortKeys(page, ["By status", "By name"]);

      // zed is waiting (rank 0) → first. mid and alpha are both plain (rank 4);
      // the name tie-break is case-insensitive, so alpha precedes mid.
      await expect
        .poll(tmuxWindowOrder)
        .toEqual([NAMES[1], NAMES[2], NAMES[0]]);
      await expect
        .poll(() => sidebarWindowOrder(page))
        .toEqual([NAMES[1], NAMES[2], NAMES[0]]);
    } finally {
      clearAgentState(NAMES[1]);
    }
  });

  test("Esc during the picker cancels with no reorder", async ({ page }) => {
    await gotoSessionWindow(page, NAMES[0]);
    const before = tmuxWindowOrder();

    await openSortPicker(page);
    // Toggle a key, then bail: no POST fires and tmux order is untouched.
    await page.getByRole("option", { name: "By created" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette-overlay")).not.toBeVisible();

    expect(tmuxWindowOrder()).toEqual(before);
  });
});
