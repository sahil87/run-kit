import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TMUX_SERVER, createSession, killSession, listWindows, setWindowOption } from "./_tmux";

// Shared setup: beforeAll writes a scratch fixture root (a markdown doc with
// a ```mermaid fence, an excalidraw scene, a plain .txt control, a
// cross-format symlink alias-scene.txt → sketch.excalidraw, plus two WIDE
// fixtures for the figure pan/zoom tests — wide.excalidraw, a 3000×300 scene
// whose fit scale is < 1 at any test viewport, and wide.md, a `graph LR`
// mermaid fence chaining 14 nodes so the diagram outgrows the 52rem reading
// column) into the OS temp dir, creates one detached session `e2e-present-viewer-<ts>` (80×24) with a
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

/** A minimal excalidraw scene: one rectangle of the given size plus a text
 *  label — the same element shape as EXCALIDRAW above, parameterized so the
 *  pan/zoom tests can force a fit scale below 1. */
function wideScene(width: number, height: number): string {
  const base = JSON.parse(EXCALIDRAW) as { elements: Array<Record<string, unknown>> };
  const [rect, text] = base.elements;
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e",
    elements: [
      { ...rect, id: "wr", width, height },
      { ...text, id: "wt", x: 40, y: 40, text: "Wide fixture", originalText: "Wide fixture" },
    ],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  });
}

const WIDE_EXCALIDRAW = wideScene(3000, 300);

const WIDE_MARKDOWN = `# Wide Diagram

\`\`\`mermaid
graph LR
  A[Alpha] --> B[Bravo] --> C[Charlie] --> D[Delta] --> E[Echo] --> F[Foxtrot] --> G[Golf]
  G --> H[Hotel] --> I[India] --> J[Juliet] --> K[Kilo] --> L[Lima] --> M[Mike] --> N[November]
\`\`\`

Text after the diagram.
`;

/** The figure module's discrete ladder (viewer/pan-zoom.ts FIGURE_ZOOM_LEVELS)
 *  — mirrored here because the spec runs under Playwright's node loader, which
 *  does not resolve the app's `@/` alias the module imports through. */
const FIGURE_ZOOM_LEVELS = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];

/** The figure's current scale, read from the SVG transform the module writes. */
async function figureScale(page: Page): Promise<number> {
  const t = await page.locator('[data-testid="viewer-figure"] svg').first().evaluate((el) => el.style.transform);
  const m = /scale\(([\d.]+)\)/.exec(t);
  if (m === null) throw new Error(`no scale in transform: ${t}`);
  return Number(m[1]);
}

/** Dispatch a ctrl-wheel on the figure's SVG — the web-tile-zoom.spec.ts
 *  technique; Playwright's mouse.wheel cannot carry a modifier. */
async function ctrlWheelOnFigure(page: Page, deltaY: number): Promise<boolean> {
  return page.locator('[data-testid="viewer-figure"] svg').first().evaluate((el, dy) => {
    const e = new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, deltaY);
}

let presentBase: string;

test.beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "rk-e2e-present-"));
  writeFileSync(join(root, "doc.md"), MARKDOWN);
  writeFileSync(join(root, "sketch.excalidraw"), EXCALIDRAW);
  writeFileSync(join(root, "plain.txt"), "plain text control\n");
  writeFileSync(join(root, "wide.excalidraw"), WIDE_EXCALIDRAW);
  writeFileSync(join(root, "wide.md"), WIDE_MARKDOWN);
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

/**
 * Proves: a wide excalidraw scene renders as a zoomable figure at rest in its
 * FIT state — the whole scene visible, readout below 100%, nothing zoomed —
 * so the at-a-glance overview the old max-width rule gave is preserved.
 * Steps:
 * 1. Navigate to the content-keyed present URL for wide.excalidraw.
 * 2. Assert exactly one figure exists with role group and data-zoomed=false.
 * 3. Assert the readout is below 100% and the SVG's rendered width is within
 *    the figure's width (fit-to-container).
 */
