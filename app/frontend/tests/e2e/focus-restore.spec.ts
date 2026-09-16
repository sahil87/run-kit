import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { focusGrabCodeStubHtml, startCodeStub, type CodeStub } from "./_ports";
import { READY_TIMEOUT, expectActiveElement, resolveWindow as resolveWindowRaw, seedComposeStrip, switchToWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

/**
 * The per-window focus-restore router and the code-server steal guard
 * (`docs/specs/right-panel.md` § The code lens). On a window switch the tile
 * grid remounts and nothing would otherwise reclaim DOM focus — and the code
 * tile's reloading iframe lets the workbench's one-shot load-time `focus()`
 * grab win by default, silently flipping the focused tile kind to `code` and
 * killing the `ttyOnly` keybindings. The restore router returns focus to the
 * window's RECORDED kind (`tty`/`compose`/`code`, default `tty`), and the
 * armed steal guard reverts the grab whenever it contradicts that recorded
 * choice. `code` is recorded only from genuine in-frame interaction, so a
 * programmatic grab can never write itself into memory.
 *
 * Shared setup:
 * - tmux server: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`); never
 *   run Playwright directly — `just test-e2e focus-restore`.
 * - Workbench grab stub: code-server is not installable in the test env, so
 *   `beforeAll` binds a stub HTTP server (`startCodeStub`, `_ports.ts`) on
 *   `RK_CODE_SERVER_PORT` (the env the test-e2e script seeds the backend
 *   with; an ephemeral port when unset — `workers: 1` lets the code-stub
 *   files share the seeded port) serving a page with one focusable button
 *   (`focusGrabCodeStubHtml`). 300ms after each load
 *   the page focuses the button ONCE (a `didFocus` flag keeps the revert's
 *   focus churn from retriggering it — matching the real one-shot
 *   editor-restore grab) and retitles its document `grabbed`. Focusing an
 *   element inside the same-origin frame chains focus up, making the iframe
 *   ELEMENT the parent document's `activeElement`, exactly like the real
 *   steal. The stub makes the backend's reachability probe genuinely true — no
 *   probe mock.
 * - `beforeAll`: one dedicated session `e2e-focusrestore-<ts>` (80×24), the
 *   stub, and a throwaway terminal-route page load to absorb Vite's cold
 *   transform outside any test's budget. `afterAll` closes the stub and kills
 *   the session.
 * - `beforeEach`: desktop viewport (1440×800) — restore and guard are
 *   desktop-only by design.
 * - The code tile is opened via the `Code tile` rail toggle, not a `?layout=`
 *   URL param: a rail click is a layout MUTATION POSTed to the shared
 *   `@rk_win_layout` option, so the tile survives in-app window switches (a
 *   URL param is inbound-only — translated once, then dropped). The
 *   click's pointerdown also disarms that visit's guard, so the grab on the
 *   tile-opening visit stands — the revert under test happens on the
 *   away-and-back RETURN.
 * - Window switches go through the sidebar row (`switchToWindow`), never
 *   `page.goto`: focus memory is in-memory by design, so a reload would wipe
 *   the state under test.
 * - `expectGrabFired(page)`: polls the iframe's `contentDocument.title` until
 *   it reads `grabbed` — every focus assertion is gated on the grab having
 *   actually fired, so a pass can never be the vacuous "the grab never
 *   happened".
 * - `expectActiveElement(page, target)`: polls `document.activeElement` until
 *   it is inside `.xterm`, is the `compose-strip-input` textarea, or is the
 *   `Code editor` iframe element.
 * - Retention note: an away-and-back switch re-shows the window's RETAINED
 *   frame (no reload, no second grab — spec right-panel.md § The code lens),
 *   so only test (a) forces a FRESH boot on the return leg (it evicts A's
 *   frame by overflowing the desktop frame cap, 3, before returning) — that
 *   is the leg where the armed guard's grab reversion is exercised. Tests
 *   (b)/(c) exercise the retained-frame restore: no grab re-fires, so the
 *   restore router's explicit focus is what lands on the recorded kind.
 * - Budgets: every test calls `test.setTimeout` — (a) drives six in-app
 *   window switches plus iframe boots (60s), (b)/(c) two switches (30s),
 *   past the 10s default.
 */

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-focusrestore-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

/** How long after its own load the stub waits before grabbing focus — the
 *  stand-in for the code-server workbench's one-shot editor-restore grab
 *  (fed to `focusGrabCodeStubHtml`, whose doc owns the grab mechanics). */
const GRAB_DELAY_MS = 300;

/** Create a window (repo cwd — windows inherit the tmux server's start cwd, so
 *  the code lens is available) and return its stable `@N` id. */
async function makeWindow(
  page: Page,
  name: string,
  opts: { command?: string } = {},
): Promise<string> {
  newWindow(TEST_SESSION, name, opts);
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, name)).windowId;
}

