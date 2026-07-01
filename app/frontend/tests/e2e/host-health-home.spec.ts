import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-host-health-${Date.now()}`;

test.describe("HOST HEALTH home zone", () => {
  test.beforeAll(() => {
    // A session ensures the server tile grid has at least one server to render.
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
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

  test("renders live host metrics on / above the server grid", async ({ page }) => {
    await page.goto("/");

    // The HOST HEALTH zone is present on the home route.
    const zone = page.getByRole("region", { name: "Host health" });
    await expect(zone).toBeVisible();
    await expect(zone.getByRole("heading", { name: "Host Health" })).toBeVisible();

    // Live metrics reach the server-neutral `?metrics=1` stream immediately (the
    // backend sends its cached metrics snapshot on connect), replacing the "No
    // metrics" placeholder with the metric rows — the CPU/mem labels come from
    // the shared HostMetrics component. Generous timeout only to absorb a cold
    // air-compiled backend on the first connection.
    await expect(zone.getByText("cpu")).toBeVisible({ timeout: 10_000 });
    await expect(zone.getByText("mem")).toBeVisible();

    // The server-tile grid below the zone still renders — the "+ New Server"
    // affordance is always present on the home route.
    await expect(
      page.getByRole("button", { name: "+ New Server" }),
    ).toBeVisible();
  });
});
