import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openPalette, resolveWindow, READY_TIMEOUT } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";
import { mockStateSocket } from "./_state-socket-mock";

/**
 * Voice round-trip e2e coverage: the caller-side gate (mic chip, palette
 * entry, HUD all mount only when the `voice_enabled` setting is on), the
 * confirm-card pipeline (hold the mic chip → stubbed transcript → ~3s
 * countdown → window send with the pane pinned), its cancel path, the ⌥Space
 * hold chord fired with the terminal focused (the xterm helper-textarea
 * carve-out), and the return leg (a `say` event renders the reply card).
 *
 * Shared setup: `beforeAll` snapshots the developer's REAL
 * ~/.config/run-kit/config.yaml (raw bytes) — scripts/test-e2e.sh isolates the
 * tmux server/port but NOT $HOME, and the suite flips `voice_enabled` through
 * the live `POST /api/settings`. `afterAll` restores the snapshot verbatim (or
 * deletes the file if it did not exist) — the settings-dialog.spec.ts pattern.
 * `beforeAll` also creates an `e2e-voice-<timestamp>` tmux session on the e2e
 * server whose one window (`voice-a`) runs `exec sleep 600` — a NON-shell
 * command, because the backend reconciler zeroes `@rk_pane_chat` on
 * plain-shell panes, and the confirm→deliver test needs the window to read as
 * an agent window so delivery routes to `POST /api/windows/:id/send` (the
 * shell-window route would head for the operator-request endpoint instead).
 * The pane option is stamped up front: the backend's window payload refreshes
 * on an interval, and the confirm test reloads after the snapshot carries
 * `chatSessionRef` so the page's FIRST sessions payload already has it.
 * `afterAll` kills the session.
 *
 * The file runs with Chromium's fake-media flags: `--use-fake-device-for-media-stream`
 * supplies a fake audio device (a tone) so `getUserMedia` + `MediaRecorder`
 * produce real chunks, and `--use-fake-ui-for-media-stream` auto-grants the
 * mic permission so no gesture-less prompt blocks the capture. Transcription
 * itself is stubbed via `page.route` — the WAV bytes never leave the page
 * harness. The confirm card's countdown is ~3s; assertions on the send use
 * polling with generous timeouts rather than fixed sleeps (the one fixed wait
 * is the cancel test's negative assertion, where a poll cannot prove absence).
 */

const SETTINGS_PATH = join(homedir(), ".config", "run-kit", "config.yaml");
let settingsSnapshot: Buffer | undefined;
let settingsExisted = false;

const TERM_SESSION = `e2e-voice-${Date.now()}`;
const WINDOW_NAME = "voice-a";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/** Flip `voice_enabled` through the real settings API (host-scoped). */
async function setVoiceEnabled(page: Page, enabled: boolean): Promise<void> {
  const res = await page.request.post("/api/settings", {
    data: { voice_enabled: enabled },
  });
  expect(res.ok(), `POST /api/settings voice_enabled=${enabled}`).toBe(true);
}

/** The e2e-session window's id (`@N`), resolved via the backend snapshot. */
async function voiceWindowId(page: Page): Promise<string> {
  return (await resolveWindow(page, TMUX_SERVER, TERM_SESSION, WINDOW_NAME)).windowId;
}

/** Enable the compose strip via its status-bar chip and wait for it. */
async function enableComposeStrip(page: Page): Promise<void> {
  const chip = page.getByRole("button", { name: "Compose text" });
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
  await expect(page.getByTestId("compose-strip")).toBeVisible({ timeout: READY_TIMEOUT });
}

/** Wait until the sessions payload has actually LANDED (the gotoServerReady
 *  sidebar-row gate) — the HUD's delivery resolves the current window from
 *  the sessions state, and the xterm connects by window id alone, seconds
 *  before the first snapshot commits. */
async function expectSessionsLanded(page: Page): Promise<void> {
  await expect(
    page
      .locator("nav[aria-label='Sessions']")
      .locator(`button[aria-label='Navigate to ${TERM_SESSION}']`),
  ).toBeVisible({ timeout: 20_000 });
}