/** Navigate to a window's terminal route and wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

// `surface-tile-code` is unique to the ACTIVE window's tile (retained frames
// carry `surface-tile-code-retained`) — scoping keeps the locator singular
// once several windows hold code frames.
const codeIframe = (page: Page) =>
  page.getByTestId("surface-tile-code").getByTitle("Code editor");
const composeInput = (page: Page) => page.getByTestId("compose-strip-input");
const railCodeButton = (page: Page) =>
  page.getByRole("button", { name: "Code tile" });

/** Open the code tile the way a USER does — the rail toggle. A rail click is
 *  a layout MUTATION (POSTs `@rk_win_layout`), so the code tile survives
 *  in-app window switches; a `?layout=` URL param does not (sidebar
 *  navigation targets the bare route and URL layouts are never persisted).
 *  The click's pointerdown also disarms the first visit's guard, so the
 *  stub's grab on THIS visit stands (the user just asked for the editor) —
 *  the revert under test happens on the away-and-back RETURN. */

/** Poll until the stub's grab has FIRED inside the iframe (its document title
 *  flips to "grabbed"). Asserting focus states only after this gate keeps the
 *  specs non-vacuous: a pass can never be "the grab never happened". */
async function expectGrabFired(page: Page): Promise<void> {
  const handle = await codeIframe(page).elementHandle();
  expect(handle, "code iframe element").not.toBeNull();
  await expect
    .poll(
      () =>
        page.evaluate(
          (f) => (f as HTMLIFrameElement).contentDocument?.title ?? "",
          handle,
        ),
      { timeout: READY_TIMEOUT },
    )
    .toBe("grabbed");
}


/** The pane's visible text (tmux truth) — spec (a) proves typing lands in the
 *  pane by capturing it. */
function capturePane(windowId: string): string {
  return execFileSync(
    "tmux",
    ["-L", TMUX_SERVER, "capture-pane", "-p", "-t", windowId],
    { encoding: "utf-8" },
  );
}

let stub: CodeStub;

