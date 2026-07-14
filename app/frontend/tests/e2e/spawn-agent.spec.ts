import { test, expect, type Page } from "@playwright/test";

// Fully mocked (no tmux/wt/fab) — inject the SSE `sessions` payload + server
// list via page.route, mock the two riff endpoints, then drive both spawn
// entry points. See spawn-agent.spec.md for intent + steps.
//
// Web-UI Spawn Agent (260713-sbk1; mockup-v2 fields added in 260714-q9cg). The
// dialog opens from Cmd+K `Agent: Spawn` AND the window-switcher `+ New Agent`,
// renders the v2 field set (Where / Worktree / Agent tier), a checkout+tier
// task-submit spawns and navigates to the returned window carrying `where`/
// `tier` in the POST body, and a 400 renders the error in-dialog.
//
// The riff-endpoint mocks use TRAILING `*` globs (`**/api/riff*`,
// `**/api/riff/presets*`) because the client's withServer appends `?server=` —
// a no-star glob would silently fall through and mutate live tmux
// (playwright-glob-query-string-fallthrough memory).

const SERVER = "default";

function sessionsPayload() {
  return JSON.stringify([
    {
      name: "dev",
      windows: [
        {
          windowId: "@1",
          index: 0,
          name: "main",
          worktreePath: "/tmp/repo",
          activity: "active",
          isActiveWindow: true,
          activityTimestamp: 0,
        },
      ],
    },
  ]);
}

// The fab-kit built-in tiers, mirrored by the backend's fabconfig.BuiltinTiers.
const BUILTIN_TIERS = ["default", "doing", "fast", "operator", "review"];

type RiffMock = {
  // When set, POST /api/riff fulfills with this status + body.
  spawnStatus: number;
  spawnBody: string;
  // Presets list returned by GET /api/riff/presets.
  presets: unknown[];
  // Tiers returned by GET /api/riff/presets (defaults to the built-ins).
  tiers?: string[];
};

async function mockBackend(page: Page, riff: RiffMock): Promise<{ spawnBodies: () => Record<string, unknown>[] }> {
  const spawnBodies: Record<string, unknown>[] = [];

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
      body: `event: sessions\ndata: ${sessionsPayload()}\n\n`,
    }),
  );

  // GET /api/riff/presets* — MUST match the presets glob BEFORE the broader
  // riff glob, so register it first (Playwright matches most-recently-added
  // first, but keeping the specific one first is clearest).
  await page.route("**/api/riff/presets*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ presets: riff.presets, tiers: riff.tiers ?? BUILTIN_TIERS }),
    }),
  );

  // POST /api/riff* — the spawn. Capture the body; only intercept POST so the
  // presets GET (which also matches `**/api/riff*`) is not swallowed here.
  await page.route("**/api/riff*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    spawnBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: riff.spawnStatus,
      contentType: "application/json",
      body: riff.spawnBody,
    });
  });

  return { spawnBodies: () => spawnBodies };
}

async function gotoTerminal(page: Page) {
  await page.goto(`/${SERVER}/1`);
  await expect(page.getByText("main").first()).toBeVisible({ timeout: 10_000 });
}

async function openViaPalette(page: Page) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command...");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill("Agent: Spawn");
  await page.keyboard.press("Enter");
}

async function openViaDropdown(page: Page) {
  await page.getByRole("button", { name: "Switch window" }).click();
  await page.getByRole("menuitem", { name: "+ New Agent" }).click();
}

const OK_SPAWN: RiffMock = {
  spawnStatus: 200,
  spawnBody: JSON.stringify({ server: SERVER, session: "dev", window: "riff-swift-fox", windowId: "@7" }),
  presets: [],
};

