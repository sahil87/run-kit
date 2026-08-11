import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-codesurface-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

/** The code-server port the e2e backend is configured with (scripts/test-e2e.sh
 *  seeds RK_CODE_SERVER_PORT for both the backend and this playwright run; the
 *  default mirrors the script's). code-server itself is NOT installable here —
 *  the spec binds a STUB HTTP server on this port to drive the reachable /
 *  not-running states (intake k3vp §6).
 *
 *  An out-of-range value is rejected here rather than at `srv.listen()`: the
 *  backend's validPort silently leaves CodeServerPort at 0 (feature off), so a
 *  bad value would surface as unrelated missing-affordance failures. */
function resolveCodePort(): number {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return 3939; // unset — same as the backend
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e code-surface\`, which seeds a valid port.`,
    );
  }
  return port;
}

const CODE_PORT = resolveCodePort();

// The git root every in-repo window derives (windows inherit the tmux server's
// start cwd — the repo root). FindGitRoot walks to the toplevel, so the
// expected `?folder=` value is the worktree root.
const GIT_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();

/** The stub "code-server": a minimal same-origin page with a focusable button
 *  (the keyboard-spike test clicks into it). Proxied at /proxy/{port}/. */
function startStub(): Promise<http.Server> {
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><body><button id="inner">stub editor</button></body></html>',
    );
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(CODE_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/** Resolve a window's stable tmux id (`@N`) from the backend snapshot by name. */
async function resolveWindow(page: Page, windowName: string): Promise<string> {
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName)).windowId;
}

/** Create a window (optionally in a NON-repo cwd) and return its @N id. */
async function makeWindow(page: Page, name: string, opts: { cwd?: string } = {}): Promise<string> {
  newWindow(TEST_SESSION, name, opts);
  return resolveWindow(page, name);
}

/** Navigate to a window's terminal route (optionally with a search string) and
 *  wait for the SSE connection. */
async function gotoWindow(page: Page, windowId: string, search = ""): Promise<void> {
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(windowId)}${search}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const railCodeButton = (page: Page) => page.getByRole("button", { name: "Code panel" });
const panel = (page: Page) => page.getByTestId("right-panel");
const codeIframe = (page: Page) => page.getByTitle("Code editor");
const notRunning = (page: Page) => page.getByTestId("code-surface-empty");
const terminal = (page: Page) => page.locator(".xterm").first();

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  // Cold-boot warm-up: when this file runs standalone (`just test-e2e
  // code-surface`), the first test would otherwise pay Vite's cold transform
  // of the app + xterm graph INSIDE its 10s budget (observed: `Connected`
  // never landing in time). A throwaway TERMINAL-route load of this session's
  // first window (beforeAll is outside the per-test budget) absorbs it — the
  // xterm chunk is what a server-route warm-up would miss.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

