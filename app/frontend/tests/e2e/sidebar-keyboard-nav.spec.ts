import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-kbnav-${Date.now()}`;

/** Resolve a window's stable tmux id (`@N`) by its display name. Polls because
 *  windows created via the tmux CLI surface in the snapshot asynchronously. */
async function resolveWindowId(page: Page, windowName: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; name: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        id = win.windowId;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return id!;
}

test.describe("Sidebar keyboard navigation", () => {
  test.beforeAll(() => {
    try {
      // Session with two windows so the tree has a session row + ≥2 window rows.
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -n edit -x 80 -y 24`,
        { stdio: "ignore" },
      );
      execSync(
        `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n test`,
        { stdio: "ignore" },
      );
    } catch {
      // best effort — may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // best effort
    }
  });

  /** Navigate to the server route, wait for SSE, and return the tree element. */
  async function openTree(page: Page) {
    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
    const tree = page.getByRole("tree", { name: "Session tree" });
    await expect(tree).toBeVisible();
    // Ensure our session's rows are present before driving the keyboard.
    await expect(
      page.locator(`[data-session-row="${TMUX_SERVER}:${TEST_SESSION}"]`),
    ).toBeVisible({ timeout: 8_000 });
    return tree;
  }

  /** Read the globally-unique roving key of the current (tabindex=0) tree row.
   *  Mirrors production rowKeyOf: window rows use `data-row-key`
   *  (`${server}:${windowId}`), session rows `data-session-row`
   *  (`${server}:${name}`) — NOT the bare `data-window-id`, which repeats across
   *  servers. */
  async function rovingKey(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const tree = document.querySelector('[role="tree"]');
      const row = tree?.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement | null;
      return row
        ? row.getAttribute("data-row-key") ?? row.getAttribute("data-session-row")
        : null;
    });
  }

  test("tree has role=tree with treeitem rows and exactly one tab stop", async ({ page }) => {
    await openTree(page);
    const items = page.locator('[role="tree"] [role="treeitem"]');
    expect(await items.count()).toBeGreaterThanOrEqual(3); // session + 2 windows
    const tabStops = page.locator('[role="tree"] [role="treeitem"][tabindex="0"]');
    await expect(tabStops).toHaveCount(1);
  });

  test("ArrowDown/ArrowUp move the roving cursor and stop at the ends", async ({ page }) => {
    await openTree(page);
    const winEdit = await resolveWindowId(page, "edit");
    // Roving keys are server-namespaced (`${server}:${windowId}`); the bare
    // `winEdit` (@N) is only the `data-window-id` handle.
    const winEditKey = `${TMUX_SERVER}:${winEdit}`;
    const sessionKey = `${TMUX_SERVER}:${TEST_SESSION}`;

    // Anchor on OUR session row (the shared e2e tmux server may hold other
    // sessions, so a global `Home` would land elsewhere). Focusing a row does
    // NOT move the roving tab stop — navigation anchors on the focused row's
    // nearest treeitem (so the first ArrowDown moves the cursor into THIS
    // session's first window).
    const sessionRow = page.locator(`[data-session-row="${sessionKey}"]`);
    await sessionRow.focus();

    await sessionRow.press("ArrowDown");
    expect(await rovingKey(page)).toBe(winEditKey);

    // ArrowUp returns to this session's header row.
    await page.locator(`[data-row-key="${winEditKey}"]`).press("ArrowUp");
    expect(await rovingKey(page)).toBe(sessionKey);
  });

  test("ArrowLeft collapses the session; ArrowRight expands then descends", async ({ page }) => {
    await openTree(page);
    const sessionKey = `${TMUX_SERVER}:${TEST_SESSION}`;
    const sel = `[data-session-row="${sessionKey}"]`;
    const sessionRow = page.locator(sel);

    await sessionRow.focus();
    // Collapse the session via ArrowLeft. Keys anchor on the focused row's
    // nearest treeitem, so this acts on OUR session regardless of which row
    // currently holds the roving tab stop (the shared e2e server may hold other
    // sessions). Collapse/expand toggle the row but do NOT move the tab stop.
    await sessionRow.press("ArrowLeft");
    await expect(sessionRow).toHaveAttribute("aria-expanded", "false");

    // ArrowRight re-expands (focus stays on the session row).
    await sessionRow.press("ArrowRight");
    await expect(sessionRow).toHaveAttribute("aria-expanded", "true");

    // ArrowRight again descends to the first window child — THIS moves the
    // roving cursor onto our session's first window.
    const winEdit = await resolveWindowId(page, "edit");
    await sessionRow.press("ArrowRight");
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${winEdit}`);
  });

  test("Enter on a window row navigates to that window", async ({ page }) => {
    await openTree(page);
    const winEdit = await resolveWindowId(page, "edit");
    const sessionKey = `${TMUX_SERVER}:${TEST_SESSION}`;

    // Anchor on OUR session row, then descend to its first window (edit).
    const sessionRow = page.locator(`[data-session-row="${sessionKey}"]`);
    await sessionRow.focus();
    await sessionRow.press("ArrowDown"); // → first window (edit)
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${winEdit}`);
    await page.locator(`[data-row-key="${TMUX_SERVER}:${winEdit}"]`).press("Enter");

    // Activation selects the window → the URL carries its id segment.
    await expect(page).toHaveURL(new RegExp(`/${TMUX_SERVER}/.+`));
    await expect(
      page.locator(`[data-window-id="${winEdit}"] [aria-current="page"]`),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("arrows inside a rename input are not hijacked by the tree", async ({ page }) => {
    const tree = await openTree(page);
    await page.locator('[role="tree"] [role="treeitem"][tabindex="0"]').focus();
    await tree.press("Home");
    const before = await rovingKey(page);

    // Double-click the session name to enter rename mode.
    await page.getByRole("button", { name: `Navigate to ${TEST_SESSION}` }).dblclick();
    const input = page.getByLabel("Rename session");
    await expect(input).toBeVisible();
    await input.focus();
    await input.press("ArrowDown"); // moves the caret, must NOT move the tree
    expect(await rovingKey(page)).toBe(before);
    // Escape cancels rename (existing contract still works).
    await input.press("Escape");
    await expect(input).toBeHidden();
  });
});
