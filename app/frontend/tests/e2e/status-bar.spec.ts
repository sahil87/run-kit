import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Status bar e2e (260814-ldbs-shell-stage-status-bar; R3/R4/R5). Fully mocked
// (no tmux/gh) — the pane-register-panel.spec.ts / tooltips.spec.ts idiom: the
// state socket delivers one session with two windows, plus host-metrics and
// version slots for the host cluster. See status-bar.spec.md for intent +
// steps.
//
// Subjects: the full-width attached status strip at the shell bottom
// (desktop-only), the fine-pointer bottom-bar DELETION, the window-cluster /
// host-cluster route split, and the no-scroll degradation ladder with the `…`
// overflow chevron.

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

  test("server route (no window): host cluster only — no window cluster, no errors", async ({ page }) => {
    await page.goto(`/${SERVER}`);
    await expect(statusBar(page)).toBeVisible({ timeout: 10_000 });
    await expect(windowCluster(page)).toHaveCount(0);
    await expect(hostCluster(page).getByText("e2e-box")).toBeVisible();
    await expect(hostCluster(page).getByText(SERVER)).toBeVisible();
    await expect(keyToolbar(page)).toHaveCount(0);
  });

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

  test("the compose hint opens the compose strip (the relocated bottom-bar affordance)", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    const compose = statusBar(page).getByTestId("status-bar-compose");
    await expect(compose).toBeVisible({ timeout: 10_000 });
    await compose.click();
    await expect(page.getByTestId("compose-strip")).toBeVisible();
    await expect(compose).toHaveAttribute("aria-pressed", "true");
  });

  test("mobile viewport: no status bar at all (the drawer keeps the panels)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/${SERVER}/1`);
    // Gate on the terminal chrome, not the sidebar-footed Connected dot (the
    // mobile drawer leaves it unmounted).
    await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(statusBar(page)).toHaveCount(0);
  });

  // The revised device rule (rework cycle 1, R3/A-013): `useIsMobile()` is
  // width-OR-coarse, so a coarse desktop-width device (iPad) renders the
  // MOBILE experience app-wide — chip bar, drawer panels, NO status bar. The
  // status bar exists exactly where the desktop grids exist (`!isMobile`).
  // `hasTouch` flips Chromium's `(pointer: coarse)` at a DESKTOP width (the
  // bottom-bar-chip-size seam).
  test.describe("coarse pointer at desktop width (the iPad seam)", () => {
    test.use({ hasTouch: true, viewport: { width: 1440, height: 800 } });

    test("coarse + wide = mobile experience: chip bar present, NO status bar", async ({ page }) => {
      await page.goto(`/${SERVER}/1`);
      // Mobile chrome at desktop width: the hamburger and (coarse) chip bar…
      await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible({
        timeout: 10_000,
      });
      await expect(keyToolbar(page)).toBeVisible();
      // …and NO status bar (the gate is `!isMobile` on every route).
      await expect(statusBar(page)).toHaveCount(0);
    });
  });
});
