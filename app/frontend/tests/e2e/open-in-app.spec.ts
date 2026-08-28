import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Open-in-App split-button. Fully mocked — no tmux server, no wt on the
// host: the sessions payload rides the state-socket mock and the
// `wt open --list --json` registry is stubbed via page.route (the e2e host
// may not carry a wt new enough for the flag — shipped in wt v0.1.5; the
// stub is what lights the control up deterministically). The e2e client is
// localhost, so the LOCAL view renders (host section only; the deeplink
// branch — including the derived `user@hostname` fallback and its
// remote-shows-deeplinks gate — is remote-only and covered by Vitest:
// `location.hostname` cannot be non-local against the e2e server).
// Routes installed per test via `mockBackend(page, registry)`:
// `**/api/servers` → a single server `default`; `**/api/open-apps*` → the
// stubbed registry (the VS Code entry uses the REAL wt registry id `code`,
// not `vscode`, so the test also pins the `code` → VS Code glyph mapping;
// `[]` reproduces the default local deployment); `**/api/windows/*/select*` →
// `{ok:true}`; the `/ws/terminals` mux socket is accepted and held open; the
// state socket carries one session `dev` with window `@1` "feature-work"
// whose ACTIVE pane's cwd `/tmp/wt/sub` is distinct from the window's
// `/tmp/wt` worktreePath, so the launch-body assertion pins the
// active-pane-cwd derivation. Each test navigates to the percent-encoded
// window route `/default/%401` and anchors on the ▦ Layout chip (the
// currentWindow gate) before asserting — the Open entry additionally waits on
// its own async registry fetch, so it gets its own visibility wait where
// needed.

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

// The wt host registry uses `code` (not `vscode`) for VS Code — mirroring the
// live wt v0.1.5 registry — so this also pins the code→VS-Code glyph mapping.
const REGISTRY = [
  { id: "code", label: "VS Code", kind: "editor" },
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
// The currentWindow-gated sync anchor: the ✕ left the bar (menuOnly, 260731-oiho)
// and the split chip followed (menuOnly in terminal mode, 260813-w1lf), so the
// ▦ Layout chip (`mode === "terminal" && currentWindow && layout` — the same
// gating semantics) is the anchor now.
const layoutAnchor = (page: Page) => page.getByRole("button", { name: "Layout", exact: true });

test.describe("Open-in-App split-button (260722-6d0f)", () => {
  /**
   * Proves: with host apps available, the split-button (primary "Open in app"
   * + chevron "Open in… (choose app)") renders in the right cluster at a wide
   * viewport; the chevron menu lists each registry app as a flat menuitem row
   * with NO "on host" section header (a local client sees a single-kind
   * list); each row leads with its resolved monochrome icon (`code` → the VS
   * Code brand glyph via `data-icon="vscode"`, iTerm → the generic
   * terminal-prompt glyph via `data-icon="terminal"` — kind fallback);
   * clicking a target POSTs `{path: <active pane cwd>, app: <wt app id>}` to
   * `/api/open` and closes the menu; and the primary segment relabels to the
   * last-used target ("Open in iTerm") after a launch.
   *
   * Steps:
   * 1. Install the mocked backend with a two-app registry (`code`/VS Code,
   *    `iterm`/iTerm) and a recording stub on the `/api/open` route glob.
   * 2. Set a 1440px viewport, navigate to `/default/%401`, wait for the
   *    ▦ Layout anchor.
   * 3. Assert the primary and chevron segments are visible in-bar.
   * 4. Click the chevron; assert the "Open in app" menu shows `VS Code` and
   *    `iTerm` rows and no "on host" text.
   * 5. Assert the VS Code row contains an `svg[data-icon='vscode']` glyph and
   *    the iTerm row an `svg[data-icon='terminal']` glyph.
   * 6. Click `iTerm`; poll the recorded POST body until it equals
   *    `{path: "/tmp/wt/sub", app: "iterm"}`; assert the menu closed.
   * 7. Assert the primary segment now reads "Open in iTerm" (last-used
   *    persisted).
   */
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
    // The ▦ Layout chip is the currentWindow-gated anchor proving the
    // sessions payload landed (the Open entry is additionally gated on the
    // async registry fetch, so it lands fractionally later).
    await expect(layoutAnchor(page)).toBeVisible({ timeout: 10_000 });

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

    // Each host row leads with its resolved monochrome glyph (260722-fc3b):
    // the wt id `code` maps to the VS Code brand glyph; iTerm (unknown id,
    // kind terminal) falls back to the generic prompt glyph.
    await expect(
      menu.getByRole("menuitem", { name: "VS Code" }).locator("svg[data-icon='vscode']"),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "iTerm" }).locator("svg[data-icon='terminal']"),
    ).toBeVisible();

    // Launching a target POSTs the ACTIVE PANE's cwd (not the worktree path)
    // plus the wt app id, and closes the menu.
    await menu.getByRole("menuitem", { name: "iTerm" }).click();
    await expect.poll(() => openBody).toEqual({ path: "/tmp/wt/sub", app: "iterm" });
    await expect(menu).not.toBeVisible();

    // With a last-used target stored, the primary segment relabels to it.
    await expect(page.getByRole("button", { name: "Open in iTerm" })).toBeVisible();
  });

  /**
   * Proves: each available open target registers a command-palette entry
   * (`Open: VS Code`, `Open: iTerm`), keeping the control keyboard-first.
   * (Palette rows stay text-only — icons are a menu-row affordance.)
   *
   * Steps:
   * 1. Install the mocked backend with the two-app registry; navigate and
   *    wait for the ▦ Layout anchor, then for the Open primary segment (the
   *    registry fetch landed).
   * 2. Open the palette (`Meta+k`), type `Open:`.
   * 3. Assert both `Open: VS Code` and `Open: iTerm` options are listed.
   */
  test("every target is palette-reachable as an Open: entry (Constitution V)", async ({
    page,
  }) => {
    await mockBackend(page, REGISTRY);
    await page.goto(WINDOW_URL);
    await expect(layoutAnchor(page)).toBeVisible({ timeout: 10_000 });
    // Wait for the registry-gated control before opening the palette (the
    // palette entries derive from the same async fetch).
    await expect(openPrimary(page)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Open:");
    await expect(page.getByRole("option", { name: "Open: VS Code" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Open: iTerm" })).toBeVisible();
  });

  /**
   * Proves: the zero-target state on a local client (empty registry —
   * sshHost/sshUser never mattered locally, and the remote-shows-deeplinks
   * gate cannot fire on `localhost`; the remote gate is covered by Vitest)
   * renders NO Open surface anywhere — bar, overflow chevron menu, and
   * palette all stay clean, so the existing top-bar chrome specs (overflow
   * pyramid, overlap sweep) are unaffected by this feature in the default e2e
   * environment.
   *
   * Steps:
   * 1. Install the mocked backend with an EMPTY registry; navigate and wait
   *    for the ▦ Layout anchor.
   * 2. Assert neither split-button segment exists (role queries — the
   *    aria-hidden measurement probe is excluded).
   * 3. Open the "More controls" chevron menu; assert it contains no `Open:`
   *    rows; close it with Escape.
   * 4. Open the palette, type `Open:`; assert no `Open:` options are listed.
   */
  test("absent in the default local deployment (empty registry): no button, no menu rows, no palette entries", async ({
    page,
  }) => {
    await mockBackend(page, []);
    await page.goto(WINDOW_URL);
    await expect(layoutAnchor(page)).toBeVisible({ timeout: 10_000 });

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
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Open:");
    await expect(page.getByRole("option", { name: /^Open:/ })).toHaveCount(0);
  });
});
