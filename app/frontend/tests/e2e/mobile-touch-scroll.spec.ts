import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-scroll-${Date.now()}`;
const port = Number(process.env.RK_PORT ?? "3333");
const BASE = `http://localhost:${port}`;

/**
 * Resolve the first window's stable tmux id (`@N`) for TEST_SESSION from the
 * backend snapshot. The terminal route is keyed by window id, not index, so a
 * deep-link must carry `@N`. Polls because the session is created via the tmux
 * CLI and surfaces in the snapshot asynchronously.
 */
async function resolveFirstWindowId(
  page: import("@playwright/test").Page,
): Promise<string> {
  const deadline = Date.now() + 5_000;
  let id: string | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `${BASE}/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string }>;
      }>;
      const wid = sessions.find((s) => s.name === TEST_SESSION)?.windows[0]
        ?.windowId;
      if (wid) {
        id = wid;
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(id, `first window for ${TEST_SESSION} not found`).not.toBeNull();
  return id!;
}

// Mock pointer:coarse so the touch scroll handler activates in desktop Chromium
function mockTouchDevice(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const orig = window.matchMedia;
    window.matchMedia = function (q: string) {
      if (q === "(pointer: coarse)") {
        return {
          matches: true,
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => true,
        } as MediaQueryList;
      }
      return orig.call(window, q);
    };
  });
}

test.describe("Mobile touch scroll", () => {
  test.setTimeout(30_000);

  test.beforeAll(() => {
    execSync(
      `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
      { stdio: "ignore" },
    );
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {}
  });

  test("touch swipe sends SGR scroll sequences via WebSocket", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockTouchDevice(page);

    const windowId = await resolveFirstWindowId(page);
    await page.goto(`${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // Generate scrollback
    await page.keyboard.type("seq 1 200\n", { delay: 10 });
    await page.waitForTimeout(2000);

    // Intercept WebSocket sends
    await page.evaluate(() => {
      (window as any).__scrollSeqs = [];
      const orig = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string" && data.includes("\x1b[<6")) {
          (window as any).__scrollSeqs.push(data);
        }
        return orig.call(this, data);
      };
    });

    // Simulate touch swipe via CDP (closest to real iOS touch)
    const box = await page.locator('[role="application"]').boundingBox();
    expect(box).not.toBeNull();
    const cx = Math.round(box!.x + box!.width / 2);
    const startY = Math.round(box!.y + box!.height / 2);

    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx, y: startY }],
    });
    await page.waitForTimeout(50);
    // Swipe down (finger moves down) = see older content = scroll up
    for (let i = 1; i <= 15; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: cx, y: startY + i * 20 }],
      });
      await page.waitForTimeout(30);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(500);

    // Verify SGR scroll-up sequences were sent
    const seqs = await page.evaluate(
      () => (window as any).__scrollSeqs as string[],
    );
    expect(seqs.length).toBeGreaterThan(0);
    // Button 64 = scroll up, with valid terminal coordinates
    expect(seqs[0]).toMatch(/\x1b\[<64;\d+;\d+M/);
    expect(seqs[0]).not.toContain(";1;1M");
  });

  test("role=application wrapper has measurable bounding box at 375x812", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockTouchDevice(page);

    const windowId = await resolveFirstWindowId(page);
    await page.goto(`${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });

    // Wrapper must stay mounted and measurable — a selector-count assertion
    // catches navigation-driven unmounts that would make boundingBox hang.
    const wrapper = page.locator('[role="application"]');
    await expect(wrapper).toHaveCount(1, { timeout: 3000 });

    const box = await wrapper.boundingBox({ timeout: 3000 });
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("tap on terminal focuses textarea for keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockTouchDevice(page);

    const windowId = await resolveFirstWindowId(page);
    await page.goto(`${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // Blur any active element first
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    // Tap via CDP (touch start + end, no movement = tap)
    const box = await page.locator('[role="application"]').boundingBox();
    expect(box).not.toBeNull();
    const client = await page.context().newCDPSession(page);
    const cx = Math.round(box!.x + box!.width / 2);
    const cy = Math.round(box!.y + box!.height / 2);

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx, y: cy }],
    });
    await page.waitForTimeout(100);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(500);

    // Verify xterm textarea received focus (triggers keyboard on iOS)
    const focused = await page.evaluate(() =>
      document.activeElement?.classList.contains("xterm-helper-textarea"),
    );
    expect(focused).toBe(true);
  });
});
