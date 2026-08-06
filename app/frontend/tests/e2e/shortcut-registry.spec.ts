import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the state-socket `sessions` payload +
// server list via page.route, then drive the keyboard. See
// shortcut-registry.spec.md for intent + steps.
//
// Keyboard shortcut registry (260730-g40a): the `Shift+CmdOrCtrl+<key>`
// run-kit action tier, the window-level dispatcher, the cheatsheet overlay
// (⇧CmdOrCtrl+/ on Win/Linux hosts, demoted to ⌘/ on mac — 260730-n789),
// click-to-capture rebinding persisted to
// localStorage["runkit-keybindings"], palette `shortcut` hints from the
// effective map, and browser-reserved key inertness (Playwright runs a plain
// browser host, so shifted N/T/W resolve disabled). Also covers the macOS
// ⌘-tier demotions (260730-n789) via a spoofed-platform block (deep mac
// paths are unit-tested in lib/keybindings.test.ts — e2e runs on Linux).

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

async function mockBackend(page: Page) {
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
  await mockStateSocket(page, { sessions: sessionsPayload() });
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
  test("Shift+CmdOrCtrl+/ toggles the overlay; filter narrows; Escape closes", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    const overlay = page.getByTestId("shortcuts-overlay");
    await expect(overlay).toBeVisible();

    // Filter narrows rows and hides empty groups.
    await page.getByLabel("Filter shortcuts").fill("waiting");
    await expect(overlay.getByText("Next waiting agent")).toBeVisible();
    await expect(overlay.getByText("New session")).toHaveCount(0);

    // The chord toggles the sheet closed even from the filter input
    // (`ignoreInputs`), then reopen and close via Escape.
    await page.keyboard.press("Shift+Control+Slash");
    await expect(overlay).toHaveCount(0);
    await page.keyboard.press("Shift+Control+Slash");
    await expect(overlay).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  });

  test("the Help: Keyboard Shortcuts palette entry opens the overlay", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Help: Keyboard Shortcuts");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();
  });

  test("the merged overlay carries the jump nav and the read-only tmux section (260801-sm6g)", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();

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
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("tmux Keybindings");
    await expect(page.getByText("Help: tmux Keybindings")).toHaveCount(0);
    // The overlay entry is the single shortcuts surface.
    await paletteInput.fill("Keyboard Shortcuts");
    await expect(page.getByText("Help: Keyboard Shortcuts")).toBeVisible();
  });

  test("click-to-capture rebinds, persists the diff, and the new chord dispatches", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Shift+Control+Slash");
    await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();

    await page.getByLabel("Change binding for Next window").click();
    await page.keyboard.press("Shift+Control+KeyU");

    // The diff persisted to localStorage["runkit-keybindings"].
    const stored = await page.evaluate(() => localStorage.getItem("runkit-keybindings"));
    expect(JSON.parse(stored ?? "{}")).toEqual({
      "window-next": { code: "KeyU", tier: "shifted" },
    });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-overlay")).toHaveCount(0);

    // The rebound chord dispatches; the vacated default no longer does.
    await page.keyboard.press("Shift+Control+KeyL");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
    await page.keyboard.press("Shift+Control+KeyU");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/2(?:$|[/?#])`));
  });
});

test.describe("palette hints", () => {
  test("registered palette entries render effective per-platform combos", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
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

  test("⌘/ toggles the overlay on a mac host and the ⌘ map layer is selectable", async ({ page }) => {
    await spoofMacPlatform(page);
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+Slash");
    const overlay = page.getByTestId("shortcuts-overlay");
    await expect(overlay).toBeVisible();
    // Display initializes from the detected (spoofed mac) host → the map
    // header offers the ⌘ modifier layer (260801-r8j2), ⇧⌘ selected by
    // default.
    const picker = overlay.getByRole("group", { name: "Keyboard map modifier" });
    await expect(picker).toBeVisible();
    const cmdOption = picker.getByRole("button", { name: "⌘", exact: true });
    await expect(cmdOption).toHaveAttribute("aria-pressed", "false");
    // Selecting ⌘ renders the ⌘ layer — the mac-browser claimed set appears
    // (⌘L is the browser's address bar).
    await cmdOption.click();
    await expect(cmdOption).toHaveAttribute("aria-pressed", "true");
    await expect(overlay.locator('[title="address bar"]')).toBeVisible();
    await page.keyboard.press("Meta+Slash");
    await expect(overlay).toHaveCount(0);
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
