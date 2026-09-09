import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { plainCodeStubHtml, startCodeStub, type CodeStub } from "./_ports";
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
 * observably changes to the raw-cwd fallback (`/tmp`) while the option, the
 * tile, its header, and the iframe element all stay exactly as they were.
 *
 * Scope limit: the FOLLOW half of the rule — code-server's own File > Open
 * Folder navigation writing the option — is unit-tested only
 * (`src/components/code-surface.test.tsx`); the e2e harness has no live
 * code-server to navigate (the stub serves a single static page). What e2e
 * covers is the seed-once rule (asserted against the option itself) and its
 * consequences (pane switch, tile close/reopen, reload), plus the derived
 * workspace file's regeneration after deletion.
 *
 * Shared setup:
 * - tmux server: the isolated `rk-test-e2e` socket (`E2E_TMUX_SERVER`); never
 *   run Playwright directly — `just test-e2e code-folder-latch`.
 * - code-server stub: code-server is not installable in the test env, so
 *   `beforeAll` binds a stub HTTP server (`startCodeStub`, `_ports.ts`) on
 *   `RK_CODE_SERVER_PORT` (the same env the test-e2e script seeds the backend
 *   with; an ephemeral port when unset) serving a minimal page, making the
 *   surface REACHABLE so the iframe renders instead of the not-running empty
 *   state. The helper validates the env against the backend's 1-65535 range
 *   before binding; `workers: 1` (serial) is what lets this file and
 *   `code-surface.spec.ts` share the seeded port.
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
 *   `deriveGitRoot` starts returning `/tmp` (the raw-cwd fallback for a
 *   non-repo cwd).
 * - `expectDerivedGitRoot(page, id, expected)`: retrying read of the window's
 *   `gitRoot` in `GET /api/sessions` (`omitempty` — an absent field IS the
 *   empty derivation). Every test asserts the derivation actually MOVED, so a
 *   passing run can never be the vacuous "nothing changed anywhere" case.
 * - `GIT_ROOT` / `GIT_ROOT_BASENAME`: `git rev-parse --show-toplevel` from
 *   the spec process and its basename (what the tile header chip shows).
 * - `fetchWorkspace(page, id)`: the test's own GET of
 *   `/api/windows/<id>/code-workspace` — the derived workspace file's
 *   run-specific absolute path (the harness's per-run XDG_STATE_HOME, so it
 *   is never hardcoded) and the `root` it was derived from. The expected
 *   iframe `src` is `/code/?workspace=<encoded path>`.
 * - `expectWorkspaceFile(path, root, id)`: reads the workspace file off disk
 *   and asserts its identity payload (`folders[0].path`, `rk.tab`,
 *   `rk.server`).
 * - `holdWorkspaceFetch(page)`: route-holds the frontend's code-workspace GET
 *   until released, so the pending → iframe transition is observable
 *   regardless of box load.
 * - Locators: the `Code tile` rail toggle, the `surface-tile-code` tile
 *   testid, the `Code editor` iframe title, and the `.xterm` terminal surface.
 * - Budgets: every test calls `test.setTimeout(30_000)` — each drives several
 *   SSE round trips plus a real tmux split or a full reload, well past the
 *   10s default.
 */

