/**
 * Animated window-switch (View Transitions) coverage.
 *
 * Every OTHER e2e spec runs under the config-wide reduced-motion emulation, so
 * they exercise the product's instant-switch fallback and never touch the slide
 * transition. This spec is the ONE place that opts back into motion
 * (`test.use({ contextOptions: { reducedMotion: "no-preference" } })`) and
 * drives the real animated path end-to-end.
 *
 * It guards against a systematic gate-timeout freeze: the polished capture gates
 * the new-state snapshot on the incoming window's first inbound bytes, released
 * at message-receipt time inside `ws.onmessage` (260703-l4nf). A regression that
 * makes that release unreachable (e.g. moving it back to a write seam that never
 * fires during View-Transition render suppression, or a UA group animation
 * holding `transition.finished` open) would make an animated switch hang instead
 * of completing. The assertion — the incoming window's content becomes visible
 * within a sane latency bound (well under 1s) — fails loudly on such a hang.
 *
 * Confirmation-gated motion (260715-38kg): the slide is now an EARNED signal —
 * it plays ONLY when the incoming bytes confirm within the ~300ms budget; a
 * timeout SKIPS the slide and shows a LogoSpinner "pending" mask instead, and a
 * failed switch bounces the URL back to tmux truth. Those timing-sensitive
 * branches (mask arm-at-timeout / lift-on-late-write / failure bounce) cannot be
 * forced deterministically against a live relay on localhost, so they are
 * UNIT-covered in `src/lib/window-transition.test.ts`. What this spec adds for
 * the new behavior is the deterministic fast-path invariant: a confirmed-fast
 * switch plays the slide and NEVER flashes the pending mask.
 */
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { gotoServerReady, READY_TIMEOUT } from "./_ready";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-switch-transition-${Date.now()}`;

// The animated switch must complete (incoming content painted) comfortably
// under this bound. The gate's own budget is ~300ms; a healthy receipt-time
// release lands the redraw well inside that. This bound is deliberately loose
// so it fails only on a genuine hang (a systematic freeze), not on ordinary
// localhost timing jitter.
const SWITCH_COMPLETE_BUDGET_MS = 1_000;

/**
 * Resolve a window's stable tmux id (`@N`) from the backend snapshot by its
 * (transient) display name. The terminal route is keyed by window id, and the
 * test-only `window.__rkTerminals` registry (dev/e2e builds only) is keyed by
 * it too. Polls because the window is created via the tmux CLI and surfaces in
 * the snapshot asynchronously.
 */
async function resolveWindowId(page: Page, windowName: string): Promise<string> {
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
      const wid = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName)?.windowId;
      if (wid) {
        id = wid;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return id!;
}

/** True once the incoming window's marker text is present in its xterm buffer. */
async function markerVisible(
  page: Page,
  windowId: string,
  marker: string,
): Promise<boolean> {
  return page.evaluate(
    ({ windowId, marker }) => {
      const term = window.__rkTerminals?.[windowId];
      if (!term) return false;
      const buf = term.buffer.active;
      // Scan the whole viewport — the marker was echoed before the switch, so
      // the incoming redraw repaints it somewhere on screen.
      for (let y = 0; y < buf.length; y++) {
        if ((buf.getLine(y)?.translateToString(true) ?? "").includes(marker)) {
          return true;
        }
      }
      return false;
    },
    { windowId, marker },
  );
}

test.describe("Window-switch slide transition (animated path)", () => {
  // Opt this file back into motion — the config-wide default disables the
  // transition, so only here do we exercise the real
  // `document.startViewTransition` path. `reducedMotion` is not a top-level
  // `use` fixture in this Playwright version (it only reaches the browser
  // context via `contextOptions`, which is spread into the context options),
  // so set it there — the type-valid channel.
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist (retry in same worker).
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort.
    }
  });

  test("a same-session animated switch completes within a sane latency bound", async ({
    page,
  }) => {
    const ts = Date.now();
    const winA = `xa-${ts}`;
    const winB = `xb-${ts}`;
    // Distinct, letter-only markers so each window's content is unambiguous in
    // the xterm buffer. `echo`ing them leaves the text on each pane, so the
    // incoming redraw repaints the target's marker after the switch.
    const markerA = `MARKERAAA${ts}`;
    const markerB = `MARKERBBB${ts}`;

    // Two named windows in the shared session, each carrying its own marker.
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winA}"`, {
      stdio: "ignore",
    });
    execSync(
      `tmux -L ${TMUX_SERVER} send-keys -t "${TEST_SESSION}:${winA}" "echo ${markerA}" Enter`,
      { stdio: "ignore" },
    );
    execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winB}"`, {
      stdio: "ignore",
    });
    execSync(
      `tmux -L ${TMUX_SERVER} send-keys -t "${TEST_SESSION}:${winB}" "echo ${markerB}" Enter`,
      { stdio: "ignore" },
    );

    // Land on the server root so the sidebar is populated, then resolve both
    // windows' stable ids.
    const sidebar = await gotoServerReady(page, TMUX_SERVER);
    const idA = await resolveWindowId(page, winA);
    const idB = await resolveWindowId(page, winB);

    // Deep-link into window A's terminal so there IS an outgoing window in view
    // — the R2 gate requires one (a first switch with no outgoing window is an
    // instant switch, which is not the path under test).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(idA)}`);
    await expect(page.locator(".xterm-screen")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    // Wait until A's terminal is registered and its marker has painted, so the
    // switch below starts from a real, populated outgoing terminal.
    await expect
      .poll(() => markerVisible(page, idA, markerA), { timeout: READY_TIMEOUT })
      .toBe(true);

    // The animated path only runs when the browser supports View Transitions.
    // Playwright's Desktop Chrome does; assert it so a runner that silently
    // lacks it fails loudly rather than passing on the instant fallback (which
    // this spec is NOT meant to cover).
    const vtSupported = await page.evaluate(
      () => typeof document.startViewTransition === "function",
    );
    expect(
      vtSupported,
      "expected View Transitions support — this spec covers the animated path",
    ).toBe(true);

    // The B row's button is the same-server switch seam that routes through
    // `navigateToWindow` (the wrapper that runs the transition), identical to a
    // real sidebar click.
    const buttonB = sidebar
      .locator(`[data-window-id="${idB}"]`)
      .getByRole("button")
      .first();
    await expect(buttonB).toBeVisible({ timeout: READY_TIMEOUT });

    // Fire the switch and clock it until B's content is painted in B's terminal.
    const t0 = Date.now();
    await buttonB.click();

    // Selection settles on B — the switch was accepted.
    await expect(buttonB).toHaveAttribute("aria-current", "page", {
      timeout: READY_TIMEOUT,
    });

    // The core assertion: B's marker becomes visible (the incoming content
    // painted) within the sane bound. A gate that never releases would freeze
    // the transition and blow past this.
    await expect
      .poll(() => markerVisible(page, idB, markerB), {
        timeout: SWITCH_COMPLETE_BUDGET_MS,
      })
      .toBe(true);
    const elapsed = Date.now() - t0;
    expect(
      elapsed,
      `animated switch took ${elapsed}ms (budget ${SWITCH_COMPLETE_BUDGET_MS}ms) — a systematic gate-timeout freeze regression`,
    ).toBeLessThan(SWITCH_COMPLETE_BUDGET_MS);

    // And the transition tears down: the direction attribute the wrapper set on
    // <html> is cleared once the (latest) transition finishes. If a UA group
    // animation held `transition.finished` open past the slide, this would lag;
    // asserting it clears within the bound guards the transition's LIFETIME
    // (not just its visuals) — the T007 group-animation neutralization.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.dataset.windowSwitchDirection ?? null,
          ),
        { timeout: SWITCH_COMPLETE_BUDGET_MS },
      )
      .toBeNull();

    // Confirmation-gated motion (260715-38kg): the pending LogoSpinner mask
    // (`.rk-window-switch-mask`) must NOT be stuck once the switch has settled.
    // On a healthy switch the gate releases fast and the mask never arms; if
    // localhost timing pushes the first confirmed write past the ~300ms budget
    // the mask may briefly arm, but SSE confirmation (the `aria-current` above)
    // — and any late incoming write — MUST lift it. A regression that never
    // lifts the mask (the stuck-mask class of bug) would leave it present here.
    // Poll (not an instant assert) so a brief legitimate flash isn't flaky.
    await expect(page.locator(".rk-window-switch-mask")).toHaveCount(0, {
      timeout: SWITCH_COMPLETE_BUDGET_MS,
    });
  });
});
