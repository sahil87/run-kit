import { test, expect, type Page } from "@playwright/test";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-sfc-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

/** The code-server port the e2e backend is configured with (the
 *  focus-restore spec's pattern — workers: 1 lets the files share the port).
 *  The stub bound here makes the surface REACHABLE, so the iframe renders
 *  instead of the not-running empty state — no reachability mock needed. */
function resolveCodePort(): number {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return 3939; // unset — same as the backend
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e surface-focus-chords\`, which seeds a valid port.`,
    );
  }
  return port;
}

const CODE_PORT = resolveCodePort();

/** How long after its own load the stub waits before grabbing focus — the
 *  stand-in for the code-server workbench's one-shot editor-restore grab. */
const GRAB_DELAY_MS = 300;

/** The stub "workbench" — byte-identical to the focus-restore spec's: a
 *  focusable button that grabs focus GRAB_DELAY_MS after load, then titles
 *  its document "grabbed" so the spec can await the grab deterministically
 *  (same-origin, so the parent can read the title). The grab is ONE-SHOT per
 *  load; focusing an element inside the frame chains focus up — the iframe
 *  ELEMENT becomes the parent document's activeElement, exactly like the
 *  real steal. */
function startStub(): Promise<http.Server> {
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html><body><button id="inner">stub editor</button><script>` +
        `var didFocus=false;setTimeout(function(){if(didFocus)return;didFocus=true;` +
        `document.getElementById("inner").focus();document.title="grabbed";},${GRAB_DELAY_MS});` +
        `</script></body></html>`,
    );
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(CODE_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/** Create a window (repo cwd — windows inherit the tmux server's start cwd, so
 *  the code lens is available) and return its stable `@N` id. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, name)).windowId;
}

/** Navigate to a window's terminal route and wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

/** Switch windows through the sidebar row — the ONLY switch path usable here:
 *  focus memory is in-memory by design, so a `page.goto` reload would wipe the
 *  very state under test (the focus-restore spec's pattern). */
async function switchToWindow(page: Page, windowId: string): Promise<void> {
  const row = page
    .locator("nav[aria-label='Sessions']")
    .locator(`[data-window-id="${windowId}"]`)
    .getByRole("button")
    .first();
  await expect(row).toBeVisible({ timeout: READY_TIMEOUT });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page", {
    timeout: READY_TIMEOUT,
  });
}

// The chords under test, as they resolve on the e2e rig's Linux browser host
// (base shifted tier — the mac ⌘ forms are unit-tested in keybindings.test.ts).
const CHORD_TTY = "Shift+Control+Digit1"; // ⌘1 on mac
const CHORD_CODE = "Shift+Control+Digit2"; // ⌘2 on mac
const CHORD_ZEN = "Shift+Control+Enter"; // ⇧⌘⏎ on mac
const CHORD_SIDEBAR = "Shift+Control+KeyB"; // ⌘B on mac

const codeIframe = (page: Page) => page.getByTitle("Code editor");
const ttyTile = (page: Page) => page.getByTestId("surface-tile-tty");
const codeTile = (page: Page) => page.getByTestId("surface-tile-code");
const railCodeButton = (page: Page) =>
  page.getByRole("button", { name: "Code tile" });
const sidebarAside = (page: Page) => page.locator('aside[aria-label="Sidebar"]');

/** The window's sidebar row wrapper (the roving treeitem). */
const windowRow = (page: Page, windowId: string) =>
  page.locator("nav[aria-label='Sessions']").locator(`[data-window-id="${windowId}"]`);

/** Poll until the stub's grab has FIRED inside the iframe (its document title
 *  flips to "grabbed") — keeps the specs non-vacuous (the focus-restore
 *  spec's gate). */
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

/** Poll `document.activeElement` until it lands on the expected focus target. */
async function expectActiveElement(
  page: Page,
  target: "xterm" | "code-iframe",
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((kind) => {
          const el = document.activeElement;
          if (!el) return false;
          if (kind === "xterm") return el.closest(".xterm") !== null;
          return el.tagName === "IFRAME" && el.getAttribute("title") === "Code editor";
        }, target),
      { timeout: READY_TIMEOUT },
    )
    .toBe(true);
}

/** One-shot check whether the xterm holds DOM focus right now. */
async function isXtermFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest(".xterm") !== null);
}

const tile = (page: Page, kind: "tty" | "code") =>
  kind === "tty" ? ttyTile(page) : codeTile(page);

/** Tile FOCUS is the focused-slot accent border (the tmux active-pane
 *  metaphor) — the observable the focus-hop e2e (shortcut-registry.spec.ts)
 *  already asserts; the seam's contract is slot focus, not DOM focus. */
async function expectTileFocused(page: Page, kind: "tty" | "code"): Promise<void> {
  await expect(tile(page, kind)).toHaveClass(/border-accent-green/, {
    timeout: READY_TIMEOUT,
  });
  const other = kind === "tty" ? "code" : "tty";
  await expect(tile(page, other)).not.toHaveClass(/border-accent-green/);
}

let stub: http.Server;

test.beforeAll(async ({ browser }, testInfo) => {
  // The hook's own budget: the warm-up below pays Vite's cold transform of
  // the app + xterm graph (the focus-restore spec's pattern).
  testInfo.setTimeout(90_000);
  createSession(TEST_SESSION);
  stub = await startStub();
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Surface focus chords (260819-qwr7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("(a) ⌘2 cycles hidden→open+focus, visible-unfocused→focus, focused→hide+restore; the chord never records `code`", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const idA = await makeWindow(page, `sfc-a-${Date.now()}`);
    const idB = await makeWindow(page, `sfc-b-${Date.now()}`);
    await gotoWindow(page, idA);
    await expectActiveElement(page, "xterm");
    // Gate the FIRST chord on the code lens being available (the rail toggle
    // renders only for available surfaces): a chord for an unavailable
    // surface mounts no handler and falls through by design (A-016).
    await expect(railCodeButton(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // State 1 — hidden: ⌘2 opens the code tile and focus lands on it once the
    // layout lands (the per-kind landing flag → the focus seam). The chord's
    // own keydown disarmed this visit's guard, so the stub's grab stands and
    // chains real DOM focus into the iframe.
    await page.keyboard.press(CHORD_CODE);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "code-iframe");
    await expectTileFocused(page, "code");

    // Make the tile visible-unfocused: click the terminal tile (a genuine
    // pointerdown — flips the focused slot to tty, records `tty`, and lands
    // DOM focus on the xterm).
    await page.locator(".xterm").first().click();
    await expectActiveElement(page, "xterm");
    await expectTileFocused(page, "tty");

    // State 2 — visible, not focused: ⌘2 focuses the code tile with NO layout
    // mutation (both tiles stay visible).
    await page.keyboard.press(CHORD_CODE);
    await expectTileFocused(page, "code");
    await expect(codeTile(page)).toBeVisible();
    await expect(ttyTile(page)).toBeVisible();

    // State 3 — focused at arity 2: ⌘2 hides the code tile and focus restores
    // through the router (memory holds `tty` from the click above — the hide
    // passes `exclude: "code"`, but the recalled kind is already tty).
    await page.keyboard.press(CHORD_CODE);
    await expect(codeTile(page)).toBeHidden({ timeout: READY_TIMEOUT });
    await expect(ttyTile(page)).toBeVisible();
    await expectActiveElement(page, "xterm");

    // The recording asymmetry, isolated on window B (nothing ever recorded
    // there): ⌘2 opens + focuses code, but writes NO focus memory. On the
    // away-and-back return the armed guard therefore resolves the tty default
    // and REVERTS the remounted stub's grab — had the chord recorded `code`,
    // the grab would stand (the focus-restore spec's (c) behavior).
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    // Same availability gate as above, for B's lens.
    await expect(railCodeButton(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await page.keyboard.press(CHORD_CODE);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "code-iframe");

    await switchToWindow(page, idA);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await switchToWindow(page, idB);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "xterm");
  });

  test("(b) ⌘1 focuses the tty tile from code (recording `tty` via the seam), then hides and reopens it", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sfc-c-${Date.now()}`);
    await gotoWindow(page, id);
    await expectActiveElement(page, "xterm");

    // Open code via the rail and click into the stub editor — the genuine
    // in-frame interaction that makes code the focused tile.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await page.frameLocator('iframe[title="Code editor"]').locator("#inner").click();
    await expectActiveElement(page, "code-iframe");
    await expectTileFocused(page, "code");

    // Focus arm: ⌘1 from inside the iframe (the chord-reclaim seam re-
    // dispatches it to the parent) moves tile focus to the tty — recording
    // `tty` through the seam's own recordTtySlot — with no layout mutation.
    await page.keyboard.press(CHORD_TTY);
    await expectTileFocused(page, "tty");
    await expect(codeTile(page)).toBeVisible();
    await expect(ttyTile(page)).toBeVisible();

    // The hide arm is a PARENT-side gesture: a chord reclaimed from inside
    // the iframe fires the frame's `onInteract` first (any in-frame keydown
    // is editor interaction), which re-flips the focused slot to code before
    // the dispatcher runs — so an in-frame ⌘1 always takes the focus arm.
    // Click the terminal to make tty's focus real, then ⌘1 at arity 2 closes
    // the tty tile (hidden, never unmounted — the P3 rule), leaving
    // single:code.
    await page.locator(".xterm").first().click();
    await expectActiveElement(page, "xterm");
    await page.keyboard.press(CHORD_TTY);
    await expect(ttyTile(page)).toBeHidden({ timeout: READY_TIMEOUT });
    await expect(codeTile(page)).toBeVisible();

    // Hidden arm: the next ⌘1 reopens the tty tile and focuses it on landing.
    await page.keyboard.press(CHORD_TTY);
    await expect(ttyTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectTileFocused(page, "tty");
  });

  test("(c) ⇧⌘⏎ enters zen (zooming the focused tile at arity 2) and exits on a second press; arity 1 hides chrome without zooming", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const idZoom = await makeWindow(page, `sfc-d-${Date.now()}`);
    const idSingle = await makeWindow(page, `sfc-e-${Date.now()}`);
    await gotoWindow(page, idZoom);

    // Arity 2 with the CODE tile focused: rail-open, then click into the stub
    // editor — the genuine in-frame interaction (`onInteract`) is what flips
    // the focused slot to code; the script grab alone produces no
    // parent-side focus event in Chromium.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await page.frameLocator('iframe[title="Code editor"]').locator("#inner").click();
    await expectActiveElement(page, "code-iframe");
    await expectTileFocused(page, "code");

    // First press: the focused (code) tile zooms — the tty tile hides at
    // display level (never unmounts, the P3 rule).
    await page.keyboard.press(CHORD_ZEN);
    await expect(ttyTile(page)).toBeHidden({ timeout: READY_TIMEOUT });
    await expect(codeTile(page)).toBeVisible();

    // Second press (reclaimed from inside the iframe) exits zen AND undoes
    // the zen-initiated zoom (260820-o8cr): both tiles are back. (The first
    // press also hid the top bar + sidebar — the full zen behavior is the
    // `zen-mode` spec's; here only the zoom seam is under test.)
    await page.keyboard.press(CHORD_ZEN);
    await expect(ttyTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeTile(page)).toBeVisible();

    // Arity 1 (260820-o8cr R6): the chord now mounts at ANY arity — the press
    // enters zen (no zoom is attempted), so the sidebar and the top-bar rail
    // are hidden while the single tty tile stays visible and focused. A
    // second press exits zen and restores the chrome.
    await switchToWindow(page, idSingle);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await expectActiveElement(page, "xterm");
    await page.keyboard.press(CHORD_ZEN);
    await expect(ttyTile(page)).toBeVisible();
    await expectActiveElement(page, "xterm");
    await expect(sidebarAside(page)).toBeHidden({ timeout: READY_TIMEOUT });
    await page.keyboard.press(CHORD_ZEN);
    await expect(sidebarAside(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // Non-vacuous: opening the code tile afterwards shows BOTH tiles
    // unzoomed — the arity-1 zen round-trip latched no zoom.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(ttyTile(page)).toBeVisible();
    await expect(codeTile(page)).toBeVisible();
  });

  test("(d) ⌘B focuses the current window's sidebar row (roving synced); Escape returns focus without hiding; a second ⌘B hides + returns", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `sfc-f-${Date.now()}`);
    await gotoWindow(page, id);
    await expectActiveElement(page, "xterm");
    await expect(sidebarAside(page)).toBeVisible();
    const rowButton = windowRow(page, id).getByRole("button").first();
    // Gate the first press on the row being rendered AND marked current (both
    // arrive via SSE after route mount) — the chord's focus arm queries
    // `[aria-current="page"]` at press time.
    await expect(rowButton).toHaveAttribute("aria-current", "page", {
      timeout: READY_TIMEOUT,
    });

    // Visible + focus outside → focus the current window's row; the roving
    // tab stop syncs to the row's treeitem (the Wave-2 #262 invariant).
    await page.keyboard.press(CHORD_SIDEBAR);
    await expect(rowButton).toBeFocused({ timeout: READY_TIMEOUT });
    await expect(windowRow(page, id)).toHaveAttribute("tabindex", "0");
    await expect(sidebarAside(page)).toBeVisible();

    // Escape returns focus to the remembered surface (the tty default — the
    // sidebar records nothing) WITHOUT hiding. The row flyout, if keyboard
    // focus opened it, gets Escape first-refusal (the nav handler is layered
    // after its dismiss), so allow one dismiss press before the return press.
    for (let i = 0; i < 2 && !(await isXtermFocused(page)); i++) {
      await page.keyboard.press("Escape");
    }
    await expectActiveElement(page, "xterm");
    await expect(sidebarAside(page)).toBeVisible();

    // Focus the row again, then ⌘B from INSIDE the sidebar → hide + return.
    await page.keyboard.press(CHORD_SIDEBAR);
    await expect(rowButton).toBeFocused({ timeout: READY_TIMEOUT });
    await page.keyboard.press(CHORD_SIDEBAR);
    await expect(sidebarAside(page)).toHaveCount(0);
    await expectActiveElement(page, "xterm");

    // Hidden → open + focus the row (deferred past the mount commit).
    await page.keyboard.press(CHORD_SIDEBAR);
    await expect(sidebarAside(page)).toBeVisible();
    await expect(rowButton).toBeFocused({ timeout: READY_TIMEOUT });
  });
});
