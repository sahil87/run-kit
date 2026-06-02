import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

// Server created through the UI during the test. Named under the unified
// rk-test-e2e-* umbrella with the Playwright process.pid as the second-to-last
// hyphen field so the automatic post-sweep can parse it and the e2e teardown
// glob (rk-test-e2e*) reaps it even if afterAll's kill-server is missed. The
// create dialog validates `^[a-zA-Z0-9_-]+$`, so hyphens are safe.
const CREATED_SERVER = `rk-test-e2e-csw-${process.pid}-${Date.now().toString().slice(-6)}`;
const TMUX_SERVER_A = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const DESKTOP_VIEWPORT = { width: 1024, height: 768 };

test.describe("Create server → waiting → view (no 'Server not found' flash)", () => {
  test.afterAll(() => {
    try {
      execSync(`tmux -L ${CREATED_SERVER} kill-server`, { stdio: "ignore" });
    } catch {
      // Best-effort — the teardown glob also reaps rk-test-e2e* servers.
    }
  });

  test("creating a server lands on the server view, never flashing 'Server not found'", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    // Start on a server that already exists, so the server list is non-empty
    // and loaded — this is exactly the condition under which the old binary
    // guard (`servers.length > 0`) wrongly flashed "Server not found" for a
    // freshly-created server.
    await page.goto(`/${TMUX_SERVER_A}`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 10_000,
    });

    // Open the command palette and trigger "Server: Create".
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill("Server: Create");
    await page.keyboard.press("Enter");

    // Fill the create dialog and submit.
    const nameInput = page.getByLabel("Server name");
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill(CREATED_SERVER);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // The URL navigates to the new server immediately.
    await expect(page).toHaveURL(new RegExp(`/${CREATED_SERVER}(?:$|[/?#])`));

    // The page ends on the working server view: the connection indicator shows
    // "Connected". The fix's core promise is that we reach this state without
    // ever rendering the "Server not found" error screen.
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Server not found")).toHaveCount(0);
  });

  test("a genuinely-unknown server URL still shows 'Server not found'", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    // A name that was never created and is not pending must fail fast once the
    // server list has loaded — the not-found path is preserved for typos.
    const bogus = `rk-test-e2e-nope-${process.pid}-${Date.now().toString().slice(-6)}`;
    await page.goto(`/${bogus}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Server not found")).toBeVisible({
      timeout: 15_000,
    });
  });
});
