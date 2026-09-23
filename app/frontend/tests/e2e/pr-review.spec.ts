import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT } from "./_ready";
import { mockStateSocket } from "./_state-socket-mock";
import { TMUX_SERVER, createSession, killSession, windowOption } from "./_tmux";

// PR-review surface e2e (spec docs/specs/pr-review.md; the comment states come
// from docs/wiki/review-comment-states.html, which is normative for them).
//
// SHARED SETUP — two groups with deliberately different substrates:
//
//   • The RENDERING group is FULLY MOCKED: no tmux, no gh, no real backend.
//     `page.route` stubs `**/api/servers`, `**/api/windows/*/options*` (the
//     surface toggle's layout write), `**/api/pr/review*` (the list, the file
//     body, and the mutations), and `/ws/terminals`;
//     `mockStateSocket` injects a `sessions` event carrying one session `dev`
//     with two windows — @1 `with-pr` (a `prUrl`, so the surface is available)
//     and @2 `no-pr` (none, so it is unreachable). That mock is what makes the
//     surface deterministic: the real payload depends on a live pull request.
//     `openReview(page, windowIndex)` navigates to the window route and opens
//     the tile through the surface toggle.
//
//   • The ARM-STATE group runs against the REAL backend and a real tmux
//     session `e2e-prreview-<ts>` on the derived e2e socket (`beforeAll`
//     creates it, `afterAll` kills it best-effort), because `@rk_win_pr_listen`
//     is tmux state and the point of the assertion is that the option is
//     actually written — a mocked POST would prove nothing about the arm being
//     shared across viewers.
//
// Viewport is desktop (1440×800) throughout: the surface-toggle group renders
// in toggle mode only on a fine pointer at desktop width.

const SERVER = "default";
const PR_URL = "https://github.com/acme/tool/pull/7";

const REVIEW_DOCUMENT = {
  url: PR_URL,
  number: 7,
  repo: "acme/tool",
  title: "Teach the widget to widget",
  state: "open",
  headSha: "headsha",
  baseSha: "basesha",
  viewer: "me",
  listening: false,
  fetchedAt: "2026-09-19T10:00:00Z",
  files: [
    { path: "app/backend/api/widget.go", status: "modified", additions: 2, deletions: 1, hasPatch: true },
    { path: "app/frontend/src/widget.ts", status: "added", additions: 5, deletions: 0, hasPatch: true },
  ],
  threads: [
    {
      id: "T-open",
      isResolved: false,
      isOutdated: false,
      path: "app/backend/api/widget.go",
      line: 2,
      side: "RIGHT",
      comments: [
        {
          id: "C1",
          databaseId: 101,
          author: "reviewer",
          // The backtick-quoted symbol is what the diff decorates on the
          // anchored row (the TreeWalker contract, § R6).
          body: "this allocation is unnecessary \u2014 `new` allocates every call",
          createdAt: "2026-09-19T10:00:00Z",
          eyes: false,
        },
      ],
    },
    {
      id: "T-resolved",
      isResolved: true,
      isOutdated: false,
      path: "app/backend/api/widget.go",
      line: 1,
      side: "RIGHT",
      comments: [
        { id: "C2", databaseId: 102, author: "reviewer", body: "nit: naming", createdAt: "2026-09-19T10:00:00Z", eyes: true },
      ],
    },
    {
      id: "T-outdated",
      isResolved: false,
      isOutdated: true,
      path: "app/backend/api/widget.go",
      line: 3,
      side: "RIGHT",
      comments: [
        { id: "C3", databaseId: 103, author: "reviewer", body: "stale anchor", createdAt: "2026-09-19T10:00:00Z", eyes: false },
      ],
    },
    // Marked 👀 with a later reply: the chip must still read dispatched. The
    // backend predicate is 👀-on-the-first-comment only, so a reply does not
    // re-queue the thread (spec § The loop guard).
    {
      id: "T-dispatched",
      isResolved: false,
      isOutdated: false,
      path: "app/backend/api/widget.go",
      // Anchored to the DELETED row (side L, line 2) so it renders on a row of
      // its own rather than sharing one with the resolved thread.
      line: 2,
      side: "LEFT",
      comments: [
        { id: "C4", databaseId: 104, author: "reviewer", body: "hold this", createdAt: "2026-09-19T10:00:00Z", eyes: true },
        { id: "C5", databaseId: 105, author: "agent", body: "on it", createdAt: "2026-09-19T10:05:00Z", eyes: false },
      ],
    },
    // Anchored to the OTHER file so widget.go's own thread assertions stay
    // unchanged; the mocked file route serves the same body for any path.
    {
      id: "T-suggestion",
      isResolved: false,
      isOutdated: false,
      path: "app/frontend/src/widget.ts",
      line: 2,
      side: "RIGHT",
      comments: [
        {
          id: "C6",
          databaseId: 106,
          author: "reviewer",
          body: "match the other signature:\n```suggestion\n  return pooled\n```",
          createdAt: "2026-09-19T10:00:00Z",
          eyes: false,
        },
      ],
    },
  ],
};

