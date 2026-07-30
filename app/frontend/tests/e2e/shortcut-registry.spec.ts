import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/gh) — inject the state-socket `sessions` payload +
// server list via page.route, then drive the keyboard. See
// shortcut-registry.spec.md for intent + steps.
//
// Keyboard shortcut registry (260730-g40a): the uniform `Shift+CmdOrCtrl`
// run-kit tier, the window-level dispatcher, the cheatsheet overlay
// (⇧CmdOrCtrl+/), click-to-capture rebinding persisted to
// localStorage["runkit-keybindings"], palette `shortcut` hints from the
// effective map, and browser-reserved key inertness (Playwright runs a plain
// browser host, so shifted N/T/W resolve disabled).

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

  test("the Help: Shortcuts palette entry opens the overlay", async ({ page }) => {
    await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Help: Shortcuts");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();
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
