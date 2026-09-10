import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, openPalette } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";

// GUI desktop picker e2e (spec docs/specs/gui.md § Switching desktops) — the
// two doors of the desktop pick flow, fully mocked (no real tmux, no Xvnc):
// the palette's `GUI: Desktop…` lazy sub-list and the All-settings `gui.wm`
// select, both ending in the shared restart confirm.
//
// Shared setup: no beforeAll/beforeEach — each test calls mockDesktopBackend
// and navigates fresh (Playwright gives every test its own page/context). The
// rig is the gui-surface.spec.ts ungated half's: `mockStateSocket` carries a
// sessions payload (session `dev`, one code-capable window `@1`) and an
// enabled+reachable `gui` global slot (delivered on hello), `/ws/terminals`
// is accepted and held open, and `/api/servers` is stubbed. On top of that:
//   - `GET /api/gui/host` is route-stubbed with a document carrying two
//     candidates (IceWM `icewm-session`, LXQt `startlxqt`) and apps
//     `chromium ×2`, enabled+reachable on display `:10`, and deliberately NO
//     `wm_candidates_hint` (LXQt is present, so the install-hint footer must
//     not render).
//   - `GET /api/settings` is route-stubbed with a registry carrying `gui.wm`
//     unset (`value: ""` — Auto), so the picker's `current` marker sits on
//     `Auto (ladder)`; `POST /api/settings` is fulfilled with the request
//     body captured so tests can assert the exact patch.
//   - `POST /api/gui/host/restart` is route-stubbed (`{"status":"ok"}`) with
//     a call counter so tests can assert exactly one (or zero) restart.
// Desktop viewport only (1280px) — the flow is viewport-independent.

const GUI_ON = [
  {
    id: "host",
    enabled: true,
    backend: "Xtigervnc",
    reachable: true,
    display: ":10",
    width: 1280,
    height: 800,
    viewers: 0,
    wm: "icewm-session",
    locked: false,
  },
];

const GUI_STATUS = {
  id: "host",
  enabled: true,
  backend: "Xtigervnc",
  reachable: true,
  display: ":10",
  width: 1280,
  height: 800,
  viewers: 0,
  wm: "icewm-session",
  wm_candidates: [
    { name: "icewm-session", label: "IceWM", kind: "wm", installed: true },
    { name: "startlxqt", label: "LXQt", kind: "session", installed: true },
  ],
  socket: "",
  session: "rk-gui",
  reason: "",
  apps: [{ name: "chromium", count: 2 }],
  uptime_seconds: 0,
};

const SETTINGS = {
  settings: [
    {
      key: "gui.wm",
      kind: "string",
      default: "",
      description: "Pin the window manager the GUI supervisor starts.",
      category: "behavior",
      ui: true,
      live: false,
      value: "",
    },
  ],
};

const WORK_WINDOW = {
  windowId: "@1",
  index: 0,
  name: "work",
  worktreePath: "/tmp/wt",
  activity: "idle",
  isActiveWindow: true,
  activityTimestamp: 0,
  gitRoot: "/repo",
  panes: [{ paneId: "%1", paneIndex: 0, cwd: "/repo", command: "zsh", isActive: true }],
};

/** The mocked backend; returns the captured POST /api/settings bodies and the
 *  restart-call count. The `gui` slot stays enabled+reachable throughout. */
async function mockDesktopBackend(page: Page) {
  const settingsPosts: unknown[] = [];
  let restartCalls = 0;
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "default", sessionCount: 1 }]),
    }),
  );
  await page.route("**/api/gui/host", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GUI_STATUS),
    }),
  );
  await page.route("**/api/gui/host/restart", async (route) => {
    restartCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"status":"ok"}',
    });
  });
  await page.route("**/api/settings", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      settingsPosts.push(JSON.parse(request.postData() ?? "null"));
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SETTINGS),
    });
  });
  await mockStateSocket(page, {
    sessions: JSON.stringify([{ name: "dev", windows: [WORK_WINDOW] }]),
    gui: GUI_ON,
  });
  return { settingsPosts, restartCalls: () => restartCalls };
}

/** Open the work window and wait for the shell to render (the gui slot has
 *  landed by then — the banner is post-connection chrome). */
async function gotoWorkWindow(page: Page) {
  await page.goto("/default/%401");
  await expect(page.getByRole("banner").getByRole("button", { name: "Terminal tile" })).toBeVisible(
    { timeout: READY_TIMEOUT },
  );
}

/** ⌘K → `GUI: Desktop…` → click the named sub-list row (waits out the lazy
 *  loader's `Loading…` row). Returns the restart-confirm dialog locator. */