test("wide excalidraw renders a zoomable figure at fit", async ({ page }) => {
  await page.goto(`${presentBase}/wide.excalidraw`);
  const figure = page.locator('[data-testid="viewer-figure"]');
  await expect(figure).toHaveCount(1);
  await expect(figure).toHaveAttribute("role", "group");
  await expect(figure).toHaveAttribute("data-zoomed", "false");
  const readout = await page.locator('[data-testid="viewer-figure-readout"]').textContent();
  expect(Number.parseInt(readout ?? "", 10)).toBeLessThan(100);
  const svgBox = await page.locator('[data-testid="viewer-figure"] svg').boundingBox();
  const figBox = await figure.boundingBox();
  expect(svgBox).not.toBeNull();
  expect(figBox).not.toBeNull();
  expect(svgBox!.width).toBeLessThanOrEqual(figBox!.width + 1);
});

/**
 * Proves: a ctrl-wheel over the figure zooms the FIGURE (continuous, exp(0.6)
 * per −60 deltaY) and escapes the fit — the content outgrows the figure box —
 * which is exactly what the tile's own zoom cannot do for fit-to-width SVG.
 * Steps:
 * 1. Open wide.excalidraw and read the rest scale from the SVG transform.
 * 2. Dispatch one ctrl-wheel (deltaY −60) on the SVG; assert it was
 *    defaultPrevented (the figure claimed it).
 * 3. Assert the new scale ≈ rest·e^0.6, the readout matches it, the SVG's
 *    rendered width now exceeds the figure width, and data-zoomed=true.
 */
test("ctrl-wheel over the figure zooms it past the fit", async ({ page }) => {
  await page.goto(`${presentBase}/wide.excalidraw`);
  const figure = page.locator('[data-testid="viewer-figure"]');
  await expect(figure).toHaveAttribute("data-zoomed", "false");
  const rest = await figureScale(page);
  expect(await ctrlWheelOnFigure(page, -60)).toBe(true);
  const zoomed = await figureScale(page);
  expect(zoomed).toBeCloseTo(rest * Math.exp(0.6), 4);
  await expect(page.locator('[data-testid="viewer-figure-readout"]')).toHaveText(`${Math.round(zoomed * 100)}%`);
  await expect(figure).toHaveAttribute("data-zoomed", "true");
  const svgBox = await page.locator('[data-testid="viewer-figure"] svg').boundingBox();
  const figBox = await figure.boundingBox();
  expect(svgBox!.width).toBeGreaterThan(figBox!.width);
});

/**
 * Proves: the figure is keyboard-operable with PLAIN keys — `+` steps to the
 * next ladder level strictly above the current scale (no snap-then-step
 * overshoot from an off-ladder fit) and `0` returns to the fit state.
 * Steps:
 * 1. Open wide.excalidraw, click the figure to focus it, read the rest scale.
 * 2. Press `+`; assert the scale equals the first ladder level above rest.
 * 3. Press `0`; assert the scale equals rest again and data-zoomed=false.
 */
test("plain + and 0 keys step and reset the figure zoom", async ({ page }) => {
  await page.goto(`${presentBase}/wide.excalidraw`);
  const figure = page.locator('[data-testid="viewer-figure"]');
  await expect(figure).toHaveAttribute("data-zoomed", "false");
  const rest = await figureScale(page);
  await figure.locator(".viewer-figure-viewport").click({ position: { x: 20, y: 20 } });
  await expect(figure).toBeFocused();
  await page.keyboard.press("+");
  const expected = FIGURE_ZOOM_LEVELS.find((l) => l > rest + 1e-9);
  expect(expected).toBeDefined();
  await expect.poll(() => figureScale(page)).toBeCloseTo(expected!, 6);
  await expect(figure).toHaveAttribute("data-zoomed", "true");
  await page.keyboard.press("0");
  await expect.poll(() => figureScale(page)).toBeCloseTo(rest, 6);
  await expect(figure).toHaveAttribute("data-zoomed", "false");
});

/**
 * Proves: once zoomed past the fit, dragging pans the content and the clamp
 * keeps the content covering the viewport (no blank margins).
 * Steps:
 * 1. Open wide.excalidraw and ctrl-wheel in twice so the scene overflows.
 * 2. Record the SVG transform, then mouse-drag 200px left / 40px up across
 *    the viewport.
 * 3. Assert the translate components changed and the SVG's box still spans
 *    the viewport horizontally (left edge ≤ viewport left, right ≥ right).
 */
