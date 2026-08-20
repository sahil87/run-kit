import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the state-socket `sessions` payload +
// server list via page.route, then drive the keyboard. See
// shortcut-registry.spec.md for intent + steps.
//
// Keyboard shortcut registry (260730-g40a): the `Shift+CmdOrCtrl+<key>`
// run-kit action tier, the window-level dispatcher, the shortcuts surface —
// the settings dialog's Shortcuts tab since 260818-bncw (⇧CmdOrCtrl+/ on
// Win/Linux hosts, demoted to ⌘/ on mac — 260730-n789),
// click-to-capture rebinding persisted to
// localStorage["runkit-keybindings"], palette `shortcut` hints from the
// effective map, and browser-reserved key inertness (Playwright runs a plain
// browser host, so shifted N/T/W resolve disabled). Also covers the macOS
// ⌘-tier demotions (260730-n789) via a spoofed-platform block (deep mac
// paths are unit-tested in lib/keybindings.test.ts — e2e runs on Linux) and
// the split-pane chords (260807-rbx5): the divider pair ⇧Ctrl+\/⇧Ctrl+- here,
// ⌘D/⇧⌘D on a spoofed mac (the `macCode` refinement). Plus the VS
// Code-aligned chrome chords: the stateful sidebar chord on B (⇧Ctrl+B here,
// ⌘B on the spoofed mac), the stateful code-tile chord on 2 (⇧Ctrl+2 / ⌘2 —
// 260819-qwr7 R4/R5), and the tty↔code focus hop on Backquote
// (⇧Ctrl+` here; ⌃` on the spoofed mac — the seam's mac-only ctrl-tier
// refusal rule). Plus the tabbed-dialog deep-links (260818-bncw): the
// three-state `shortcuts-overlay` toggle, the pure-opener `settings-open`,
// pointer/arrow tab switching, and the `Settings: Appearance` palette action.

const SERVER = "default";

function sessionsPayload() {
  const win = (id: number, name: string, active: boolean) => ({
    windowId: `@${id}`,
    index: id - 1,
    name,
    worktreePath: `/tmp/${name}`,
    activity: active ? "active" : "idle",
    isActiveWindow: active,
    activityTimestamp: 0,
    agentState: "idle",
  });
  return JSON.stringify([
    {
      name: "dev",
      windows: [win(1, "win-one", true), win(2, "win-two", false), win(3, "win-three", false)],
    },
  ]);
}

async function mockBackend(page: Page, sessionsJson?: string) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
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
  // Curated tmux keybindings for the overlay's read-only TMUX section
  // (260801-sm6g — the merged shortcuts surface fetches these while open).
  await page.route("**/api/keybindings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { key: "F2", table: "root", command: "new-window", label: "New tmux window" },
        { key: "S-F7", table: "root", command: "copy-mode", label: "Scroll / copy mode" },
        { key: "\\", table: "prefix", command: "split-window -h", label: "Split horizontally" },
      ]),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsJson ?? sessionsPayload() });
}

/** The default payload with `gitRoot` stamped on window @1 — code-capable
 *  (the code surface's availability is the window's derived gitRoot). */
function codeCapablePayload(): string {
  const payload = JSON.parse(sessionsPayload()) as [
    { windows: Record<string, unknown>[] },
  ];
  payload[0].windows[0].gitRoot = "/tmp/win-one";
  return JSON.stringify(payload);
}

async function gotoWindowOne(page: Page) {
  await page.goto(`/${SERVER}/1`);
  await expect(page.getByText("win-one").first()).toBeVisible();
}

test.describe("shifted-tier window cycling", () => {
  test("Shift+Ctrl+L / Shift+Ctrl+H cycle the current session's windows with wraparound", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    // Next: @1 → @2 → @3, then wrap to @1.
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/3(?:$|[/?#])`));
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));

    // Previous wraps backward from @1 to @3.
    await page.keyboard.press("Shift+Control+KeyH");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/3(?:$|[/?#])`));
  });

  test("Shift+Ctrl+[ / Shift+Ctrl+] retrace history (back / forward)", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));

    await page.keyboard.press("Shift+Control+BracketLeft");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));

    await page.keyboard.press("Shift+Control+BracketRight");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });
});

