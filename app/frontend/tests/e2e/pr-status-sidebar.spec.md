# pr-status-sidebar.spec.ts

Verifies the sidebar's live PR-status line: it renders for a change-bound window
that has a PR and is hidden for a scratch window, at both mobile and desktop
viewports.

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
      `prReview: approved` (the gate is satisfied).
    - `@2` "scratch-shell" — no `fabChange` (the gate fails).
- `beforeEach` installs both routes before navigation.

## Tests

### `renders the PR line for a change-bound window and hides it for a scratch window`

**What it proves:** the display gate is `fabChange && prNumber` — a change-bound
window with a PR shows the line (with the PR number, state, and an external link
to the PR URL), while a scratch window shows nothing.

**Steps:**
1. Navigate to `/default`.
2. Assert the Sessions nav is visible.
3. In the `@1` row, assert the `pr-status-line` is visible and contains
   `PR #386` and `open`.
4. Assert the `pr-status-link` anchor has `href` = the PR URL and
   `target="_blank"`.
5. In the `@2` row, assert there is no `pr-status-line` (count 0).

### `PR line renders at 375px (mobile) and 1024px (desktop)`

**What it proves:** the PR line is present and readable at both the mobile
(375px) and desktop (1024px) breakpoints — covering the responsive requirement.

**Steps:**
1. Set viewport to 375×812 and navigate to `/default`.
2. Open the mobile sidebar drawer via the top-bar `Toggle navigation` button.
3. Assert the `@1` row's `pr-status-line` contains `PR #386` inside the mobile
   Sessions nav.
4. Set viewport to 1024×800 and reload `/default`.
5. Assert the `@1` row's `pr-status-line` contains `PR #386` in the desktop
   sidebar.
