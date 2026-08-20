/**
 * Tty tile progress e2e (260819-1vxq).
 *
 * Drives the REAL transport end-to-end: a passthrough-wrapped OSC 9;4
 * sequence printed inside a real tmux pane must light the tty tile's 2px
 * progress line and header percent chip, and a state-0 remove must clear
 * them. This doubles as the regression guard on the passthrough transport
 * itself — raw (unwrapped) OSC 9;4 is swallowed by tmux (spiked 2026-08-19),
 * so only the `\ePtmux;…\e\\`-wrapped form (inner ESCs doubled) can feed the
 * feature, and the embedded conf's `allow-passthrough on` is what lets it
 * through.
 *
 * Progress is per-viewer ephemeral (no replay for late attachers), so the
 * emit is wrapped in a `toPass` retry: a sequence printed before the relay
 * stream attached is legitimately lost, and re-emitting is idempotent.
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createSession, killSession, TMUX_SERVER } from "./_tmux";
import { gotoWindow, resolveWindow, READY_TIMEOUT } from "./_ready";

const SERVER = TMUX_SERVER;
const SESSION = "e2e-tty-progress";

/** Type a shell command into the session's current window and run it. */
function paneRun(command: string): void {
  execFileSync(
    "tmux",
    ["-L", TMUX_SERVER, "send-keys", "-t", `=${SESSION}:`, command, "Enter"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Print a passthrough-wrapped OSC 9;4 from inside the pane. The inner
 *  sequence's ESCs are doubled per the tmux passthrough contract; printf
 *  interprets the octal escapes shell-side. */
function emitProgress(state: number, value: number): void {
  paneRun(`printf '\\033Ptmux;\\033\\033]9;4;${state};${value}\\007\\033\\\\'`);
}

test.describe("tty tile progress (wrapped OSC 9;4)", () => {
  test.beforeAll(() => {
    createSession(SESSION);
  });

  test.afterAll(() => {
    killSession(SESSION);
  });

  test("wrapped set lights the line + chip; wrapped remove clears both", async ({
    page,
  }) => {
    const win = await resolveWindow(page, SERVER, SESSION);
    await gotoWindow(page, SERVER, win.windowId);

    // Idle: no progress chrome.
    await expect(page.getByTestId("progress-line")).toHaveCount(0);
    await expect(page.getByTestId("progress-chip")).toHaveCount(0);

    // Determinate 42%: re-emit until the attached client renders it (an emit
    // that raced the relay attach is lost by design — ephemerality rule).
    await expect(async () => {
      emitProgress(1, 42);
      await expect(page.getByTestId("progress-chip")).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: READY_TIMEOUT });

    await expect(page.getByTestId("progress-chip")).toHaveText("42%");
    const line = page.getByTestId("progress-line");
    await expect(line).toHaveAttribute("aria-valuenow", "42");

    // Remove: state 0 clears both (the emitter owns lifecycle).
    emitProgress(0, 0);
    await expect(page.getByTestId("progress-line")).toHaveCount(0, {
      timeout: READY_TIMEOUT,
    });
    await expect(page.getByTestId("progress-chip")).toHaveCount(0);
  });
});