// One hunk: a context line, a deletion, and two additions — enough to assert
// every addressing attribute including a deletion's post-image anchor.
const FILE_BODY = {
  path: "app/backend/api/widget.go",
  refine: false,
  totalLines: 3,
  headSha: "headsha",
  baseSha: "basesha",
  highlighted: true,
  rows: [
    { kind: "hunk", header: "@@ -1,2 +1,3 @@ func Widget() {", at: 1 },
    { kind: "ctx", side: "R", l: 1, left: 1, right: 1, at: 1, spans: [{ t: "func Widget() {" }] },
    { kind: "del", side: "L", l: 2, left: 2, at: 2, spans: [{ c: "k", t: "return" }, { t: " old" }] },
    { kind: "add", side: "R", l: 2, right: 2, at: 2, spans: [{ c: "k", t: "return" }, { t: " new" }] },
    { kind: "add", side: "R", l: 3, right: 3, at: 3, spans: [{ t: "}" }] },
  ],
};

// The same hunk shifted down the file: its first post-image line is 6, so the
// tile offers a leading context expander (`↑ 4 lines`). The splice test needs a
// diff that does NOT start at line 1.
const OFFSET_FILE_BODY = {
  ...FILE_BODY,
  totalLines: 7,
  rows: [
    { kind: "hunk", header: "@@ -5,2 +5,3 @@ func Widget() {", at: 5 },
    { kind: "ctx", side: "R", l: 5, left: 5, right: 5, at: 5, spans: [{ t: "func Widget() {" }] },
    { kind: "del", side: "L", l: 6, left: 6, at: 6, spans: [{ c: "k", t: "return" }, { t: " old" }] },
    { kind: "add", side: "R", l: 6, right: 6, at: 6, spans: [{ c: "k", t: "return" }, { t: " new" }] },
    { kind: "add", side: "R", l: 7, right: 7, at: 7, spans: [{ t: "}" }] },
  ],
};

function sessionsPayload() {
  return JSON.stringify([
    {
      name: "dev",
      windows: [
        {
          windowId: "@1",
          index: 0,
          name: "with-pr",
          worktreePath: "/tmp/a",
          activity: "idle",
          isActiveWindow: true,
          activityTimestamp: 0,
          prUrl: PR_URL,
          prNumber: 7,
          prState: "open",
        },
        {
          windowId: "@2",
          index: 1,
          name: "no-pr",
          worktreePath: "/tmp/b",
          activity: "idle",
          isActiveWindow: false,
          activityTimestamp: 0,
        },
      ],
    },
  ]);
}

/** Every mutation the tile can make, recorded so a test can assert the request
 *  the UI actually sent rather than a rendered side effect. */
type Recorded = { url: string; body: string };