test.describe("Web-UI Spawn Agent", () => {
  test("opens the spawn dialog from the Cmd+K Agent: Spawn action", async ({ page }) => {
    await mockBackend(page, OK_SPAWN);
    await gotoTerminal(page);

    await openViaPalette(page);

    // Title carries the target session (mockup-v2).
    await expect(page.getByRole("dialog", { name: "Spawn agent in dev" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Task")).toBeVisible();
  });

  test("opens the spawn dialog from the window-switcher + New Agent item", async ({ page }) => {
    await mockBackend(page, OK_SPAWN);
    await gotoTerminal(page);

    await openViaDropdown(page);

    await expect(page.getByRole("dialog", { name: "Spawn agent in dev" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Task")).toBeVisible();
  });

  test("renders the mockup-v2 fields (Where radio, Worktree, Agent tier)", async ({ page }) => {
    await mockBackend(page, OK_SPAWN);
    await gotoTerminal(page);

    await openViaPalette(page);
    await expect(page.getByRole("dialog", { name: "Spawn agent in dev" })).toBeVisible({ timeout: 5_000 });

    // Where radio — new worktree checked by default.
    await expect(page.getByRole("radio", { name: /new worktree/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /this checkout/i })).not.toBeChecked();
    // Worktree field visible in worktree mode; Agent tier dropdown defaults to
    // "default". `exact` on the Agent label — a loose match also hits the dialog
    // (accessible name "Spawn agent in dev" contains "agent").
    await expect(page.getByLabel("Worktree name")).toBeVisible();
    await expect(page.getByLabel("Agent", { exact: true })).toHaveValue("default");

    // Selecting "this checkout" hides the Worktree field.
    await page.getByRole("radio", { name: /this checkout/i }).check();
    await expect(page.getByLabel("Worktree name")).toBeHidden();
  });

  test("submitting a task spawns and navigates to the returned window", async ({ page }) => {
    const { spawnBodies } = await mockBackend(page, OK_SPAWN);
    await gotoTerminal(page);

    await openViaPalette(page);
    const task = page.getByLabel("Task");
    await task.fill("fix the bug");
    await task.press("Enter");

    // Navigates to the returned windowId (@7 → URL segment `7`).
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/7(?:$|[/?#])`), { timeout: 5_000 });
    // The POST carried the task + session (server rides ?server=). Defaults-only
    // body omits where/tier (worktree + default are the backend defaults).
    await expect.poll(() => spawnBodies().length).toBeGreaterThan(0);
    expect(spawnBodies()[0]).toMatchObject({ task: "fix the bug", session: "dev" });
    expect(spawnBodies()[0]).not.toHaveProperty("where");
    expect(spawnBodies()[0]).not.toHaveProperty("tier");
  });

  test("a checkout + tier task-submit carries where and tier in the POST body", async ({ page }) => {
    const { spawnBodies } = await mockBackend(page, OK_SPAWN);
    await gotoTerminal(page);

    await openViaPalette(page);
    await expect(page.getByRole("dialog", { name: "Spawn agent in dev" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("radio", { name: /this checkout/i }).check();
    await page.getByLabel("Agent", { exact: true }).selectOption("doing");
    const task = page.getByLabel("Task");
    await task.fill("explore the code");
    await task.press("Enter");

    await expect(page).toHaveURL(new RegExp(`/${SERVER}/7(?:$|[/?#])`), { timeout: 5_000 });
    await expect.poll(() => spawnBodies().length).toBeGreaterThan(0);
    expect(spawnBodies()[0]).toMatchObject({
      task: "explore the code",
      session: "dev",
      where: "checkout",
      tier: "doing",
    });
    // No worktree name in checkout mode.
    expect(spawnBodies()[0]).not.toHaveProperty("worktreeName");
  });

  test("a 400 renders its error in-dialog and does not navigate", async ({ page }) => {
    await mockBackend(page, {
      spawnStatus: 400,
      spawnBody: JSON.stringify({ error: "The session's working directory is not inside a git repository" }),
      presets: [],
    });
    await gotoTerminal(page);

    await openViaPalette(page);
    const task = page.getByLabel("Task");
    await task.fill("whatever");
    await task.press("Enter");

    // Error is shown in-dialog; the dialog stays open and the URL is unchanged.
    await expect(page.getByText(/not inside a git repository/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("dialog", { name: "Spawn agent in dev" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
  });
});
