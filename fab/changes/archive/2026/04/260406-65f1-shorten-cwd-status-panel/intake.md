# Intake: Shorten CWD in Status Panel

**Change**: 260406-65f1-shorten-cwd-status-panel
**Created**: 2026-04-06
**Status**: Draft

## Origin

> The cwd line in the left panel status bar is too long sometimes - can we shorten it in some ways. Eg: Use ~ instead of home. Restrict to last two folder in case it goes beyond the length of the left panel

One-shot request. The user wants the `cwd` display in the sidebar's `StatusPanel` component shortened via two strategies: home directory substitution with `~`, and fallback truncation to the last two path segments when the path is still long.

## Why

The sidebar's status panel (`StatusPanel` component, left panel bottom) shows the current working directory on line 1. On Linux systems — where home directories live under `/home/<username>/` — the existing `shortenPath` function doesn't replace the home prefix with `~` (it only handles macOS `/Users/`). On any OS, deeply nested paths like `/home/sahil/code/org/repo/src/deeply/nested/feature` can still overflow the truncated display area, making it hard to orient quickly.

If left unfixed: the cwd line is almost always unhelpful on Linux (full absolute path shown), and long paths still overflow even on macOS after home substitution.

## What Changes

### 1. Fix `shortenPath` to handle Linux `/home/` prefix

The current implementation in `app/frontend/src/components/sidebar/status-panel.tsx`:

```ts
function shortenPath(cwd: string): string {
  const home = "/Users/";
  if (cwd.startsWith(home)) {
    const rest = cwd.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) return "~" + rest.slice(slash);
    return "~";
  }
  return cwd;
}
```

This needs to be replaced to handle both:
- macOS: `/Users/<username>/` → `~/<rest>`
- Linux: `/home/<username>/` → `~/<rest>`
- Root home: `/root/` → `~/<rest>`
- Exact home dir match (no trailing slash): `/home/sahil` → `~`

The replacement logic should be:
1. Try both `/Users/` and `/home/` prefixes
2. Strip prefix + username segment to arrive at `~/<rest>` or just `~` if at the home dir root

### 2. Add last-two-segments fallback

After home substitution, if the resulting path still has more than 2 segments (i.e., more than one `/` in the non-`~` portion), truncate to show only the last two directory segments, prefixed with `…/`:

Examples:
- `/home/sahil/code/org/repo` → `~/code/org/repo` → `…/org/repo`
- `~/code/sahil87/run-kit` → no truncation (2 segments after `~`)
- `~/code/sahil87/run-kit/app/frontend/src` → `…/frontend/src`
- `/var/log/nginx/access` → `…/nginx/access` (no home prefix, still truncate)

The threshold for truncation is: more than 2 path segments total (counting from the leftmost non-`~` segment).

**Exact behavior spec:**
```
shortenPath("/home/sahil/code/org/repo/src")  → "…/repo/src"
shortenPath("/home/sahil/code/org")           → "~/code/org"  (2 segs, no truncation)
shortenPath("/home/sahil")                    → "~"
shortenPath("/Users/john/projects/myapp")     → "~/projects/myapp"  (2 segs)
shortenPath("/Users/john/a/b/c/d")            → "…/c/d"
shortenPath("/var/log/nginx")                 → "/var/log/nginx"  (3 segs, truncate: "…/log/nginx")
shortenPath("/tmp")                           → "/tmp"  (1 seg, no truncation)
```

Wait — let me refine: truncation applies when the path (after home substitution) has **more than 2 segments after the root**. For `~`-prefixed paths, segments are counted after `~`. For absolute paths without `~`, segments are the non-empty parts after splitting on `/`.

Simpler rule: split the final path on `/`, if there are more than 2 non-empty segments, keep only the last 2 and prefix with `…/`.

Examples with this rule:
- `~/code/org/repo` → segments after `~`: `code`, `org`, `repo` → 3 > 2 → `…/org/repo`
- `~/code/org` → 2 segments → `~/code/org` (no change)
- `/var/log/nginx/access` → 4 segments → `…/nginx/access`
- `/tmp` → 1 segment → `/tmp`

The `title` attribute already shows the full path on hover (line 71 in the current code), so users can always recover the full path.

### 3. No UI changes

The `cwd` display element already has `truncate` class as a CSS safety net. The `title={activePaneCwd}` shows full path on hover. Only the `shortenPath` function changes.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update status panel CWD display behavior — note the `~` substitution and last-two-segments truncation in the cwd line

## Impact

- `app/frontend/src/components/sidebar/status-panel.tsx` — `shortenPath` function rewrite (~10 lines)
- `app/frontend/src/components/sidebar/status-panel.test.tsx` — update/add test cases for new behavior

## Open Questions

- None. The behavior is fully specified by the user's description and the existing code patterns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix covers Linux `/home/` and macOS `/Users/` prefixes | Both are standard home prefixes; `/root/` also covered for completeness | S:90 R:95 A:95 D:90 |
| 2 | Confident | Truncation threshold is >2 segments after home substitution | User said "last two folders" — straightforward; 2 segments is the natural interpretation | S:85 R:90 A:85 D:85 |
| 3 | Confident | Truncation prefix is `…/` (ellipsis + slash) | Consistent with UI conventions for truncated paths; `…` signals omitted prefix | S:75 R:90 A:80 D:85 |
| 4 | Certain | `title` attribute retains full path on hover (no change needed) | Already implemented in current code; user didn't ask to remove it | S:95 R:95 A:95 D:95 |
| 5 | Confident | Only `shortenPath` function changes — no layout or CSS changes | CSS `truncate` class already handles overflow; user's request is purely about the text content | S:80 R:90 A:90 D:85 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
