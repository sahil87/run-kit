import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow, windowOption } from "./_tmux";

/**
 * Per-window shared CODE ROOT (`docs/specs/right-panel.md` § The code lens +
 * § Surface Registry; ui-state.md § Code Surface): the code surface's folder
 * is the window's `@rk_win_code_root` tmux option — SEEDED once (the first
 * time the code tile renders for a window whose option is still empty, from
 * the derived gitRoot) and never moved by the terminal afterwards. The
 * backend keeps deriving `gitRoot` from the ACTIVE pane's cwd every SSE tick,
 * so a pane switch out of the repo must not make the code lens unavailable
 * (toggle and tile strobing away) and must not re-navigate the embedded
 * editor (losing its in-flight state). The spec drives the real thing: a
 * window with a second pane at a non-repo cwd, where the live derivation
 * observably goes empty while the option, the tile, its header, and the
 * iframe element all stay exactly as they were.
 *
 * Scope limit: the FOLLOW half of the rule — code-server's own File > Open
 * Folder navigation writing the option — is unit-tested only
 * (`src/components/code-surface.test.tsx`); the e2e harness has no live
 * code-server to navigate (the stub serves a single static page). What e2e
 * covers is the seed-once rule (asserted against the option itself) and its
 * consequences (pane switch, tile close/reopen, reload).
 *
 * Shared setup:
 * - tmux server: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`); never
 *   run Playwright directly — `just test-e2e code-folder-latch`.
 * - code-server stub: code-server is not installable in the test env, so
 *   `beforeAll` binds a stub HTTP server on `RK_CODE_SERVER_PORT` (default
 *   3939 — the same env the test-e2e script seeds the backend with) serving a
 *   minimal page, making the surface REACHABLE so the iframe renders instead
 *   of the not-running empty state. The port is validated against the
 *   backend's 1-65535 range first; `workers: 1` (serial) is what lets this
 *   file and `code-surface.spec.ts` share the port.
 * - `beforeAll`: create one dedicated session `e2e-codelatch-<ts>` (80×24) so
 *   this file never collides with other specs, start the stub, then warm the
 *   dev server with a throwaway terminal-route page load (Vite's cold
 *   transform of the app + xterm graph would otherwise eat the first test's
 *   budget). `afterAll` closes the stub and kills the session.
 * - `beforeEach`: desktop viewport (1440×800) — the rail is desktop-only.
 * - Readiness gate: the status bar's `Connected` dot (the desktop sidebar
 *   footer is gone, so the old nav-scoped gate no longer resolves on desktop).
 * - `makeWindow(name)`: create a repo-cwd window (windows inherit the tmux
 *   server's repo-root cwd) and return its stable `@N` id.
 * - `expectCodeRoot(id, expected)`: retrying read of the window's
 *   `@rk_win_code_root` option — the SEED's ground truth (the POST lands
 *   asynchronously, so the read polls).
 * - `splitPaneOutsideRepo(id)`: `tmux split-window -c /tmp` on the window.
 *   tmux makes the new pane ACTIVE, so the backend's active-pane-preferring
 *   `deriveGitRoot` starts returning `""`.
 * - `expectDerivedGitRoot(page, id, expected)`: retrying read of the window's
 *   `gitRoot` in `GET /api/sessions` (`omitempty` — an absent field IS the
 *   empty derivation). Every test asserts the derivation actually MOVED, so a
 *   passing run can never be the vacuous "nothing changed anywhere" case.
 * - `GIT_ROOT` / `GIT_ROOT_BASENAME` / `SEEDED_SRC`: `git rev-parse
 *   --show-toplevel` from the spec process, its basename (what the tile header
 *   chip shows), and the expected iframe `src` `/code/?folder=<encoded root>`.
 * - Locators: the `Code tile` rail toggle, the `surface-tile-code` tile
 *   testid, the `Code editor` iframe title, and the `.xterm` terminal surface.
 * - Budgets: both tests call `test.setTimeout(30_000)` — each drives several
 *   SSE round trips plus a real tmux split, well past the 10s default.
 */

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-codelatch-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

