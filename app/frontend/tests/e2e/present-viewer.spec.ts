import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TMUX_SERVER, createSession, killSession, listWindows, setWindowOption } from "./_tmux";

// Shared setup: beforeAll writes a scratch fixture root (a markdown doc with
// a ```mermaid fence, an excalidraw scene, a plain .txt control, and a
// cross-format symlink alias-scene.txt → sketch.excalidraw) into the OS temp
// dir, creates one detached session `e2e-present-viewer-<ts>` (80×24) with a
// single window on the isolated rk-test-e2e socket (E2E_TMUX_SERVER, via
// _tmux.ts), and declares the fixture root on that window via
// `@rk_win_web_1_root` — the exact option the /present content-keyed arm
// derives its serve roots from. The content-keyed URL's roothash segment is
// the sha256 of the stamped root string, 12-hex prefix — the same digest the
// handler computes (present.go). Tests drive the backend URL DIRECTLY
// (page.goto on /present/{server}/{hash}/{file}), never the SPA tile chrome:
// the viewer shell IS the page. Render tests track every request the page
// makes and assert all of them stay same-origin (the offline contract —
// fonts are bundle-inlined, no CDN fallback may fire). afterAll kills the
// session best-effort. No route stubs, no viewport pinning, no host-global
// state.

const TEST_SESSION = `e2e-present-viewer-${Date.now()}`;

const MARKDOWN = `# Viewer Fixture

A presented markdown document with a diagram.

\`\`\`mermaid
graph TD
  A[Start] --> B[Done]
\`\`\`
`;

const EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "e2e",
  elements: [
    {
      id: "r1",
      type: "rectangle",
      x: 10,
      y: 10,
      width: 220,
      height: 110,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 3 },
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    },
    {
      id: "t1",
      type: "text",
      x: 30,
      y: 50,
      width: 120,
      height: 25,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 2,
      version: 1,
      versionNonce: 2,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      text: "Fixture box",
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: "Fixture box",
      lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
});

let presentBase: string;

test.beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "rk-e2e-present-"));
  writeFileSync(join(root, "doc.md"), MARKDOWN);
  writeFileSync(join(root, "sketch.excalidraw"), EXCALIDRAW);
  writeFileSync(join(root, "plain.txt"), "plain text control\n");
  symlinkSync("sketch.excalidraw", join(root, "alias-scene.txt"));

  createSession(TEST_SESSION, { windows: ["viewer"] });
  const win = listWindows(TEST_SESSION)[0];
  setWindowOption(win.windowId, "@rk_win_web_1_root", root);

  const hash = createHash("sha256").update(root).digest("hex").slice(0, 12);
  presentBase = `/present/${TMUX_SERVER}/${hash}`;
});

test.afterAll(() => {
  killSession(TEST_SESSION);
});

/** Collect every request URL a page makes during fn — the offline contract
 *  check: the viewer must never touch a foreign origin (no CDN font/script
 *  fallback). */
async function expectSameOriginOnly(page: Page, fn: () => Promise<void>): Promise<void> {
  const foreign: string[] = [];
  const seen: string[] = [];
  page.on("request", (req) => {
    seen.push(req.url());
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(req.url()) && !req.url().startsWith("data:")) {
      foreign.push(req.url());
    }
  });
  await fn();
  expect(foreign, `foreign-origin requests: ${foreign.join(", ")}\nall: ${seen.join(", ")}`).toEqual([]);
}

/**
 * Proves: a presented .md renders through the viewer shell — the markdown
 * heading is real document content and the ```mermaid fence becomes an
 * in-page SVG diagram — and the whole render stays same-origin (offline
 * contract: no CDN font/script fallback fires).
 * Steps:
 * 1. Navigate directly to the content-keyed present URL for doc.md while
 *    recording requests.
 * 2. Assert the rendered "Viewer Fixture" heading is visible.
 * 3. Assert the mermaid fence rendered to an SVG inside .viewer-diagram.
 * 4. Assert no request left the local origin.
 */
test("presented markdown renders the viewer shell with mermaid", async ({ page }) => {
  await expectSameOriginOnly(page, async () => {
    await page.goto(`${presentBase}/doc.md`);
    await expect(page.getByRole("heading", { name: "Viewer Fixture" })).toBeVisible();
    await expect(page.locator(".viewer-diagram svg")).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * Proves: the explicit ?raw=1 escape hatch bypasses the shell and returns the
 * markdown source bytes.
 * Steps:
 * 1. GET the same URL with raw=1 via the request context.
 * 2. Assert the body carries the markdown source, not shell HTML.
 */
test("raw=1 returns the markdown source", async ({ page }) => {
  const res = await page.request.get(`${presentBase}/doc.md?raw=1`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("# Viewer Fixture");
  expect(body).not.toContain("viewer-root");
});

/**
 * Proves: a presented .excalidraw scene renders as a static SVG via the
 * utility-only exportToSvg path — no editor chrome, no foreign-origin
 * request (fonts are bundle-inlined).
 * Steps:
 * 1. Navigate directly to the content-keyed present URL for sketch.excalidraw
 *    while recording requests.
 * 2. Assert an SVG appears inside .viewer-scene.
 * 3. Assert no request left the local origin.
 */
test("presented excalidraw renders a static SVG", async ({ page }) => {
  await expectSameOriginOnly(page, async () => {
    await page.goto(`${presentBase}/sketch.excalidraw`);
    await expect(page.locator(".viewer-scene svg")).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * Proves: cross-format symlink aliases render with the RESOLVED file's
 * format — a .txt URL aliasing an .excalidraw file gets the shell (backend
 * resolved-extension gate) and renders the scene (the X-Present-Format
 * header overrides the URL extension client-side).
 * Steps:
 * 1. Create nothing — the alias rides the beforeAll fixture.
 * 2. Navigate to the alias-scene.txt present URL.
 * 3. Assert the excalidraw SVG renders despite the .txt URL.
 */
test("cross-format symlink alias renders the resolved format", async ({ page }) => {
  await page.goto(`${presentBase}/alias-scene.txt`);
  await expect(page.locator(".viewer-scene svg")).toBeVisible({ timeout: 15_000 });
});

/**
 * Proves: the viewer themes from prefers-color-scheme alone — dark scheme
 * yields the dark surface on a phone-width viewport, light scheme the light
 * surface on a desktop-width one (R8; the iframe has no app-theme plumbing).
 * Steps:
 * 1. Emulate dark scheme at 375px width; load doc.md.
 * 2. Assert the body's computed background is the dark token.
 * 3. Emulate light scheme at 1440px; reload.
 * 4. Assert the body's computed background is the light token.
 */
test("viewer themes via prefers-color-scheme at narrow and desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${presentBase}/doc.md`);
  await expect(page.getByRole("heading", { name: "Viewer Fixture" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(18, 20, 23)");

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Viewer Fixture" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(255, 255, 255)");
});

/**
 * Proves: the extension gate leaves other file types untouched — a .txt under
 * the same declared root serves its bytes, never the shell.
 * Steps:
 * 1. GET plain.txt through the present route.
 * 2. Assert the body is the file's text with no shell markup.
 */
test("ungated extensions serve raw bytes", async ({ page }) => {
  const res = await page.request.get(`${presentBase}/plain.txt`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("plain text control");
  expect(body).not.toContain("viewer-root");
});