test.describe("shortcuts overlay", () => {
  // The overlay's body is the settings dialog's Shortcuts tab now
  // (260818-bncw): the chord deep-links into the one dialog, and the panel
  // carries its own testid inside `dialog[name=Settings]`.
  const settingsDialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
  const shortcutsPanel = (page: Page) => page.getByTestId("settings-shortcuts-panel");

  test("Shift+CmdOrCtrl+/ toggles the Shortcuts tab; filter narrows; Escape closes", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    const panel = shortcutsPanel(page);
    await expect(panel).toBeVisible();
    // The chord deep-links: the dialog opened ON the Shortcuts tab.
    await expect(settingsDialog(page).getByRole("tab", { name: "Shortcuts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Filter narrows rows and hides empty groups.
    await page.getByLabel("Filter shortcuts").fill("waiting");
    await expect(panel.getByText("Next waiting agent")).toBeVisible();
    await expect(panel.getByText("New session")).toHaveCount(0);

    // The chord toggles the dialog closed even from the filter input
    // (`ignoreInputs`), then reopen and close via Escape.
    await page.keyboard.press("Shift+Control+Slash");
    await expect(settingsDialog(page)).toHaveCount(0);
    await page.keyboard.press("Shift+Control+Slash");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
  });

  test("the Help: Keyboard Shortcuts palette entry opens the Shortcuts tab", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Help: Keyboard Shortcuts");
    await page.keyboard.press("Enter");
    await expect(shortcutsPanel(page)).toBeVisible();
  });

  test("the merged surface carries the jump nav and the read-only tmux section (260801-sm6g)", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    await expect(shortcutsPanel(page)).toBeVisible();

    // Sticky jump-nav chips, one per section.
    const nav = page.getByTestId("shortcuts-jump-nav");
    for (const chip of ["key map", "global", "terminal", "board", "tmux"]) {
      await expect(nav.getByText(chip, { exact: true })).toBeVisible();
    }

    // TMUX locked section from the mocked GET /api/keybindings: Direct rows,
    // and a Prefix row rendered as a Ctrl S then \ sequence.
    const tmux = page.getByTestId("tmux-section");
    await expect(tmux.getByText("Scroll / copy mode")).toBeVisible();
    await expect(tmux.getByText("Split horizontally")).toBeVisible();
    // `exact` — the Prefix SUBHEAD also contains "then" ("Ctrl+S, then key").
    await expect(tmux.getByText("then", { exact: true })).toBeVisible();

    // One filter spans app + tmux: the tmux hit stays visible and the chips
    // grow live match counts (global dims at zero).
    await page.getByLabel("Filter shortcuts").fill("split");
    await expect(tmux.getByText("Split horizontally")).toBeVisible();
    await expect(nav.locator("button", { hasText: "tmux" })).toContainText("1");
    await expect(nav.locator("button", { hasText: "global" })).toContainText("0");
  });

  test("the legacy Help: tmux Keybindings palette entry is gone (260801-sm6g)", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("tmux Keybindings");
    await expect(page.getByText("Help: tmux Keybindings")).toHaveCount(0);
    // The shortcuts entry is the single shortcuts surface.
    await paletteInput.fill("Keyboard Shortcuts");
    await expect(page.getByText("Help: Keyboard Shortcuts")).toBeVisible();
  });

  test("click-to-capture rebinds, persists the diff, and the new chord dispatches", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    await expect(shortcutsPanel(page)).toBeVisible();

    await page.getByLabel("Change binding for Next window").click();
    await page.keyboard.press("Shift+Control+KeyU");

    // The diff persisted to localStorage["runkit-keybindings"].
    const stored = await page.evaluate(() => localStorage.getItem("runkit-keybindings"));
    expect(JSON.parse(stored ?? "{}")).toEqual({
      "window-next": { code: "KeyU", tier: "shifted" },
    });

    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);

    // The rebound chord dispatches; the vacated default no longer does.
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
    await page.keyboard.press("Shift+Control+KeyU");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });
});

