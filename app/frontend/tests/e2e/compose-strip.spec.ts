import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * Docked compose strip (260718-dhdj) e2e coverage. The strip replaces the modal
 * ComposeBuffer: it is a single global surface docked above the bottom bar,
 * toggled by the `>_` chip / `View: Text Input` palette action, persisted as a
 * chrome preference, sending Enter+`\r` to the LIVE focused pane. See the sibling
 * `.spec.md` for the per-test contract.
 */

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
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
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; name: string }>;
      }>;
      const wins = sessions.find((s) => s.name === session)?.windows;
      const wid = name
        ? wins?.find((w) => w.name === name)?.windowId
        : wins?.[0]?.windowId;
      if (wid) {
        id = wid;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `window for ${session} not found`).not.toBeNull();
  return id!;
}

test.describe("Docked compose strip", () => {
  test.beforeAll(() => {
    // Terminal-route session runs `cat` so typed STDIN echoes into the pane —
    // this is how we verify Enter sends `text + \r` end-to-end.
    tmux(`new-session -d -s ${TERM_SESSION} -x 80 -y 24`);
    tmux(`send-keys -t ${TERM_SESSION} 'cat' Enter`);
    // Board-route session with two named windows for the target-label test.
    tmux(`new-session -d -s ${BOARD_SESSION} -x 80 -y 24 -n cs-alpha`);
    tmux(`new-window -t ${BOARD_SESSION} -n cs-bravo`);
  });

  test.afterAll(() => {
    try { tmux(`send-keys -t ${TERM_SESSION} C-c`); } catch { /* ok */ }
    try { tmux(`kill-session -t ${TERM_SESSION}`); } catch { /* ok */ }
    try { tmux(`kill-session -t ${BOARD_SESSION}`); } catch { /* ok */ }
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

    // Reopen via the chip: the unsent draft survived the close (module store).
    await chip.click();
    await expect(page.getByTestId("compose-strip-input")).toHaveValue(draft);
  });

  test("Enter sends text + carriage return to the focused pane; Escape blurs", async ({ page }) => {
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

    // Type a unique marker and press Enter — it must reach the pane running
    // `cat`, which echoes it. The trailing `\r` submits the line.
    const marker = `CS_ENTER_${Date.now()}`;
    await input.click();
    await input.fill(marker);
    await input.press("Enter");
    // The textarea clears (send succeeded, strip stays open).
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("compose-strip")).toBeVisible();

    // The marker appears in the pane's captured output (cat echoed it on its
    // own input line, then the `\r` committed it as a fresh echoed line).
    await expect
      .poll(() => tmuxCapture(TERM_SESSION), { timeout: 10_000 })
      .toContain(marker);

    // Escape blurs the strip textarea (does NOT close the strip).
    await input.click();
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(input).not.toBeFocused();
    await expect(page.getByTestId("compose-strip")).toBeVisible();
  });

  test("Insert stages text without committing; Ctrl/Cmd+Enter submits (260719-mxvw)", async ({ page }) => {
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
    // Fine pointer (default e2e environment): Enter submits, so the keyboard
    // hint states "send".
    await expect(input).toHaveAttribute("enterkeyhint", "send");

    // Insert: raw bytes with NO trailing \r — staged on cat's input line,
    // never committed.
    const staged = `CSINS${Date.now()}`;
    await input.click();
    await input.fill(staged);
    await page.getByTestId("compose-strip-insert").click();
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

    // Cmd/Ctrl+Enter (the universal submit chord) commits the staged line plus
    // this suffix as ONE line — proving the insert really was staged (still in
    // the input buffer) and the chord really submitted.
    const suffix = `CSSUB${Date.now()}`;
    await input.fill(suffix);
    await input.press("ControlOrMeta+Enter");
    await expect(input).toHaveValue("");
    await expect
      .poll(
        () =>
          (tmuxCapture(TERM_SESSION).match(new RegExp(`${staged}${suffix}`, "g")) ?? [])
            .length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2); // input echo + cat's echoed output line
  });

  test("target label follows the focused board pane", async ({ page }) => {
    test.setTimeout(60_000);
    const alpha = await resolveWindowId(page, BOARD_SESSION, "cs-alpha");
    const bravo = await resolveWindowId(page, BOARD_SESSION, "cs-bravo");
    for (const winId of [alpha, bravo]) {
      const res = await page.request.post(`/api/boards/${BOARD_NAME}/pin`, {
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.goto(`/board/${BOARD_NAME}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 15_000 });

    // Enable the strip on the board route.
    await page.getByRole("button", { name: "Compose text" }).click();
    const label = page.getByTestId("compose-strip-target");
    await expect(label).toBeVisible();

    // Initial focused pane is index 0 (cs-alpha). Cycle focus to pane 1 and
    // assert the target label follows to cs-bravo.
    await expect(label).toHaveText("cs-alpha");
    await page.keyboard.press("Meta+]");
    await expect(label).toHaveText("cs-bravo");
    await page.keyboard.press("Meta+[");
    await expect(label).toHaveText("cs-alpha");
  });
});