test.beforeAll(async ({ browser }, testInfo) => {
  // The hook's own budget: the warm-up below pays Vite's cold transform of
  // the app + xterm graph, which on a loaded box outlasts the default (the
  // per-test timeout, 10s locally). The inner expects carry their own 60s
  // gates; this just lets the hook live long enough to reach them.
  testInfo.setTimeout(90_000);
  createSession(TEST_SESSION);
  stub = await startCodeStub(focusGrabCodeStubHtml(GRAB_DELAY_MS));
  // Cold-boot warm-up (the code-surface spec's pattern): absorb Vite's cold
  // transform of the app + xterm graph outside any test's budget.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.server.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Window-focus restore + code-server steal guard", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: the first visit to a window focuses the terminal on its own (the
   * `tty` default, replacing the accidental code-wins behavior), and after an
   * away-and-back switch that boots a FRESH workbench (A's frame evicted via
   * the desktop cap while away), the stub's grab is reverted to the xterm
   * textarea and real keystrokes reach the tmux pane.
   *
   * Steps:
   * 1. Create window A running `cat` (typed STDIN echoes into the pane) and
   *    window B; seed the compose preference OFF (the strip is on by default
   *    and would take the first visit's focus — this test is about the tty
   *    default); navigate to A; assert `document.activeElement` lands inside
   *    `.xterm` (first visit with the strip collapsed ⇒ the `tty` default).
   * 2. Click the `Code tile` rail toggle (a persisted mutation; its pointerdown
   *    disarms this visit's guard); wait for the iframe and for the grab to
   *    fire; assert focus is on the iframe (the grab stands after a manual open).
   * 3. Evict A's frame: create windows C and D, then open the code tile in B,
   *    C, and D — the desktop frame cap (3) overflows and A's record (the
   *    least-recently-shown) evicts. A plain away-and-back would re-show A's
   *    RETAINED frame with no reload and no second grab, leaving the guard's
   *    reversion path unexercised.
   * 4. Switch back to A; wait for the freshly booted iframe's grab to fire.
   * 5. Assert `document.activeElement` is inside `.xterm` — the armed guard
   *    reverted the grab to the remembered (default) `tty`.
   * 6. Type a unique marker; poll `tmux capture-pane` until it echoes — the
   *    keystrokes landed in the pane, not the iframe.
   */
  test("(a) a window remembered as tty reverts the workbench grab to the terminal, and typing lands in the pane", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Window A runs `cat` so typed STDIN echoes into the pane — tmux-side
    // proof of where the keystrokes went. Window B is the away-window.
    const idA = await makeWindow(page, `fr-a-tty-${Date.now()}`, { command: "cat" });
    const idB = await makeWindow(page, `fr-b-tty-${Date.now()}`);
    // The compose strip is on by default and a first visit then lands in ITS
    // textarea (compose-strip.spec.ts owns that case); this test is about the
    // tty first-visit default, so it states the explicit opt-out.
    await seedComposeStrip(page, false);
    await gotoWindow(page, idA);

    // First visit: no memory and the strip collapsed ⇒ the tty default — the
    // restore effect focuses the xterm textarea on its own (no grab exists
    // yet: the code tile is not open).
    await expectActiveElement(page, "xterm");

    // Open the code tile via the rail (a persisted user mutation — see the
    // helper comment above). The click disarms the guard, so the stub's grab
    // on this visit STANDS: focus lands in the iframe.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "code-iframe");

    // Evict A's frame before returning IN-APP (memory is in-memory — a reload
    // would wipe it): opening the code tile in B, C, and D overflows the
    // desktop frame cap (3) and drops A's record (the least-recently-shown).
    // Without this the return would re-show A's RETAINED frame — no reload,
    // no second grab, nothing for the guard to revert.
    const evictors = [idB];
    for (let i = 0; i < 2; i += 1) {
      evictors.push(await makeWindow(page, `fr-evict-${i}-${Date.now()}`));
    }
    for (const id of evictors) {
      await switchToWindow(page, id);
      await railCodeButton(page).click();
      await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    }

    // Back to A: no record remains, so the code tile boots a FRESH workbench;
    // its grab fires against the armed guard, and the revert lands on the
    // remembered (default) `tty` — nothing was ever recorded for A.
    await switchToWindow(page, idA);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "xterm");

    // Typing lands in the pane (a surviving grab would have eaten it into the
    // iframe).
    const marker = `FR_TTY_${Date.now()}`;
    await page.keyboard.type(marker);
    await expect
      .poll(() => capturePane(idA), { timeout: READY_TIMEOUT })
      .toContain(marker);
  });

  /**
   * Proves: focusing the compose textarea records `compose` for the window, and
   * on return the restore router focuses the strip — the retained frame fires
   * no second grab, so the router's explicit focus lands undisturbed.
   *
   * Steps:
   * 1. Create windows A and B; seed the compose preference OFF so the chip
   *    click below is a genuine enable; navigate to A; wait for the terminal
   *    relay to attach (the strip's target and the recording seam's key).
   * 2. Enable the strip via the `Compose` chip; click the textarea; assert
   *    it holds focus (the genuine gesture that records `compose`).
   * 3. Click the `Code tile` rail toggle; wait for the iframe and the grab (the
   *    click disarmed this visit's guard, so the grab stands here).
   * 4. Switch to B via the sidebar, then back to A — the return re-shows A's
   *    RETAINED frame (no reload, no second grab).
   * 5. Assert `document.activeElement` is the `compose-strip-input` textarea.
   */
  test("(b) a window remembered as compose restores the strip textarea on return", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const idA = await makeWindow(page, `fr-a-compose-${Date.now()}`);
    const idB = await makeWindow(page, `fr-b-compose-${Date.now()}`);
    // Start from the explicit opt-out: the chip click below is the GENUINE
    // enable gesture this test records `compose` through.
    await seedComposeStrip(page, false);
    await gotoWindow(page, idA);
    // The strip's textarea is disabled until the terminal relay attaches (the
    // focused target), which is also what gives the recording seam its key.
    await expect
      .poll(() => page.evaluate((w) => Boolean(window.__rkTerminals?.[w]), idA), {
        timeout: READY_TIMEOUT,
      })
      .toBe(true);

    // Enable the strip and focus its textarea — the GENUINE gesture that
    // records `compose` for this window.
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await expect(composeInput(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await composeInput(page).click();
    await expectActiveElement(page, "compose");

    // Open the code tile (rail = persisted mutation; the click disarms this
    // visit's guard, so the grab stands here).
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);

    // Away and back: A's RETAINED frame re-shows (no reload — no second grab
    // fires), and the restore router focuses the remembered strip (never the
    // editor, never the terminal).
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await switchToWindow(page, idA);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectActiveElement(page, "compose");
  });

  /**
   * Proves: after a genuine click into the editor (the only seam that records
   * `code`), returning to the window focuses the RETAINED frame explicitly —
   * a retained frame fires no load-time grab, so the restore router's code
   * arm is what returns focus to the editor.
   *
   * Steps:
   * 1. Create windows A and B; navigate to A; open the code tile via the rail
   *    toggle; wait for the iframe and the grab.
   * 2. Click the stub editor's button through the frame; assert focus lands on
   *    the iframe element (records `code`, disarms the guard).
   * 3. Switch to B via the sidebar, then back to A — the return re-shows A's
   *    RETAINED frame (no reload, no second grab).
   * 4. Assert `document.activeElement` is the `Code editor` iframe — the
   *    restore router focused the recorded `code` target.
   */
  test("(c) a window remembered as code restores focus to the retained editor frame", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const idA = await makeWindow(page, `fr-a-code-${Date.now()}`);
    const idB = await makeWindow(page, `fr-b-code-${Date.now()}`);
    await gotoWindow(page, idA);

    // Open the code tile via the rail, let the grab fire (unguarded — the
    // rail click disarmed), THEN click into the stub editor: the genuine
    // in-frame interaction that records `code`. Waiting for the grab first
    // keeps the click from racing it.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await page
      .getByTestId("surface-tile-code")
      .frameLocator('iframe[title="Code editor"]')
      .locator("#inner")
      .click();
    await expectActiveElement(page, "code-iframe");

    // Away and back: A's RETAINED frame re-shows (no reload — no second grab
    // fires), and the restore router's code arm focuses the frame explicitly —
    // the remembered kind is `code`.
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await switchToWindow(page, idA);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectActiveElement(page, "code-iframe");
  });
});