// Tabbed settings dialog (260818-bncw): the two chords' deep-link semantics —
// `settings-open` a pure opener, `shortcuts-overlay` a three-state toggle —
// plus the per-tab palette action and the pointer/arrow tab navigation.
test.describe("tabbed settings dialog deep-links (260818-bncw)", () => {
  const settingsDialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });
  const tab = (page: Page, name: string) =>
    settingsDialog(page).getByRole("tab", { name, exact: true });

  test("settings-open lands on General; the shortcuts chord switches tabs without closing; re-fire is a no-op", async ({
    page,
  }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    // ⇧Ctrl+, opens on General (the pure opener).
    await page.keyboard.press("Shift+Control+Comma");
    await expect(settingsDialog(page)).toBeVisible();
    await expect(tab(page, "General")).toHaveAttribute("aria-selected", "true");
    await expect(settingsDialog(page).getByLabel("Instance name")).toBeVisible();

    // ⇧Ctrl+/ while open on General SWITCHES to Shortcuts (no close).
    await page.keyboard.press("Shift+Control+Slash");
    await expect(settingsDialog(page)).toBeVisible();
    await expect(tab(page, "Shortcuts")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("settings-shortcuts-panel")).toBeVisible();

    // ⇧Ctrl+, while open on Shortcuts: no-op — never closes, never yanks.
    await page.keyboard.press("Shift+Control+Comma");
    await expect(settingsDialog(page)).toBeVisible();
    await expect(tab(page, "Shortcuts")).toHaveAttribute("aria-selected", "true");

    // ⇧Ctrl+/ while open on Shortcuts closes (the toggle's second state).
    await page.keyboard.press("Shift+Control+Slash");
    await expect(settingsDialog(page)).toHaveCount(0);
  });

  test("tabs switch by pointer and by roving arrow keys", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Comma");
    await expect(settingsDialog(page)).toBeVisible();

    // Pointer: Appearance shows the theme controls.
    await tab(page, "Appearance").click();
    await expect(tab(page, "Appearance")).toHaveAttribute("aria-selected", "true");
    await expect(settingsDialog(page).getByRole("group", { name: "Theme mode" })).toBeVisible();

    // Roving arrow keys: ArrowDown from the focused tab activates the next.
    await tab(page, "Appearance").focus();
    await page.keyboard.press("ArrowDown");
    await expect(tab(page, "Shortcuts")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Shortcuts")).toBeFocused();
  });

  test("the Settings: Appearance palette action deep-links the Appearance tab", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Settings: Appearance");
    await expect(page.getByText("Settings: Appearance")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(settingsDialog(page)).toBeVisible();
    await expect(tab(page, "Appearance")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("palette hints", () => {
  test("registered palette entries render effective per-platform combos", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Agent: Next waiting");
    // Playwright runs a non-mac browser host → "Shift+Ctrl+A".
    await expect(page.getByText("Shift+Ctrl+A")).toBeVisible();
  });
});

// Spoof macOS platform detection (260730-n789): `detectPlatform()` probes
// `navigator.platform` + userAgent, so an init-script getter override makes
// the SPA resolve the mac per-platform defaults on the Linux CI browser.
// Deep mac behavior (shell-host demotions, claims) is unit-test territory —
// this exercises the resolved wiring end-to-end where the platform is the
// only mac-specific input.
async function spoofMacPlatform(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => "MacIntel",
      configurable: true,
    });
  });
}