test.describe("Code lens & CODE surface (phase 2) — stub reachable", () => {
  let stub: http.Server;

  test.beforeAll(async () => {
    stub = await startStub();
  });

  test.afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("the code rail button + View: Code menu row appear only on a git-repo window", async ({ page }) => {
    // A repo-cwd window gains the code affordances once the SSE window payload
    // carries gitRoot (availability = gitRoot ∧ configured port — never
    // reachability).
    const repo = await makeWindow(page, `cs-repo-${Date.now()}`);
    await gotoWindow(page, repo);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(railCodeButton(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // The view switcher is menuOnly (260722-n2n4): the code lens surfaces as a
    // per-view row in the "More controls" chevron menu.
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(
      page.getByRole("menu", { name: "More controls" }).getByRole("menuitemradio", { name: "View: Code" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // A NON-repo cwd (/tmp) derives no gitRoot → neither affordance renders,
    // even with the port configured.
    const offRepo = await makeWindow(page, `cs-tmp-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, offRepo);
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(railCodeButton(page)).toHaveCount(0);
    await page.getByRole("button", { name: "More controls" }).click();
    await expect(
      page.getByRole("menu", { name: "More controls" }).getByRole("menuitemradio", { name: "View: Code" }),
    ).toHaveCount(0);
  });

  test("?panel=code opens the surface; the iframe src is /proxy/{port}/?folder=<git root>", async ({ page }) => {
    const id = await makeWindow(page, `cs-panel-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");

    // The iframe renders (stub reachable) at the fully DERIVED relative src —
    // never an absolute origin (the toProxySrc path discipline).
    await expect(panel(page)).toBeVisible({ timeout: 10_000 });
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(iframe).toHaveAttribute(
      "src",
      `/proxy/${CODE_PORT}/?folder=${encodeURIComponent(GIT_ROOT)}`,
    );
    // The sandbox carries the k3vp prerequisite set incl. allow-downloads.
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-downloads");
    // The terminal stays mounted beside the panel (P2).
    await expect(terminal(page)).toBeVisible();
  });

  test("?view=code renders the code lens in the MAIN slot", async ({ page }) => {
    const id = await makeWindow(page, `cs-view-${Date.now()}`);
    await gotoWindow(page, id, "?view=code");
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    // The rail is still there (the panel slot is independent, P2).
    await expect(page.getByTestId("right-panel-rail")).toBeVisible();
  });

  test("unavailable params fall through: ?view=code → tty and ?panel=code → closed on a /tmp window", async ({ page }) => {
    const id = await makeWindow(page, `cs-fallthrough-${Date.now()}`, { cwd: "/tmp" });
    await gotoWindow(page, id, "?view=code&panel=code");
    await expect(terminal(page)).toBeVisible({ timeout: 10_000 });
    await expect(codeIframe(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });

  test("switching surfaces hides but never unmounts the web iframe (P3 across surfaces)", async ({ page }) => {
    const id = await makeWindow(page, `cs-p3-${Date.now()}`);
    // Stamp @rk_url so BOTH surfaces are available on this repo-cwd window.
    execFileSync("tmux", ["-L", TMUX_SERVER, "set-option", "-w", "-t", id, "@rk_url", "http://localhost:8080/"]);
    await gotoWindow(page, id);
    const railWebButton = page.getByRole("button", { name: "Web panel" });
    await expect(railWebButton).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(railCodeButton(page)).toBeVisible();

    // Open web, then switch to code (P6 swaps content in place).
    await railWebButton.click();
    await expect(panel(page).getByTitle("Proxied content")).toBeVisible({ timeout: 10_000 });
    await railCodeButton(page).click();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });

    // The web iframe is hidden but STILL MOUNTED — the same element returns
    // when switching back.
    const webIframe = panel(page).getByTitle("Proxied content");
    await expect(webIframe).toBeHidden();
    await expect(webIframe).toHaveCount(1);
    const handleBefore = await webIframe.elementHandle();
    await railWebButton.click();
    await expect(webIframe).toBeVisible({ timeout: 10_000 });
    const handleAfter = await webIframe.elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
  });

  test("keyboard spike: a registry chord pressed INSIDE the iframe reaches the parent (chord reclaim)", async ({ page }) => {
    const id = await makeWindow(page, `cs-chord-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });

    // Focus INSIDE the same-origin stub frame, then press the palette chord —
    // without the capture-phase reclaim listener, the iframe would swallow it.
    await page.frameLocator('iframe[title="Code editor"]').locator("#inner").click();
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Code lens & CODE surface (phase 2) — stub down", () => {
  // No stub here: nothing listens on CODE_PORT (the previous describe's
  // afterAll closed it), so the TTL-cached probe flips to unreachable.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("the surface renders the not-running empty state when the port is unreachable", async ({ page }) => {
    const id = await makeWindow(page, `cs-down-${Date.now()}`);
    await gotoWindow(page, id, "?panel=code");

    // Availability still holds (port configured ∧ gitRoot derived) — the rail
    // button renders; only the CONTENT is the empty state. Generous timeout:
    // the backend's ~5s probe TTL must expire before the flip lands.
    await expect(railCodeButton(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(notRunning(page)).toHaveText(`code-server not running on :${CODE_PORT}`, {
      timeout: 30_000,
    });
    await expect(codeIframe(page)).toHaveCount(0);
  });
});