/** Navigate to the voice window's terminal route and wait for the xterm plus
 *  the sessions payload. */
async function gotoVoiceWindow(page: Page): Promise<void> {
  const windowId = await voiceWindowId(page);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
  await expectSessionsLanded(page);
}

/**
 * Hold the mic chip (pointer down until the recording card renders, then up)
 * and return once the confirm card carries the stubbed transcript.
 */
async function holdMicToConfirmCard(page: Page): Promise<void> {
  const chip = page.getByTestId("compose-strip-mic");
  await expect(chip).toBeVisible({ timeout: READY_TIMEOUT });
  await chip.hover();
  await page.mouse.down();
  await expect(page.getByTestId("voice-hud-recording")).toBeVisible({ timeout: 10_000 });
  // Hold briefly so the fake-device MediaRecorder actually captures a chunk —
  // an empty recording resolves null and abandons the pipeline.
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.getByTestId("voice-hud-confirm")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("voice-hud-transcript")).toHaveText("restart the api");
  await expect(page.getByTestId("voice-hud-countdown")).toBeVisible();
}

test.describe("Voice round-trip", () => {
  test.beforeAll(() => {
    // Snapshot the developer's REAL ~/.config/run-kit/config.yaml before the
    // suite mutates it via POST /api/settings (voice_enabled key); restored
    // verbatim after.
    try {
      settingsSnapshot = readFileSync(SETTINGS_PATH);
      settingsExisted = true;
    } catch (err) {
      // Only ENOENT means "no file to restore". Any other read error means
      // the file EXISTS but couldn't be snapshotted — rethrow so afterAll
      // never deletes the developer's real settings on a failed snapshot.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      settingsSnapshot = undefined;
      settingsExisted = false;
    }

    // A non-shell pane command — the backend reconciler strips @rk_pane_chat
    // from plain-shell panes, and the confirm→deliver test needs the agent
    // route.
    createSession(TERM_SESSION, {
      windows: [{ name: WINDOW_NAME, command: "exec sleep 600" }],
    });
  });

  test.afterAll(() => {
    // Restore the settings snapshot even if tests failed.
    try {
      if (settingsExisted && settingsSnapshot !== undefined) {
        writeFileSync(SETTINGS_PATH, settingsSnapshot);
      } else {
        rmSync(SETTINGS_PATH, { force: true });
      }
    } catch {
      // Best-effort restore — never mask a test failure with a teardown one.
    }
    killSession(TERM_SESSION);
  });

  /**
   * Proves: the caller-side gate — with `voice_enabled` false the compose
   * strip renders NO mic chip and the palette has no `Voice: hold to talk`
   * entry; after flipping the setting on via the real API and reloading, both
   * appear. The gate is a mount-time read, so the flip needs a reload.
   *
   * Steps:
   * 1. POST `voice_enabled: false`; navigate to the voice window and enable
   *    the compose strip.
   * 2. Assert the mic chip (`compose-strip-mic`) is absent; open the palette
   *    and assert `Voice: hold to talk` has no option.
   * 3. POST `voice_enabled: true`; reload (the strip persists via its
   *    localStorage preference).
   * 4. Assert the mic chip is visible and the palette entry now exists.
   */
  test("mic chip and palette entry mount only when voice is enabled", async ({ page }) => {
    test.setTimeout(90_000);
    await setVoiceEnabled(page, false);
    await gotoVoiceWindow(page);
    await enableComposeStrip(page);

    await expect(page.getByTestId("compose-strip-mic")).toHaveCount(0);
    let paletteInput = await openPalette(page);
    await paletteInput.fill("Voice: hold to talk");
    await expect(page.getByRole("option", { name: "Voice: hold to talk" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await setVoiceEnabled(page, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await expectSessionsLanded(page);
    await expect(page.getByTestId("compose-strip")).toBeVisible({ timeout: READY_TIMEOUT });

    await expect(page.getByTestId("compose-strip-mic")).toBeVisible({ timeout: READY_TIMEOUT });
    paletteInput = await openPalette(page);
    await paletteInput.fill("Voice: hold to talk");
    await expect(page.getByRole("option", { name: "Voice: hold to talk" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  /**
   * Proves: the confirm-card auto-send pipeline end to end — press-and-hold
   * the mic chip records through the real capture stack (fake device), the
   * stubbed transcribe endpoint's text lands on the confirm card with the
   * countdown chip, and when the countdown completes the agent-window
   * delivery fires `POST /api/windows/:id/send` with
   * `{text, mode: "submit", pane: "%N"}` — the pane pinned to the window's
   * active pane.
   *
   * Steps:
   * 1. Enable voice; stub `POST /api/voice/transcribe` to return
   *    "restart the api" and capture any `POST /api/windows/:id/send` bodies
   *    (fulfilled 200 so the card settles into "sent").
   * 2. Stamp `@rk_pane_chat` on the session's pane and poll `GET /api/sessions`
   *    until the window carries `chatSessionRef`, then reload so the page's
   *    first sessions payload is already chat-capable.
   * 3. Hold the mic chip; assert the confirm card shows the transcript with
   *    the countdown chip.
   * 4. Poll until exactly one send body arrives; assert
   *    `{text: "restart the api", mode: "submit", pane: "%…"}`.
   */
  test("confirm card countdown delivers the utterance to the active pane", async ({ page }) => {
    test.setTimeout(120_000);
    await setVoiceEnabled(page, true);
    const sendBodies: Record<string, unknown>[] = [];
    await page.route("**/api/voice/transcribe*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "restart the api" }),
      }),
    );
    await page.route("**/api/windows/*/send*", (route) => {
      sendBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoVoiceWindow(page);
    await enableComposeStrip(page);

    // Make the window an agent window, then reload so the page's first
    // sessions payload already carries chatSessionRef (no snapshot race).
    const windowId = await voiceWindowId(page);
    const paneId = execFileSync("tmux", [
      "-L", TMUX_SERVER, "display-message", "-t", windowId, "-p", "#{pane_id}",
    ]).toString().trim();
    execFileSync("tmux", [
      "-L", TMUX_SERVER, "set-option", "-p", "-t", paneId, "@rk_pane_chat", "claude:e2e-voice",
    ]);
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
          );
          if (!res.ok()) return null;
          const sessions = (await res.json()) as Array<{
            name: string;
            windows: Array<{ windowId: string; chatSessionRef?: string }>;
          }>;
          return (
            sessions
              .find((s) => s.name === TERM_SESSION)
              ?.windows.find((w) => w.windowId === windowId)?.chatSessionRef ?? null
          );
        },
        { timeout: 15_000 },
      )
      .not.toBeNull();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 15_000 });
    await expectSessionsLanded(page);
    await expect(page.getByTestId("compose-strip")).toBeVisible({ timeout: READY_TIMEOUT });

    await holdMicToConfirmCard(page);
    await expect.poll(() => sendBodies.length, { timeout: 15_000 }).toBe(1);
    expect(sendBodies[0]).toMatchObject({
      text: "restart the api",
      mode: "submit",
      pane: expect.stringMatching(/^%\d+$/),
    });
  });

  /**
   * Proves: the ⌥Space hold-to-talk chord fires while the TERMINAL has focus —
   * xterm's hidden helper textarea is the normal focus state on this route and
   * must not suppress the chord (the shared editable-suppression carve-out).
   * Hold records through the real capture stack; release settles into the
   * confirm card.
   *
   * Steps:
   * 1. Enable voice; stub the transcribe endpoint (and the window send so the
   *    countdown's auto-send stays in the harness).
   * 2. Navigate to the voice window; click the xterm so the terminal holds
   *    focus.
   * 3. keyboard.down Alt + Space; assert the recording card renders.
   * 4. Release Space/Alt; assert the confirm card carries the stubbed
   *    transcript.
   */
  test("⌥Space hold fires with the terminal focused", async ({ page }) => {
    test.setTimeout(90_000);
    await setVoiceEnabled(page, true);
    await page.route("**/api/voice/transcribe*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "restart the api" }),
      }),
    );
    await page.route("**/api/windows/*/send*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );

    await gotoVoiceWindow(page);
    await page.locator(".xterm-screen").click();

    await page.keyboard.down("Alt");
    await page.keyboard.down("Space");
    await expect(page.getByTestId("voice-hud-recording")).toBeVisible({ timeout: 10_000 });
    // Hold briefly so the fake-device MediaRecorder captures a chunk.
    await page.waitForTimeout(500);
    await page.keyboard.up("Space");
    await page.keyboard.up("Alt");
    await expect(page.getByTestId("voice-hud-confirm")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("voice-hud-transcript")).toHaveText("restart the api");
  });

  /**
   * Proves: the confirm card's cancel discards the utterance — tapping cancel
   * before the countdown ends dismisses the card and NO window send fires,
   * even after the countdown would have elapsed.
   *
   * Steps:
   * 1. Enable voice; stub transcribe (same body as the confirm test) and
   *    capture window-send bodies.
   * 2. Navigate (the window is still chat-stamped from the confirm test's
   *    setup — the stamp is idempotent window state, re-asserted by the
   *    snapshot), enable the strip, hold the mic chip to the confirm card.
   * 3. Click the card's cancel chip; assert the confirm card unmounts.
   * 4. Wait out the full countdown (fixed sleep — absence cannot be polled)
   *    and assert no send body arrived.
   */
  test("cancelling the confirm card discards the utterance — no send fires", async ({ page }) => {
    test.setTimeout(120_000);
    await setVoiceEnabled(page, true);
    const sendBodies: Record<string, unknown>[] = [];
    await page.route("**/api/voice/transcribe*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "restart the api" }),
      }),
    );
    await page.route("**/api/windows/*/send*", (route) => {
      sendBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoVoiceWindow(page);
    await enableComposeStrip(page);
    await holdMicToConfirmCard(page);

    await page.getByTestId("voice-hud-cancel").click();
    await expect(page.getByTestId("voice-hud-confirm")).toHaveCount(0);
    // Outlast the ~3s countdown: had cancel not disarmed it, the send would
    // have fired by now.
    await page.waitForTimeout(4_000);
    expect(sendBodies).toEqual([]);
  });

  /**
   * Proves: the return leg — a `say` event on the state socket renders the
   * HUD's green reply card with the spoken text. The event is a fire-and-forget
   * global (no cached slot, no replay), so the spec emits it via the mock's
   * handle only AFTER the HUD has mounted and subscribed. The rest of the
   * backend is fully mocked (the operator-compose.spec.ts pattern): sessions
   * ride the state-socket mock, `/api/settings` stays real (the voice gate
   * reads the developer's registry), and the terminal socket is stubbed.
   *
   * Steps:
   * 1. Enable voice via the real API; install the terminal/select/servers
   *    stubs and the state-socket mock carrying one work window `@1`.
   * 2. Navigate to the `@1` terminal route; wait for the HUD root to attach
   *    (its subscribe effect has run once it renders).
   * 3. Emit a global `say` event; assert the reply card renders the text.
   */
  test("a say event renders the HUD reply card", async ({ page }) => {
    test.setTimeout(60_000);
    await setVoiceEnabled(page, true);
    await page.routeWebSocket(/\/ws\/terminals/, () => {});
    await page.route("**/api/windows/*/select*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );
    await page.route("**/api/servers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ name: "default", sessionCount: 1 }]),
      }),
    );
    const socket = await mockStateSocket(page, {
      sessions: JSON.stringify([
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
              agentState: "idle",
              panes: [
                { paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "zsh", isActive: true },
              ],
            },
          ],
        },
      ]),
    });

    await page.goto("/default/%401");
    await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("voice-hud").waitFor({ state: "attached", timeout: READY_TIMEOUT });

    socket.emitGlobal("say", { text: "dispatch is green", ts: new Date().toISOString() });
    await expect(page.getByTestId("voice-hud-reply")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(page.getByTestId("voice-hud-reply")).toContainText("dispatch is green");
  });
});