test.describe("macOS per-platform defaults (spoofed platform)", () => {
  test("⌘[ / ⌘] retrace history on a mac host; the shifted default is vacated", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    await gotoWindowOne(page);

    // H/L stay shifted on macOS — window cycling is unchanged.
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));

    // The demoted ⌘ tier drives history (pressed with Meta, while the
    // terminal owns focus — exercising the mac seam refusal).
    await page.keyboard.press("Meta+BracketLeft");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
    await page.keyboard.press("Meta+BracketRight");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));

    // The old shifted combo no longer matches on a mac host.
    await page.keyboard.press("Shift+Control+BracketLeft");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });

  test("⌘/ toggles the Shortcuts tab on a mac host and the ⌘ map layer is selectable", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+Slash");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const panel = page.getByTestId("settings-shortcuts-panel");
    await expect(panel).toBeVisible();
    // Display initializes from the detected (spoofed mac) host → the map
    // header offers the ⌘ modifier layer (260801-r8j2), ⇧⌘ selected by
    // default.
    const picker = panel.getByRole("group", { name: "Keyboard map modifier" });
    await expect(picker).toBeVisible();
    const cmdOption = picker.getByRole("button", { name: "⌘", exact: true });
    await expect(cmdOption).toHaveAttribute("aria-pressed", "false");
    // Selecting ⌘ renders the ⌘ layer — KeyL shows the web-address binding's
    // "address" keycap (⌘L, 260819-v6y4; on the shifted layer the same key
    // reads "next win", so this cell proves the layer swap). The old
    // mac-browser "address bar" claim on ⌘L is removed.
    await cmdOption.click();
    await expect(cmdOption).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator('[title="address"]')).toBeVisible();
    await expect(panel.locator('[title="address bar"]')).toHaveCount(0);
    await page.keyboard.press("Meta+Slash");
    await expect(dialog).toHaveCount(0);
  });

  test("⌘N and ⇧⌘N stay inert in a mac browser host (create-session palette-only)", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    let created = false;
    await page.route("**/api/sessions*", (route) => {
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      }
      return route.fallback();
    });
    await gotoWindowOne(page);

    // N demotes only inside the desktop shell; a mac BROWSER keeps it
    // reserved on both tiers.
    await page.keyboard.press("Meta+KeyN");
    await page.keyboard.press("Shift+Meta+KeyN");
    await page.waitForTimeout(300);
    expect(created).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
  });

  test("⌘B runs the stateful sidebar chord on a mac host (both mac hosts — no shell gate)", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    await gotoWindowOne(page);

    const sidebar = page.locator('aside[aria-label="Sidebar"]');
    const currentRow = page
      .locator("nav[aria-label='Sessions']")
      .locator('[data-window-id] [aria-current="page"]');
    await expect(currentRow).toBeVisible();

    // The stateful chord (260819-qwr7 R5): focus the current row (sidebar
    // stays open) → hide + return on the second press → reopen + refocus.
    await expect(sidebar).toBeVisible();
    await page.keyboard.press("Meta+KeyB");
    await expect(currentRow).toBeFocused();
    await page.keyboard.press("Meta+KeyB");
    await expect(sidebar).toHaveCount(0);
    await page.keyboard.press("Meta+KeyB");
    await expect(sidebar).toBeVisible();
    await expect(currentRow).toBeFocused();
  });

  test("⌘2 is inert in a mac BROWSER host (the browser's tab claim); ⌃` hops focus", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page, codeCapablePayload());
    await gotoWindowOne(page);

    const codeTile = page.getByTestId("surface-tile-code");
    const ttyTile = page.getByTestId("surface-tile-tty");

    // ⌘1–9 are the mac browser's tab-switching claims (MAC_BROWSER_CMD_CLAIMS),
    // so the ⌘2 tile chord resolves `reserved` (palette-only) here — the press
    // dispatches nothing (260819-qwr7 R2). The chord works in the mac SHELL.
    await expect(codeTile).toHaveCount(0);
    await page.keyboard.press("Meta+Digit2");
    await page.waitForTimeout(300);
    await expect(codeTile).toHaveCount(0);

    // ⌃` (the ctrl-tier refusal rule 3 under terminal focus) opens the
    // tile and hops focus to it; a second ⌃` hops back to the tty.
    await page.keyboard.press("Control+Backquote");
    await expect(codeTile).toBeVisible({ timeout: 10_000 });
    await expect(codeTile).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Control+Backquote");
    await expect(ttyTile).toHaveClass(/border-accent-green/);
    await expect(codeTile).not.toHaveClass(/border-accent-green/);
  });
});

// Split chords (260807-rbx5): the divider pair ⇧Ctrl+\/⇧Ctrl+- on Win/Linux
// and ⌘D / ⇧⌘D on mac (the `macCode` refinement) reuse the
// `Window: Split Horizontal|Vertical` palette bodies, so the assertion is
// the spawned `POST /api/windows/{id}/split` body. Both bound on every host.
async function mockSplit(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  // Trailing `*` — the client appends `?server=`.
  await page.route("**/api/windows/*/split*", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true,"pane_id":"%2"}',
    });
  });
  return bodies;
}

