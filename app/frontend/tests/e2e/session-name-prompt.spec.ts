import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

const SEED_SESSION = `e2e-prompt-${Date.now()}`;
const TYPED_NAME = `e2e_named_${Date.now()}`;

/** True when a session with exactly `name` exists on the e2e tmux server. */
function tmuxHasSession(name: string): boolean {
  try {
    execFileSync("tmux", ["-L", TMUX_SERVER, "has-session", "-t", `=${name}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Open the palette, select `Session: Create` (exact — `Session: Create at
 *  Folder` shares the prefix), and return the prompt's name input. */
async function openPrompt(page: Page) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill("Session: Create");
  const option = page.getByRole("option", { name: "Session: Create", exact: true });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  const dialog = page.getByRole("dialog", { name: "New session" });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return { dialog, input: dialog.getByRole("textbox", { name: "Session name" }) };
}

test.describe("Session name prompt (Session: Create)", () => {
  test.beforeAll(() => {
    createSession(SEED_SESSION);
  });

  test.afterAll(() => {
    killSession(SEED_SESSION);
    // Best-effort teardown of sessions the tests create.
    killSession("session");
    killSession(TYPED_NAME);
  });

  test("Escape cancels — prompt closes, nothing is created", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const { dialog, input } = await openPrompt(page);

    // On /$server there is no current window, so the prefill is the bare
    // fallback base (deduped only if taken).
    const prefill = await input.inputValue();
    expect(prefill).toMatch(/^session(-\d+)?$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(tmuxHasSession(prefill)).toBe(false);
  });

  test("Enter accepts the prefilled default — today's behavior plus one keystroke", async ({
    page,
  }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const { dialog, input } = await openPrompt(page);

    const prefill = await input.inputValue();
    expect(prefill).toMatch(/^session(-\d+)?$/);
    await input.press("Enter");

    await expect(dialog).toHaveCount(0);
    // The created session surfaces as a tile on the /$server density view.
    await expect(page.getByTestId(`session-tile-${prefill}`)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("typing overrides the default — the typed name is created", async ({ page }) => {
    await gotoServerReady(page, TMUX_SERVER);
    const { dialog, input } = await openPrompt(page);

    // The prefill is select-all'd on open, so typing replaces it outright.
    await page.keyboard.type(TYPED_NAME);
    await expect(input).toHaveValue(TYPED_NAME);
    await input.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`session-tile-${TYPED_NAME}`)).toBeVisible({
      timeout: 10_000,
    });
  });
});
