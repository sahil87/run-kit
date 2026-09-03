/**
 * Shared web-tile e2e helpers.
 */
import type { Page } from "@playwright/test";

/** Specs that stamp dead `http://localhost:<port>/` web URLs assert tile
 *  CHROME (layout, menus, lens switching), never frame content. The dead-port
 *  error state (260819-v6y4 R8) hides the iframe when nothing listens on the
 *  port — this route stub answers `/proxy/<port>/**` (both the iframe src and
 *  the tile's same-origin dead-port probe fetch) with a static 200 page so
 *  the tile stays in its live-iframe state, exactly the posture those specs
 *  were written against. Stub every port a spec stamps — the same derived
 *  value the spec's `reserveDeadPort()` (`_ports.ts`) resolution feeds its
 *  stamped URL. */
export async function stubProxyPorts(page: Page, ...ports: number[]): Promise<void> {
  const pattern = new RegExp(`/proxy/(${ports.join("|")})(/|$)`);
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>proxy stub</title></head><body><p>stub</p></body></html>",
    }),
  );
}
