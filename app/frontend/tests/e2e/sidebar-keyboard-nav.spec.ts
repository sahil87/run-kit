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

  /** Read the data-* key of the currently roving (tabindex=0) tree row. */
  async function rovingKey(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const tree = document.querySelector('[role="tree"]');
      const row = tree?.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement | null;
      return row
        ? row.getAttribute("data-window-id") ?? row.getAttribute("data-session-row")
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
    const tree = await openTree(page);
    const winEdit = await resolveWindowId(page, "edit");

    // Focus the current tab stop, then walk down into the windows.
    await page.locator('[role="tree"] [role="treeitem"][tabindex="0"]').focus();
    await tree.press("Home");
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${TEST_SESSION}`);

    await tree.press("ArrowDown");
    expect(await rovingKey(page)).toBe(winEdit);

    // ArrowUp returns to the session header; another ArrowUp stops (no wrap).
    await tree.press("ArrowUp");
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${TEST_SESSION}`);
    await tree.press("ArrowUp");
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${TEST_SESSION}`);
  });

  test("ArrowLeft collapses the session; ArrowRight expands then descends", async ({ page }) => {
    const tree = await openTree(page);
    const sessionRow = `[data-session-row="${TMUX_SERVER}:${TEST_SESSION}"]`;

    await page.locator(sessionRow).focus();
    await tree.press("Home");
    // Collapse the session via ArrowLeft.
    await tree.press("ArrowLeft");
    await expect(page.locator(sessionRow)).toHaveAttribute("aria-expanded", "false");

    // ArrowRight re-expands (focus stays on the session row).
    await tree.press("ArrowRight");
    await expect(page.locator(sessionRow)).toHaveAttribute("aria-expanded", "true");
    expect(await rovingKey(page)).toBe(`${TMUX_SERVER}:${TEST_SESSION}`);

    // ArrowRight again descends to the first window child.
    const winEdit = await resolveWindowId(page, "edit");
    await tree.press("ArrowRight");
    expect(await rovingKey(page)).toBe(winEdit);
  });

  test("Enter on a window row navigates to that window", async ({ page }) => {
    const tree = await openTree(page);
    const winEdit = await resolveWindowId(page, "edit");

    await page.locator('[role="tree"] [role="treeitem"][tabindex="0"]').focus();
    await tree.press("Home");
    await tree.press("ArrowDown"); // → first window (edit)
    expect(await rovingKey(page)).toBe(winEdit);
    await tree.press("Enter");

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
