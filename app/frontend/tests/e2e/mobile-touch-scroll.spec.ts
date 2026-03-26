import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TEST_SESSION = `e2e-scroll-${Date.now()}`;
const port = Number(process.env.RK_PORT ?? "3000");
const BASE = `http://localhost:${port}`;

// Mock pointer:coarse so the scroll proxy is created in desktop Chromium
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
    } catch {
      // Best effort
    }
  });

  test("scroll proxy enables touch scrolling in terminal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockTouchDevice(page);

    // Route: /$server/$session/$window
    await page.goto(`${BASE}/${TMUX_SERVER}/${TEST_SESSION}/0`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // Generate scrollback
    await page.keyboard.type("seq 1 200\n", { delay: 10 });
    await page.waitForTimeout(2000);

    // Verify scroll proxy was injected
    const proxyScrollHeight = await page.evaluate(() => {
      const container = document.querySelector('[role="application"]');
      const proxy = container?.querySelector(
        'div[style*="overflow-y"]',
      ) as HTMLElement;
      return proxy?.scrollHeight ?? 0;
    });
    expect(proxyScrollHeight).toBe(10000);

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

    // Simulate native scroll on proxy (as iOS would on touch swipe-down)
    await page.evaluate(() => {
      const container = document.querySelector('[role="application"]');
      const proxy = container?.querySelector(
        'div[style*="overflow-y"]',
      ) as HTMLElement;
      if (proxy) proxy.scrollTop -= 300;
    });
    await page.waitForTimeout(500);

    // Verify SGR scroll-up sequences were sent to tmux
    const seqs = await page.evaluate(
      () => (window as any).__scrollSeqs as string[],
    );
    expect(seqs.length).toBeGreaterThan(0);
    // Button 64 = scroll up, with valid terminal coordinates (not 1;1)
    expect(seqs[0]).toMatch(/\x1b\[<64;\d+;\d+M/);
    expect(seqs[0]).not.toContain(";1;1M");

    // Verify scrollTop was re-centered for continuous scrolling
    const scrollTop = await page.evaluate(() => {
      const container = document.querySelector('[role="application"]');
      const proxy = container?.querySelector(
        'div[style*="overflow-y"]',
      ) as HTMLElement;
      return proxy?.scrollTop ?? -1;
    });
    expect(scrollTop).toBe(5000);
  });

  test("tap passthrough focuses terminal for keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockTouchDevice(page);

    await page.goto(`${BASE}/${TMUX_SERVER}/${TEST_SESSION}/0`);
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // Tap the terminal area — the browser fires click (not scroll) for taps
    const box = await page.locator('[role="application"]').boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.click(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    );
    await page.waitForTimeout(500);

    // Verify the xterm helper textarea received focus (keyboard trigger on iOS)
    const focused = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.classList.contains("xterm-helper-textarea") ?? false;
    });
    expect(focused).toBe(true);
  });
});
