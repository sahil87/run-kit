import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully-mocked spec (same technique as top-bar-refresh.spec.ts): the server
// list, boards list, and board entries are injected via page.route and the
// sessions payload via the state-socket mock, so no live tmux backend is
// needed. See top-bar-persistence.spec.md for intent + steps.
//
// Regression coverage for change 260707-4vq2: the TopBar mounts ONCE in the
// persistent root layout (`AppLayout`, above the router `<Outlet>`) rather than
// three separate per-page copies. This asserts the user-facing outcomes of
// that lift:
//   1. The bar is present (its brand crumb visible) immediately after each
//      CLIENT-SIDE cross-route navigation settles — it is not torn down and
//      rebuilt as a blank between pages (the old "navbar reload" flicker). This
//      is the persistence claim, and it holds only for genuine in-app router
//      navigation: hops 1 (server tile → `/$server`) and 3 (board tile →
//      `/board/$name`) click TanStack-Router-driven controls.
//
// NOTE on hop 1's server choice: a Host-page server tile is a SWITCH affordance,
// and a switch resolves a landing window for the target server, so a tile for a
// server that HAS windows navigates to `/$server/$window`, not `/$server`. Hop 1
// therefore clicks EMPTY_SERVER — a mocked server with no sessions, where the
// resolution has nothing to pick and correctly falls through to the bare server
// route. That keeps hop 1 a genuine client-side hop into `tmux Server` mode
// (which is what this spec is about) while staying truthful about the switch
// contract; the populated-server case is covered by its own test below.
//   2. Its center heading is route-derived and updates per route — Host →
//      `tmux Server <server>` → back to Host → `Board <board>` — including
//      the board heading, which renders from the URL param while the lazy board
//      chunk loads.
//   3. On an unmatched route (`/board/x/y`), the bar falls back to the minimal
//      `host` heading rather than leaking the fuzzy-matched board param as
//      `Board x` (the T002 not-found-fallback fix).
//
// NOTE on hop 2 (brand crumb → `/`): the brand crumb is a RAW `<a href="/">`
// (top-bar.tsx), which TanStack Router does NOT intercept — clicking it is a
// FULL document navigation, not client-side. So hop 2 is a RELOAD BOUNDARY, not
// a persistence hop: it verifies the persistent-layout chrome mounts correctly
// on a COLD load at `/` (route-derived host heading present after the
// reload), NOT that the bar survived without a remount. Only hops 1 and 3 test
// no-remount persistence.
//
// (The internal implementation — a single non-remounting `RootTopBar` fed by a
// route-derived mode + a page-registered slot context — is unit-tested in
// top-bar-slot-context.test.tsx and app.tsx's structure; this e2e covers the
// observable cross-route behavior.)

const SERVER = "default";
// A second mocked server with NO sessions. Its tile is the one Host-page switch
// affordance that still lands on the bare `/$server` route.
const EMPTY_SERVER = "spare";
const BOARD = "myboard";

const sessionsPayload = JSON.stringify([
  {
    name: "dev",
    windows: [
      {
        windowId: "@1",
        index: 0,
        name: "feature-work",
        worktreePath: "/tmp/wt",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: 0,
      },
    ],
  },
]);

