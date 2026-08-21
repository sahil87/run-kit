import { test, expect, type Page } from "@playwright/test";

// Recovery section on the Host Overview (`/`) — R8/R9/R10. The offer list and
// both mutating POSTs are route-mocked (the mutating routes carry the trailing
// `*` glob — the mutating-route idiom from the withServer era, kept so a query
// string can never slip past the mock). Everything else (state socket, boards,
// metrics) rides the real e2e backend. See recovery-section.spec.md for
// intent + steps.

const OFFER_KIT = {
  server: "kit",
  takenAt: new Date(Date.now() - 3600_000).toISOString(),
  sessionCount: 1,
  windowCount: 2,
  sessions: [
    {
      name: "dev",
      color: "4",
      windows: [
        { index: 0, name: "shell", paneCount: 1, commands: ["zsh"], resumable: false },
        { index: 1, name: "agent", paneCount: 2, commands: ["zsh", "claude -c"], resumable: true },
      ],
    },
  ],
};

const OFFER_WORK = {
  server: "work",
  takenAt: new Date(Date.now() - 120_000).toISOString(),
  sessionCount: 2,
  windowCount: 3,
  sessions: [
    {
      name: "ops",
      windows: [
        { index: 0, name: "logs", paneCount: 1, commands: ["htop"], resumable: false },
      ],
    },
  ],
};

/** Route-mock the recovery endpoints. `offers` is mutable so a mutation test
 *  can shrink the list the refetch then returns. Returns request loggers. */
async function mockRecovery(page: Page, offers: object[]) {
  const state = { offers };
  const getCount = { n: 0 };
  const restoreBodies: unknown[] = [];
  const dismissBodies: unknown[] = [];

  // Mutating routes first (trailing `*` — a `?server=` suffix must never miss
  // the mock); the plain GET glob matches `/api/recovery` exactly, never the
  // POST subpaths.
  await page.route("**/api/recovery/restore*", async (route) => {
    restoreBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionsCreated: 1 }),
    });
  });
  await page.route("**/api/recovery/dismiss*", async (route) => {
    dismissBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.route("**/api/recovery", async (route) => {
    getCount.n += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ offers: state.offers }),
    });
  });

  return { state, getCount, restoreBodies, dismissBodies };
}

/** Deterministic TMUX SERVERS zone — the section under test sits between it
 *  and SERVICES, and a restore success refetches this list. */
async function mockServers(page: Page) {
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "dev", sessionCount: 1 }]),
    }),
  );
}

async function gotoHost(page: Page) {
  await page.goto("/");
  // Readiness: the TMUX SERVERS zone has rendered its (mocked) tile grid.
  await expect(page.getByRole("heading", { name: "Tmux Servers" })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Recovery section", () => {
  test("empty offers render NO Recovery section — zero footprint between TMUX SERVERS and SERVICES", async ({
    page,
  }) => {
    await mockRecovery(page, []);
    await mockServers(page);
    await gotoHost(page);

    await expect(page.getByRole("region", { name: "Recovery" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recovery" })).toHaveCount(0);
    // The surrounding zones render normally — nothing reserved the space.
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  });

  test("populated offers render the heading, one row per offer, and Restore all (2)", async ({
    page,
  }) => {
    await mockRecovery(page, [OFFER_KIT, OFFER_WORK]);
    await mockServers(page);
    await gotoHost(page);

    const region = page.getByRole("region", { name: "Recovery" });
    await expect(region).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recovery" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore all (2)" })).toBeVisible();

    const kitRow = page.getByTestId("recovery-row-kit");
    await expect(kitRow).toBeVisible();
    await expect(kitRow.getByRole("img", { name: "not running" })).toBeVisible();
    await expect(kitRow).toContainText("1 session · 2 tabs · last seen 1h ago · system restart");
    await expect(kitRow.getByRole("button", { name: "Restore kit" })).toBeVisible();
    await expect(kitRow.getByRole("button", { name: "Dismiss recovery for kit" })).toBeVisible();
    await expect(page.getByTestId("recovery-row-work")).toBeVisible();
  });

  test("the chevron expands the read-only session tree (swatch, tabs, commands, resumable tag)", async ({
    page,
  }) => {
    await mockRecovery(page, [OFFER_KIT]);
    await mockServers(page);
    await gotoHost(page);

    const toggle = page.getByRole("button", { name: "Show layout for kit" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("resumable")).toHaveCount(0);

    await toggle.click();
    // The toggle's accessible name flips Show → Hide with the state.
    const expandedToggle = page.getByRole("button", { name: "Hide layout for kit" });
    await expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
    const tree = page.getByTestId("recovery-session-dev");
    await expect(tree).toBeVisible();
    await expect(tree).toContainText("dev");
    await expect(tree).toContainText("0: shell · 1 pane");
    await expect(tree).toContainText("1: agent · 2 panes");
    await expect(tree).toContainText("zsh, claude -c");
    await expect(tree.getByText("resumable")).toBeVisible();

    // Read-only: the tree carries no buttons (no resume affordance).
    await expect(tree.getByRole("button")).toHaveCount(0);
  });

  test("restore POSTs the server name, removes the row, and refetches the offers", async ({
    page,
  }) => {
    const { state, getCount, restoreBodies } = await mockRecovery(page, [OFFER_KIT, OFFER_WORK]);
    await mockServers(page);
    await gotoHost(page);
    await expect(page.getByTestId("recovery-row-kit")).toBeVisible();
    expect(getCount.n).toBe(1);

    // The backend drops the offer once restored — the refetch returns less.
    state.offers = [OFFER_WORK];
    await page.getByRole("button", { name: "Restore kit" }).click();

    await expect.poll(() => restoreBodies.length).toBe(1);
    expect(restoreBodies[0]).toEqual({ server: "kit" });
    await expect(page.getByTestId("recovery-row-kit")).toHaveCount(0);
    await expect(page.getByTestId("recovery-row-work")).toBeVisible();
    // Mount fetch + the post-mutation refetch.
    await expect.poll(() => getCount.n).toBe(2);
  });

  test("dismiss POSTs the server name and removes the row", async ({ page }) => {
    const { state, dismissBodies } = await mockRecovery(page, [OFFER_KIT, OFFER_WORK]);
    await mockServers(page);
    await gotoHost(page);
    await expect(page.getByTestId("recovery-row-kit")).toBeVisible();

    state.offers = [OFFER_WORK];
    await page.getByRole("button", { name: "Dismiss recovery for kit" }).click();

    await expect.poll(() => dismissBodies.length).toBe(1);
    expect(dismissBodies[0]).toEqual({ server: "kit" });
    await expect(page.getByTestId("recovery-row-kit")).toHaveCount(0);
    await expect(page.getByTestId("recovery-row-work")).toBeVisible();
  });

  test("Dismiss all POSTs one dismiss per server and the section leaves the DOM", async ({
    page,
  }) => {
    const { state, dismissBodies } = await mockRecovery(page, [OFFER_KIT, OFFER_WORK]);
    await mockServers(page);
    await gotoHost(page);
    await expect(page.getByRole("button", { name: "Dismiss all" })).toBeVisible();

    // The backend drops each offer once dismissed — the refetches return less,
    // then nothing.
    state.offers = [];
    await page.getByRole("button", { name: "Dismiss all" }).click();

    await expect.poll(() => dismissBodies.length).toBe(2);
    expect(dismissBodies).toEqual([{ server: "kit" }, { server: "work" }]);
    await expect(page.getByRole("region", { name: "Recovery" })).toHaveCount(0);
  });
});