async function mockBackend(page: Page, recorded: Recorded[]) {
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  // The toggle grows the layout through the shared `@rk_win_layout` write; the
  // mocked socket never echoes the new value back, so the tile renders from
  // app.tsx's optimistic overlay — which only applies once the POST resolves.
  await page.route("**/api/windows/*/options*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  await page.route("**/api/pr/review/file*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FILE_BODY) }),
  );
  for (const verb of ["comment", "thread", "listen", "refresh"]) {
    await page.route(`**/api/pr/review/${verb}*`, (route) => {
      recorded.push({ url: route.request().url(), body: route.request().postData() ?? "" });
      route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
  }
  // The list route is registered LAST so the more specific sub-paths above win.
  await page.route("**/api/pr/review?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(REVIEW_DOCUMENT),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsPayload() });
}

/** Navigate to a window route and open the review tile via its toggle. */
async function openReview(page: Page, windowIndex: number) {
  await page.goto(`/${SERVER}/${windowIndex}`);
  const toggle = page.getByTestId("surface-toggles").getByRole("button", { name: "Changes tile" });
  await expect(toggle).toBeVisible({ timeout: READY_TIMEOUT });
  await toggle.click();
  await expect(page.getByTestId("review-surface")).toBeVisible({ timeout: READY_TIMEOUT });
}

test.describe("review surface", () => {
  test.use({ viewport: { width: 1440, height: 800 } });

  let recorded: Recorded[] = [];
  test.beforeEach(async ({ page }) => {
    recorded = [];
    await mockBackend(page, recorded);
  });

  /**
   * Proves: the surface is PR-backed only — the toggle is offered on a window
   * whose branch resolved to a pull request, and is absent on one that did not,
   * so the tile is unreachable there.
   *
   * Steps:
   * 1. Navigate to window @1 (a `prUrl` in the payload).
   * 2. Assert the `Changes tile` toggle is present in the surface-toggle group.
   * 3. Navigate to window @2 (no `prUrl`).
   * 4. Assert the toggle is gone while the sibling toggles remain.
   */
  test("the toggle appears only for a window with a pull request", async ({ page }) => {
    await page.goto(`/${SERVER}/1`);
    const group = page.getByTestId("surface-toggles");
    await expect(group.getByRole("button", { name: "Changes tile" })).toBeVisible({
      timeout: READY_TIMEOUT,
    });

    await page.goto(`/${SERVER}/2`);
    await expect(group.getByRole("button", { name: "Terminal tile" })).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await expect(group.getByRole("button", { name: "Changes tile" })).toHaveCount(0);
  });

  /**
   * Proves: the tile mounts the PR's file list WITHOUT fetching any file body —
   * a two-hundred-file PR must render its list without tokenizing any of it —
   * and expanding one file fetches exactly that file's body.
   *
   * Steps:
   * 1. Record every `/api/pr/review/file` request the page makes.
   * 2. Open the review tile on window @1.
   * 3. Assert both file rows render and no file request has been made.
   * 4. Expand the first file and assert its diff rows appear.
   */
  test("the file list renders without fetching any body; expanding fetches one", async ({ page }) => {
    const fileRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/pr/review/file")) fileRequests.push(req.url());
    });

    await openReview(page, 1);
    const rows = page.getByTestId("review-file-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("widget.go");
    expect(fileRequests).toHaveLength(0);

    await rows.first().getByRole("button", { name: /^Expand / }).click();
    await expect(page.locator('[data-path="app/backend/api/widget.go"] [data-l]').first()).toBeVisible();
    expect(fileRequests.some((url) => url.includes("widget.go"))).toBe(true);
  });

  /**
   * Proves: every rendered code row carries GitHub's own (side, line) address,
   * and a deleted row additionally carries the post-image line it sat before —
   * the anchoring contract the comment layer and the composer both read — and
   * that decoration on such a row is non-destructive.
   *
   * Steps:
   * 1. Open the review tile and expand the first file.
   * 2. Assert the added row carries data-side="R" and data-l="2".
   * 3. Assert the deleted row carries data-side="L", data-l="2" and data-at="2".
   * 4. Assert the token spans survived into the DOM (the backend highlighted).
   * 5. Assert the thread's backtick-quoted symbol is decorated with a <mark>
   *    and the token span beside it is untouched — decoration goes through a
   *    TreeWalker over text nodes, never `innerHTML`.
   */
  test("diff rows carry the data-side / data-l / data-at anchoring contract", async ({ page }) => {
    await openReview(page, 1);
    await page.getByTestId("review-file-row").first().getByRole("button", { name: /^Expand / }).click();

    const file = page.locator('[data-path="app/backend/api/widget.go"]');
    const added = file.locator('[data-side="R"][data-l="2"]');
    await expect(added).toHaveCount(1);
    await expect(added).toContainText("return new");

    const deleted = file.locator('[data-side="L"][data-l="2"]');
    await expect(deleted).toHaveCount(1);
    await expect(deleted).toHaveAttribute("data-at", "2");

    // Backend-computed token markup reaches the DOM as spans the comment layer
    // must not destroy.
    await expect(added.locator("span.k")).toHaveCount(1);

    // Decoration is non-destructive: the thread anchored here quotes `new`, so
    // that symbol is wrapped in a <mark> BY A TreeWalker over the text nodes,
    // and the token span beside it is still there. A decorator that assigned
    // innerHTML would have destroyed it.
    await expect(added.locator("mark.rk-review-mark")).toHaveCount(1);
    await expect(added.locator("mark.rk-review-mark")).toHaveText("new");
    await expect(added.locator("span.k")).toHaveCount(1);
    await expect(added).toContainText("return new");
  });

  /**
   * Proves: the three thread states render distinguishably — an open thread is
   * expanded, a resolved one collapses behind a purple pill, and an outdated
   * one collapses behind an amber pill (they are different things and must not
   * look alike).
   *
   * Steps:
   * 1. Open the review tile and expand the first file.
   * 2. Assert the open thread's body is visible.
   * 3. Assert the resolved thread carries a `Resolved` pill.
   * 4. Assert the outdated thread carries an `Outdated` pill.
   */
  test("open, resolved and outdated threads render distinguishably", async ({ page }) => {
    await openReview(page, 1);
    await page.getByTestId("review-file-row").first().getByRole("button", { name: /^Expand / }).click();

    const open = page.locator('[data-thread-id="T-open"]');
    await expect(open).toHaveAttribute("data-thread-state", "open");
    await expect(open).toContainText("this allocation is unnecessary");

    const resolved = page.locator('[data-thread-id="T-resolved"]');
    await expect(resolved).toHaveAttribute("data-thread-state", "resolved");
    await expect(resolved.getByTestId("review-thread-pill")).toHaveText("Resolved");

    const outdated = page.locator('[data-thread-id="T-outdated"]');
    await expect(outdated).toHaveAttribute("data-thread-state", "outdated");
    await expect(outdated.getByTestId("review-thread-pill")).toHaveText("Outdated");

    // A marked thread keeps the chip even after a reply lands: the backend
    // never re-queues on one, so a "re-queued" rendering would be a lie.
    const dispatched = page.locator('[data-thread-id="T-dispatched"]');
    await expect(dispatched).toHaveAttribute("data-thread-state", "dispatched");
    await expect(dispatched.getByTestId("review-thread-pill")).toHaveText("\u2192 dispatched");
  });

  /**
   * Proves: a context expansion SPLICES into the file's diff rather than
   * replacing it — the hunk header, the deletion and the additions all survive
   * alongside the newly-fetched context lines, and the expander counts back
   * from the new first line.
   *
   * Steps:
   * 1. Re-route the file endpoint: rangeless requests answer with a diff whose
   *    first post-image line is 5; ranged requests answer with context rows for
   *    exactly the lines asked for.
   * 2. Open the tile and expand the first file.
   * 3. Assert the diff renders and offers an `↑ 4 lines` expander.
   * 4. Click it and assert the four context rows appeared AND the deletion and
   *    the additions are still rendered.
   */
  test("expanding context splices into the diff instead of replacing it", async ({ page }) => {
    await page.route("**/api/pr/review/file*", (route) => {
      const url = new URL(route.request().url());
      const start = Number(url.searchParams.get("start") ?? 0);
      const count = Number(url.searchParams.get("count") ?? 0);
      if (start > 0) {
        const rows = [];
        for (let line = start; line < start + count; line++) {
          rows.push({ kind: "ctx", side: "R", l: line, left: line, right: line, at: line, spans: [{ t: `ctx ${line}` }] });
        }
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...OFFSET_FILE_BODY, rows }),
        });
        return;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OFFSET_FILE_BODY),
      });
    });

    await openReview(page, 1);
    await page.getByTestId("review-file-row").first().getByRole("button", { name: /^Expand / }).click();

    const file = page.locator('[data-path="app/backend/api/widget.go"]');
    await expect(file.locator('[data-side="R"][data-l="6"]')).toHaveCount(1);
    const expander = page.getByRole("button", { name: "\u2191 4 lines" });
    await expect(expander).toBeVisible();

    await expander.click();
    // The fetched context landed…
    await expect(file.locator('[data-side="R"][data-l="1"]')).toHaveCount(1);
    await expect(file.locator('[data-side="R"][data-l="4"]')).toHaveCount(1);
    // …and the diff it spliced into is still there. Before the splice fix the
    // response replaced the body and every one of these vanished.
    await expect(file.locator('[data-side="L"][data-l="6"]')).toHaveCount(1);
    await expect(file.locator('[data-side="R"][data-l="6"]')).toHaveCount(1);
    await expect(file.locator('[data-side="R"][data-l="7"]')).toHaveCount(1);
  });

  /**
   * Proves: a ```suggestion fence renders as its own mini-diff with an Apply
   * button, and applying it marks the thread handled — the reason the listener
   * never spends an agent turn on a suggestion-only thread.
   *
   * Steps:
   * 1. Open the tile and expand the SECOND file (the suggestion thread anchors
   *    there).
   * 2. Assert the suggestion block renders the replacement text.
   * 3. Click *Apply suggestion*.
   * 4. Assert a resolve POST was sent for that thread.
   */
  test("a suggestion renders as a mini-diff with a working Apply button", async ({ page }) => {
    await openReview(page, 1);
    await page.getByTestId("review-file-row").nth(1).getByRole("button", { name: /^Expand / }).click();

    const thread = page.locator('[data-thread-id="T-suggestion"]');
    await expect(thread.getByTestId("review-suggestion")).toContainText("return pooled");

    await thread.getByRole("button", { name: "Apply suggestion" }).click();
    await expect.poll(() => recorded.filter((r) => r.url.includes("/thread")).length).toBeGreaterThan(0);
    const posted = JSON.parse(recorded.find((r) => r.url.includes("/thread"))!.body);
    expect(posted).toMatchObject({ window: "@1", threadId: "T-suggestion", resolved: true });
  });

  /**
   * Proves: the composer's two modes are both reachable and state their
   * different dispatch consequence, and a review-mode comment renders as a
   * LOCAL pending-review card — invisible to gh until the review is submitted,
   * which is why only the single-comment path can dispatch on post.
   *
   * Steps:
   * 1. Open the tile, expand the first file and open a composer on R2.
   * 2. Focus *Start a review* and assert the chip repaints to
   *    `⊘ on review submit`.
   * 3. Submit and assert the POST carried mode `review`.
   * 4. Assert a pending-review card renders under that line.
   */
  test("review mode states its dispatch consequence and renders a pending card", async ({ page }) => {
    await openReview(page, 1);
    await page.getByTestId("review-file-row").first().getByRole("button", { name: /^Expand / }).click();
    await page.getByRole("button", { name: "Comment on R2" }).click();

    const composer = page.getByTestId("review-composer");
    const chip = composer.getByTestId("review-composer-dispatch-chip");
    await expect(chip).toHaveText("\u26a1 dispatch on post");

    await composer.getByRole("textbox").fill("batch this one");
    await composer.getByRole("button", { name: "Start a review" }).focus();
    await expect(chip).toHaveText("\u2298 on review submit");

    await composer.getByRole("button", { name: "Start a review" }).click();
    await expect.poll(() => recorded.filter((r) => r.url.includes("/comment")).length).toBeGreaterThan(0);
    const posted = JSON.parse(recorded.find((r) => r.url.includes("/comment"))!.body);
    expect(posted).toMatchObject({ mode: "review", body: "batch this one" });

    const pendingCard = page.getByTestId("review-pending-comment");
    await expect(pendingCard).toHaveCount(1);
    await expect(pendingCard).toContainText("batch this one");
    await expect(pendingCard).toContainText("pending review");
  });

  /**
   * Proves: the composer anchors under its line, names the side+line it will
   * post against, and states the dispatch consequence of its two modes — only
   * *Add single comment* can dispatch on post, because a pending review is
   * invisible to gh until submitted.
   *
   * Steps:
   * 1. Open the review tile and expand the first file.
   * 2. Click the added row's `+` gutter affordance.
   * 3. Assert the composer's header reads `Comment on R2` and its chip reads
   *    `⚡ dispatch on post`.
   * 4. Type a body, submit with *Add single comment*, and assert the POST body
   *    carried the path, the line, the side and mode `single`.
   */
  test("the composer anchors to its line and posts a single comment", async ({ page }) => {
    await openReview(page, 1);
    await page.getByTestId("review-file-row").first().getByRole("button", { name: /^Expand / }).click();

    await page.getByRole("button", { name: "Comment on R2" }).click();
    const composer = page.getByTestId("review-composer");
    await expect(composer.getByTestId("review-composer-ref")).toHaveText("Comment on R2");
    await expect(composer.getByTestId("review-composer-dispatch-chip")).toHaveText("⚡ dispatch on post");

    await composer.getByRole("textbox").fill("please use the pooled buffer");
    await composer.getByRole("button", { name: "Add single comment" }).click();

    await expect
      .poll(() => recorded.filter((r) => r.url.includes("/comment")).length)
      .toBeGreaterThan(0);
    const posted = JSON.parse(recorded.find((r) => r.url.includes("/comment"))!.body);
    expect(posted).toMatchObject({
      window: "@1",
      path: "app/backend/api/widget.go",
      line: 2,
      side: "R",
      mode: "single",
      body: "please use the pooled buffer",
    });
  });

  /**
   * Proves: the tile's listener arm is reachable from the command palette —
   * Constitution V's requirement that every verb has a palette entry, which is
   * load-bearing here because the tile's own affordances are pointer-first.
   *
   * Steps:
   * 1. Open the review tile so the surface publishes its verb seams.
   * 2. Open the command palette and type `Review: Listen`.
   * 3. Press Enter and assert a listen POST was sent with `listening: true`.
   */
  test("the listener arm is reachable from the command palette", async ({ page }) => {
    await openReview(page, 1);
    const input = page.getByPlaceholder("Type a command");
    await page.keyboard.press("Shift+Control+k");
    await expect(input).toBeVisible({ timeout: READY_TIMEOUT });
    await input.fill("Review: Listen");
    await page.keyboard.press("Enter");

    await expect.poll(() => recorded.filter((r) => r.url.includes("/listen")).length).toBeGreaterThan(0);
    const posted = JSON.parse(recorded.find((r) => r.url.includes("/listen"))!.body);
    expect(posted).toMatchObject({ window: "@1", listening: true });
  });

  /**
   * Proves: the changed files also render as a directory tree beside the diff,
   * that the tree navigates without opening or fetching anything, and that the
   * header toggle beside the listen control hides and restores it.
   *
   * Steps:
   * 1. Open the review tile and assert the tree panel is present by default.
   * 2. Assert single-child directory runs are collapsed into one row
   *    (`app` branches, so `backend/api` and `frontend/src` are single rows).
   * 3. Open a directory and click a file; assert it becomes the selected row.
   * 4. Click the tree toggle and assert the panel goes away, then returns.
   */
  test("the file tree maps the PR and its toggle sits beside listen", async ({ page }) => {
    await openReview(page, 1);

    const panel = page.getByTestId("review-tree-panel");
    await expect(panel).toBeVisible();

    // `app` branches into two subtrees, so it keeps its own row; each branch
    // then compresses to a single row rather than one indent per segment.
    const dirs = page.getByTestId("review-tree-dir");
    await expect(dirs.filter({ hasText: "app" }).first()).toBeVisible();

    await dirs.filter({ hasText: "app" }).first().click();
    await expect(page.getByTestId("review-tree-dir").filter({ hasText: "backend/api" })).toBeVisible();

    await page.getByTestId("review-tree-dir").filter({ hasText: "backend/api" }).click();
    const leaf = page.getByTestId("review-tree-file").filter({ hasText: "widget.go" }).first();
    await leaf.click();
    await expect(leaf).toHaveAttribute("aria-current", "true");

    const toggle = page.getByRole("button", { name: "Toggle the file tree" });
    await toggle.click();
    await expect(panel).toHaveCount(0);
    await toggle.click();
    await expect(page.getByTestId("review-tree-panel")).toBeVisible();
  });

});

