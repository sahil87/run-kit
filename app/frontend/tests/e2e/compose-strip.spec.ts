import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { pinWindow } from "./_boards";
import { resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

/**
 * Docked compose strip (260718-dhdj) e2e coverage. The strip replaces the modal
 * ComposeBuffer: it is a single global surface docked above the bottom bar,
 * toggled by the `>_` chip / `View: Text Input` palette action, persisted as a
 * chrome preference, sending to the LIVE focused pane. Enter matrix
 * (260802-lj98, terminal-faithful): plain Enter = insert line (`text + "\n"`,
 * clears the draft; empty Enter is a full no-op); Cmd/Ctrl+Enter = submit
 * (`text + "\r"`; EMPTY textarea sends a bare `\r` — "press Enter in the
 * pane"); Alt+Enter = chord-only byte-exact raw insert; Shift+Enter is the
 * only local newline. Drafts are PER TARGET (260801-cyth): keyed by the
 * focused window and persisted (text only) to localStorage, so they stay with
 * their addressee across navigation and survive reloads. See the sibling
 * `.spec.md` for the per-test contract.
 */

const TERM_SESSION = `e2e-compose-${Date.now()}`;
const BOARD_SESSION = `e2e-compose-board-${Date.now()}`;
const BOARD_NAME = `cs${Date.now().toString().slice(-6)}`;

function tmux(cmd: string): void {
  execSync(`tmux -L ${TMUX_SERVER} ${cmd}`, { stdio: "ignore" });
}

function tmuxCapture(session: string): string {
  return execSync(`tmux -L ${TMUX_SERVER} capture-pane -p -t ${session}`, {
    encoding: "utf8",
  });
}

async function resolveWindowId(
  page: import("@playwright/test").Page,
  session: string,
  name?: string,
): Promise<string> {
  return (await resolveWindow(page, TMUX_SERVER, session, name)).windowId;
}

test.describe("Docked compose strip", () => {
  test.beforeAll(() => {
    // Terminal-route session runs `cat` so typed STDIN echoes into the pane —
    // this is how we verify Enter sends `text + \r` end-to-end.
    createSession(TERM_SESSION);
    tmux(`send-keys -t ${TERM_SESSION} 'cat' Enter`);
    // Board-route session with two named windows for the target-label test.
    createSession(BOARD_SESSION, { windows: ["cs-alpha", "cs-bravo"] });
  });

  test.afterAll(() => {
    try { tmux(`send-keys -t ${TERM_SESSION} C-c`); } catch { /* ok */ }
    killSession(TERM_SESSION);
    killSession(BOARD_SESSION);
  });

  test("toggle via >_ chip and via the command palette; persists across reload", async ({ page }) => {
    test.setTimeout(60_000);
    const windowId = await resolveWindowId(page, TERM_SESSION);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });

    const chip = page.getByRole("button", { name: "Compose text" });
    const strip = page.getByTestId("compose-strip");

    // Off by default: the chip is not pressed and the strip is absent.
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(strip).toHaveCount(0);

    // Chip toggles it ON.
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(strip).toBeVisible();

    // Persistence: reload keeps it on.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Compose text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("compose-strip")).toBeVisible();

    // Command-palette parity: `View: Text Input` toggles it back OFF.
    await page.keyboard.press("Meta+k");
    await page.getByRole("option", { name: "View: Text Input" }).click();
    await expect(page.getByRole("button", { name: "Compose text" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByTestId("compose-strip")).toHaveCount(0);
  });

  test("the on-strip × closes the strip; the draft survives close→reopen (260722-d5q7)", async ({ page }) => {
    test.setTimeout(60_000);
    const windowId = await resolveWindowId(page, TERM_SESSION);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    // Wait for the relay stream to attach so the strip has a live target (the
    // textarea is disabled without one).
    await expect
      .poll(() => page.evaluate((w) => Boolean(window.__rkTerminals?.[w]), windowId), {
        timeout: 15_000,
      })
      .toBe(true);

    // Enable the strip via the `>_` chip and type a draft.
    const chip = page.getByRole("button", { name: "Compose text" });
    await chip.click();
    const input = page.getByTestId("compose-strip-input");
    await expect(input).toBeVisible();
    const draft = `CS_CLOSE_${Date.now()}`;
    await input.click();
    await input.fill(draft);

    // The header-row × closes the strip — same toggle as the chip, so the chip
    // reads unpressed. No confirmation dialog appears.
    await page.getByTestId("compose-strip-close").click();
    await expect(page.getByTestId("compose-strip")).toHaveCount(0);
    await expect(chip).toHaveAttribute("aria-pressed", "false");

    // Reopen via the chip: the unsent draft survived the close (the per-target
    // module store outlives the strip's unmount).
    await chip.click();
    await expect(page.getByTestId("compose-strip-input")).toHaveValue(draft);
  });

  test("drafts are per-target and survive a reload (260801-cyth)", async ({ page }) => {
    test.setTimeout(60_000);
    const alpha = await resolveWindowId(page, BOARD_SESSION, "cs-alpha");
    const bravo = await resolveWindowId(page, BOARD_SESSION, "cs-bravo");

    // Window A: enable the strip and type a draft for A.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(alpha)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Compose text" }).click();
    const input = page.getByTestId("compose-strip-input");
    await expect(input).toBeVisible();
    const draftA = `CSA_${Date.now()}`;
    await input.click();
    await input.fill(draftA);

    // Window B: the strip shows B's (empty) draft — A's did not travel.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(bravo)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await expect(input).toBeEnabled({ timeout: 15_000 }); // B is the focused target
    await expect(input).toHaveValue("");
    const draftB = `CSB_${Date.now()}`;
    await input.click();
    await input.fill(draftB);

    // Back on A: A's draft is recalled (and B's stays with B).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(alpha)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(input).toHaveValue(draftA, { timeout: 15_000 });

    // Refresh survival: a reload rehydrates the draft text from localStorage.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(input).toHaveValue(draftA, { timeout: 15_000 });

    // And B still has its own draft after the reload.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(bravo)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(input).toHaveValue(draftB, { timeout: 15_000 });
  });

  test("Enter sends the line (text + newline); empty Enter is a no-op; Cmd/Ctrl+Enter submits; Escape blurs", async ({ page }) => {
    test.setTimeout(60_000);
    const windowId = await resolveWindowId(page, TERM_SESSION);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    // Wait for the relay stream to attach.
    await expect
      .poll(() => page.evaluate((w) => Boolean(window.__rkTerminals?.[w]), windowId), {
        timeout: 15_000,
      })
      .toBe(true);

    // Enable the strip.
    await page.getByRole("button", { name: "Compose text" }).click();
    const input = page.getByTestId("compose-strip-input");
    await expect(input).toBeVisible();

    // Empty textarea + plain Enter = FULL no-op: the keydown is consumed, so
    // no local newline appears and nothing is sent (260802-lj98).
    await input.click();
    await input.press("Enter");
    await expect(input).toHaveValue("");

    // Type a unique marker and press plain Enter — insert line: the strip
    // transmits `marker\n` and clears. On the `cat` pane the `\n` commits the
    // line (terminal-conventional Enter), so the marker appears twice: the tty
    // input echo plus cat's echoed output line.
    const marker = `CSENT${Date.now()}`;
    await input.fill(marker);
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("compose-strip")).toBeVisible();
    await expect
      .poll(
        () => (tmuxCapture(TERM_SESSION).match(new RegExp(marker, "g")) ?? []).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // Cmd/Ctrl+Enter — the ONLY submit chord — still sends `text + \r`.
    const chordMarker = `CSSUB${Date.now()}`;
    await input.fill(chordMarker);
    await input.press("ControlOrMeta+Enter");
    await expect(input).toHaveValue("");
    await expect
      .poll(() => tmuxCapture(TERM_SESSION), { timeout: 10_000 })
      .toContain(chordMarker);

    // Escape blurs the strip textarea (does NOT close the strip).
    await input.click();
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(input).not.toBeFocused();
    await expect(page.getByTestId("compose-strip")).toBeVisible();
  });

  test("Alt+Enter stages raw text; empty Cmd/Ctrl+Enter presses Enter in the pane; Insert button inserts the line (260802-lj98)", async ({ page }) => {
    test.setTimeout(60_000);
    const windowId = await resolveWindowId(page, TERM_SESSION);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => page.evaluate((w) => Boolean(window.__rkTerminals?.[w]), windowId), {
        timeout: 15_000,
      })
      .toBe(true);

    await page.getByRole("button", { name: "Compose text" }).click();
    const input = page.getByTestId("compose-strip-input");
    await expect(input).toBeVisible();
    // Enter transmits the line to the pane (insert-line) and clears the
    // draft, so the keyboard hint states the "send" action.
    await expect(input).toHaveAttribute("enterkeyhint", "send");

    // Alt+Enter — the chord-only raw insert: byte-exact text with NO trailing
    // byte, staged on cat's input line, never committed.
    const staged = `CSRAW${Date.now()}`;
    await input.click();
    await input.fill(staged);
    await input.press("Alt+Enter");
    // Same clear-on-delivery as submit; the strip stays open.
    await expect(input).toHaveValue("");
    await expect
      .poll(() => tmuxCapture(TERM_SESSION), { timeout: 10_000 })
      .toContain(staged);
    // Exactly ONE occurrence — the tty echo of the staged input line. A
    // committed line would appear twice (input echo + cat's output line).
    expect(
      (tmuxCapture(TERM_SESSION).match(new RegExp(staged, "g")) ?? []).length,
    ).toBe(1);

    // The stage-then-submit loop: the textarea is now EMPTY, and Cmd/Ctrl+Enter
    // on an empty textarea sends a bare `\r` — "press Enter in the pane" —
    // committing the previously-staged line (it now appears a second time as
    // cat's echoed output line). This proves both halves of the loop: the raw
    // insert really was staged, and the empty chord really pressed Enter.
    await input.press("ControlOrMeta+Enter");
    await expect
      .poll(
        () => (tmuxCapture(TERM_SESSION).match(new RegExp(staged, "g")) ?? []).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);

    // The Insert button follows Enter (insert line): `text + "\n"` commits on
    // the `cat` pane, so the marker appears twice without any further chord.
    const inserted = `CSINS${Date.now()}`;
    await input.fill(inserted);
    await page.getByTestId("compose-strip-insert").click();
    await expect(input).toHaveValue("");
    await expect
      .poll(
        () => (tmuxCapture(TERM_SESSION).match(new RegExp(inserted, "g")) ?? []).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2); // input echo + cat's echoed output line
  });

  test("target label follows the focused board pane", async ({ page }) => {
    test.setTimeout(60_000);
    const alpha = await resolveWindowId(page, BOARD_SESSION, "cs-alpha");
    const bravo = await resolveWindowId(page, BOARD_SESSION, "cs-bravo");
    for (const winId of [alpha, bravo]) {
      await pinWindow(page.request, BOARD_NAME, TMUX_SERVER, winId);
    }

    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 15_000 });

    // Enable the strip on the board route. Opening focuses the strip's
    // textarea (focus-on-open, 260801-sm6g) — blur it with Escape so the
    // board pane-cycle chords below aren't input-suppressed.
    await page.getByRole("button", { name: "Compose text" }).click();
    const label = page.getByTestId("compose-strip-target");
    await expect(label).toBeVisible();
    await expect(page.getByTestId("compose-strip-input")).toBeFocused();
    await page.keyboard.press("Escape");

    // Initial focused pane is index 0 (cs-alpha). Cycle focus to pane 1 and
    // assert the target label follows to cs-bravo.
    await expect(label).toHaveText("cs-alpha");
    await page.keyboard.press("Meta+]");
    await expect(label).toHaveText("cs-bravo");
    await page.keyboard.press("Meta+[");
    await expect(label).toHaveText("cs-alpha");
  });
});
