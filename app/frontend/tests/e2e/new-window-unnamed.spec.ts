import { test, expect } from "@playwright/test";
import { gotoServerReady } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";

const TEST_SESSION = `e2e-unnamed-${Date.now()}`;

test.describe("Unnamed tab creation (+ New Tab)", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("+ New Tab omits the name from the create request (tmux auto-names)", async ({
    page,
  }) => {
    // Intercept the window-create request to inspect its body without mutating
    // real tmux — this is the deterministic frontend→API contract seam. We
    // fulfill with a 201 so the optimistic flow settles cleanly; the tmux-native
    // auto-rename itself is covered by the Go config/arg tests (the e2e server's
    // automatic-rename-format application is not guaranteed, so asserting the
    // visual folder name here would be flaky). The glob ends in `*` so the
    // `?server=` query withServer appends still matches (a no-star glob would
    // fall through and mutate live tmux).
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("**/api/sessions/*/windows*", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.continue();
    });

    await gotoServerReady(page, TMUX_SERVER, TEST_SESSION);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    // The session's "+ New tab in <session>" button is the create seam. The
    // flow is deliberately SAME-server (the sidebar subscribes SSE to the
    // route's server only — a cross-server ghost never settles; see plan.md
    // ## Notes for the recorded pre-existing bug).
    const createBtn = sidebar.locator(
      `button[aria-label="New tab in ${TEST_SESSION}"]`,
    );
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    // The intercepted create request body must carry NO `name` key — an omitted
    // name is the "let tmux auto-name to the folder basename" signal. (The old
    // behavior hardcoded name: "zsh".)
    await expect
      .poll(() => capturedBody, { timeout: 5_000 })
      .not.toBeNull();
    expect(capturedBody!).not.toHaveProperty("name");
  });
});