// Own session so this file never collides with other specs (fullyParallel off).
const TEST_SESSION = `e2e-codelatch-${Date.now()}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 800 };

// The git root every in-repo window derives (windows inherit the tmux server's
// start cwd — the repo root) and the basename the code tile header shows.
const GIT_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
}).trim();
const GIT_ROOT_BASENAME = GIT_ROOT.split("/").filter(Boolean).pop()!;

/** The window's derived workspace file, fetched exactly the way the tile does:
 *  GET /api/windows/{id}/code-workspace (the route's single writer). The
 *  harness runs with a per-run temp XDG_STATE_HOME, so the returned absolute
 *  path is run-specific — the response is the only legitimate source. */
async function fetchWorkspace(
  page: Page,
  windowId: string,
): Promise<{ path: string; root: string }> {
  const res = await page.request.get(
    `/api/windows/${encodeURIComponent(windowId)}/code-workspace?server=${encodeURIComponent(TMUX_SERVER)}`,
  );
  expect(res.ok(), `code-workspace GET for ${windowId}: ${res.status()}`).toBe(true);
  return (await res.json()) as { path: string; root: string };
}

/** The expected iframe `src` for a derived workspace path. */
function workspaceSrc(path: string): string {
  return `/code/?workspace=${encodeURIComponent(path)}`;
}

/** Read the derived workspace file off disk and assert its identity payload:
 *  the folder it was derived from, the window id (`rk.tab`), and the tmux
 *  server (`rk.server`). */
function expectWorkspaceFile(path: string, root: string, windowId: string): void {
  expect(existsSync(path), `workspace file exists: ${path}`).toBe(true);
  const doc = JSON.parse(readFileSync(path, "utf-8")) as {
    folders: Array<{ path: string }>;
    settings: Record<string, string>;
  };
  expect(doc.folders).toEqual([{ path: root }]);
  expect(doc.settings["rk.tab"]).toBe(windowId);
  expect(doc.settings["rk.server"]).toBe(TMUX_SERVER);
}

/** Route-hold the frontend's code-workspace GET until the returned release
 *  runs — makes the pending → iframe transition deterministic regardless of
 *  box load (the pending state's natural lifetime can be shorter than a
 *  paint). The test's own `fetchWorkspace` goes through `page.request`, which
 *  page routing does not intercept. */
async function holdWorkspaceFetch(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/windows/*/code-workspace*", async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** Create a repo-cwd window and return its stable `@N` id. */
async function makeWindow(page: Page, name: string): Promise<string> {
  newWindow(TEST_SESSION, name);
  return (await resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, name)).windowId;
}

/** Split a SECOND pane into the window at a NON-repo cwd. tmux makes the new
 *  pane active, so the backend's active-pane-preferring `deriveGitRoot` starts
 *  returning `/tmp` (the raw-cwd fallback) for this window — the intake's
 *  screenshot scenario, minus the human switching panes. No `_tmux.ts` helper
 *  exists for splits; this is the
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

let stub: CodeStub;

test.beforeAll(async ({ browser }) => {
  createSession(TEST_SESSION);
  stub = await startCodeStub(plainCodeStubHtml());
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
  await new Promise((resolve) => stub.server.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Code root (@rk_win_code_root seed + stability)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  /**
   * Proves: the first code-tile render SEEDS `@rk_win_code_root` from the
   * derived gitRoot, shows the terse pending state until the derived
   * workspace path resolves, and mounts the editor at the tab-keyed
   * `/code/?workspace=<path>` URL — and the seed never moves the editor
   * again. Once the active pane leaves the repo (live `gitRoot` → the
   * raw-cwd fallback `/tmp`) the toggle, the tile, its header basename, and
   * the iframe `src` are all unchanged, and the iframe is the SAME element —
   * the parent never re-navigated it (a re-set `src` reloads the workbench
   * even to the URL it is already at). Closing and reopening the tile in
   * that state re-derives nothing.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?layout=split-h:tty,code`;
   *    wait for the SSE connection.
   * 2. With the window's code-workspace GET route-held, assert
   *    `code-surface-pending` precedes the `Code editor` iframe; release the
   *    GET, then assert the iframe is visible, the window's
   *    `@rk_win_code_root` option now holds the git root (the one seed
   *    write), and the tile header contains the repo basename.
   * 3. GET the window's code-workspace; assert the iframe `src` is
   *    `/code/?workspace=<encoded path>` and the workspace file on disk
   *    carries the git root (`folders[0].path`), the window id (`rk.tab`),
   *    and the tmux server (`rk.server`). Capture the iframe's element
   *    handle.
   * 4. `split-window -c /tmp` on the window; poll `GET /api/sessions` until
   *    the window's derived `gitRoot` is `/tmp` (the raw-cwd fallback).
   * 5. Assert the `Code tile` toggle, the tile, its header basename, the
   *    iframe `src`, and the option are all still there; assert the iframe
   *    element handle is IDENTICAL to the captured one; assert the terminal
   *    is still visible.
   * 6. Click the `Code tile` toggle to close the tile (assert hidden),
   *    click it again to reopen (assert visible), and assert the reopened
   *    iframe `src` and header basename still come from the option.
   */
  test("the code tile survives the active pane leaving the repo, and reopens at the seeded code root", async ({
    page,
  }) => {
    // Several SSE round trips plus a tmux split — well past the default budget.
    test.setTimeout(30_000);
    const release = await holdWorkspaceFetch(page);
    const id = await makeWindow(page, `latch-panes-${Date.now()}`);
    await page.goto(
      `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=split-h:tty,code`,
    );
    await expect(page.getByTestId("status-bar").locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });

    // First open: the pending state precedes the iframe (the derivation GET
    // resolves only once the seed POST has landed and the payload carries the
    // new code root — the GET is route-held so the state is observable under
    // any load); the derived gitRoot seeds the shared option (exactly
    // one write), and the tile header names it.
    await expect(page.getByTestId("code-surface-pending")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    release();
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });
    await expectCodeRoot(id, GIT_ROOT);
    const ws = await fetchWorkspace(page, id);
    expect(ws.root).toBe(GIT_ROOT);
    const seededSrc = workspaceSrc(ws.path);
    await expect(iframe).toHaveAttribute("src", seededSrc);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    expectWorkspaceFile(ws.path, GIT_ROOT, id);
    const handleBefore = await iframe.elementHandle();

    // The active pane leaves the repo — the LIVE derivation moves to the
    // raw-cwd fallback (/tmp).
    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "/tmp");

    // Everything the derivation used to drive stays put: the toggle, the
    // tile, its header, the iframe's src, the option itself, and the iframe
    // ELEMENT itself (a re-navigation would have replaced the workbench and
    // its in-flight state).
    await expect(railCodeButton(page)).toBeVisible();
    await expect(codeTile(page)).toBeVisible();
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    await expect(iframe).toHaveAttribute("src", seededSrc);
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
    await expect(codeIframe(page)).toHaveAttribute("src", seededSrc);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
  });

  /**
   * Proves: the code root is SUBSTRATE state (a tmux option), not in-memory
   * or per-browser state. After a full reload — which discards every
   * in-memory trace of the seed — a bare-route re-arrival still renders the
   * seeded layout and boots the editor at the same derived
   * `/code/?workspace=<path>` URL, even though the live derivation now
   * points at the raw-cwd fallback (`/tmp`): the root provably comes from
   * the option, not the live derivation.
   *
   * Steps:
   * 1. Create a repo-cwd window; navigate with `?layout=single:code` (inbound
   *    translation writes `@rk_win_layout`); assert the iframe is visible and
   *    the option holds the git root (the seed); GET the window's
   *    code-workspace and assert the iframe `src` is
   *    `/code/?workspace=<encoded path>`.
   * 2. `split-window -c /tmp`; poll until the derived `gitRoot` is `/tmp` (the
   *    raw-cwd fallback).
   * 3. `page.goto` the BARE route (a full reload with no carried params).
   * 4. Assert the `Code editor` iframe is visible at the same workspace
   *    `src`, the tile header still contains the repo basename, and the
   *    option is unchanged.
   */
  test("a bare-route reload with the active pane outside the repo still renders the seeded code root", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `latch-reload-${Date.now()}`);
    const url = `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=single:code`;
    await page.goto(url);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectCodeRoot(id, GIT_ROOT);
    const ws = await fetchWorkspace(page, id);
    const seededSrc = workspaceSrc(ws.path);
    await expect(codeIframe(page)).toHaveAttribute("src", seededSrc);

    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "/tmp");

    // A full load of the BARE route throws away every in-memory trace of the
    // seed; the layout AND the root come from tmux, so the editor still boots
    // at the SEEDED workspace even though the live derivation now resolves to
    // /tmp.
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", seededSrc);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    expect(windowOption(id, "@rk_win_code_root")).toBe(GIT_ROOT);
  });

  /**
   * Proves: the derived workspace file is a pure artifact of (server, window
   * id, code root) — deleting it on disk changes nothing but a regeneration.
   * A full reload (a fresh mount generation) re-runs the derivation GET,
   * whose handler is the single writer: the file reappears with the same
   * identity payload and the remounted iframe points at it again.
   *
   * Steps:
   * 1. Create a repo-cwd window; with the code-workspace GET route-held,
   *    navigate with `?layout=single:code`; assert `code-surface-pending`
   *    precedes the iframe (the first open's seed is still in flight);
   *    release the GET and assert the iframe is visible; GET the window's
   *    code-workspace and assert the file exists on disk with the expected
   *    identity payload.
   * 2. Delete the workspace file from disk.
   * 3. With the GET route-held again, `page.goto` the BARE route (a full
   *    reload — a fresh mount generation); assert `code-surface-pending`
   *    precedes the remounted iframe; release the GET.
   * 4. Assert the remounted iframe is visible at the same
   *    `/code/?workspace=<path>` src and the file exists again with the same
   *    identity payload — the reload's own derivation GET regenerated it (no
   *    test-side GET after the deletion).
   */
  test("a deleted workspace file is regenerated on the next mount", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const release = await holdWorkspaceFetch(page);
    const id = await makeWindow(page, `latch-regen-${Date.now()}`);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=single:code`);
    await expect(page.getByTestId("code-surface-pending")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    release();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expectCodeRoot(id, GIT_ROOT);
    const ws = await fetchWorkspace(page, id);
    expectWorkspaceFile(ws.path, GIT_ROOT, id);

    rmSync(ws.path);
    expect(existsSync(ws.path)).toBe(false);

    // A full reload throws away every in-memory trace: the remount re-runs
    // the derivation GET (route-held again so the remount's pending state is
    // observable — with the root already seeded its natural lifetime is a
    // single round trip), and the handler — the single writer — regenerates
    // the file. Deliberately no test-side GET after the deletion: the iframe
    // mounting is the proof the FRONTEND's fetch recreated it.
    const releaseRemount = await holdWorkspaceFetch(page);
    await page.goto(`/${TMUX_SERVER}/${encodeURIComponent(id)}`);
    await expect(page.getByTestId("code-surface-pending")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    releaseRemount();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", workspaceSrc(ws.path));
    expectWorkspaceFile(ws.path, GIT_ROOT, id);
  });
});