test.describe("review listener arm state", () => {
  test.use({ viewport: { width: 1440, height: 800 } });

  const SESSION = `e2e-prreview-${Date.now()}`;
  let windowId = "";

  test.beforeAll(() => {
    createSession(SESSION, { server: TMUX_SERVER, windows: [{ name: "listen" }] });
  });
  test.afterAll(() => {
    try {
      killSession(SESSION, { server: TMUX_SERVER });
    } catch {
      /* best effort — a failed teardown must not fail the run */
    }
  });

  /**
   * Proves: arming the listener writes the `@rk_win_pr_listen` tmux window
   * option and disarming clears it — the arm is SHARED tab state, not a
   * per-viewer posture, so it has to land in tmux where every viewer reads it.
   *
   * Steps:
   * 1. Resolve the real window id of the tmux session created in `beforeAll`.
   * 2. POST `/api/pr/review/listen` with `listening: true` against the real
   *    backend.
   * 3. Read the option back out of tmux and assert it is `1`.
   * 4. POST again with `listening: false` and assert the option is cleared.
   */
  test("arming writes @rk_win_pr_listen and disarming clears it", async ({ page, request }) => {
    await page.goto(`/${TMUX_SERVER}`);
    windowId = await page.evaluate(async (server: string) => {
      const res = await fetch(`/api/sessions?server=${encodeURIComponent(server)}`);
      const sessions = (await res.json()) as {
        name: string;
        windows: { windowId: string; name: string }[];
      }[];
      const session = sessions.find((s) => s.name.startsWith("e2e-prreview-"));
      return session?.windows[0]?.windowId ?? "";
    }, TMUX_SERVER);
    expect(windowId).toMatch(/^@\d+$/);

    const listen = (listening: boolean) =>
      request.post(`/api/pr/review/listen?server=${encodeURIComponent(TMUX_SERVER)}`, {
        data: { window: windowId, listening },
      });

    expect((await listen(true)).ok()).toBe(true);
    await expect
      .poll(() => windowOption(windowId, "@rk_win_pr_listen", { server: TMUX_SERVER }))
      .toBe("1");

    expect((await listen(false)).ok()).toBe(true);
    await expect
      .poll(() => windowOption(windowId, "@rk_win_pr_listen", { server: TMUX_SERVER }))
      .toBe("");
  });
});
