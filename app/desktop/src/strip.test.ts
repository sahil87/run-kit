/**
 * node:test suite for the titlebar-strip pure logic (run via `pnpm run test`
 * after compile — the `hosts.test.ts` convention).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BLANK_UNDERLAY_URL,
  DEFAULT_STRIP_COLOR,
  fallbackStripCss,
  shouldInjectFallbackStrip,
  STRIP_HEIGHT_PX,
  STRIP_MARKER_CLASS,
  symbolColorFor,
} from "./strip";

// ── symbolColorFor ───────────────────────────────────────────────────────────

test("dark strip backgrounds derive light symbols", () => {
  assert.equal(symbolColorFor("#0f1117"), "#e5e7eb");
  assert.equal(symbolColorFor("#1a2b3c"), "#e5e7eb");
});

test("light strip backgrounds derive dark symbols", () => {
  assert.equal(symbolColorFor("#f8f9fb"), "#111827");
  assert.equal(symbolColorFor("#ffffff"), "#111827");
});

test("unparseable background reads as dark (light symbols)", () => {
  assert.equal(symbolColorFor(""), "#e5e7eb");
  assert.equal(symbolColorFor("not-a-color"), "#e5e7eb");
});

// ── fallbackStripCss ─────────────────────────────────────────────────────────

test("fallback CSS is keyed on the marker class and carries the strip geometry", () => {
  const css = fallbackStripCss("#123456");
  assert.ok(css.includes(`html:not(.${STRIP_MARKER_CLASS})`));
  assert.ok(css.includes(`height: ${STRIP_HEIGHT_PX}px`));
  assert.ok(css.includes(`padding-top: ${STRIP_HEIGHT_PX}px`));
  assert.ok(css.includes("background: #123456"));
  assert.ok(css.includes("-webkit-app-region: drag"));
});

test("fallback CSS pins the fullbleed app root below the band", () => {
  // The rk SPA's `.app-root` is position:fixed under `html.fullbleed` — body
  // padding alone cannot reserve the band's space there, so the CSS must pin
  // the root down with !important overrides (else the band covers the top bar).
  const css = fallbackStripCss("#123456");
  assert.ok(css.includes(`html.fullbleed:not(.${STRIP_MARKER_CLASS}) .app-root`));
  assert.ok(css.includes(`top: ${STRIP_HEIGHT_PX}px !important`));
  assert.ok(
    css.includes(`height: calc(var(--app-height, 100vh) - ${STRIP_HEIGHT_PX}px) !important`),
  );
});

test("fallback CSS falls back to the default color on junk input", () => {
  const css = fallbackStripCss("javascript:alert(1)");
  assert.ok(css.includes(`background: ${DEFAULT_STRIP_COLOR}`));
  assert.ok(!css.includes("javascript:"));
});

// ── shouldInjectFallbackStrip ────────────────────────────────────────────────

const ORIGINS: ReadonlySet<string> = new Set([
  "http://100.101.2.3:3000",
  "https://rk.example.com",
]);

test("registered host origins inject", () => {
  assert.equal(
    shouldInjectFallbackStrip("http://100.101.2.3:3000/utils2/rk-dev?x=1", ORIGINS),
    true,
  );
  assert.equal(shouldInjectFallbackStrip("https://rk.example.com/", ORIGINS), true);
});

test("the welcome file:// page never injects (it has its own static strip)", () => {
  assert.equal(
    shouldInjectFallbackStrip("file:///Applications/app/welcome.html", ORIGINS),
    false,
  );
});

test("foreign origins and garbage never inject", () => {
  assert.equal(shouldInjectFallbackStrip("http://evil.example.com/", ORIGINS), false);
  assert.equal(shouldInjectFallbackStrip("about:blank", ORIGINS), false);
  assert.equal(shouldInjectFallbackStrip("not a url", ORIGINS), false);
  assert.equal(shouldInjectFallbackStrip("", ORIGINS), false);
});

// ── BLANK_UNDERLAY_URL ───────────────────────────────────────────────────────

test("the blank underlay is a data:text/html document carrying an explicit no-drag region", () => {
  // Contract pin: about:blank emits no draggable-regions update, so the
  // welcome underlay must be blanked with a document that declares an
  // app-region — this is what clears the welcome page's stale drag band.
  assert.ok(BLANK_UNDERLAY_URL.startsWith("data:text/html,"));
  assert.ok(BLANK_UNDERLAY_URL.includes("-webkit-app-region:no-drag"));
});

test("the blank underlay never matches the fallback-strip injection predicate", () => {
  assert.equal(shouldInjectFallbackStrip(BLANK_UNDERLAY_URL, ORIGINS), false);
});
