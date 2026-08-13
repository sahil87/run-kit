import { test, expect } from "@playwright/test";
import { execFileSync, execSync } from "node:child_process";
import { pinWindow } from "./_boards";
import { READY_TIMEOUT, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

/**
 * Docked compose strip (260718-dhdj) e2e coverage. The strip replaces the modal
 * ComposeBuffer: a single global surface toggled by the `a▏` chip /
 * `View: Text Input` palette action, persisted as a chrome preference, sending
 * to the LIVE focused pane. It renders at exactly one of TWO docks
 * (260813-j3jb): INSIDE the first tty tile on the desktop terminal route
 * (single-send — the tile frame makes the target self-evident), or full-width
 * at the shell footer (selection broadcast, the board route, mobile, no-tty
 * layouts). The dock split doubles as the mode signal: in-tile = sends to this
 * terminal, footer = broadcast/fallback. Enter matrix (260802-lj98,
 * terminal-faithful): plain Enter = insert line (`text + "\n"`,
 * clears the draft; empty Enter is a full no-op); Cmd/Ctrl+Enter = submit
 * (`text + "\r"`; EMPTY textarea sends a bare `\r` — "press Enter in the
 * pane"); Alt+Enter = chord-only byte-exact raw insert; Shift+Enter is the
 * only local newline. Drafts are PER TARGET (260801-cyth): keyed by the
 * focused window and persisted (text only) to localStorage, so they stay with
 * their addressee across navigation, dock flips, and survive reloads. See the
 * sibling `.spec.md` for the per-test contract.
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

/** Bounding box or throw (a hidden/absent element is a real failure here). */
async function boxOf(
  locator: import("@playwright/test").Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

/** Poll until the locator's left/width land within `tol` px of the target's —
 * used for the footer dock's full-width assertion (the box settles with the
 * layout, so a one-shot assert could catch it mid-paint). */
async function expectAlignedTo(
  locator: import("@playwright/test").Locator,
  target: { x: number; width: number },
  tol = 4,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const b = await locator.boundingBox();
        if (!b) return Infinity;
        return Math.max(Math.abs(b.x - target.x), Math.abs(b.width - target.width));
      },
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(tol);
}

test.describe("Docked compose strip", () => {
  test.beforeAll(() => {
    // Terminal-route session runs `cat` so typed STDIN echoes into the pane —
    // this is how we verify Enter sends `text + \r` end-to-end.
    createSession(TERM_SESSION);
    tmux(`send-keys -t ${TERM_SESSION} 'cat' Enter`);
    // Stamp @rk_url up front: the split-layout test's web tile reads rkUrl
    // from the backend's window payload, which refreshes on an interval —
    // setting the option mid-test raced that propagation (a >10s cold wait).
    const first = listWindows(TERM_SESSION)[0];
    if (first) {
      execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", first.windowId, "@rk_url", "http://localhost:8080/"]);
    }
    // Board-route session with two named windows for the target-label test.
    createSession(BOARD_SESSION, { windows: ["cs-alpha", "cs-bravo"] });
  });

  test.afterAll(() => {
    try { tmux(`send-keys -t ${TERM_SESSION} C-c`); } catch { /* ok */ }
    killSession(TERM_SESSION);
    killSession(BOARD_SESSION);
  });

  test("toggle via a▏ chip and via the command palette; persists across reload", async ({ page }) => {
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

    // Enable the strip via the `a▏` chip and type a draft.
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

  test("the strip docks INSIDE the tty tile on a desktop terminal route (260813-j3jb)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 800 });
    const windowId = await resolveWindowId(page, TERM_SESSION);
    // @rk_url was stamped in beforeAll (the backend payload refreshes on an
    // interval — setting it here raced that propagation). The iframe src is
    // deterministic regardless of whether anything listens there (we assert
    // dock placement, never iframe content).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}?layout=split-h:tty,web`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    const ttyTile = page.getByTestId("surface-tile-tty");
    await expect(ttyTile).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("surface-tile-web")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Compose text" }).click();
    const strip = page.getByTestId("compose-strip");
    await expect(strip).toBeVisible();

    // In-tile dock: the strip is a DESCENDANT of the tty tile's frame (below
    // the terminal body) — and NOT in the shell footer.
    await expect(ttyTile.getByTestId("compose-strip")).toBeVisible();
    await expect(page.locator("footer").getByTestId("compose-strip")).toHaveCount(0);
    // It carries no pane-alignment inline styles (container-aligned by
    // construction — 260812-fryz's measurement hack is retired).
    await expect(page.getByTestId("compose-strip-inner")).not.toHaveAttribute(
      "style",
      /margin-left|width/,
    );

    // Zooming the tty tile carries the strip with it (the dock rides the tile).
    await ttyTile.getByRole("button", { name: "Zoom Terminal" }).click();
    await expect(ttyTile.getByTestId("compose-strip")).toBeVisible();
    await expect(page.locator("footer").getByTestId("compose-strip")).toHaveCount(0);
  });

  test("the board route docks the strip at the shell footer, full width (260813-j3jb)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 800 });
    const alpha = await resolveWindowId(page, BOARD_SESSION, "cs-alpha");
    const bravo = await resolveWindowId(page, BOARD_SESSION, "cs-bravo");
    // A second, per-run-unique board so this test's pins never tangle with the
    // target-label test's board above.
    const alignBoard = `csa${Date.now().toString().slice(-6)}`;
    for (const winId of [alpha, bravo]) {
      await pinWindow(page.request, alignBoard, TMUX_SERVER, winId);
    }

    await page.goto(`/board/${alignBoard}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 15_000 });

    await page.getByRole("button", { name: "Compose text" }).click();
    const strip = page.getByTestId("compose-strip");
    const inner = page.getByTestId("compose-strip-inner");
    await expect(inner).toBeVisible();

    // The board has no surface tiles, so the strip docks at the shell footer —
    // a child of <footer>, never inside a board pane — and spans the FULL row
    // (no pane alignment on this dock).
    await expect(page.locator("footer").getByTestId("compose-strip")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "board pane cs-alpha" }).getByTestId("compose-strip"),
    ).toHaveCount(0);
    const rowBox = await boxOf(strip);
    await expectAlignedTo(inner, rowBox, 2);
    await expect(inner).not.toHaveAttribute("style", /margin-left/);
  });

  test("selection broadcast flips the strip from the tile to the footer dock (260813-j3jb)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 800 });
    const alpha = await resolveWindowId(page, BOARD_SESSION, "cs-alpha");
    const bravo = await resolveWindowId(page, BOARD_SESSION, "cs-bravo");

    // Start on cs-alpha's TERMINAL route with the strip enabled: single-send
    // mode docks it inside the tty tile.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(alpha)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
    const ttyTile = page.getByTestId("surface-tile-tty");
    await expect(ttyTile).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Compose text" }).click();
    await expect(ttyTile.getByTestId("compose-strip")).toBeVisible();
    // Focus-on-open grabbed the textarea; blur it so nothing below is
    // input-suppressed.
    await page.keyboard.press("Escape");

    // Select both windows in the sidebar tree, then open the broadcast strip
    // via the palette action (no send — dock placement only).
    for (const winId of [alpha, bravo]) {
      const row = page.locator(`[data-row-key="${TMUX_SERVER}:${winId}"] button`).first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click({ modifiers: ["ControlOrMeta"] });
    }
    await page.keyboard.press("Meta+k");
    await page.getByPlaceholder("Type a command").fill("Selection: Send prompt to 2 agents");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("compose-strip-target")).toHaveText("2 selected");

    // The flip: broadcast is a shell-level concern, so the strip leaves the
    // tile and renders at the shell footer — full width, no alignment styles.
    await expect(ttyTile.getByTestId("compose-strip")).toHaveCount(0);
    const footerStrip = page.locator("footer").getByTestId("compose-strip");
    await expect(footerStrip).toBeVisible();
    const rowBox = await boxOf(footerStrip);
    await expectAlignedTo(page.getByTestId("compose-strip-inner"), rowBox, 2);
    await expect(page.getByTestId("compose-strip-inner")).not.toHaveAttribute(
      "style",
      /margin-left/,
    );
  });

  test("375px mobile: the strip docks at the shell footer with no horizontal overflow (260813-j3jb)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 375, height: 812 });
    const windowId = await resolveWindowId(page, TERM_SESSION);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}`, {
      waitUntil: "domcontentloaded",
    });
    // No `Connected` dot on mobile (the sidebar is an unmounted drawer) — gate
    // on the terminal itself.
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Compose text" }).click();
    const inner = page.getByTestId("compose-strip-inner");
    await expect(inner).toBeVisible();

    // Mobile renders no tile chrome, so the strip docks at the shell footer —
    // never inside the (chromeless) tile — and causes no page-level
    // horizontal overflow; the visible box stays fully inside the viewport.
    await expect(page.locator("footer").getByTestId("compose-strip")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(375);
    const innerBox = await boxOf(inner);
    expect(innerBox.x).toBeGreaterThanOrEqual(0);
    expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(375);
  });
});
