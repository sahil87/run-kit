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
 *
 * PRECONDITION (260724-6j1v): the `[aria-label='Connected']` dot lives in the
 * sidebar FOOTER, and Shell unmounts the sidebar when it is collapsed or at a
 * mobile viewport (closed drawer). Specs using this gate — or gating on the
 * dot directly — must run at a desktop viewport with the sidebar open
 * (Playwright's 1280px `Desktop Chrome` default qualifies). For mobile-viewport
 * tests, gate on an always-mounted element (heading, chevron, iframe) instead.
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

/** A window as it appears in the `GET /api/sessions` snapshot. */
export interface SnapshotWindow {
  windowId: string;
  index: number;
  name: string;
  marker?: string;
  color?: string;
}

/**
 * Resolve a window from the backend snapshot by its display name, scoped to a
 * given server + session — or the session's FIRST window when `windowName` is
 * omitted. Returns the full snapshot window (`windowId`, `index`, `name`,
 * `marker?`, `color?`); callers project the field(s) they need. Polls because
 * a CLI-created window surfaces asynchronously in `GET /api/sessions`.
 */
export async function resolveWindow(
  page: Page,
  server: string,
  session: string,
  windowName?: string,
): Promise<SnapshotWindow> {
  const deadline = Date.now() + 5_000;
  let win: SnapshotWindow | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(server)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: SnapshotWindow[];
      }>;
      const windows = sessions.find((s) => s.name === session)?.windows;
      const found =
        windowName === undefined
          ? windows?.[0]
          : windows?.find((w) => w.name === windowName);
      if (found) {
        win = found;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(
    win,
    windowName === undefined
      ? `first window of "${session}" not found in snapshot`
      : `window "${windowName}" not found in snapshot`,
  ).not.toBeNull();
  return win!;
}

/** Navigate to a specific window's terminal route and wait for connection.
 *  Same sidebar-mount precondition as `gotoServerReady` (the dot is in the
 *  sidebar footer — desktop viewport, sidebar open). */
export async function gotoWindow(
  page: Page,
  server: string,
  windowId: string,
): Promise<void> {
  await page.goto(`/${server}/${encodeURIComponent(windowId)}`);
  await expect(page.locator("[aria-label='Connected']")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}
