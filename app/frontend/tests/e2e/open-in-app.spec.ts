import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Open-in-App split-button (260722-6d0f). Fully mocked — no tmux server, no
// wt on the host: the sessions payload rides the state-socket mock and the
// `wt open --list --json` registry is stubbed via page.route (`wt` has not
// shipped the flag yet — backlog [qj66] — so the real backend always serves
// `[]` here; the stub is what lights the control up). The e2e client is
// localhost, so the LOCAL view renders (host section only; the deeplink
// branch is remote-only and covered by Vitest — `location.hostname` cannot
// be non-local against the e2e server). See open-in-app.spec.md.

const SERVER = "default";

// One session, one window `@1` whose active pane carries the cwd the Open
// launch targets. The pane cwd (not just worktreePath) is included so the
// POST /api/open body assertion pins the active-pane-cwd derivation.
const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: 0,
        panes: [
          {
            paneId: "%1",
            paneIndex: 0,
            cwd: "/tmp/wt/sub",
            command: "zsh",
            isActive: true,
          },
        ],
      },
    ],
  },
]);

const WINDOW_URL = `/${SERVER}/%401`;

const REGISTRY = [
  { id: "vscode", label: "VS Code", kind: "editor" },
  { id: "iterm", label: "iTerm", kind: "terminal" },
];

/** Install the fully-mocked backend. `registry` drives the open-apps stub —
 *  `[]` reproduces the default deployment (wt without --list). */
async function mockBackend(page: Page, registry: unknown[]): Promise<void> {
  // Terminals mux socket: accept and hold open so the terminal route mounts
  // without a backend.
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* no-op */
  });

  // Window select during nav — trailing `*` required (query string).
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

  // The wt host-app registry (stubbed — the flag doesn't exist wt-side yet).
  await page.route("**/api/open-apps*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(registry),
    }),
  );

  await mockStateSocket(page, { sessions: sessionsPayload });
}

const openPrimary = (page: Page) => page.getByRole("button", { name: "Open in app" });
const openChevron = (page: Page) =>
  page.getByRole("button", { name: "Open in… (choose app)" });
const closeButton = (page: Page) => page.getByRole("button", { name: "Close pane" });

test.describe("Open-in-App split-button (260722-6d0f)", () => {
  test("renders with a stubbed registry; menu lists the host apps; launching POSTs the pane cwd", async ({
    page,
  }) => {
    await mockBackend(page, REGISTRY);

    // Record the launch POST instead of letting it reach the real backend.
    let openBody: unknown = null;
    await page.route("**/api/open?*", async (route) => {
      openBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"ok":true}',
      });
    });

    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(WINDOW_URL);
    // The Close pane button is the currentWindow-gated anchor proving the
    // sessions payload landed (the Open entry is additionally gated on the
    // async registry fetch, so it lands fractionally later).
    await expect(closeButton(page)).toBeVisible({ timeout: 10_000 });

    // The split-button renders in-bar at a wide viewport: primary + chevron.
    await expect(openPrimary(page)).toBeVisible({ timeout: 10_000 });
    await expect(openChevron(page)).toBeVisible();

    // Chevron opens the menu listing both host apps — flat list, NO "on host"
    // header (local client → single-kind list).
    await openChevron(page).click();
    const menu = page.getByRole("menu", { name: "Open in app" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "VS Code" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "iTerm" })).toBeVisible();
    await expect(menu.getByText("on host")).toHaveCount(0);

    // Launching a target POSTs the ACTIVE PANE's cwd (not the worktree path)
    // plus the wt app id, and closes the menu.
    await menu.getByRole("menuitem", { name: "iTerm" }).click();
    await expect.poll(() => openBody).toEqual({ path: "/tmp/wt/sub", app: "iterm" });
    await expect(menu).not.toBeVisible();

    // With a last-used target stored, the primary segment relabels to it.
    await expect(page.getByRole("button", { name: "Open in iTerm" })).toBeVisible();
  });

  test("every target is palette-reachable as an Open: entry (Constitution V)", async ({
    page,
  }) => {
    await mockBackend(page, REGISTRY);
    await page.goto(WINDOW_URL);
    await expect(closeButton(page)).toBeVisible({ timeout: 10_000 });
    // Wait for the registry-gated control before opening the palette (the
    // palette entries derive from the same async fetch).
    await expect(openPrimary(page)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Open:");
    await expect(page.getByRole("option", { name: "Open: VS Code" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Open: iTerm" })).toBeVisible();
  });

  test("absent in the default deployment (empty registry, no sshHost): no button, no menu rows, no palette entries", async ({
    page,
  }) => {
    await mockBackend(page, []);
    await page.goto(WINDOW_URL);
    await expect(closeButton(page)).toBeVisible({ timeout: 10_000 });

    // No split-button in the bar (nor its probe copy — role queries exclude
    // the aria-hidden probe anyway).
    await expect(openPrimary(page)).toHaveCount(0);
    await expect(openChevron(page)).toHaveCount(0);

    // No Open: rows in the overflow chevron menu.
    await page.getByRole("button", { name: "More controls" }).click();
    const overflowMenu = page.getByRole("menu", { name: "More controls" });
    await expect(overflowMenu).toBeVisible();
    await expect(overflowMenu.getByRole("menuitem", { name: /^Open:/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // No Open: palette entries.
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Open:");
    await expect(page.getByRole("option", { name: /^Open:/ })).toHaveCount(0);
  });
});
