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
// keyboard row focus, and coarse-pointer rail/dot-tap; placement is
// pointer-conditional — "right" (the sidebar's right edge) on fine pointers,
// "bottom-start" below the row on coarse, with the card width capped short of
// the row's 56px status rail. Card actions (change color / fork / pin / kill)
// are explicit sectioned rows at the card's bottom on BOTH pointer worlds —
// the title bar carries only the ⓘ docs link. 260817-ve5m extends the rail +
// card to the session rows and server-group headers (coarse-only surfaces —
// tap/scrub is their one trigger), makes `Change color…` the first action row
// of every tier's card, removes the coarse left label zone (the display-only
// marker stripe stays; the content start reclaims ~14px), and generalizes the
// scrub to retarget cards ACROSS tiers via the shared `data-rail-row` handle.

const SERVER = "default";

// @1: change-bound window WITH an owned open PR (blue "building — active" dot
// — the PR never owns the dot; the rest PR glyph + full four-register card
// carry the PR story) AND a reconciled claude chat (so the conversation-fork
// affordance renders — 260806-s4av), carrying two panes (%425 active) so the
// identity title bar renders its full `Window @N · pane %N · N panes` form.
// @2: plain scratch window (gray "idle" dot, no glyph, out-register-only card,
// no fork link, no panes → degraded `Window @N` title) carrying an orange
// color + solid marker so the coarse left-zone reclaim can prove the
// display-only stripe survives the interactive zone's removal.
const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    sessionId: "$4",
    sessionPath: "/home/sahil/code/sahil87/run-kit",
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
        panes: [
          { paneId: "%7", paneIndex: 0, cwd: "/tmp/wt", command: "zsh", isActive: false },
          { paneId: "%425", paneIndex: 1, cwd: "/tmp/wt", command: "claude", isActive: true },
        ],
      },
      {
        windowId: "@2",
        index: 1,
        name: "scratch-shell",
        worktreePath: "/tmp/scratch",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: 0,
        color: "orange",
        marker: "solid",
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
// The two non-window rail tiers (260817-ve5m): the session row (a level-1
// treeitem keyed `${server}:${name}`) and the server-group header (NOT a
// treeitem — the shared `data-rail-row` attribute is what unifies the shapes).
const sessionRow = (page: Page) => tree(page).locator("[data-session-row='default:dev']");
const serverHeader = (page: Page) => page.locator("[data-server='default']");
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

    // Content: the identity title bar (`Window @N · pane %N · N panes`, the
    // card's first element, carrying ONLY the ⓘ docs affordance on its right
    // edge — actions live in the sectioned rows at the card's bottom), then
    // the DEMOTED dot-label body line (hue word + status word +
    // waiting suffix — no PR words; the pr register below carries the PR) +
    // the four registers + freshness + links.
    const titleBar = page.getByTestId("popup-title-bar");
    await expect(titleBar).toContainText("Window @1 · pane %425 · 2 panes");
    await expect(titleBar.getByTestId("row-flyout-docs-link")).toBeVisible();
    await expect(titleBar.getByTestId("row-flyout-fork-action")).toHaveCount(0);
    // Sectioned action rows (change color → fork → pin → kill, one home per
    // action, BOTH pointer worlds): labels + sub-hints, in order. `Change
    // color…` is the FIRST row of every tier's card (260817-ve5m).
    const colorRow = card(page).getByTestId("row-flyout-color-action");
    const forkRow = card(page).getByTestId("row-flyout-fork-action");
    const pinRow = card(page).getByTestId("row-flyout-pin-action");
    const killRow = card(page).getByTestId("row-flyout-kill-action");
    await expect(colorRow).toContainText("Change color…");
    await expect(forkRow).toContainText("Fork conversation");
    await expect(forkRow).toContainText("new window, same directory");
    await expect(pinRow).toContainText("Pin to board…");
    await expect(pinRow).toContainText("not pinned");
    await expect(killRow).toContainText("Kill window");
    await expect(killRow).toContainText("confirms first");
    const colorBox = (await colorRow.boundingBox())!;
    const forkBox = (await forkRow.boundingBox())!;
    const pinBox = (await pinRow.boundingBox())!;
    const killBox = (await killRow.boundingBox())!;
    expect(colorBox.y).toBeLessThan(forkBox.y);
    expect(forkBox.y).toBeLessThan(pinBox.y);
    expect(pinBox.y).toBeLessThan(killBox.y);
    const cardText = (await card(page).innerText()).replaceAll("\n", " ");
    expect(cardText.indexOf("Window @1")).toBeLessThan(cardText.indexOf("building — active"));
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
    // (warm retarget — no strobing, never two cards). The pane-less scratch
    // window's title degrades to `Window @N` alone.
    await scratchRow(page).hover();
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText("idle");
    const titleBar = page.getByTestId("popup-title-bar");
    await expect(titleBar).toContainText("Window @2");
    await expect(titleBar).not.toContainText("pane");
    await expect(page.getByTestId("row-flyout-pr-link")).toHaveCount(0);
  });

  test("the fork action row renders only on a claude-chat row and POSTs the fork endpoint", async ({
    page,
  }) => {
    // Gate: @1 carries a reconciled claude chat → the fork action row renders
    // in the card's sectioned action list; @2 (plain shell, no chatProvider)
    // does not.
    await prRow(page).hover();
    const forkRow = page.getByTestId("row-flyout-fork-action");
    await expect(forkRow).toBeVisible();
    await expect(forkRow).toHaveAttribute("title", /same directory/i);

    await scratchRow(page).hover();
    await expect(card(page)).toContainText("idle");
    await expect(page.getByTestId("row-flyout-fork-action")).toHaveCount(0);

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
    await page.getByTestId("row-flyout-fork-action").click();
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
    await page.getByTestId("row-flyout-fork-action").click();

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

  /** Coarse ⇒ `useIsMobile()` ⇒ the sidebar is a closed drawer: open it via
   *  the hamburger before reaching for rows (mobile-layout.spec.ts idiom). */
  async function gotoCoarseDrawer(page: Page) {
    await mockCoarsePointer(page);
    await mockBackend(page);
    await page.goto(`/${SERVER}`);
    await page.getByRole("button", { name: "Toggle navigation" }).tap();
    await expect(prRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(scratchRow(page)).toBeVisible();
  }

  test("rail renders on every row with aligned slots; rail-tap opens a contained bottom-start card without selecting the row", async ({
    page,
  }) => {
    await gotoCoarseDrawer(page);

    // The widened mobile drawer: 92% of the viewport capped at 340px.
    const drawerBox = (await page.locator('aside[aria-label="Navigation"]').boundingBox())!;
    expect(Math.round(drawerBox.width)).toBe(
      Math.min(Math.round(page.viewportSize()!.width * 0.92), 340),
    );

    // Coarse rest state: the rest-state PR glyph lives in the rail's fixed
    // 16px slot; the pin/✕ cluster is fine-pointer-only — the buttons are not
    // in the DOM at all (pin/kill moved into the flyout card). The rail is
    // 56px wide (260817-ve5m — one constant, all tiers).
    const prRail = prRow(page).getByTestId("status-rail");
    const scratchRail = scratchRow(page).getByTestId("status-rail");
    await expect(prRail).toBeVisible();
    await expect(scratchRail).toBeVisible();
    expect(Math.round((await prRail.boundingBox())!.width)).toBe(56);
    expect(Math.round((await scratchRail.boundingBox())!.width)).toBe(56);
    await expect(prRail.getByTestId("row-pr-glyph")).toBeVisible();
    await expect(scratchRail.getByTestId("row-pr-glyph")).toHaveCount(0);
    // The chevron hint renders on EVERY row — glyph or not (a consistent rail
    // is a learnable rail).
    await expect(prRail).toContainText("›");
    await expect(scratchRail).toContainText("›");
    await expect(prRow(page).getByLabel("Pin feature-work to a board")).toHaveCount(0);
    await expect(prRow(page).getByLabel("Kill window feature-work")).toHaveCount(0);

    // The widened leading tap zone (the SECONDARY touch target) still meets
    // the ≥32×36 touch-target convention.
    const zone = prRow(page).getByTestId("status-dot-tap");
    const zoneBox = await zone.boundingBox();
    expect(zoneBox).not.toBeNull();
    expect(zoneBox!.width).toBeGreaterThanOrEqual(32);
    expect(zoneBox!.height).toBeGreaterThanOrEqual(36);

    // Tapping the RAIL (the primary target) opens the card and does NOT
    // select the row (stopPropagation) — the URL stays on the server route
    // (@1's select would navigate to /default/1).
    await prRail.tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("building — active");
    // The card is the coarse color/pin/kill home — and fork's only home.
    // `Change color…` leads the action rows on every tier (260817-ve5m).
    const colorRow = card(page).getByTestId("row-flyout-color-action");
    await expect(colorRow).toContainText("Change color…");
    await expect(card(page).getByTestId("row-flyout-fork-action")).toBeVisible();
    await expect(card(page).getByTestId("row-flyout-pin-action")).toBeVisible();
    await expect(card(page).getByTestId("row-flyout-kill-action")).toBeVisible();
    const colorBox = (await colorRow.boundingBox())!;
    const forkBox = (await card(page).getByTestId("row-flyout-fork-action").boundingBox())!;
    expect(colorBox.y).toBeLessThan(forkBox.y);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));

    // Coarse placement + containment: the card anchors BELOW its row
    // (bottom-start), renders fully on-screen, and its right edge stops
    // BEFORE the rail column — the finger's column stays visible/touchable.
    const cardBox = (await card(page).boundingBox())!;
    const rowBox = (await prRow(page).boundingBox())!;
    const railBox = (await prRail.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(cardBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(railBox.x + 1);
    // The notch points UP at the row/rail: the arrow rides the card's top
    // edge.
    const arrowBox = (await page.getByTestId("row-flyout-arrow").boundingBox())!;
    expect(arrowBox.y + arrowBox.height).toBeLessThanOrEqual(cardBox.y + 2);

    // The dot-tap zone still works as the SECONDARY target: dismiss, then tap
    // the dot zone to reopen.
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await zone.tap();
    await expect(card(page)).toBeVisible();
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

  test("card kill row opens the existing kill confirmation dialog (no force-kill on touch)", async ({
    page,
  }) => {
    const killRequests: string[] = [];
    await page.route("**/api/windows/*/kill*", (route) => {
      killRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await gotoCoarseDrawer(page);

    await prRow(page).getByTestId("status-dot-tap").tap();
    await expect(card(page)).toBeVisible();
    await card(page).getByTestId("row-flyout-kill-action").tap();

    // The existing KillDialog confirm path — no kill POST has fired.
    await expect(page.getByText("Kill window?")).toBeVisible();
    expect(killRequests).toHaveLength(0);
    // The row was not selected either.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));

    await page.getByRole("button", { name: "Cancel" }).tap();
    await expect(page.getByText("Kill window?")).toHaveCount(0);
    expect(killRequests).toHaveLength(0);
  });

  test("card pin row closes the card and opens the existing pin popover", async ({ page }) => {
    await gotoCoarseDrawer(page);

    await prRow(page).getByTestId("status-dot-tap").tap();
    await expect(card(page)).toBeVisible();
    await card(page).getByTestId("row-flyout-pin-action").tap();

    // Popover-over-flyout precedence: the card is gone, the row's PinPopover
    // is open, and the row was never selected.
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Pin window to board" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
  });

  test("scrub: press the rail + slide retargets the single card across rows; release keeps it; tap-elsewhere dismisses", async ({
    page,
  }) => {
    await gotoCoarseDrawer(page);

    // Press the rail (the primary scrub target — pointerdown opens the card
    // and captures the pointer), then slide onto the sibling row without
    // lifting.
    const railBox = (await prRow(page).getByTestId("status-rail").boundingBox())!;
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
    await page.mouse.down();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("building — active");

    const scratchBox = (await scratchRow(page).boundingBox())!;
    await page.mouse.move(scratchBox.x + scratchBox.width / 2, scratchBox.y + scratchBox.height / 2, {
      steps: 5,
    });
    // One card, retargeted to @2 (the scrub never selects/navigates).
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText("Window @2");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));

    // Containment mid-scrub: the retargeted card never covers the finger's
    // rail column on the row it now belongs to.
    const retargetedCardBox = (await card(page).boundingBox())!;
    const scratchRailBox = (await scratchRow(page).getByTestId("status-rail").boundingBox())!;
    expect(retargetedCardBox.x + retargetedCardBox.width).toBeLessThanOrEqual(scratchRailBox.x + 1);

    // Release keeps the last card open and the drawer stays put.
    await page.mouse.up();
    await expect(card(page)).toContainText("Window @2");
    await expect(prRow(page)).toBeVisible();

    // Tapping elsewhere dismisses via the existing outside-press path.
    await page.mouse.click(700, 300);
    await expect(card(page)).toHaveCount(0);
  });

  test("coarse left-zone reclaim: no interactive zone, the display-only marker stripe stays, content starts ≈16px", async ({
    page,
  }) => {
    await gotoCoarseDrawer(page);

    // The interactive label zone (and its palette-icon reveal) is REMOVED on
    // coarse — no element carries its aria-label anywhere in the tree.
    await expect(page.locator('[aria-label="Set window label"]')).toHaveCount(0);

    // The display-only marker stripe REMAINS on coarse (information, not an
    // affordance): @2 carries a solid marker, rendered as a left-edge stripe.
    const stripe = scratchRow(page).locator('div[style*="border-left"]');
    await expect(stripe).toBeVisible();

    // The reclaimed geometry: the row content (the dot tap zone) starts ≈16px
    // from the row's left edge (4px stripe inset + 10px max stripe + 2px
    // clearance) instead of the fine-pointer 30px.
    const rowBox = (await scratchRow(page).boundingBox())!;
    const zoneBox = (await scratchRow(page).getByTestId("status-dot-tap").boundingBox())!;
    expect(Math.abs(zoneBox.x - rowBox.x - 16)).toBeLessThanOrEqual(1);
  });

  test("session rail tap opens the session card; its actions route (kill confirms first)", async ({
    page,
  }) => {
    const killRequests: string[] = [];
    await page.route("**/api/sessions/*/kill*", (route) => {
      killRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await gotoCoarseDrawer(page);

    // The session row carries the rail; its fine-pointer 4-icon cluster is
    // absent from the DOM on coarse.
    const rail = sessionRow(page).getByTestId("status-rail");
    await expect(rail).toBeVisible();
    await expect(sessionRow(page).getByLabel("Kill session dev")).toHaveCount(0);
    await expect(sessionRow(page).getByLabel("New window in dev")).toHaveCount(0);

    await rail.tap();
    await expect(card(page)).toBeVisible();
    // Title + the identity-tip facts line + the relocated action rows in the
    // fixed order (Spawn agent… is wired on this route).
    await expect(page.getByTestId("popup-title-bar")).toContainText("Session dev");
    await expect(card(page)).toContainText("$4 · 2 windows · ~/code/sahil87/run-kit");
    const colorRow = card(page).getByTestId("row-flyout-color-action");
    const spawnRow = card(page).getByTestId("row-flyout-spawn-action");
    const createRow = card(page).getByTestId("row-flyout-create-action");
    const killRow = card(page).getByTestId("row-flyout-kill-action");
    await expect(colorRow).toContainText("Change color…");
    await expect(spawnRow).toContainText("Spawn agent…");
    await expect(createRow).toContainText("New window");
    await expect(killRow).toContainText("Kill session");
    await expect(killRow).toContainText("confirms first");
    const ys = await Promise.all(
      [colorRow, spawnRow, createRow, killRow].map(async (r) => (await r.boundingBox())!.y),
    );
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(ys[2]).toBeLessThan(ys[3]);
    // Nothing navigated or collapsed.
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
    await expect(prRow(page)).toBeVisible();

    // Kill session routes through the EXISTING confirm dialog — no kill POST.
    await killRow.tap();
    await expect(page.getByText("Kill session?")).toBeVisible();
    await expect(page.getByText(/and all 2 windows/)).toBeVisible();
    expect(killRequests).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel" }).tap();
    await expect(page.getByText("Kill session?")).toHaveCount(0);

    // Change color… closes the card and opens the row's existing color
    // popover (popover-over-card precedence holds: no card flash while open).
    await rail.tap();
    await expect(card(page)).toBeVisible();
    await card(page).getByTestId("row-flyout-color-action").tap();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole("listbox", { name: "Color picker" })).toBeVisible();
    await rail.tap();
    await expect(card(page)).toHaveCount(0);
  });

  test("server rail tap opens the server card; Kill server routes to the existing dialog without toggling the group", async ({
    page,
  }) => {
    const killRequests: string[] = [];
    await page.route("**/api/servers/kill*", (route) => {
      killRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await gotoCoarseDrawer(page);

    // The group header carries the rail; its 3-icon cluster is absent on
    // coarse.
    const header = serverHeader(page);
    const rail = header.getByTestId("status-rail");
    await expect(rail).toBeVisible();
    await expect(header.getByLabel("Kill server default")).toHaveCount(0);
    await expect(header.getByLabel("New session on default")).toHaveCount(0);

    await rail.tap();
    await expect(card(page)).toBeVisible();
    await expect(page.getByTestId("popup-title-bar")).toContainText("Server default");
    // Server names ARE socket names; the count is the group's own data (the
    // singular form degrades like the identity tip's `1 window`).
    await expect(card(page)).toContainText("tmux -L default · 1 session");
    const colorRow = card(page).getByTestId("row-flyout-color-action");
    const createRow = card(page).getByTestId("row-flyout-create-action");
    const killRow = card(page).getByTestId("row-flyout-kill-action");
    await expect(colorRow).toContainText("Change color…");
    await expect(createRow).toContainText("New session");
    await expect(killRow).toContainText("Kill server");
    await expect(killRow).toContainText("confirms first");

    // Kill server routes through the existing killServerTarget dialog (the
    // rk-daemon warning is not in play for this mocked non-daemon server), no
    // kill POST fires, and the group header was never toggled.
    await killRow.tap();
    await expect(page.getByText(/and all its sessions/)).toBeVisible();
    expect(killRequests).toHaveLength(0);
    await expect(header.getByRole("button", { name: /Collapse default sessions/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
    await page.getByRole("button", { name: "Cancel" }).tap();
    await expect(page.getByText(/and all its sessions/)).toHaveCount(0);
  });

  test("cross-tier scrub: window → session → server retarget; release keeps the server card; nothing navigates or collapses", async ({
    page,
  }) => {
    await gotoCoarseDrawer(page);

    // Press @1's rail, then slide up across the session row onto the
    // server-group header without lifting.
    const winRailBox = (await prRow(page).getByTestId("status-rail").boundingBox())!;
    await page.mouse.move(winRailBox.x + winRailBox.width / 2, winRailBox.y + winRailBox.height / 2);
    await page.mouse.down();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("Window @1");

    const sessionRailBox = (await sessionRow(page).getByTestId("status-rail").boundingBox())!;
    await page.mouse.move(
      sessionRailBox.x + sessionRailBox.width / 2,
      sessionRailBox.y + sessionRailBox.height / 2,
      { steps: 5 },
    );
    // One card, retargeted across the tier boundary to the session card.
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByTestId("popup-title-bar")).toContainText("Session dev");

    const headerRailBox = (await serverHeader(page).getByTestId("status-rail").boundingBox())!;
    await page.mouse.move(
      headerRailBox.x + headerRailBox.width / 2,
      headerRailBox.y + headerRailBox.height / 2,
      { steps: 5 },
    );
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByTestId("popup-title-bar")).toContainText("Server default");

    // Release keeps the server card; the scrub never selected, navigated, or
    // toggled anything.
    await page.mouse.up();
    await expect(card(page)).toContainText("tmux -L default · 1 session");
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/?$`));
    await expect(
      serverHeader(page).getByRole("button", { name: /Collapse default sessions/ }),
    ).toBeVisible();
    await expect(prRow(page)).toBeVisible();
  });
});
