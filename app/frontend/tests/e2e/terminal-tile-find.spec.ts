import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-ttyfind-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The pane's fixed payload: exactly three occurrences of "FAIL", printed once
// and then idled — the client-buffer content the search addon scans.
const PANE_COMMAND =
  "printf 'step-1 FAIL alpha\\nstep-2 FAIL beta\\nstep-3 FAIL gamma\\n'; sleep 300";

async function resolveWindowId(page: Page): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION)).windowId;
}

/** Deep-link the window's terminal route (default `single:tty` — ONE tile)
 *  and wait for the xterm surface. */
async function gotoTtyWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: READY_TIMEOUT });
}

/** Poll the registered terminal's buffer until all three FAIL lines landed —
 *  the relay attach + first-frame delay absorbed by polling, never a sleep. */
async function awaitPaneOutput(page: Page, windowId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((wid) => {
          const term = window.__rkTerminals?.[wid];
          if (!term) return -1;
          const buf = term.buffer.active;
          let count = 0;
          for (let y = 0; y < buf.length; y++) {
            const line = buf.getLine(y)?.translateToString(true) ?? "";
            count += line.split("FAIL").length - 1;
          }
          return count;
        }, windowId),
      { timeout: READY_TIMEOUT },
    )
    .toBe(3);
}

/** Focus the terminal so keydowns arrive through the xterm helper textarea —
 *  the chord then rides the terminal seam's shifted-tier refusal up to the
 *  window dispatcher. */
async function focusTerminal(page: Page): Promise<void> {
  await page.locator("[role='application']").click();
  await page.locator(".xterm-helper-textarea").focus();
}

const findBar = (page: Page) => page.getByTestId("terminal-find-bar");
const findInput = (page: Page) => findBar(page).getByLabel("Find query");
const findCounter = (page: Page) => findBar(page).getByLabel("Match count");
const findButton = (page: Page) => page.getByLabel("Find in terminal", { exact: true });
/** The addon's buffer-highlight decoration elements (DOM decoration layer,
 *  rendered regardless of the WebGL/canvas renderer choice). */
const findDecorations = (page: Page) => page.locator(".xterm-find-result-decoration");

test.describe("Terminal tile — find in buffer (260819-zqf9)", () => {
  // Setup per test (snapshot poll + route load + buffer poll) exceeds the
  // 10s default budget on a contended runner.
  test.setTimeout(process.env.CI ? 60_000 : 30_000);

  test.beforeAll(() => {
    createSession(TEST_SESSION, {
      windows: [{ name: "find", command: PANE_COMMAND }],
    });
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("(a) the chord opens the bar over real pane output; query counts + decorates; Enter navigates with wrap; Escape clears", async ({
    page,
  }) => {
    const windowId = await resolveWindowId(page);
    await gotoTtyWindow(page, windowId);
    await awaitPaneOutput(page, windowId);

    // ⇧Ctrl+F is the chord the Linux rig resolves (the binding's shifted base
    // tier; ⌘F on mac hosts). Pressed with terminal focus, it rides the
    // terminal seam's shifted-tier refusal up to the dispatcher.
    await focusTerminal(page);
    await page.keyboard.press("Shift+Control+f");
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
    await expect(findInput(page)).toBeFocused();
    await expect(findButton(page)).toHaveAttribute("aria-pressed", "true");

    // Three occurrences in the pane payload.
    await findInput(page).fill("FAIL");
    await expect(findCounter(page)).toHaveText("1/3");

    // Decorations: buffer highlights land in the DOM decoration layer (the
    // elements size with the render loop, so count/attach is the honest
    // signal — not visibility), and the overview ruler exists at all only
    // because the Terminal constructor carries the `overviewRuler` width
    // option.
    await expect
      .poll(() => findDecorations(page).count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
    await expect(page.locator(".xterm-decoration-overview-ruler")).toHaveCount(1);

    // The buffer-scope hint appears once a search has run.
    await expect(findBar(page).getByLabel("Search scope")).toHaveText(/since attach/);

    // Enter advances with wrap; Shift+Enter retreats.
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("2/3");
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("3/3");
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("1/3");
    await findInput(page).press("Shift+Enter");
    await expect(findCounter(page)).toHaveText("3/3");

    // Escape closes the bar, clears every decoration, and returns focus to
    // the pane.
    await findInput(page).press("Escape");
    await expect(findBar(page)).toHaveCount(0);
    await expect(findDecorations(page)).toHaveCount(0);
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  });

  test("(b) the ⌕ header button toggles the bar with the pressed/active state", async ({
    page,
  }) => {
    const windowId = await resolveWindowId(page);
    await gotoTtyWindow(page, windowId);
    await awaitPaneOutput(page, windowId);

    await expect(findButton(page)).toHaveAttribute("aria-pressed", "false");
    await findButton(page).click();
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
    await expect(findButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(findButton(page)).toHaveClass(/text-accent-green/);
    await findButton(page).click();
    await expect(findBar(page)).toHaveCount(0);
    await expect(findButton(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("(c) the `Terminal: Find` palette entry opens the bar (registry id-join hint)", async ({
    page,
  }) => {
    const windowId = await resolveWindowId(page);
    await gotoTtyWindow(page, windowId);
    await awaitPaneOutput(page, windowId);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Terminal: Find");
    const option = page.getByRole("option", { name: /Terminal: Find/ });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click();
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });
  });

  test("(d) zero-match reads 0/0; an invalid regex does not throw and the bar recovers", async ({
    page,
  }) => {
    const windowId = await resolveWindowId(page);
    await gotoTtyWindow(page, windowId);
    await awaitPaneOutput(page, windowId);

    await findButton(page).click();
    await expect(findBar(page)).toBeVisible({ timeout: 5_000 });

    // No-match query: the counter floors at 0/0 and navigation no-ops.
    await findInput(page).fill("ZZZZZ");
    await expect(findCounter(page)).toHaveText("0/0");
    await findInput(page).press("Enter");
    await expect(findCounter(page)).toHaveText("0/0");

    // Regex toggle + malformed pattern: the addon's throw is caught — the bar
    // stays open and functional.
    await findBar(page).getByLabel("Match regex").click();
    await findInput(page).fill("([");
    await expect(findBar(page)).toBeVisible();
    await expect(findCounter(page)).toHaveText("0/0");

    // Recovery: regex off, a real query finds again.
    await findBar(page).getByLabel("Match regex").click();
    await findInput(page).fill("FAIL");
    await expect(findCounter(page)).toHaveText("1/3");
  });
});
