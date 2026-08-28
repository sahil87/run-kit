/**
 * Tty tile progress e2e.
 *
 * Drives the REAL transport end-to-end: a passthrough-wrapped OSC 9;4
 * sequence printed inside a real tmux pane must light the tty tile's 2px
 * progress line and header percent chip, and a state-0 remove must clear
 * them. This doubles as the regression guard on the passthrough transport
 * itself — raw (unwrapped) OSC 9;4 is swallowed by tmux, so only the
 * `\ePtmux;…\e\\`-wrapped form (inner ESCs doubled) can feed the feature,
 * and the embedded conf's `allow-passthrough on` is what lets it through.
 *
 * Progress is per-viewer ephemeral (no replay for late attachers), so the
 * emit is wrapped in a `toPass` retry: a sequence printed before the relay
 * stream attached is legitimately lost, and re-emitting is idempotent.
 *
 * `beforeAll` creates a detached 80×24 session `e2e-tty-progress` (single
 * default-shell window) on the isolated e2e tmux server; `afterAll` kills
 * it. `paneRun` types a shell command into the session's current window via
 * `tmux send-keys`; `emitProgress(state, value)` prints the wrapped OSC 9;4
 * sequence with printf-octal escapes.
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

  /**
   * Proves: a wrapped `OSC 9;4;1;42` emitted by a program inside the pane
   * renders the determinate progress line (`aria-valuenow` 42) and the `42%`
   * header chip on the terminal-route tty tile, entirely client-side (no
   * backend, no SSE); a wrapped `OSC 9;4;0;0` removes both. Progress is
   * per-viewer ephemeral, so the set-emit retries until the attached client
   * renders it — an emit that races the relay attach is legitimately lost.
   *
   * Steps:
   * 1. Resolve the session's first window from the snapshot and navigate to
   *    its terminal route, gated on the status bar's `Connected` dot.
   * 2. Assert no `progress-line` / `progress-chip` testids render at idle.
   * 3. In a `toPass` retry: print the wrapped set-42% sequence in the pane
   *    and expect the `progress-chip` to become visible.
   * 4. Assert the chip text is `42%` and the `progress-line` carries
   *    `aria-valuenow="42"`.
   * 5. Print the wrapped remove sequence and assert both testids leave the
   *    DOM.
   */
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
    await expect(page.getByTestId("progress-chip")).toHaveCount(0, {
      timeout: READY_TIMEOUT,
    });
  });
});