/** The code-server port the e2e backend is configured with — code-server itself
 *  is not installable here, so a stub HTTP server binds it to make the surface
 *  REACHABLE (the code-surface spec's pattern; workers: 1 means the two files
 *  never hold the port at the same time). */
function resolveCodePort(): number {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return 3939; // unset — same as the backend
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e code-folder-latch\`, which seeds a valid port.`,
    );
  }
  return port;
}

const CODE_PORT = resolveCodePort();

// The git root every in-repo window derives (windows inherit the tmux server's
// start cwd — the repo root) and the basename the code tile header shows.
const GIT_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();
const GIT_ROOT_BASENAME = GIT_ROOT.split("/").filter(Boolean).pop()!;
const SEEDED_SRC = `/code/?folder=${encodeURIComponent(GIT_ROOT)}`;

function startStub(): Promise<http.Server> {
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><body><button id="inner">stub editor</button></body></html>');
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(CODE_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/** Create a repo-cwd window and return its stable `@N` id. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, name)).windowId;
}

/** Split a SECOND pane into the window at a NON-repo cwd. tmux makes the new
 *  pane active, so the backend's active-pane-preferring `deriveGitRoot` starts
 *  returning "" for this window — the intake's screenshot scenario, minus the
 *  human switching panes. No `_tmux.ts` helper exists for splits; this is the
 *  same direct `execFileSync` the code-surface spec uses for `set-option`. */
function splitPaneOutsideRepo(windowId: string): void {
  execFileSync("tmux", ["-L", TMUX_SERVER, "split-window", "-t", windowId, "-c", "/tmp"]);
}

/** Poll the backend snapshot until the window's LIVE derivation matches. The
 *  spec's whole premise is that derivation moved while the editor did not, so
 *  the tests assert the move actually happened rather than assuming it. */
async function expectDerivedGitRoot(
  page: Page,
  windowId: string,
  expected: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
        );
        if (!res.ok()) return null;
        const sessions = (await res.json()) as Array<{
          name: string;
          windows: Array<{ windowId: string; gitRoot?: string }>;
        }>;
        const win = sessions
          .find((s) => s.name === TEST_SESSION)
          ?.windows.find((w) => w.windowId === windowId);
        // `gitRoot` is `omitempty` — an absent field IS the empty derivation.
        return win ? (win.gitRoot ?? "") : null;
      },
      { timeout: READY_TIMEOUT },
    )
    .toBe(expected);
}

/** Poll the window's `@rk_win_code_root` option — the seed write's ground
 *  truth (the POST lands asynchronously). */
async function expectCodeRoot(windowId: string, expected: string): Promise<void> {
  await expect
    .poll(() => windowOption(windowId, "@rk_win_code_root"), { timeout: 10_000 })
    .toBe(expected);
}

const railCodeButton = (page: Page) => page.getByRole("button", { name: "Code tile" });
const codeTile = (page: Page) => page.getByTestId("surface-tile-code");
const codeIframe = (page: Page) => page.getByTitle("Code editor");
const terminal = (page: Page) => page.locator(".xterm").first();