test("dragging a zoomed figure pans it within the clamp", async ({ page }) => {
  await page.goto(`${presentBase}/wide.excalidraw`);
  await ctrlWheelOnFigure(page, -60);
  await ctrlWheelOnFigure(page, -60);
  const figure = page.locator('[data-testid="viewer-figure"]');
  await expect(figure).toHaveAttribute("data-zoomed", "true");
  const svg = figure.locator("svg");
  const before = await svg.evaluate((el) => el.style.transform);
  const vp = (await figure.locator(".viewer-figure-viewport").boundingBox())!;
  const startX = vp.x + vp.width * 0.7;
  const startY = vp.y + vp.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 100, startY - 20, { steps: 4 });
  await page.mouse.move(startX - 200, startY - 40, { steps: 4 });
  await page.mouse.up();
  const after = await svg.evaluate((el) => el.style.transform);
  expect(after).not.toBe(before);
  const svgBox = (await svg.boundingBox())!;
  expect(svgBox.x).toBeLessThanOrEqual(vp.x + 1);
  expect(svgBox.x + svgBox.width).toBeGreaterThanOrEqual(vp.x + vp.width - 1);
});

/**
 * Proves: a mermaid diagram in markdown is an INLINE figure — its box is the
 * fitted height at rest (no clipping, today's look), and the Expand toggle
 * grows the box to the viewport height and restores it when toggled off.
 * Steps:
 * 1. Open wide.md and locate the diagram figure.
 * 2. Assert the viewport height equals the rendered SVG height (±1px).
 * 3. Hover, click Expand; assert aria-pressed=true and the viewport height
 *    ≈ window height − 2rem.
 * 4. Click Expand again; assert aria-pressed=false and the fitted height is
 *    restored.
 */
test("mermaid renders an inline figure whose Expand toggle grows and restores the box", async ({ page }) => {
  await page.goto(`${presentBase}/wide.md`);
  const figure = page.locator(".viewer-diagram.viewer-figure");
  await expect(figure).toHaveCount(1);
  await expect(figure).toHaveAttribute("data-mode", "inline");
  const viewport = figure.locator(".viewer-figure-viewport");
  const svgBox = (await figure.locator("svg").boundingBox())!;
  const fitted = (await viewport.boundingBox())!;
  expect(Math.abs(fitted.height - svgBox.height)).toBeLessThanOrEqual(1);
  await figure.hover();
  const expand = figure.getByRole("button", { name: "Expand" });
  await expand.click();
  await expect(expand).toHaveAttribute("aria-pressed", "true");
  const innerHeight = await page.evaluate(() => window.innerHeight);
  const rem = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
  await expect.poll(async () => (await viewport.boundingBox())!.height).toBeCloseTo(innerHeight - 2 * rem, 0);
  await expand.click();
  await expect(expand).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await viewport.boundingBox())!.height).toBeCloseTo(fitted.height, 0);
});

/**
 * Proves: the viewer claims ctrl-wheel ONLY over a figure — a ctrl-wheel
 * anywhere else in the document is left untouched, so the web tile's own
 * document-capture zoom arm keeps working for the rest of the page.
 * Steps:
 * 1. Open wide.md and install a document-level wheel listener that records
 *    whether it ran.
 * 2. Dispatch a ctrl-wheel on document.body (outside the figure).
 * 3. Assert the event was NOT defaultPrevented and the document listener saw it.
 */
test("ctrl-wheel outside a figure passes through to the document", async ({ page }) => {
  await page.goto(`${presentBase}/wide.md`);
  await expect(page.locator(".viewer-figure")).toHaveCount(1);
  const result = await page.evaluate(() => {
    let seen = false;
    document.addEventListener("wheel", () => {
      seen = true;
    }, { capture: true, once: true });
    const e = new WheelEvent("wheel", { deltaY: -60, ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return { prevented: e.defaultPrevented, seen };
  });
  expect(result.prevented).toBe(false);
  expect(result.seen).toBe(true);
});
