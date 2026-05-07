import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
const TIMESTAMP = Date.now();
const SESSIONS = [
  `reorder-alpha-${TIMESTAMP}`,
  `reorder-bravo-${TIMESTAMP}`,
  `reorder-charlie-${TIMESTAMP}`,
];

test.describe("Sidebar session reorder persistence", () => {
  test.beforeAll(() => {
    for (const name of SESSIONS) {
      try {
        execSync(
          `tmux -L ${TMUX_SERVER} new-session -d -s ${name} -x 80 -y 24`,
          { stdio: "ignore" },
        );
      } catch {
        // already exists — ignore
      }
    }
  });

  test.afterAll(() => {
    for (const name of SESSIONS) {
      try {
        execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${name}`, {
          stdio: "ignore",
        });
      } catch {
        // best effort
      }
    }
    // Reset the user-option so the next run starts clean.
    try {
      execSync(`tmux -L ${TMUX_SERVER} set-option -us @rk_session_order`, {
        stdio: "ignore",
      });
    } catch {
      // best effort
    }
  });

  test("server-persisted order survives a page reload via SSE", async ({
    page,
    request,
    baseURL,
  }) => {
    const customOrder = [SESSIONS[2], SESSIONS[0], SESSIONS[1]];

    // Drive persistence through the API — this matches the production path
    // (frontend PUT → backend → tmux user-option → SSE broadcast) and avoids
    // the timing dependency on the hub's first-poll bootstrap.
    const url = `${baseURL ?? `http://localhost:${process.env.RK_PORT ?? 3020}`}/api/sessions/order?server=${TMUX_SERVER}`;
    const putResp = await request.put(url, {
      headers: { "Content-Type": "application/json" },
      data: { order: customOrder },
    });
    if (!putResp.ok()) {
      const body = await putResp.text();
      throw new Error(`PUT ${url} → ${putResp.status()}: ${body}`);
    }

    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    const sidebar = page.locator("nav[aria-label='Sessions']");
    for (const name of SESSIONS) {
      await expect(sidebar.locator(`text=${name}`)).toBeVisible({
        timeout: 5_000,
      });
    }

    // expect.poll covers the SSE → React state propagation lag without
    // committing to a fixed wait.
    await expect
      .poll(
        async () =>
          await sidebar.evaluate((el, sessionNames: string[]) => {
            const buttons = el.querySelectorAll("button[aria-label^='Navigate to ']");
            const order: string[] = [];
            buttons.forEach((b) => {
              const label = b.getAttribute("aria-label") ?? "";
              const m = label.match(/^Navigate to (.+)$/);
              if (m) order.push(m[1]);
            });
            return order.filter((n) => sessionNames.includes(n));
          }, SESSIONS),
        { timeout: 5_000 },
      )
      .toEqual(customOrder);

    // Reload — order MUST survive because it lives in tmux, not the browser.
    await page.reload();
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });
    for (const name of SESSIONS) {
      await expect(sidebar.locator(`text=${name}`)).toBeVisible({
        timeout: 5_000,
      });
    }

    await expect
      .poll(
        async () =>
          await sidebar.evaluate((el, sessionNames: string[]) => {
            const buttons = el.querySelectorAll("button[aria-label^='Navigate to ']");
            const order: string[] = [];
            buttons.forEach((b) => {
              const label = b.getAttribute("aria-label") ?? "";
              const m = label.match(/^Navigate to (.+)$/);
              if (m) order.push(m[1]);
            });
            return order.filter((n) => sessionNames.includes(n));
          }, SESSIONS),
        { timeout: 5_000 },
      )
      .toEqual(customOrder);
  });
});
