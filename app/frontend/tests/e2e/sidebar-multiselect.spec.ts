import { test, expect, type Page } from "@playwright/test";
import { gotoServerReady, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

/**
 * Sidebar window-row multi-select + palette bulk actions (260807-nf9f,
 * 260808-ebgs).
 *
 * The source session holds the windows to sweep; the target session is where
 * the bulk move lands them. Both are per-run unique so a shared e2e tmux server
 * (which may hold other sessions) never collides.
 */
const STAMP = Date.now();
const SRC_SESSION = `e2e-msel-${STAMP}`;
const DST_SESSION = `e2e-mseldst-${STAMP}`;

/** The globally-unique roving/selection key for a window row. */
function rowKey(windowId: string): string {
  return `${TMUX_SERVER}:${windowId}`;
}

test.describe("Sidebar window-row multi-select", () => {
  test.beforeAll(() => {
    // The first three preserve the range/move fixtures; the final pair is
    // reserved for the destructive close test so later tests keep live panes.
    createSession(SRC_SESSION, {
      windows: ["alpha", "beta", "gamma", "close-one", "close-two"],
    });
    createSession(DST_SESSION, { windows: ["keep"] });
  });

  test.afterAll(() => {
    killSession(SRC_SESSION);
    killSession(DST_SESSION);
  });

  /** Navigate to the server route and wait for both sessions' rows to render. */
  async function openTree(page: Page) {
    await gotoServerReady(page, TMUX_SERVER);
    const tree = page.getByRole("tree", { name: "Session tree" });
    await expect(tree).toBeVisible();
    await expect(
      page.locator(`[data-session-row="${TMUX_SERVER}:${SRC_SESSION}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(`[data-session-row="${TMUX_SERVER}:${DST_SESSION}"]`),
    ).toBeVisible({ timeout: 10_000 });
    return tree;
  }

  /** Resolve the source session's three window ids from the backend snapshot. */
  async function windowIds(page: Page) {
    return {
      alpha: (await resolveWindow(page, TMUX_SERVER, SRC_SESSION, "alpha")).windowId,
      beta: (await resolveWindow(page, TMUX_SERVER, SRC_SESSION, "beta")).windowId,
      gamma: (await resolveWindow(page, TMUX_SERVER, SRC_SESSION, "gamma")).windowId,
    };
  }

  /** Resolve the pair reserved for the destructive confirmed-close test. */
  async function closeWindowIds(page: Page) {
    return {
      one: (await resolveWindow(page, TMUX_SERVER, SRC_SESSION, "close-one"))
        .windowId,
      two: (await resolveWindow(page, TMUX_SERVER, SRC_SESSION, "close-two"))
        .windowId,
    };
  }

  /** The set of currently `aria-selected` window rows, as roving keys. */
  async function selectedKeys(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]'),
      ).map((el) => el.getAttribute("data-row-key") ?? ""),
    );
  }

  test("the tree declares aria-multiselectable and starts with nothing selected", async ({
    page,
  }) => {
    const tree = await openTree(page);
    await expect(tree).toHaveAttribute("aria-multiselectable", "true");
    expect(await selectedKeys(page)).toEqual([]);
    // The count indicator is absent while the selection is empty.
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);
  });

  test("Cmd-click toggles a window row's selection without navigating", async ({ page }) => {
    await openTree(page);
    const { alpha } = await windowIds(page);
    const urlBefore = page.url();
    const row = page.locator(`[data-row-key="${rowKey(alpha)}"]`);

    // Modifier-click the row's select button — the row does NOT navigate.
    await row.locator("button").first().click({ modifiers: ["ControlOrMeta"] });
    await expect(row).toHaveAttribute("aria-selected", "true");
    expect(page.url()).toBe(urlBefore);

    // The count indicator appears and reports 1.
    await expect(page.getByTestId("selection-indicator")).toContainText("1 selected");

    // A second modifier-click removes it again.
    await row.locator("button").first().click({ modifiers: ["ControlOrMeta"] });
    await expect(row).toHaveAttribute("aria-selected", "false");
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);
  });

  test("Shift-click extends a contiguous range from the anchor", async ({ page }) => {
    await openTree(page);
    const { alpha, beta, gamma } = await windowIds(page);

    // Anchor on alpha, then shift-click gamma → alpha, beta, gamma all selected.
    await page
      .locator(`[data-row-key="${rowKey(alpha)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await page
      .locator(`[data-row-key="${rowKey(gamma)}"] button`)
      .first()
      .click({ modifiers: ["Shift"] });

    for (const id of [alpha, beta, gamma]) {
      await expect(page.locator(`[data-row-key="${rowKey(id)}"]`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    await expect(page.getByTestId("selection-indicator")).toContainText("3 selected");
  });

  test("`x` toggles the focused row and Escape clears the selection", async ({ page }) => {
    await openTree(page);
    const { alpha, beta } = await windowIds(page);
    const alphaRow = page.locator(`[data-row-key="${rowKey(alpha)}"]`);
    const sessionRow = page.locator(`[data-session-row="${TMUX_SERVER}:${SRC_SESSION}"]`);

    // Focus the alpha row itself (the treeitem) and press `x`.
    await alphaRow.focus();
    await alphaRow.press("x");
    await expect(alphaRow).toHaveAttribute("aria-selected", "true");

    // `x` on a SESSION row is a no-op — sessions are not selectable.
    await sessionRow.focus();
    await sessionRow.press("x");
    expect(await selectedKeys(page)).toEqual([rowKey(alpha)]);

    // `x` again on alpha deselects it; then re-select two rows for the clear.
    await alphaRow.focus();
    await alphaRow.press("x");
    await expect(alphaRow).toHaveAttribute("aria-selected", "false");
    await alphaRow.press("x");
    const betaRow = page.locator(`[data-row-key="${rowKey(beta)}"]`);
    await betaRow.focus();
    await betaRow.press("x");
    await expect(page.getByTestId("selection-indicator")).toContainText("2 selected");

    // Escape inside the tree clears everything.
    await betaRow.press("Escape");
    expect(await selectedKeys(page)).toEqual([]);
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);
  });

  test("collapsing a session does not clear the selection of its still-live windows", async ({
    page,
  }) => {
    await openTree(page);
    const { alpha, beta } = await windowIds(page);

    /** The session row's collapse/expand chevron, scoped to the row itself —
     *  a bare name lookup also matches the SERVER panel's copy of the session. */
    const chevron = (session: string) =>
      page
        .locator(`[data-session-row="${TMUX_SERVER}:${session}"]`)
        .getByRole("button", { name: new RegExp(`^(Collapse|Expand) ${session}$`) });

    await page
      .locator(`[data-row-key="${rowKey(alpha)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await page
      .locator(`[data-row-key="${rowKey(beta)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByTestId("selection-indicator")).toContainText("2 selected");

    // Fold the selected rows out of view. They are still live in tmux, so the
    // selection (and its count indicator) must be untouched — a visibility-keyed
    // prune would read "not rendered" as "gone" and wipe both keys here.
    await chevron(SRC_SESSION).click();
    await expect(page.locator(`[data-row-key="${rowKey(alpha)}"]`)).toHaveCount(0);
    await expect(page.getByTestId("selection-indicator")).toContainText("2 selected");

    // Collapsing an UNRELATED session (another signature change the selected
    // windows had no part in) must likewise leave them alone.
    await chevron(DST_SESSION).click();
    await expect(page.getByTestId("selection-indicator")).toContainText("2 selected");

    // Re-expanding shows the rows still selected.
    await chevron(SRC_SESSION).click();
    await expect(page.locator(`[data-row-key="${rowKey(alpha)}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(`[data-row-key="${rowKey(beta)}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Re-expand the unrelated session too. Each test gets a fresh page (and the
    // selection store is per-page), but the collapse state is persisted to
    // localStorage, which the following test's tree would inherit.
    await chevron(DST_SESSION).click();
    await expect(
      page.locator(`[data-session-row="${TMUX_SERVER}:${DST_SESSION}"]`),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("palette bulk close requires confirmation and closes every selected window", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await openTree(page);
    const { one, two } = await closeWindowIds(page);
    for (const id of [one, two]) {
      await page
        .locator(`[data-row-key="${rowKey(id)}"] button`)
        .first()
        .click({ modifiers: ["ControlOrMeta"] });
    }

    const actionLabel = "Selection: Close 2 windows";
    const confirmLabel = "Close 2 windows — Enter to confirm";
    await page.keyboard.press("Meta+k");
    let paletteInput = page.getByPlaceholder("Type a command...");
    await paletteInput.fill(actionLabel);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: confirmLabel })).toBeVisible();

    // Escape cancels the sub-step; neither window is touched and the selection
    // remains available for the second attempt.
    await page.keyboard.press("Escape");
    const liveAfterCancel = new Set(
      listWindows(SRC_SESSION).map((win) => win.windowId),
    );
    expect(liveAfterCancel.has(one)).toBe(true);
    expect(liveAfterCancel.has(two)).toBe(true);
    await expect(page.getByTestId("selection-indicator")).toContainText(
      "2 selected",
    );

    await page.keyboard.press("Meta+k");
    paletteInput = page.getByPlaceholder("Type a command...");
    await paletteInput.fill(actionLabel);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: confirmLabel })).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Closed 2 windows")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);
    await expect
      .poll(
        () => {
          const live = new Set(
            listWindows(SRC_SESSION).map((win) => win.windowId),
          );
          return !live.has(one) && !live.has(two);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("palette prompt broadcast targets a frozen selection sequentially", async ({
    page,
  }) => {
    await openTree(page);
    const { gamma } = await windowIds(page);
    const keep = (
      await resolveWindow(page, TMUX_SERVER, DST_SESSION, "keep")
    ).windowId;

    const requests: Array<{
      server: string | null;
      windowId: string;
      body: unknown;
    }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await page.route(/\/api\/windows\/[^/]+\/chat\/send\?server=/, async (route) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const request = route.request();
      const url = new URL(request.url());
      const segments = url.pathname.split("/");
      requests.push({
        server: url.searchParams.get("server"),
        windowId: decodeURIComponent(segments[3] ?? ""),
        body: request.postDataJSON(),
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      inFlight--;
    });

    for (const id of [gamma, keep]) {
      await page
        .locator(`[data-row-key="${rowKey(id)}"] button`)
        .first()
        .click({ modifiers: ["ControlOrMeta"] });
    }
    const actionLabel = "Selection: Send prompt to 2 agents";
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await paletteInput.fill(actionLabel);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("compose-strip-target")).toHaveText(
      "2 selected",
    );
    const composeInput = page.getByTestId("compose-strip-input");
    await expect(composeInput).toBeFocused();

    // Mutating the live selection after opening must not retarget the frozen
    // compose recipient set or its label.
    await page
      .locator(`[data-row-key="${rowKey(keep)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByTestId("selection-indicator")).toContainText(
      "1 selected",
    );
    await expect(page.getByTestId("compose-strip-target")).toHaveText(
      "2 selected",
    );

    await composeInput.fill("run tests and report");
    await page.getByTestId("compose-strip-send").click();

    await expect(page.getByText("Sent prompt to 2 agents")).toBeVisible({
      timeout: 15_000,
    });
    expect(maxInFlight).toBe(1);
    expect(requests).toEqual([
      {
        server: TMUX_SERVER,
        windowId: gamma,
        body: { text: "run tests and report" },
      },
      {
        server: TMUX_SERVER,
        windowId: keep,
        body: { text: "run tests and report" },
      },
    ]);
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);
  });

  test("palette 'Selection: Move N windows to <session>' bulk-moves the selection", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await openTree(page);
    const { alpha, beta } = await windowIds(page);

    // Select two of the source session's windows.
    await page
      .locator(`[data-row-key="${rowKey(alpha)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await page
      .locator(`[data-row-key="${rowKey(beta)}"] button`)
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByTestId("selection-indicator")).toContainText("2 selected");

    // Run the per-target-session palette entry.
    const label = `Selection: Move 2 windows to ${DST_SESSION}`;
    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command...");
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
    await paletteInput.fill(label);
    await expect(page.getByRole("option", { name: label })).toBeVisible({
      timeout: 10_000,
    });
    await page.keyboard.press("Enter");

    // Success toast, and the selection clears on a fully successful batch.
    await expect(
      page.getByText(`Moved 2 windows to ${DST_SESSION}`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("selection-indicator")).toHaveCount(0);

    // tmux-side truth: both windows now live in the target session, and neither
    // remains in the source.
    await expect
      .poll(
        () => {
          const dst = new Set(listWindows(DST_SESSION).map((w) => w.windowId));
          return [alpha, beta].every((id) => dst.has(id));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const srcIds = listWindows(SRC_SESSION).map((w) => w.windowId);
    expect(srcIds).not.toContain(alpha);
    expect(srcIds).not.toContain(beta);

    // And the rows repaint under the target session via SSE.
    await expect(
      page.locator(
        `[data-session-group="${DST_SESSION}"] [data-row-key="${rowKey(alpha)}"]`,
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(
        `[data-session-group="${DST_SESSION}"] [data-row-key="${rowKey(beta)}"]`,
      ),
    ).toBeVisible({ timeout: 15_000 });
  });
});
