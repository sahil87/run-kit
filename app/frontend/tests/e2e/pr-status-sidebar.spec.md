# pr-status-sidebar.spec.ts

Verifies the **Pane panel's** live PR-status row: it renders for a change-bound
window that has a PR and is hidden for a scratch window, at both mobile and
desktop viewports. (PR status lives in the per-window Pane panel — not on the
window-tree rows — so each test selects the target window, then reads the panel.)

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The isolated
  e2e tmux server has no change-bound PRs and `gh` is unavailable in CI, so the
  spec injects the data via `page.route`:
  - `**/api/servers` → a single server `default` (so the app attaches exactly
    one SSE connection).
  - `**/api/sessions/stream*` → one `event: sessions` frame whose payload is a
    session `dev` with two windows:
    - `@1` "feature-work" — change-bound (`fabChange` set) with
      `prNumber: 386`, `prUrl`, `prState: open`, `prChecks: pass`,
      `prReview: approved` (the gate is satisfied). `@1` is the active window,
      so the Pane panel reflects it on load.
    - `@2` "scratch-shell" — no `fabChange` (the gate fails).
- `beforeEach` installs both routes before navigation.

## Tests

### `Pane panel shows the PR row for a change-bound window and hides it for a scratch window`

**What it proves:** the display gate is `fabChange && prNumber` — when the
selected window is change-bound with a PR, the Pane panel shows the `pr` row
(open-first: the row body is an open-in-new-tab link to the PR, titled with the
PR URL, with copy role-swapped to a hover-revealed icon — see change 41ks);
when the selected window is a scratch window, no PR row appears. (This spec
locates the row by its `[title]` = PR URL, which is element-type-agnostic, so
it matches the anchor unchanged.)

**Steps:**
1. Navigate directly to the change-bound window route `/default/%401` (`@1`,
   percent-encoded) — the Pane panel reflects the URL-selected window.
2. Assert the Pane panel's pr row — the element titled with the PR URL — is
   visible and contains `#386` and `open`.
3. Navigate to the scratch window route `/default/%402` (`@2`).
4. Assert no element is titled with the PR URL (count 0) and no `#386` text
   appears anywhere in the Pane panel.

### `Pane panel PR row renders at 375px (mobile) and 1024px (desktop)`

**What it proves:** the Pane panel's PR row is present and readable at both the
mobile (375px) and desktop (1024px) breakpoints — covering the responsive
requirement.

**Steps:**
1. Set viewport to 375×812 and navigate to the change-bound window route
   `/default/%401` (`@1`).
2. Open the mobile sidebar drawer (which hosts the Pane panel) via the top-bar
   `Toggle navigation` button.
3. Assert the pr row (titled with the PR URL) contains `#386`.
4. Set viewport to 1024×800 and navigate to `/default/%401` again.
5. Assert the pr row (titled with the PR URL) contains `#386` in the persistent
   desktop sidebar.