let stub: http.Server;

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  stub = await startStub();
  // Cold-boot warm-up (the code-surface spec's pattern): absorb Vite's cold
  // transform of the app + xterm graph outside any test's budget.
  const page = await browser.newPage();
  const first = await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION);
  await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(first.windowId)}`);
  await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Code root (@rk_win_code_root seed + stability)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: the first code-tile render SEEDS `@rk_win_code_root` from the
   * derived gitRoot, and the seed never moves the editor again. Once the
   * active pane leaves the repo (live `gitRoot` → `""`) the toggle, the
   * tile, its header basename, and the iframe `src` are all unchanged, and
   * the iframe is the SAME element — the parent never re-navigated it (a
   * re-set `src` reloads the workbench even to the URL it is already at).
   * Closing and reopening the tile in that state re-derives nothing.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?layout=split-h:tty,code`;
   *    wait for the SSE connection.
   * 2. Assert the `Code editor` iframe is visible with
   *    `src=/code/?folder=<git root>`, the tile header contains the repo
   *    basename, and the window's `@rk_win_code_root` option now holds the
   *    git root (the one seed write); capture the iframe's element handle.
   * 3. `split-window -c /tmp` on the window; poll `GET /api/sessions` until the
   *    window's derived `gitRoot` is `""`.
   * 4. Assert the `Code tile` toggle, the tile, its header basename, the
   *    iframe `src`, and the option are all still there; assert the iframe
   *    element handle is IDENTICAL to the captured one; assert the terminal
   *    is still visible.
   * 5. Click the `Code tile` toggle to close the tile (assert hidden),
   *    click it again to reopen (assert visible), and assert the reopened
   *    iframe `src` and header basename still come from the option.
   */
  test("the code tile survives the active pane leaving the repo, and reopens at the seeded code root", async ({
    page,
  }) => {
    // Several SSE round trips plus a tmux split — well past the default budget.
    test.setTimeout(30_000);
    const id = await makeWindow(page, `latch-panes-${Date.now()}`);
    await page.goto(
      `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=split-h:tty,code`,
    );
    await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });

    // First open: the derived gitRoot seeds the shared option (exactly one
    // write), and the tile header names it.
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(iframe).toHaveAttribute("src", SEEDED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    await expectCodeRoot(id, GIT_ROOT);
    const handleBefore = await iframe.elementHandle();

    // The active pane leaves the repo — the LIVE derivation goes empty.
    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "");

    // Everything the derivation used to drive stays put: the toggle, the
    // tile, its header, the iframe's src, the option itself, and the iframe
    // ELEMENT itself (a re-navigation would have replaced the workbench and
    // its in-flight state).
    await expect(railCodeButton(page)).toBeVisible();
    await expect(codeTile(page)).toBeVisible();
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    await expect(iframe).toHaveAttribute("src", SEEDED_SRC);
    expect(windowOption(id, "@rk_win_code_root")).toBe(GIT_ROOT);
    const handleAfter = await iframe.elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
    await expect(terminal(page)).toBeVisible();

    // Close and reopen the tile while the active pane is STILL outside the
    // repo: reopening re-derives nothing — the shared option decides.
    await railCodeButton(page).click();
    await expect(codeTile(page)).toBeHidden();
    await railCodeButton(page).click();
    await expect(codeTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", SEEDED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
  });

  /**
   * Proves: the code root is SUBSTRATE state (a tmux option), not in-memory
   * or per-browser state. After a full reload — which discards every
   * in-memory trace of the seed — a bare-route re-arrival still renders the
   * seeded layout and boots the editor at the seeded folder; on a
   * derivation-only availability rule the layout would degrade to
   * `single:tty` and render a terminal.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?layout=single:code` (inbound
   *    translation writes `@rk_win_layout`); assert the iframe is visible at
   *    `src=/code/?folder=<git root>` and the option holds the git root (the
   *    seed).
   * 2. `split-window -c /tmp`; poll until the derived `gitRoot` is `""`.
   * 3. `page.goto` the BARE route (a full reload with no carried params).
   * 4. Assert the `Code editor` iframe is visible at the same seeded `src`,
   *    the tile header still contains the repo basename, and the option is
   *    unchanged.
   */
  test("a bare-route reload with the active pane outside the repo still renders the seeded code root", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `latch-reload-${Date.now()}`);
    const url = `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=single:code`;
    await page.goto(url);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", SEEDED_SRC);
    await expectCodeRoot(id, GIT_ROOT);

    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "");

    // A full load of the BARE route throws away every in-memory trace of the
    // seed; the layout AND the folder come from tmux, so the code lens still
    // resolves (it would degrade to `single:tty` on a derivation-only
    // availability rule).
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", SEEDED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    expect(windowOption(id, "@rk_win_code_root")).toBe(GIT_ROOT);
  });
});
