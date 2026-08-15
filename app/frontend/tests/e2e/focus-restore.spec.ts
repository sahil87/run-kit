import { test, expect, type Page } from "@playwright/test";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-focusrestore-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

/** The code-server port the e2e backend is configured with (the code-surface
 *  spec's pattern — workers: 1 lets the files share the port). The stub bound
 *  here makes the surface REACHABLE, so the iframe renders instead of the
 *  not-running empty state — no reachability mock needed. */
function resolveCodePort(): number {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return 3939; // unset — same as the backend
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e focus-restore\`, which seeds a valid port.`,
    );
  }
  return port;
}

const CODE_PORT = resolveCodePort();

/** How long after its own load the stub waits before grabbing focus — the
 *  stand-in for the code-server workbench's one-shot editor-restore grab. */
const GRAB_DELAY_MS = 300;

/** The stub "workbench": a focusable button that grabs focus GRAB_DELAY_MS
 *  after load, then titles its document "grabbed" so the spec can await the
 *  grab deterministically (same-origin, so the parent can read the title).
 *  The grab is ONE-SHOT per load (matching the real editor-restore grab): the
 *  `didFocus` flag stops the revert's focus churn from retriggering the
 *  timer's target. Focusing an element inside the frame chains focus up — the
 *  iframe ELEMENT becomes the parent document's activeElement, exactly like
 *  the real steal. */
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

/** Switch windows through the sidebar row — the ONLY switch path usable here:
 *  focus memory is in-memory by design, so a `page.goto` reload would wipe the
 *  very state under test. The row's button routes through `navigateToWindow`,
 *  identical to a real sidebar click. */
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

const codeIframe = (page: Page) => page.getByTitle("Code editor");
const composeInput = (page: Page) => page.getByTestId("compose-strip-input");
const railCodeButton = (page: Page) =>
  page.getByRole("button", { name: "Code tile" });

/** Open the code tile the way a USER does — the rail toggle. A rail click is
 *  a layout MUTATION (writes `rk-layout:{server}:{@N}`), so the code tile
 *  survives in-app window switches; a `?layout=` URL param does not (sidebar
 *  navigation drops the search string and URL layouts are never persisted).
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

/** Poll `document.activeElement` until it lands on the expected focus target. */
async function expectActiveElement(
  page: Page,
  target: "xterm" | "compose" | "code-iframe",
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((kind) => {
          const el = document.activeElement;
          if (!el) return false;
          if (kind === "xterm") return el.closest(".xterm") !== null;
          if (kind === "compose") {
            return el.getAttribute("data-testid") === "compose-strip-input";
          }
          return el.tagName === "IFRAME" && el.getAttribute("title") === "Code editor";
        }, target),
      { timeout: READY_TIMEOUT },
    )
    .toBe(true);
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

let stub: http.Server;

test.beforeAll(async ({ browser }, testInfo) => {
  // The hook's own budget: the warm-up below pays Vite's cold transform of
  // the app + xterm graph, which on a loaded box outlasts the default (the
  // per-test timeout, 10s locally). The inner expects carry their own 60s
  // gates; this just lets the hook live long enough to reach them.
  testInfo.setTimeout(90_000);
  createSession(TEST_SESSION);
  stub = await startStub();
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
  await new Promise((resolve) => stub.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Window-focus restore + code-server steal guard", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("(a) a window remembered as tty reverts the workbench grab to the terminal, and typing lands in the pane", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    // Window A runs `cat` so typed STDIN echoes into the pane — tmux-side
    // proof of where the keystrokes went. Window B is the away-window.
    const idA = await makeWindow(page, `fr-a-tty-${Date.now()}`, { command: "cat" });
    const idB = await makeWindow(page, `fr-b-tty-${Date.now()}`);
    await gotoWindow(page, idA);

    // First visit: no memory ⇒ the tty default — the restore effect focuses
    // the xterm textarea on its own (no grab exists yet: the code tile is
    // not open).
    await expectActiveElement(page, "xterm");

    // Open the code tile via the rail (a persisted user mutation — see the
    // helper comment above). The click disarms the guard, so the stub's grab
    // on this visit STANDS: focus lands in the iframe.
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "code-iframe");

    // Switch away and back IN-APP (memory is in-memory — a reload would wipe
    // it). The code tile re-renders from the persisted layout, the remounted
    // iframe grabs again — and this time the armed guard reverts it: nothing
    // was ever recorded for A, so the tty default wins.
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
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

  test("(b) a window remembered as compose reverts the grab to the strip textarea", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const idA = await makeWindow(page, `fr-a-compose-${Date.now()}`);
    const idB = await makeWindow(page, `fr-b-compose-${Date.now()}`);
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
    await page.getByRole("button", { name: "Compose text" }).click();
    await expect(composeInput(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await composeInput(page).click();
    await expectActiveElement(page, "compose");

    // Open the code tile (rail = persisted mutation; the click disarms this
    // visit's guard, so the grab stands here).
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);

    // Away and back: the strip is restored and the re-fired grab is reverted
    // to it (never the editor, never the terminal).
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await switchToWindow(page, idA);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "compose");
  });

  test("(c) a window remembered as code lets the grab through — the grab IS the restore", async ({
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
    await page.frameLocator('iframe[title="Code editor"]').locator("#inner").click();
    await expectActiveElement(page, "code-iframe");

    // Away and back: the remembered kind is `code`, so the guard lets the
    // remounted workbench's grab stand — focus lands INSIDE the iframe.
    await switchToWindow(page, idB);
    await expect(page.locator(".xterm").first()).toBeVisible({ timeout: READY_TIMEOUT });
    await switchToWindow(page, idA);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectGrabFired(page);
    await expectActiveElement(page, "code-iframe");
  });
});
