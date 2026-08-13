import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { READY_TIMEOUT, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

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
const LATCHED_SRC = `/code/?folder=${encodeURIComponent(GIT_ROOT)}`;

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
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 60_000 });
  await page.close();
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
  killSession(TEST_SESSION);
});

test.describe("Code-folder latch (260813-if5d)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
  });

  test("the code tile survives the active pane leaving the repo, and reopens at the latched folder", async ({
    page,
  }) => {
    // Several SSE round trips plus a tmux split — well past the default budget.
    test.setTimeout(30_000);
    const id = await makeWindow(page, `latch-panes-${Date.now()}`);
    await page.goto(
      `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=split-h:tty,code`,
    );
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: READY_TIMEOUT,
    });

    // First open: derivation seeds the latch, and the tile header names it.
    const iframe = codeIframe(page);
    await expect(iframe).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(iframe).toHaveAttribute("src", LATCHED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    const handleBefore = await iframe.elementHandle();

    // The active pane leaves the repo — the LIVE derivation goes empty.
    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "");

    // Everything the derivation used to drive stays put: the rail affordance,
    // the tile, its header, the iframe's src, and the iframe ELEMENT itself (a
    // re-navigation would have replaced the workbench and its in-flight state).
    await expect(railCodeButton(page)).toBeVisible();
    await expect(codeTile(page)).toBeVisible();
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
    await expect(iframe).toHaveAttribute("src", LATCHED_SRC);
    const handleAfter = await iframe.elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [handleBefore, handleAfter])).toBe(true);
    await expect(terminal(page)).toBeVisible();

    // Close and reopen the tile while the active pane is STILL outside the
    // repo: reopening re-derives nothing — the latch decides (intake decision
    // 1 explicitly rejected re-deriving on reopen).
    await railCodeButton(page).click();
    await expect(codeTile(page)).toBeHidden();
    await railCodeButton(page).click();
    await expect(codeTile(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", LATCHED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
  });

  test("a reload with the active pane outside the repo still renders the latched folder", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const id = await makeWindow(page, `latch-reload-${Date.now()}`);
    const url = `/${TMUX_SERVER}/${encodeURIComponent(id)}?layout=single:code`;
    await page.goto(url);
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", LATCHED_SRC);

    splitPaneOutsideRepo(id);
    await expectDerivedGitRoot(page, id, "");

    // A reload throws away every in-memory trace of the seed; the latch lives
    // in localStorage, so the deep link still resolves the code lens (it would
    // degrade to `single:tty` on a derivation-only availability rule).
    await page.reload();
    await expect(codeIframe(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(codeIframe(page)).toHaveAttribute("src", LATCHED_SRC);
    await expect(codeTile(page)).toContainText(GIT_ROOT_BASENAME);
  });
});