async function pickDesktopRow(page: Page, rowName: string) {
  const paletteInput = await openPalette(page);
  await paletteInput.fill("GUI: Desktop");
  await page.getByRole("option", { name: "GUI: Desktop…" }).click();
  await expect(page.getByPlaceholder("Pick a desktop — Enter select · Esc cancel")).toBeVisible();
  const row = page.getByRole("option", { name: rowName, exact: true });
  await expect(row).toBeVisible({ timeout: READY_TIMEOUT });
  await row.click();
  return page.getByRole("dialog", { name: "Restart the desktop now?" });
}

test.describe("gui desktop picker — mocked signal, desktop (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /**
   * Proves: picking a desktop from the palette's `GUI: Desktop…` sub-list
   * writes the pin (`{"gui.wm":"startlxqt"}` as the ONLY settings POST), opens
   * the restart confirm naming the running apps (`chromium ×2`), and `Later`
   * closes the dialog WITHOUT ever calling the restart route — the written pin
   * stands for the next restart.
   *
   * Steps:
   * 1. Mock the backend (gui enabled+reachable; status document with the
   *    IceWM/LXQt candidates and apps `chromium ×2`); open @1.
   * 2. Open the palette, select `GUI: Desktop…`; assert the sub-step's
   *    read-only input carries the pick-a-desktop placeholder, then click the
   *    `LXQt` row once it loads.
   * 3. Assert the confirm `Restart the desktop now?` appears and its body
   *    names `chromium ×2`.
   * 4. Press `Later`; assert the dialog closed, the captured settings POSTs
   *    are exactly `[{"gui.wm":"startlxqt"}]`, and the restart route was
   *    never called.
   */
  test("palette pick → Later: one settings POST, the confirm names the apps, zero restart calls", async ({
    page,
  }) => {
    const { settingsPosts, restartCalls } = await mockDesktopBackend(page);
    await gotoWorkWindow(page);

    const dialog = await pickDesktopRow(page, "LXQt");
    await expect(dialog).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(dialog).toContainText("Running apps will close: chromium ×2", {
      timeout: READY_TIMEOUT,
    });

    await dialog.getByRole("button", { name: "Later" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => settingsPosts).toEqual([{ "gui.wm": "startlxqt" }]);
    expect(restartCalls()).toBe(0);
  });

  /**
   * Proves: the same palette pick, confirmed with `Restart`, POSTs
   * `/api/gui/host/restart` exactly once and closes the dialog.
   *
   * Steps:
   * 1. Mock the backend as in the Later test; open @1.
   * 2. Palette `GUI: Desktop…` → `LXQt`; assert the confirm appears.
   * 3. Press `Restart`; assert the restart route was called exactly once and
   *    the dialog closed.
   */
  test("palette pick → Restart: exactly one restart POST, dialog closes", async ({ page }) => {
    const { restartCalls } = await mockDesktopBackend(page);
    await gotoWorkWindow(page);

    const dialog = await pickDesktopRow(page, "LXQt");
    await expect(dialog).toBeVisible({ timeout: READY_TIMEOUT });

    await dialog.getByRole("button", { name: "Restart" }).click();
    await expect.poll(() => restartCalls()).toBe(1);
    await expect(dialog).toHaveCount(0);
  });

  /**
   * Proves: the All-settings `gui.wm` row renders a select once the status
   * document resolves, listing exactly `Auto (ladder)`, one option per
   * candidate label, and `Other…` in that order — and, with LXQt installed
   * (no `wm_candidates_hint` on the document), the install-hint footer is
   * absent.
   *
   * Steps:
   * 1. Mock the backend as above; open @1.
   * 2. Open the Settings dialog via the `Settings: All` palette deep-link;
   *    assert the All settings tab is selected.
   * 3. Wait for the `gui.wm` select; assert its options are exactly
   *    `Auto (ladder)`, `IceWM`, `LXQt`, `Other…` in order.
   * 4. Assert no `gui-wm-install-hint` footer renders.
   */
  test("settings row: the select lists Auto, both candidates, Other…; no install hint", async ({
    page,
  }) => {
    await mockDesktopBackend(page);
    await gotoWorkWindow(page);

    const paletteInput = await openPalette(page);
    await paletteInput.fill("Settings: All");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(dialog.getByRole("tab", { name: "All settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const select = dialog.locator('select[id="setting-gui.wm"]');
    await expect(select).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(select.locator("option")).toHaveText(["Auto (ladder)", "IceWM", "LXQt", "Other…"]);
    await expect(dialog.getByTestId("gui-wm-install-hint")).toHaveCount(0);
  });
});
