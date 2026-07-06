import { test, expect, type Page } from "@playwright/test";

// Fully mocked (no tmux/gh) — inject the SSE `sessions` payload + server list
// via page.route. Exercises the PANE panel's four-register view. See
// pane-register-panel.spec.md for intent + steps.
//
// PANE panel register view (260706-y1ar; status-pyramid.md § Row Minimalism):
// output (L0) / agent (L1) / fab (L2) / PR (L3), one orthogonal line per layer,
// never collapsed. Absent layers render as absent (a plain shell shows only
// `output`). The PR register shows for ANY pane with a prNumber (ungated from
// fabChange — universal derivation, Principle X).

const SERVER = "default";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        // @1: all four layers present — a fab window with an agent and a PR.
        windowId: "@1",
        index: 0,
        name: "full-stack",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
        agentState: "waiting",
        agentIdleDuration: "3m",
        fabChange: "260706-y1ar-status-pyramid-ui-surfacing",
        fabStage: "review",
        fabDisplayState: "failed",
        prUrl: "https://github.com/o/r/pull/386",
        prNumber: 386,
        prState: "open",
        prChecks: "fail",
        panes: [{ paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "claude", isActive: true }],
      },
      {
        // @2: a plain shell — only the L0 output register is present.
        windowId: "@2",
        index: 1,
        name: "plain-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        panes: [{ paneId: "%2", paneIndex: 0, cwd: "/tmp/scratch", command: "zsh", isActive: true }],
      },
      {
        // @3: a plain pane WITH a PR but no fab change — the L3 PR register
        // still shows (universal derivation) even though the dot stays gray.
        windowId: "@3",
        index: 2,
        name: "pr-only",
        worktreePath: "/tmp/pr",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        prUrl: "https://github.com/o/r/pull/999",
        prNumber: 999,
        prState: "open",
        prChecks: "pass",
        panes: [{ paneId: "%3", paneIndex: 0, cwd: "/tmp/pr", command: "zsh", isActive: true }],
      },
    ],
  },
]);

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/relay\//, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await page.route("**/api/sessions/stream*", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      body: `event: sessions\ndata: ${sessionsPayload}\n\n`,
    }),
  );
}

test.describe("PANE panel four-register view", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("a full window shows all four registers (output/agent/fab/PR)", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    // L0 output register (always present).
    await expect(page.getByTestId("register-output")).toBeVisible();
    // L1 agent register — the waiting agent + duration.
    const agent = page.getByTestId("register-agent");
    await expect(agent).toBeVisible();
    await expect(agent).toContainText("waiting 3m");
    // L2 fab register — change · stage · displayState.
    await expect(page.getByText(/y1ar/)).toBeVisible();
    await expect(page.getByText(/review/)).toBeVisible();
    // L3 PR register — the PR line for the derived PR.
    await expect(page.getByTestId("pr-line")).toContainText("#386");
  });

  test("a plain shell shows only the output register (absent layers absent)", async ({ page }) => {
    await page.goto(`/${SERVER}/2`);
    await expect(page.getByTestId("register-output")).toBeVisible();
    // No agent, fab, or PR registers for a bare shell.
    await expect(page.getByTestId("register-agent")).toHaveCount(0);
    await expect(page.getByTestId("pr-line")).toHaveCount(0);
  });

  test("the PR register (L3) shows for a plain pane with a PR (universal derivation)", async ({ page }) => {
    await page.goto(`/${SERVER}/3`);
    // No fab change on this window, yet the PR register still surfaces the PR.
    await expect(page.getByTestId("pr-line")).toContainText("#999");
    // No fab register (no change bound).
    await expect(page.getByTestId("register-agent")).toHaveCount(0);
  });
});
