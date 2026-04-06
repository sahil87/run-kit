# Spec: Shorten CWD in Status Panel

**Change**: 260406-65f1-shorten-cwd-status-panel
**Created**: 2026-04-06
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Changing the layout, height, or CSS of the `StatusPanel` component
- Adding a user-configurable truncation preference
- Modifying how the `title` attribute (hover tooltip) displays the path — it always shows the full original `cwd`

## Status Panel: CWD Display Shortening

### Requirement: Home Directory Substitution

The `shortenPath` function in `app/frontend/src/components/sidebar/status-panel.tsx` SHALL replace the user's home directory prefix with `~`. The following prefixes MUST be recognized:

- `/home/<username>/` (Linux)
- `/Users/<username>/` (macOS)
- `/root/` (Linux root user)
- Exact matches `/home/<username>`, `/Users/<username>`, `/root` (no trailing slash) SHALL produce `~`

The username segment is the first path component after `/home/` or `/Users/` — any value is accepted (no hardcoding).

#### Scenario: Linux home prefix substituted

- **GIVEN** the active pane's cwd is `/home/sahil/code/run-kit`
- **WHEN** `shortenPath` processes the path
- **THEN** the result begins with `~` (i.e., `~/code/run-kit`)

#### Scenario: macOS home prefix substituted

- **GIVEN** the active pane's cwd is `/Users/john/projects/myapp`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `~/projects/myapp`

#### Scenario: Root home prefix substituted

- **GIVEN** the active pane's cwd is `/root/scripts`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `~/scripts`

#### Scenario: Exact home directory

- **GIVEN** the active pane's cwd is `/home/sahil` (no trailing slash, no subdirectory)
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `~`

#### Scenario: Non-home path unchanged by substitution

- **GIVEN** the active pane's cwd is `/var/log/nginx`
- **WHEN** `shortenPath` processes the path
- **THEN** no `~` substitution occurs (path is passed to truncation step as-is)

---

### Requirement: Last-Two-Segments Truncation

After home substitution, `shortenPath` SHALL truncate paths that have more than 2 non-empty path segments to show only the last 2 segments, prefixed with `…/`.

Segment counting rules:
- For `~`-prefixed results: count non-empty segments in the portion after `~/`
- For non-`~` absolute paths: count non-empty segments (i.e., split on `/`, filter empty strings)
- Paths with exactly 0, 1, or 2 segments SHALL NOT be truncated

#### Scenario: Deep home path truncated

- **GIVEN** the active pane's cwd is `/home/sahil/code/org/repo/src`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `…/repo/src` (home substitution yields `~/code/org/repo/src` → 4 segments → truncated)

#### Scenario: Two-segment home path not truncated

- **GIVEN** the active pane's cwd is `/home/sahil/code/org`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `~/code/org` (2 segments — no truncation)

#### Scenario: Three-segment home path truncated

- **GIVEN** the active pane's cwd is `/home/sahil/code/org/repo`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `…/org/repo` (3 segments → truncated)

#### Scenario: Deep non-home path truncated

- **GIVEN** the active pane's cwd is `/var/log/nginx/access`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `…/nginx/access` (4 segments → truncated)

#### Scenario: Short non-home path not truncated

- **GIVEN** the active pane's cwd is `/tmp`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `/tmp` (1 segment — no truncation)

#### Scenario: Three-segment non-home path truncated

- **GIVEN** the active pane's cwd is `/var/log/nginx`
- **WHEN** `shortenPath` processes the path
- **THEN** the result is `…/log/nginx` (3 segments → truncated)

---

### Requirement: Full Path on Hover Preserved

The `title` attribute on the cwd display element SHALL continue to receive the original, unmodified `activePaneCwd` value. The shortening logic applies only to the visible text — not to the hover tooltip.

#### Scenario: Hover shows full path

- **GIVEN** the cwd is `/home/sahil/code/org/repo/src`
- **WHEN** the user hovers the cwd line in the status panel
- **THEN** the full path `/home/sahil/code/org/repo/src` is shown in the tooltip (title attribute)
- **AND** the visible text shows `…/repo/src`

---

### Requirement: Test Coverage

The `shortenPath` function MUST have unit tests in `app/frontend/src/components/sidebar/status-panel.test.tsx` covering:
- Linux home substitution
- macOS home substitution
- Exact home directory match (yields `~`)
- Truncation of paths with >2 segments
- No truncation for paths with ≤2 segments
- Non-home paths (no `~` substitution, but may be truncated)

Existing tests that rely on the current `shortenPath` behavior SHALL be updated to match the new behavior.

---

## Design Decisions

1. **Truncation after substitution, not before**: Home substitution runs first, then segment-count is evaluated. This means `~/a/b/c` (3 segments after `~`) gets truncated to `…/b/c`, which is more useful than truncating the raw path first.
   - *Why*: The user-visible anchor is `~` (home); segments relative to home are the meaningful units. Truncation on the post-substituted form gives the most navigable result.
   - *Rejected*: Truncating the raw path and then substituting would produce confusing results for paths like `/home/sahil/code/org/repo` → truncated to `/org/repo` (wrong, loses home context).

2. **`…/` as truncation prefix**: Uses Unicode ellipsis (`…`, U+2026) followed by `/`.
   - *Why*: Consistent with filesystem UI conventions. Single character is more compact than `...`.
   - *Rejected*: `...` (three ASCII dots) — more characters, less idiomatic in UI contexts.

3. **No change to `title` attribute**: The original path is preserved in the hover tooltip.
   - *Why*: The user can always see the full path on hover. No information is lost. This is already implemented and working.
   - *Rejected*: Showing a shortened path in the tooltip too — would remove the escape hatch for seeing the full path.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix covers Linux `/home/` and macOS `/Users/` prefixes | Both are standard home prefixes; codebase runs on both; confirmed from intake #1 | S:90 R:95 A:95 D:90 |
| 2 | Certain | Truncation threshold is >2 non-empty segments | User said "last two folders" — unambiguous; confirmed from intake #2; design decision locks this in | S:90 R:90 A:90 D:90 |
| 3 | Certain | Truncation prefix is `…/` (Unicode ellipsis + slash) | Confirmed from intake #3; no competing convention in codebase; design decision adopted | S:80 R:90 A:90 D:90 |
| 4 | Certain | `title` attribute retains full path on hover | Already implemented; no change needed; confirmed from intake #4 | S:95 R:95 A:95 D:95 |
| 5 | Certain | Only `shortenPath` function changes — no layout or CSS changes | Confirmed from intake #5; CSS `truncate` already handles overflow safely | S:85 R:90 A:95 D:90 |
| 6 | Certain | Truncation applied after home substitution | Design decision: preserves home-relative segment semantics; no ambiguity | S:90 R:90 A:95 D:90 |
| 7 | Certain | `/root` (root user home) should also be substituted with `~` | <!-- clarified: Resolved — requirement body already lists /root as a SHALL requirement; consistent with Linux convention and explicitly confirmed in intake #1; grade promoted to Certain --> Promoted from Confident: explicitly listed as SHALL in requirement body and confirmed in intake | S:90 R:90 A:90 D:90 |

7 assumptions (7 certain, 0 confident, 0 tentative, 0 unresolved).
