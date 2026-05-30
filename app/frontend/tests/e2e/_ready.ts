/**
 * Shared readiness helpers for e2e specs.
 *
 * The app is SSE-driven: navigating to `/$server` opens an SSE connection, and
 * the session list arrives in a follow-up payload. Tests must wait for the data
 * to render, not merely for the connection ("Connected") to open. On a dev box
 * the payload is near-instant; on a 2-vCPU CI runner (where air, Vite, Chromium
 * and tmux all contend) it can take seconds, so readiness timeouts are widened
 * under CI rather than masking the slowness with blanket retries.
 */
import { expect, type Page } from "@playwright/test";

/** Generous readiness timeout for "wait for SSE data to render" gates. Wider on
 *  CI to absorb shared-runner latency; tight locally to keep feedback fast. */
export const READY_TIMEOUT = process.env.CI ? 20_000 : 10_000;

/**
 * Navigate to a server route and wait until the sidebar is connected AND
 * populated. Returns the Sessions nav locator. Pass `expectSession` to also
 * gate on a specific session row being rendered (the strongest signal that the
 * SSE payload has actually landed).
 */
export async function gotoServerReady(
  page: Page,
  server: string,
  expectSession?: string,
): Promise<ReturnType<Page["locator"]>> {
  await page.goto(`/${server}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: READY_TIMEOUT });
  const sidebar = page.locator("nav[aria-label='Sessions']");
  if (expectSession) {
    await expect(
      sidebar.locator(`button[aria-label='Navigate to ${expectSession}']`),
    ).toBeVisible({ timeout: READY_TIMEOUT });
  }
  return sidebar;
}
