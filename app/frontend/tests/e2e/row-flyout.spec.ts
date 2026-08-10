import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Row-hover register flyout card + rest-state PR glyph (93dy). Fully mocked:
// the isolated e2e tmux server has no real change-bound PRs and `gh` is
// unavailable in CI, so the SSE `sessions` payload (and the server list) is
// injected via page.route / the state-socket mock — the same idiom as the
// retired status-dot-tip.spec.ts this file replaces. See row-flyout.spec.md
// for intent + steps.
//
// The flyout opens on WHOLE-ROW hover (350ms delay, warm-window retarget),
// keyboard row focus, and coarse-pointer dot-tap; it anchors to the row with
// placement "right", so it renders at the sidebar's right edge.

const SERVER = "default";

// @1: change-bound window WITH an owned open PR (blue "building — active" dot
// — the PR never owns the dot; the rest PR glyph + full four-register card
// carry the PR story) AND a reconciled claude chat (so the conversation-fork
// affordance renders — 260806-s4av). @2: plain scratch window (gray "idle"
// dot, no glyph, out-register-only card, no fork link).
const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: 0,
        agentState: "waiting",
        agentIdleDuration: "3m",
        chatProvider: "claude",
        chatSessionRef: "5d80479e-8f25-46cd-a0d4-e51435508a37",
        fabChange: "260805-93dy-window-row-pr-glyph-register-flyout",
        fabStage: "apply",
        fabDisplayState: "active",
        prUrl: "https://github.com/o/r/pull/386",
        prNumber: 386,
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
        prFetchedAt: new Date().toISOString(),
      },
      {
        windowId: "@2",
        index: 1,
        name: "scratch-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
      },
    ],
  },
]);

/** Install routes that fully mock the server list and the state socket. */
async function mockBackend(page: Page) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept and hold the socket open; send nothing */
  });

  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );

  await mockStateSocket(page, { sessions: sessionsPayload });
}

/** Mock `(pointer: coarse)` as matching (the tooltips.spec.ts precedent —
 *  Playwright's desktop Chromium cannot flip the real pointer media feature). */
