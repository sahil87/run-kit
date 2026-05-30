import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

// Pre-existing server (the harness already seeds `rk-test-e2e` with an
// `e2e-init` session). Its presence means `servers.length > 0` at navigate
// time — the exact precondition that used to trip the immediate ServerNotFound
// flash for a just-created server.
const PRE_EXISTING_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";

// The server the test creates through the UI. Named under the unified
// rk-test-e2e-* umbrella with the Playwright process.pid as the second-to-last
// hyphen field so the harness post-sweep can parse it and reap it even if the
// explicit afterAll cleanup is skipped (mirrors sidebar-server-coupling.spec).
const NEW_SERVER = `rk-test-e2e-waiting-${process.pid}-${Date.now().toString().slice(-6)}`;
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

test.describe("Server create — waiting state, never a not-found flash", () => {
  test.afterAll(() => {
    // Explicit cleanup of the server the UI created. Best-effort; the harness
    // reaper sweeps rk-test-e2e-* sockets as a backstop.
    try {
      execSync(`tmux -L ${NEW_SERVER} kill-server`, { stdio: "ignore" });
    } catch {
      // Best-effort
    }
  });

  test("creating a server shows the provisioning state, never a Server not found screen", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);

    // Start on the pre-existing server so the server list is loaded and
    // non-empty — the exact precondition under which the old binary guard
    // (`servers.length > 0`) flashed ServerNotFound for a just-created server.
    await page.goto(`/${PRE_EXISTING_SERVER}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // Open the command palette via its `palette:open` DOM event (layout- and
    // platform-independent — more robust than the Cmd/Ctrl+K shortcut, whose
    // modifier mapping varies in headless browsers, and than the BottomBar
    // trigger, which is not always in the desktop layout). The palette is a
    // lazily-loaded chunk, so poll-dispatch until its listener has mounted and
    // the input appears, then invoke "Server: Create".
    const palette = page.getByPlaceholder("Type a command...");
    await expect(async () => {
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("palette:open")));
      await expect(palette).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await palette.fill("Server: Create");
    await palette.press("Enter");

    // The create dialog opens — type the new server name and submit.
    const nameInput = page.getByLabel("Server name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(NEW_SERVER);
    await nameInput.press("Enter");

    // The router navigates to the new server's route immediately.
    await expect(page).toHaveURL(new RegExp(`/${NEW_SERVER}`), { timeout: 10_000 });

    // Headline guarantee (the bug this change fixes): the just-created server
    // renders the brief ServerWaiting provisioning state ("Creating…"), NOT the
    // ServerNotFound error screen. Asserting the provisioning frame here is
    // reliable because the waiting state persists until the refreshed list
    // includes the server (no artificial timer). The deterministic
    // waiting→view swap and pending-clear lifecycle are covered by the unit /
    // route-guard tests (`server-guard.test.tsx`).
    await expect(page.getByText(/Creating/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Server not found")).toHaveCount(0);
  });
});