test.describe("split chords (260807-rbx5)", () => {
  test("Shift+Ctrl+\\ and Shift+Ctrl+- split side-by-side then stacked on the terminal route", async ({ page }) => {
    await mockBackend(page);
    const splits = await mockSplit(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Backslash");
    await expect.poll(() => splits.length).toBe(1);
    await page.keyboard.press("Shift+Control+Minus");
    await expect.poll(() => splits.length).toBe(2);
    expect(splits).toEqual([
      { horizontal: true, cwd: "/tmp/win-one" },
      { horizontal: false, cwd: "/tmp/win-one" },
    ]);
  });

  test("the palette hints both splits with the divider-pair chords", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Window: Split");
    await expect(page.getByText("Window: Split Horizontal")).toBeVisible();
    await expect(page.getByText("Window: Split Vertical")).toBeVisible();
    // One hint each: horizontal's ⇧Ctrl+\ and vertical's ⇧Ctrl+-.
    await expect(page.getByText("Shift+Ctrl+\\")).toHaveCount(1);
    await expect(page.getByText("Shift+Ctrl+-")).toHaveCount(1);
  });

  test("⌘D and ⇧⌘D split horizontally then vertically on a mac host", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    const splits = await mockSplit(page);
    await gotoWindowOne(page);

    // Both chords land while the terminal owns focus — ⌘D exercises the mac
    // cmd-tier seam refusal, ⇧⌘D the shifted-tier one.
    await page.keyboard.press("Meta+KeyD");
    await expect.poll(() => splits.length).toBe(1);
    await page.keyboard.press("Shift+Meta+KeyD");
    await expect.poll(() => splits.length).toBe(2);
    expect(splits).toEqual([
      { horizontal: true, cwd: "/tmp/win-one" },
      { horizontal: false, cwd: "/tmp/win-one" },
    ]);
  });
});

test.describe("VS Code-aligned chrome chords (B / 2 / Backquote)", () => {
  const sidebar = (page: Page) => page.locator('aside[aria-label="Sidebar"]');
  const codeTile = (page: Page) => page.getByTestId("surface-tile-code");
  const ttyTile = (page: Page) => page.getByTestId("surface-tile-tty");

  test("Shift+Ctrl+B runs the stateful sidebar chord: focus the current row, then hide, then reopen+focus", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    const currentRow = page
      .locator("nav[aria-label='Sessions']")
      .locator('[data-window-id] [aria-current="page"]');
    await expect(currentRow).toBeVisible();

    // First press (visible, focus outside): focus the current window's row —
    // the sidebar stays open (the stateful chord, 260819-qwr7 R5).
    await expect(sidebar(page)).toBeVisible();
    await page.keyboard.press("Shift+Control+KeyB");
    await expect(currentRow).toBeFocused();
    await expect(sidebar(page)).toBeVisible();
    // Second press (focus inside): hide + return. Third (hidden): reopen +
    // refocus the row.
    await page.keyboard.press("Shift+Control+KeyB");
    await expect(sidebar(page)).toHaveCount(0);
    await page.keyboard.press("Shift+Control+KeyB");
    await expect(sidebar(page)).toBeVisible();
    await expect(currentRow).toBeFocused();
  });

  test("Shift+Ctrl+2 toggles the code tile on a code-capable window", async ({ page }) => {
    await mockBackend(page, codeCapablePayload());
    await gotoWindowOne(page);

    // The stateful tile chord (260819-qwr7 R4): hidden → open + focus on
    // landing; focused at arity 2 → hide + restore.
    await expect(codeTile(page)).toHaveCount(0);
    await page.keyboard.press("Shift+Control+Digit2");
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeTile(page)).toHaveClass(/border-accent-green/);
    await page.keyboard.press("Shift+Control+Digit2");
    // Hide-never-unmount: the closed tile stays mounted, hidden.
    await expect(codeTile(page)).toBeHidden({ timeout: 10_000 });
  });

  test("Shift+Ctrl+` opens the closed code tile and hops focus, then hops back to the tty", async ({
    page,
  }) => {
    await mockBackend(page, codeCapablePayload());
    await gotoWindowOne(page);

    // Open-then-focus: the closed code tile opens AND takes the focused-tile
    // accent border (slot A / tty is the default focus).
    await expect(ttyTile(page)).toBeVisible();
    await page.keyboard.press("Shift+Control+Backquote");
    await expect(codeTile(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeTile(page)).toHaveClass(/border-accent-green/);
    await expect(ttyTile(page)).not.toHaveClass(/border-accent-green/);

    // Second press hops focus back to the tty tile (no close — it's a hop).
    await page.keyboard.press("Shift+Control+Backquote");
    await expect(ttyTile(page)).toHaveClass(/border-accent-green/);
    await expect(codeTile(page)).not.toHaveClass(/border-accent-green/);
    await expect(codeTile(page)).toBeVisible();
  });
});

test.describe("browser-reserved keys", () => {
  test("Shift+Ctrl+N is inert in a browser host (create-session stays palette-only)", async ({ page }) => {
    await mockBackend(page);
    let created = false;
    await page.route("**/api/sessions*", (route) => {
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      }
      return route.fallback();
    });
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+KeyN");
    // Give a would-be dispatch time to fire the POST, then assert it did not.
    await page.waitForTimeout(300);
    expect(created).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
  });
});