function mockCoarsePointer(page: Page) {
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

const tree = (page: Page) => page.locator("[role='tree']");
const prRow = (page: Page) => tree(page).locator("[role='treeitem'][data-window-id='@1']");
const scratchRow = (page: Page) => tree(page).locator("[role='treeitem'][data-window-id='@2']");
const card = (page: Page) => page.getByTestId("row-flyout-card");

async function gotoAndWait(page: Page) {
  await page.goto(`/${SERVER}`);
  await expect(prRow(page)).toBeVisible({ timeout: 10_000 });
  await expect(scratchRow(page)).toBeVisible();
}

test.describe("Row flyout card (fine pointer)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await gotoAndWait(page);
  });

  test("hovering a row opens the register card at the sidebar's right edge", async ({ page }) => {
    await prRow(page).hover();
    await expect(card(page)).toBeVisible();

    // Content: dot-label header (hue word + status word + waiting suffix — no
    // PR words; the pr register below carries the PR) + the four registers +
    // freshness + links.
    await expect(card(page)).toContainText("building — active — agent waiting 3m");
    await expect(page.getByTestId("row-flyout-out")).toContainText("out");
    await expect(page.getByTestId("row-flyout-agt")).toContainText("waiting 3m");
    await expect(page.getByTestId("row-flyout-fab")).toContainText(
      "93dy window-row-pr-glyph-register-flyout · apply · active",
    );
    await expect(page.getByTestId("row-flyout-pr")).toContainText("#386");
    await expect(page.getByTestId("row-flyout-checked")).toContainText(/checked \d+\w+ ago/);
    // The pr register LINE itself is the open-first anchor (PrLinkRow idiom):
    // it wraps the segments and carries an always-visible inline ↗.
    const prLink = page.getByTestId("row-flyout-pr-link");
    await expect(prLink).toContainText("#386");
    await expect(prLink).toContainText("↗");
    await expect(prLink).toHaveAttribute("aria-label", "Open PR #386 in a new tab");
    await expect(prLink).toHaveAttribute("href", "https://github.com/o/r/pull/386");
    await expect(prLink).toHaveAttribute("target", "_blank");
    await expect(prLink).toHaveAttribute("rel", "noopener noreferrer");
    // Row-aligned notch (E1): the arrow renders on the card's row-side edge,
    // vertically inside the hovered row's band (its center ≈ the row's center).
    const arrowBox = await page.getByTestId("row-flyout-arrow").boundingBox();
    const anchorRowBox = await prRow(page).boundingBox();
    expect(arrowBox).not.toBeNull();
    const arrowCenterY = arrowBox!.y + arrowBox!.height / 2;
    expect(arrowCenterY).toBeGreaterThanOrEqual(anchorRowBox!.y - 1);
    expect(arrowCenterY).toBeLessThanOrEqual(anchorRowBox!.y + anchorRowBox!.height + 1);
    const docsLink = page.getByTestId("row-flyout-docs-link");
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute(
      "href",
      "https://github.com/sahil87/run-kit/blob/main/docs/site/status-dot.md",
    );

    // Fixed-x anchor: the card sits at (right of) the sidebar's right edge,
    // vertically overlapping the hovered row.
    const aside = page.locator('aside[aria-label="Sidebar"]');
    const asideBox = (await aside.boundingBox())!;
    const cardBox = (await card(page).boundingBox())!;
    const rowBox = (await prRow(page).boundingBox())!;
    expect(cardBox.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 1);
    expect(cardBox.y).toBeLessThan(rowBox.y + rowBox.height + 8);
    expect(cardBox.y + cardBox.height).toBeGreaterThan(rowBox.y - 8);

    // No line paints OUTSIDE the max-w-xs card box: the mocked fab register
    // ("…window-row-pr-glyph-register-flyout · apply · active") is wider than
    // the card, so without `truncate` on the register lines the card's
    // scrollWidth exceeds its clientWidth (the cycle-1 regression measured
    // 435 vs 318). Truncated lines keep content inside the box.
    const overflow = await card(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("moving between rows retargets the card (warm window, single card)", async ({ page }) => {
    await prRow(page).hover();
    await expect(card(page)).toContainText("building — active");

    // Sweep to the sibling row: the first card closes and the sibling's opens
    // (warm retarget — no strobing, never two cards).
    await scratchRow(page).hover();
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText("idle");
    await expect(page.getByTestId("row-flyout-pr-link")).toHaveCount(0);
  });

  test("the fork link renders only on a claude-chat row and POSTs the fork endpoint", async ({
    page,
  }) => {
    // Gate: @1 carries a reconciled claude chat → the fork affordance renders
    // beside the docs link; @2 (plain shell, no chatProvider) does not.
    await prRow(page).hover();
    const forkLink = page.getByTestId("row-flyout-fork-link");
    await expect(forkLink).toBeVisible();
    await expect(forkLink).toHaveAttribute("title", /same directory/i);

    await scratchRow(page).hover();
    await expect(card(page)).toContainText("idle");
    await expect(page.getByTestId("row-flyout-fork-link")).toHaveCount(0);

    // Clicking it POSTs the window-keyed fork endpoint with NO body (every input
    // is derived server-side). Mocked with an empty windowId so the app skips
    // navigation and the assertion stays on this route.
    const forkRequests: string[] = [];
    await page.route("**/api/windows/*/fork*", (route) => {
      forkRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ server: SERVER, session: "dev", window: "feature-work-fork", windowId: "" }),
      });
    });

    await prRow(page).hover();
    await page.getByTestId("row-flyout-fork-link").click();
    await expect.poll(() => forkRequests.length).toBe(1);
    // Window-keyed: the source window's id is in the path (percent-encoded '@').
    expect(forkRequests[0]).toContain("/fork");
    expect(decodeURIComponent(forkRequests[0])).toContain("/api/windows/@1/fork");
    // Forking never also selects/navigates the row.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
  });

  test("a successful fork navigates to the returned window", async ({ page }) => {
    // The navigation half of the fork contract (R11): a NON-empty returned
    // windowId routes to that window (the empty-id skip is the case above).
    await page.route("**/api/windows/*/fork*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server: SERVER,
          session: "dev",
          window: "feature-work-fork",
          windowId: "@9",
        }),
      }),
    );

    await prRow(page).hover();
    await page.getByTestId("row-flyout-fork-link").click();

    // @9 → URL segment `9` (the route strips the '@'), the same navigation the
    // spawn dialog performs with a riff result.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/9(?:$|[/?#])`), { timeout: 5_000 });
  });

  test("clicking the card's PR link does not select/navigate the window row", async ({ page }) => {
    await prRow(page).hover();
    const prLink = page.getByTestId("row-flyout-pr-link");
    await expect(prLink).toBeVisible();
    // Block the new-tab navigation so the assertion stays on the SPA route.
    await prLink.evaluate((a) => a.removeAttribute("href"));
    await prLink.click();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
  });

  test("keyboard: focusing the row opens the card; Tab reaches its links; Escape dismisses it", async ({
    page,
  }) => {
    await prRow(page).focus();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("building — active");

    // The card's links are Tab-reachable from the focused row
    // (FloatingFocusManager modal={false} + the portal's tab-order guards).
    // Tab walks the row's action icons first (pin, kill), then enters the
    // portalled card: docs link, then the PR link.
    const docsLink = page.getByTestId("row-flyout-docs-link");
    let reachedDocs = false;
    for (let i = 0; i < 6 && !reachedDocs; i++) {
      await page.keyboard.press("Tab");
      reachedDocs = await docsLink.evaluate((el) => el === document.activeElement);
    }
    expect(reachedDocs).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("row-flyout-pr-link")).toBeFocused();

    // Escape still dismisses with focus inside the card, and focus returns
    // INTO the row (the root when it is the roving tab stop, else its first
    // tabbable child) — either way the tree keydown anchors on
    // closest('[role="treeitem"]'), so arrow-key nav continues from this row.
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    const focusInRow = await prRow(page).evaluate(
      (row) => row === document.activeElement || row.contains(document.activeElement),
    );
    expect(focusInRow).toBe(true);
  });

  test("rest PR glyph shows for an owned PR and hover swaps it for the actions", async ({ page }) => {
    const glyph = prRow(page).getByTestId("row-pr-glyph");
    // At rest: the glyph is visible in the last (✕) slot; the plain scratch
    // row has none.
    await expect(glyph).toBeVisible();
    await expect(scratchRow(page).getByTestId("row-pr-glyph")).toHaveCount(0);

    // On hover the glyph display-swaps away and the kill ✕ takes the slot
    // (the buttons are opacity-revealed, so assert computed opacity).
    await prRow(page).hover();
    await expect(glyph).toBeHidden();
    const kill = prRow(page).getByLabel("Kill window feature-work");
    await expect(kill).toHaveCSS("opacity", "1");

    // Leaving the row restores the rest glyph.
    await scratchRow(page).hover();
    await expect(glyph).toBeVisible();
  });
});

