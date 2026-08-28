import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Session-row and server-tile identity tips — the slim tier-1-weight
// hover-cards sharing the window flyout's title-bar grammar: title bar =
// identity (`Session <full name>` / `Server <name>`), body = one plain-text
// facts line (`$N · N tabs · ~/{path}` / `tmux -L <name> · N sessions`).
// The cards are non-interactive, open on row hover (fine pointer) and
// keyboard row focus, and dismiss on Escape; the server tile's native
// `title` attribute is removed in favor of the card (the double-tooltip rule).
//
// Shared setup: fully mocked — no tmux server, no real backend reads (the
// row-flyout.spec.ts idiom). `**/api/servers` serves a single `default`
// server with sessionCount 1; the `/ws/terminals` WebSocket is accepted and
// held open; `/ws/state` (via mockStateSocket) serves one session `dev`
// carrying the sessionId/sessionPath fields with two plain tabs (`@1`, `@2`).
// The session row is located by `[role='treeitem'][data-session-row=...]`,
// the server tile by its role="option" accessible name, and the cards by the
// `session-tip` / `server-tip` testids.

const SERVER = "default";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    sessionId: "$4",
    sessionPath: "/home/sahil/code/sahil87/run-kit",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
      {
        windowId: "@2",
        index: 1,
        name: "scratch-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
      },
    ],
  },
]);

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept and hold the socket open; send nothing */
  });

  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

  await mockStateSocket(page, { sessions: sessionsPayload });
}

const sessionRow = (page: Page) =>
  page.locator("[role='treeitem'][data-session-row='default:dev']");
const serverTile = (page: Page) => page.getByRole("option", { name: "default" });
const sessionTip = (page: Page) => page.getByTestId("session-tip");
const serverTip = (page: Page) => page.getByTestId("server-tip");

test.describe("Session/server identity tips (fine pointer)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/${SERVER}`);
    await expect(sessionRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(serverTile(page)).toBeVisible();
  });

  /**
   * Proves: hovering a session row (fine pointer) opens the session identity
   * tip: the title bar reads `Session dev` and the body reads
   * `$4 · 2 tabs · ~/code/sahil87/run-kit` — the tmux id, the window count,
   * and the root path with `$HOME` abbreviated to `~`. The card holds no
   * interactive content (tier-1 weight lives in the body, not the chrome).
   *
   * Steps:
   * 1. Assert no `session-tip` card exists at rest.
   * 2. Hover the `dev` session row.
   * 3. Assert the card is visible, its title bar contains "Session dev", the
   *    card contains "$4 · 2 tabs · ~/code/sahil87/run-kit", and it contains
   *    no anchors or buttons.
   */
  test("hovering a session row opens its identity tip (full name + $N · N tabs · ~/path)", async ({
    page,
  }) => {
    await expect(sessionTip(page)).toHaveCount(0);
    await sessionRow(page).hover();

    const tip = sessionTip(page);
    await expect(tip).toBeVisible();
    // Title bar = identity: the full (untruncated) session name.
    await expect(tip.getByTestId("popup-title-bar")).toContainText("Session dev");
    // Body = facts: tmux session id, window count, ~-abbreviated root path.
    await expect(tip).toContainText("$4 · 2 tabs · ~/code/sahil87/run-kit");
    // Tier-1 weight: no interactive content.
    await expect(tip.locator("a, button")).toHaveCount(0);
  });

  /**
   * Proves: the session tip is keyboard-reachable — focusing the row's
   * treeitem opens it without a pointer, and Escape dismisses it (floating-ui
   * `useDismiss`).
   *
   * Steps:
   * 1. Focus the `dev` session row.
   * 2. Assert the `session-tip` card appears.
   * 3. Press Escape; assert the card is removed.
   */
  test("keyboard: focusing a session row opens the tip; Escape dismisses it", async ({ page }) => {
    await sessionRow(page).focus();
    await expect(sessionTip(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sessionTip(page)).toHaveCount(0);
  });

  /**
   * Proves: hovering a server tile opens the server identity tip: title bar
   * `Server default`, body `tmux -L default · 1 session` — the socket flag
   * composed frontend-side from the server name (server names ARE socket
   * names) and shown uniformly, plus the session count. The tile's native
   * `title` attribute is gone (never both — the OS bubble would double the
   * styled card), and the card is non-interactive.
   *
   * Steps:
   * 1. Assert the `default` tile has no `title` attribute and no `server-tip`
   *    card exists at rest.
   * 2. Hover the tile.
   * 3. Assert the card is visible, its title bar contains "Server default",
   *    the card contains "tmux -L default · 1 session", and it contains no
   *    anchors or buttons.
   */
  test("hovering a server tile opens its identity tip (socket flag); the tile has no native title", async ({
    page,
  }) => {
    // The native title attribute is REPLACED by the card (the double-tooltip
    // rule) — assert its absence before opening anything.
    await expect(serverTile(page)).not.toHaveAttribute("title");
    await expect(serverTip(page)).toHaveCount(0);

    await serverTile(page).hover();
    const tip = serverTip(page);
    await expect(tip).toBeVisible();
    await expect(tip.getByTestId("popup-title-bar")).toContainText("Server default");
    await expect(tip).toContainText("tmux -L default · 1 session");
    await expect(tip.locator("a, button")).toHaveCount(0);
  });
});