async function mockBackend(page: Page): Promise<void> {
  await page.routeWebSocket(/\/ws\/terminals/, () => {
    /* accept, send nothing */
  });
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: SERVER, sessionCount: 1 },
        { name: EMPTY_SERVER, sessionCount: 0 },
      ]),
    }),
  );
  await page.route("**/api/boards", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: BOARD, pinCount: 1 }]),
    }),
  );
  await page.route(`**/api/boards/${BOARD}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          server: SERVER,
          windowId: "@1",
          session: "dev",
          windowIndex: 0,
          windowName: "feature-work",
          orderKey: "a0",
        },
      ]),
    }),
  );
  await mockStateSocket(page, {
    sessions: sessionsPayload,
    sessionsByServer: { [SERVER]: sessionsPayload, [EMPTY_SERVER]: "[]" },
  });
}

// The brand crumb is the always-present bar element on every mode — its
// continuous visibility across navigation is the proxy for "the bar never
// blanks out".
const brand = (page: Page) => page.getByLabel("RunKit home");

test.describe("TopBar persistence across routes (260707-4vq2)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("the persistent bar stays present and its heading updates across / → /$server → /board", async ({
    page,
  }) => {
    // Host. Solo `Host` center heading + the persistent bar's brand crumb.
    // `exact: true` disambiguates the bar's `Host` heading from the Host page's
    // `Host health` region (both are aria-labelled and `getByLabel` is a
    // substring match by default).
    await page.goto("/");
    await expect(page.getByLabel("Host", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(brand(page)).toBeVisible();

    // Hop 1: server tile (scoped to the Tmux servers region) → `/$server`. The
    // route-derived heading flips to `tmux Server <server>` (aria-label carries
    // no colon — the `:` is presentational). The bar is present immediately.
    // EMPTY_SERVER has no sessions, so the switch resolves no landing window and
    // lands on the bare server route (see the header note).
    await page
      .getByRole("region", { name: "Tmux servers" })
      .getByRole("button", { name: EMPTY_SERVER, exact: false })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${EMPTY_SERVER}$`));
    await expect(page.getByLabel(`tmux Server ${EMPTY_SERVER}`)).toBeVisible();
    await expect(brand(page)).toBeVisible();
    // The prior mode's heading is gone (mode is route-derived, not stacked).
    await expect(page.getByLabel("Host", { exact: true })).toHaveCount(0);

    // Hop 2 (RELOAD BOUNDARY, not persistence): the brand crumb is a raw
    // `<a href="/">` that TanStack Router does NOT intercept, so clicking it is
    // a FULL document navigation. We assert the persistent-layout chrome mounts
    // correctly on a cold load at `/` — route-derived `Host` heading present,
    // prior `tmux Server` heading gone — NOT that the bar survived a remount.
    await brand(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Host", { exact: true })).toBeVisible();
    await expect(brand(page)).toBeVisible();
    await expect(page.getByLabel(`tmux Server ${EMPTY_SERVER}`)).toHaveCount(0);

    // Hop 3 (client-side): board tile → `/board/$name`. The board chunk is
    // lazy, but the route-derived heading renders `Board <board>` from the URL
    // param while the chunk loads — and the bar (brand crumb) stays present
    // throughout without a remount (this IS a persistence hop).
    await page
      .getByRole("region", { name: "Boards" })
      .getByRole("button", { name: BOARD, exact: false })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/board/${BOARD}$`));
    await expect(page.getByLabel(`Board ${BOARD}`)).toBeVisible();
    await expect(brand(page)).toBeVisible();
  });

  test("a Host-page tile for a server with windows switches into that server's window", async ({
    page,
  }) => {
    // The switch counterpart of hop 1. SERVER has session `dev` with the active
    // window `@1`, so the tile resolves a landing window and navigates to the
    // terminal route — the bar follows with the `Window` heading rather than
    // `tmux Server`. The URL segment is the window id minus its `@`.
    await page.goto("/");
    await expect(page.getByLabel("Host", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page
      .getByRole("region", { name: "Tmux servers" })
      .getByRole("button", { name: SERVER, exact: false })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1$`));
    await expect(brand(page)).toBeVisible();
    // Terminal mode, not the session-tiles overview.
    await expect(page.getByLabel(`tmux Server ${SERVER}`)).toHaveCount(0);
  });

  test("an unmatched route falls back to the minimal host heading (not the fuzzy-matched board param)", async ({
    page,
  }) => {
    // `/board/x/y` fuzzy-matches the board route (`name=x`) then bubbles to the
    // app-layout route's `notFoundComponent` (NotFoundPage). TanStack Router
    // RETAINS the partially-matched param in `useMatches()`, so without the
    // not-found signal the bar would derive `board` mode and show `Board x`.
    // NotFoundPage signals not-found into the slot context, forcing the minimal
    // `host` fallback (T002 fix, R10 / A-015).
    await page.goto("/board/x/y");
    await expect(page.getByText("Page not found")).toBeVisible({ timeout: 10_000 });
    // The persistent bar is present with the host fallback heading …
    await expect(page.getByLabel("Host", { exact: true })).toBeVisible();
    await expect(brand(page)).toBeVisible();
    // … and it did NOT leak the fuzzy-matched board param as a `Board x` heading.
    await expect(page.getByLabel("Board x")).toHaveCount(0);
  });
});
