import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Status bar e2e. Fully mocked (no tmux/gh) — the pane-register-panel.spec.ts /
// tooltips.spec.ts idiom: the state socket (mockStateSocket from
// _state-socket-mock.ts) delivers one session (`dev`) with one window (`@1`,
// all signal layers: waiting agent, fab change, open PR, git branch), a
// host-metrics snapshot (`e2e-box`), and a version slot (`0.9.3`).
// `/ws/terminals` is stubbed; `/api/servers` + window-select are fulfilled
// inline. `beforeEach` installs the mock. Default Playwright desktop viewport
// (1280px) unless a test resizes.
//
// Subjects: the full-width attached status strip at the shell bottom
// (desktop-only), the width-or-coarse mobile predicate that suppresses it, the
// fine-pointer bottom-bar DELETION, the window-cluster / host-cluster route
// split, and the no-scroll degradation ladder with the `…` overflow chevron.

const SERVER = "default";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        // @1: all signal layers present — agent waiting, fab change, open PR.
        windowId: "@1",
        index: 0,
        name: "full-stack",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
        agentState: "waiting",
        agentIdleDuration: "3m",
        fabChange: "260814-ldbs-shell-stage-status-bar",
        fabStage: "apply",
        prUrl: "https://github.com/o/r/pull/603",
        prNumber: 603,
        prState: "open",
        prChecks: "pass",
        panes: [
          { paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "claude", isActive: true, gitBranch: "main" },
        ],
      },
    ],
  },
]);

const metricsPayload = {
  hostname: "e2e-box",
  cpu: { samples: [10, 17], current: 17, cores: 8 },
  memory: { used: 24 * 1024 ** 3, total: 59 * 1024 ** 3 },
  load: { avg1: 1.12, avg5: 0.9, avg15: 0.7, cpus: 8 },
  disk: { used: 100 * 1024 ** 3, total: 500 * 1024 ** 3 },
  uptime: 3600,
};

async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  // The InstanceName provider reads the REAL /api/health — pin it so the
  // host segment's `instanceName ?? metrics.hostname` chain is deterministic
  // (a dev machine's own instance-name override would otherwise win).
  await page.route("**/api/health*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hostname: "e2e-box", instanceName: null }),
    }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await mockStateSocket(page, {
    sessions: sessionsPayload,
    metrics: metricsPayload,
    version: { version: "0.9.3", boot: "b1", brew: false },
  });
}

const statusBar = (page: Page) => page.getByTestId("status-bar");
const windowCluster = (page: Page) => page.getByTestId("status-bar-window");
const hostCluster = (page: Page) => page.getByTestId("status-bar-host");
// The bottom bar's toolbar role — absent on fine pointers (R3).
const keyToolbar = (page: Page) => page.getByRole("toolbar", { name: "Terminal keys" });

