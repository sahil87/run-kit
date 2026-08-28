import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { gotoServerReady } from "./_ready";
import { TMUX_FAMILY, createSession, killServer, listWindows } from "./_tmux";

// Dedicated scratch server: the legacy-option sweep runs at most once per
// server per daemon lifetime, so the seeded legacy keys must land on a server
// this daemon process has never swept (the legacy-color-sweep precedent).
// Named inside this worktree's socket family (TMUX_FAMILY anchor) so the
// allowlist, teardown glob, and post-sweep all match by prefix.
const SWEEP_SERVER = `${TMUX_FAMILY}scope-sweep-${process.pid}-${Date.now().toString().slice(-6)}`;
const TEST_SESSION = `e2e-sweep-${Date.now()}`;
const WIN_NAME = "sweep-win";

// Legacy (pre-rename) names seeded here; the sweep converges them onto the
// scope-prefixed rk names. Removed when the deprecation window closes.
const LEGACY_WINDOW_SEEDS: Array<{ option: string; value: string }> = [
  { option: "@rk_role", value: "operator" },
  { option: "@rk_url", value: "/about:blank" },
  { option: "@rk_note", value: "1:e2e-legacy-note" },
];
const LEGACY_SERVER_SEEDS: Array<{ option: string; value: string }> = [
  { option: "@rk_origin", value: "e2e-legacy" },
  // Comma form (no brackets) — tmux show-options echoes a bracketed value
  // with its set-time quoting, which would falsify an exact-match assertion.
  { option: "@rk_session_order", value: TEST_SESSION },
];
const NEW_WINDOW = ["@rk_win_role", "@rk_win_url", "@rk_win_note"] as const;
const NEW_SERVER = ["@rk_srv_origin", "@rk_srv_session_order"] as const;

/** Read a window-scoped user option (`""` = unset). */
function windowOption(windowId: string, option: string): string {
  return execFileSync("tmux", [
    "-L", SWEEP_SERVER, "show-options", "-qv", "-w", "-t", windowId, option,
  ]).toString().trim();
}

/** Read a server-scoped user option (`""` = unset). */
function serverOption(option: string): string {
  return execFileSync("tmux", [
    "-L", SWEEP_SERVER, "show-options", "-s", "-qv", option,
  ]).toString().trim();
}

/** Poll a window-scoped user option until it reads `expected` ("" = unset). */
async function expectWindowOptionPoll(
  page: Page,
  windowId: string,
  option: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(() => windowOption(windowId, option), { timeout: 6_000 })
    .toBe(expected);
}

/** Poll a server-scoped user option until it reads `expected` ("" = unset). */
async function expectServerOptionPoll(
  page: Page,
  option: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(() => serverOption(option), { timeout: 6_000 })
    .toBe(expected);
}

test.describe("Legacy scope-prefix sweep (@rk_* → scoped rk names)", () => {
  let windowId = "";

  test.beforeAll(() => {
    createSession(TEST_SESSION, { server: SWEEP_SERVER, windows: [WIN_NAME] });
    windowId = listWindows(TEST_SESSION, { server: SWEEP_SERVER })[0].windowId;
    for (const seed of LEGACY_WINDOW_SEEDS) {
      execFileSync("tmux", [
        "-L", SWEEP_SERVER, "set-option", "-w", "-t", windowId, seed.option, seed.value,
      ]);
    }
    for (const seed of LEGACY_SERVER_SEEDS) {
      execFileSync("tmux", [
        "-L", SWEEP_SERVER, "set-option", "-s", seed.option, seed.value,
      ]);
    }
  });

  test.afterAll(() => {
    killServer(SWEEP_SERVER);
  });

  test("window- and server-scope legacy names converge onto the scope-prefixed rk names", async ({
    page,
  }) => {
    // The scratch-server boot + sweep polls outgrow the default 10s budget.
    test.setTimeout(30_000);

    // Sanity: the seeds landed at their scopes.
    for (const seed of LEGACY_WINDOW_SEEDS) {
      expect(windowOption(windowId, seed.option)).toBe(seed.value);
    }
    for (const seed of LEGACY_SERVER_SEEDS) {
      expect(serverOption(seed.option)).toBe(seed.value);
    }

    await gotoServerReady(page, SWEEP_SERVER, TEST_SESSION);

    // The reload-config endpoint is an attach-equivalent sweep hook: first
    // call for this server runs the once-guarded sweep, which copies each
    // legacy value onto its new scope-prefixed name and unsets the legacy one.
    const reloadRes = await page.request.post(
      `/api/tmux/reload-config?server=${encodeURIComponent(SWEEP_SERVER)}`,
    );
    expect(reloadRes.ok(), "POST /api/tmux/reload-config").toBeTruthy();

    // Window scope: legacy gone, new name carries the value at the same scope.
    for (let i = 0; i < LEGACY_WINDOW_SEEDS.length; i++) {
      await expectWindowOptionPoll(page, windowId, LEGACY_WINDOW_SEEDS[i].option, "");
      expect(windowOption(windowId, NEW_WINDOW[i])).toBe(LEGACY_WINDOW_SEEDS[i].value);
    }

    // Server scope: same convergence.
    for (let i = 0; i < LEGACY_SERVER_SEEDS.length; i++) {
      await expectServerOptionPoll(page, LEGACY_SERVER_SEEDS[i].option, "");
      expect(serverOption(NEW_SERVER[i])).toBe(LEGACY_SERVER_SEEDS[i].value);
    }
  });
});