test.describe("Row flyout card (coarse pointer)", () => {
  test.use({ hasTouch: true });

  test("touch: no hover-open, no rest glyph; dot-tap opens the card without selecting the row", async ({
    page,
  }) => {
    await mockCoarsePointer(page);
    await mockBackend(page);
    // Coarse pointer ⇒ `useIsMobile()` ⇒ the sidebar is a closed drawer: open
    // it via the hamburger before reaching for rows (mobile-layout.spec.ts
    // idiom).
    await page.goto(`/${SERVER}`);
    await page.getByRole("button", { name: "Toggle navigation" }).tap();
    await expect(prRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(scratchRow(page)).toBeVisible();

    // The rest glyph never renders visibly on coarse pointers (the action
    // cluster is always visible there and wins the slots).
    await expect(prRow(page).getByTestId("row-pr-glyph")).toBeHidden();

    // Tap the DOT (the touch status path): the card opens and the tap does
    // NOT select the row (stopPropagation) — the URL stays on the server
    // route (@1's select would navigate to /default/1).
    await prRow(page).getByTestId("status-dot-tap").tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("building — active");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));

    // A touch interaction with the row BODY does not hover-open a card: it
    // selects the row (tap-to-select is unchanged) — dismiss the open card
    // first, then tap the row body.
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await scratchRow(page).getByText("scratch-shell").tap();
    // Row select navigated (tap = select, not hover-open) — off the bare
    // server route onto a window route…
    await expect(page).not.toHaveURL(new RegExp(`/${SERVER}/?$`));
    // …and no flyout card appeared from the touch interaction.
    await page.waitForTimeout(600); // past the 350ms open delay
    await expect(card(page)).toHaveCount(0);
  });
});