test.describe("Status bar (260814-ldbs)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  /**
   * Proves: on the desktop terminal route the status bar renders with BOTH
   * clusters — the window cluster mirrors the current window's registers
   * (tmux pane, cwd basename, git branch, agent state, fab change, PR as an
   * open-first anchor) and the host cluster shows compact metrics,
   * host+version, and the connection dot — while the fine-pointer bottom bar
   * is gone from the DOM entirely.
   *
   * Steps:
   * 1. Navigate to `/default/1`; wait for the status bar.
   * 2. Assert zero `Terminal keys` toolbars in the DOM.
   * 3. Assert the window cluster's register values (`pane 1/1 %1`, `wt`,
   *    `main`, `waiting 3m`, the fab line, the `Open PR #603` link).
   * 4. Assert the host cluster (`17%`, `e2e-box`, `v0.9.3`) and the
   *    `Connected` dot.
   */
  test("desktop terminal route: status bar present with BOTH clusters; no bottom bar exists", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    await expect(statusBar(page)).toBeVisible({ timeout: 10_000 });

    // R3: the fine-pointer desktop has NO bottom bar at all.
    await expect(keyToolbar(page)).toHaveCount(0);

    // R4 left cluster — the current window's registers (same resolvers as the
    // retired desktop PANE panel).
    await expect(windowCluster(page).getByText("pane 1/1 %1")).toBeVisible();
    await expect(windowCluster(page).getByText("wt")).toBeVisible(); // cwd basename
    await expect(windowCluster(page).getByText("main")).toBeVisible(); // git branch
    await expect(windowCluster(page).getByText("waiting 3m")).toBeVisible(); // agt
    await expect(windowCluster(page).getByText(/ldbs shell-stage-status-bar · apply/)).toBeVisible();
    // PR register: an open-first anchor.
    await expect(
      windowCluster(page).getByRole("link", { name: "Open PR #603 in a new tab" }),
    ).toBeVisible();

    // R4 right cluster — host metrics + host/version + the connection dot.
    await expect(hostCluster(page).getByText("17%")).toBeVisible();
    await expect(hostCluster(page).getByText("e2e-box")).toBeVisible();
    await expect(hostCluster(page).getByText("v0.9.3")).toBeVisible();
    await expect(statusBar(page).getByLabel("Connected")).toBeVisible();
  });

  /**
   * Proves: off the terminal route the status bar still renders (uniform
   * frame) but with the host cluster only — a route with no live window data
   * renders no window segments and no placeholder rows, and the bottom bar
   * is absent there too.
   *
   * Steps:
   * 1. Navigate to `/default`; wait for the status bar.
   * 2. Assert no `status-bar-window` element exists.
   * 3. Assert the host cluster shows the hostname and server name.
   * 4. Assert zero `Terminal keys` toolbars.
   */
  test("server route (no window): host cluster only — no window cluster, no errors", async ({ page }) => {
    await page.goto(`/${SERVER}`);
    await expect(statusBar(page)).toBeVisible({ timeout: 10_000 });
    await expect(windowCluster(page)).toHaveCount(0);
    await expect(hostCluster(page).getByText("e2e-box")).toBeVisible();
    await expect(hostCluster(page).getByText(SERVER)).toBeVisible();
    await expect(keyToolbar(page)).toHaveCount(0);
  });

  /**
   * Proves: the no-scroll degradation ladder at the ~800px band. The window
   * cluster renders in descending relevance (git → pr → fab → agt → tmx →
   * cwd) and display order equals survival order, so the rightmost segment
   * dies first: deterministic CSS breakpoint classes hide cwd (≥xl) and tmx
   * (≥lg) while git/agt/fab/PR survive (there is no `out` segment — deleted
   * outright); the bar never scrolls; the `…` chevron (hidden at full width)
   * appears and its menu lists the dropped segments in strip order; the
   * menu's rows are keyboard-reachable by arrow-nav, which skips the rows a
   * breakpoint currently hides; Escape closes it.
   *
   * Steps:
   * 1. Navigate to `/default/1`; wait for the window cluster.
   * 2. At 1440px assert all window segments visible and the chevron hidden.
   * 3. Resize to 800×600; assert cwd/tmx hidden, git/agt still visible, and
   *    `scrollWidth ≤ clientWidth` on the bar.
   * 4. Click the chevron; assert the menu lists `tmx`/`cwd` rows and no
   *    `out` row.
   * 5. Assert focus enters the panel on the first VISIBLE row (`tmx` — the
   *    menu mirrors the strip order git → tmx → cwd, and git's row is hidden
   *    while its segment survives ≥md), that ArrowDown/ArrowUp move to `cwd`
   *    and back, and that ArrowUp off the first row wraps to the last
   *    VISIBLE row (the compose action) rather than the breakpoint-hidden
   *    version row — a `display: none` row cannot take focus, so arrow-nav
   *    must skip it. This is the browser-only half of the contract; the unit
   *    suite covers the rove itself, where jsdom computes no layout.
   * 6. Press Escape; assert the menu closes.
   */
  test("narrow desktop width: low-priority segments drop (never scroll) and the … chevron lists them", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    await expect(windowCluster(page)).toBeVisible({ timeout: 10_000 });

    // Wide (1440 ≥ xl): every window segment shows, no chevron.
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(windowCluster(page).getByText("pane 1/1 %1")).toBeVisible();
    await expect(windowCluster(page).getByText("wt")).toBeVisible();
    await expect(statusBar(page).getByTestId("status-bar-overflow")).toBeHidden();

    // ~800px desktop band: rightmost dies first — cwd (≥xl) and tmx (≥lg)
    // are dropped by their deterministic breakpoint classes; git/agt/fab/PR
    // survive; the bar does not scroll.
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(windowCluster(page).getByText("wt")).toBeHidden();
    await expect(windowCluster(page).getByText("pane 1/1 %1")).toBeHidden();
    await expect(windowCluster(page).getByText("main")).toBeVisible();
    await expect(windowCluster(page).getByText("waiting 3m")).toBeVisible();
    const bar = statusBar(page);
    const scrolls = await bar.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls, "the status bar must never scroll").toBe(false);

    // The chevron carries the dropped segments (R5 stage 3).
    const chevron = statusBar(page).getByTestId("status-bar-overflow");
    await expect(chevron).toBeVisible();
    await chevron.click();
    const menu = page.getByRole("menu", { name: "Overflow status segments" });
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/^tmx /)).toBeVisible();
    await expect(menu.getByText(/^cwd /)).toBeVisible();
    // No out row exists at any width — the register is deleted outright.
    await expect(menu.getByText(/^out /)).toHaveCount(0);
    // Keyboard: focus enters the panel on open, ArrowUp/ArrowDown rove between
    // the VISIBLE rows only. The rows a breakpoint currently hides stay in the
    // DOM (git/cpu/version at this width) and must be skipped — a display:none
    // row cannot take focus, so including it would strand nav on a dead index.
    // This is the browser-only half of the contract; jsdom computes no layout.
    // Menu rows mirror the strip order (git → tmx → cwd), so the first
    // VISIBLE row here is tmx (git's segment survives ≥md, hiding its row).
    await expect(menu.getByText(/^tmx /)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByText(/^cwd /)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByText(/^tmx /)).toBeFocused();
    // Wrapping backwards off the first row lands on the LAST visible row — the
    // compose action, not the hidden version row that follows the metrics rows.
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: /Compose text/ })).toBeFocused();
    // Escape closes and refocuses the trigger.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  /**
   * Proves: the status bar's `a▏` hint is the desktop compose opener (the
   * relocated bottom-bar affordance): clicking it mounts the compose strip
   * and the hint reflects the pressed state.
   *
   * Steps:
   * 1. Navigate to `/default/1`; wait for the `status-bar-compose` button.
   * 2. Click it; assert the `compose-strip` element renders.
   * 3. Assert the hint is `aria-pressed="true"`.
   */
  test("the compose hint opens the compose strip (the relocated bottom-bar affordance)", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    const compose = statusBar(page).getByTestId("status-bar-compose");
    await expect(compose).toBeVisible({ timeout: 10_000 });
    await compose.click();
    await expect(page.getByTestId("compose-strip")).toBeVisible();
    await expect(compose).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * Proves: either a narrow viewport or a coarse pointer selects the mobile
   * experience and removes the desktop status bar; only the coarse-pointer
   * case retains the terminal key toolbar.
   *
   * Steps:
   * 1. Open isolated narrow/fine and wide/coarse browser contexts.
   * 2. Navigate each context to `/default/1` and gate on mobile navigation.
   * 3. Assert the status bar is absent in both contexts.
   * 4. Assert the key toolbar is absent for fine input and visible for coarse
   *    input.
   */
  test("width or coarse pointer selects the mobile status-bar treatment", async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) throw new Error("Playwright baseURL is required");

    const cases = [
      { label: "narrow fine pointer", hasTouch: false, viewport: { width: 375, height: 812 } },
      { label: "wide coarse pointer", hasTouch: true, viewport: { width: 1440, height: 800 } },
    ];

    for (const device of cases) {
      const context = await browser.newContext({ baseURL, hasTouch: device.hasTouch, viewport: device.viewport });
      try {
        const page = await context.newPage();
        await mockBackend(page);
        await page.goto(`/${SERVER}/1`);
        await expect(page.getByRole("button", { name: "Toggle navigation" }), device.label).toBeVisible({
          timeout: 10_000,
        });
        await expect(statusBar(page), device.label).toHaveCount(0);
        if (device.hasTouch) {
          await expect(keyToolbar(page), device.label).toBeVisible();
        } else {
          await expect(keyToolbar(page), device.label).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
  });
});
