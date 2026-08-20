# Intake: Consolidate Home-Path Abbreviation

**Change**: 260816-momh-consolidate-home-path-abbreviation
**Created**: 2026-08-17

## Origin

Promptless dispatch via `/fab-proceed` (2026-08-17). Originates as a **should-fix finding from PR #618's fab review** (change `xb77`, the sidebar session identity tip), verified still present on `origin/main` HEAD `3e7c6b91` and re-verified in this worktree at intake time. The conversation preceding dispatch agreed on the exact consolidation approach (see What Changes).

> Chore: consolidate the duplicated home-directory path-abbreviation logic into one shared helper. Two implementations of the same "$HOME → ~" substitution exist — `abbreviateHomePath` in `app/frontend/src/lib/format.ts` and the private `HOME_PATTERNS` list inside `shortenPath` in `app/frontend/src/components/sidebar/status-panel.tsx` — and they already diverge (`/root` coverage). Extract one shared helper in `lib/format.ts`, fold `/root` in with boundary semantics, have `shortenPath` delegate its step-1 substitution, delete `HOME_PATTERNS`.

## Why

1. **The pain point**: two independent implementations of the same "$HOME → ~" display substitution exist in the frontend, and they have already drifted:
   - `app/frontend/src/lib/format.ts:27` — exported `abbreviateHomePath(path)`, regex `/^\/(?:home|Users)\/[^/]+(?=\/|$)/`, replaces the matched prefix with `~`. Introduced by change `xb77` (PR #618) for the session identity tip. Sole consumer: `components/sidebar/session-row.tsx:135`. Covered by `lib/format.test.ts`.
   - `app/frontend/src/components/sidebar/status-panel.tsx:40` — private `HOME_PATTERNS = [/^\/home\/[^/]+/, /^\/Users\/[^/]+/, /^\/root(?=\/|$)/]`, applied as step 1 inside `shortenPath(cwd)` (step 2 is a keep-last-2-segments truncation).
2. **The observable defect**: `HOME_PATTERNS` additionally covers `/root`, so a `/root/...` cwd renders as `~/...` in the PANE panel's cwd row but raw (`/root/...`) in the session identity tip — the same path, two renderings, one sidebar. There is also a boundary-semantics divergence: `abbreviateHomePath` requires a segment boundary after the user segment via `(?=\/|$)`; `HOME_PATTERNS`' `/home` and `/Users` arms have no such lookahead (only its `/root` arm does).
3. **If unfixed**: the two pattern sets keep drifting — any future prefix addition (or fix) lands in one place and not the other, and this exact class of divergence recurs. This is the `code-quality.md` anti-pattern "Duplicating existing utilities" made concrete.
4. **Why this approach**: `lib/format.ts` is the established shared-format home and already exports the better-specified (boundary-checked) implementation with tests; folding `/root` into it and making `shortenPath` a delegating consumer is the smallest change that leaves exactly one owner of the substitution.

## What Changes

### 1. `app/frontend/src/lib/format.ts` — fold `/root` into `abbreviateHomePath`

Extend the exported `abbreviateHomePath` (keep its name and location) to cover all three home prefixes — `/home/<user>`, `/Users/<user>`, and `/root` — **preserving the `(?=\/|$)` segment-boundary semantics for all three**. Current implementation for reference:

```ts
export function abbreviateHomePath(path: string): string {
  const m = /^\/(?:home|Users)\/[^/]+(?=\/|$)/.exec(path);
  return m ? `~${path.slice(m[0].length)}` : path;
}
```

Target behavior (exact-match table):

| Input | Output |
|-------|--------|
| `/home/sahil/code/x` | `~/code/x` |
| `/Users/sahil/code/x` | `~/code/x` |
| `/root/x` | `~/x` |
| `/root` | `~` |
| `/home/u` (bare home) | `~` |
| `/rootfs/x` | `/rootfs/x` (no match — boundary) |
| `/homeless/dir` | `/homeless/dir` (no match) |
| `/srv/data` | `/srv/data` (pass-through) |
| `/home` | `/home` (no user segment) |

The boundary-checked form is the more correct one and introduces **no loosening anywhere**: `/roots/...` does not match `HOME_PATTERNS`' `/root` arm today either (it already carries the lookahead), and `/home/userx`-style names must abbreviate only at a segment boundary — which `abbreviateHomePath` already enforces and `HOME_PATTERNS`' `/home`//`/Users` arms merely happened not to be caught out by (`[^/]+` is greedy to the next `/`, so real absolute paths behaved identically). Behavior only becomes MORE correct, never looser. Update the function's doc comment to mention `/root`.

### 2. `app/frontend/src/components/sidebar/status-panel.tsx` — `shortenPath` delegates step 1

- Delete the `HOME_PATTERNS` constant (line 40).
- `shortenPath(cwd)` calls `abbreviateHomePath(cwd)` (imported from `@/lib/format` — the file already imports `parseFabChange` from there) for its step-1 home substitution.
- Step 2 (keep-last-2-segments truncation, the `…/a/b` form) stays **locally in `shortenPath`, byte-for-byte unchanged in behavior**. `shortenPath` remains private to status-panel.tsx.

Net effect: the identity tip gains `/root` coverage (divergence closed); the PANE panel cwd row behavior is unchanged for all real inputs.

### 3. Tests

- **Extend `app/frontend/src/lib/format.test.ts`** (table-driven `cases` array already in place) with `/root` and boundary cases: `/root` → `~`, `/root/x` → `~/x`, `/rootfs/x` → no match, plus keep the existing `/home/u` bare-home and `/srv/data` pass-through rows (already present).
- **`status-panel.test.tsx` must stay green unmodified** — `shortenPath` observable behavior is preserved.
- No e2e — unit coverage suffices; there is no user-visible surface change except the `/root` identity-tip fix, which the format unit tests pin.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) light touch — the identity-tip line already cites `lib/format.ts` `abbreviateHomePath`; note that the helper now also covers `/root` and is the single shared home-substitution owner, consumed by `shortenPath` (PANE panel cwd row) as well. If hydrate judges the existing line still accurate as written, a no-op is acceptable.

## Impact

- **Frontend-only**, ~15 lines net across two source files + one test file:
  - `app/frontend/src/lib/format.ts` (regex + doc comment)
  - `app/frontend/src/components/sidebar/status-panel.tsx` (delete `HOME_PATTERNS`, delegate step 1)
  - `app/frontend/src/lib/format.test.ts` (new table rows)
- **Do NOT touch** `app/frontend/src/components/sidebar/session-row.tsx` — its call site (line 135) already uses the shared helper.
- No backend, no routes, no API, no e2e specs (hence no `.spec.md` obligations).
- Verification: `just test-frontend` (Vitest) + `cd app/frontend && npx tsc --noEmit`. Existing `status-panel.test.tsx` and `format.test.ts` suites are the regression net.

## Open Questions

None — the approach, target semantics, and scope guardrails were fully agreed in the originating conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The shared helper keeps the exported name/location `abbreviateHomePath` in `lib/format.ts`; `status-panel.tsx` imports it | Discussed — agreed in conversation; format.ts is the established shared-format home with existing tests | S:95 R:85 A:90 D:90 |
| 2 | Certain | All three prefixes (`/home/<user>`, `/Users/<user>`, `/root`) carry the segment-boundary lookahead (slash-or-end, as in format.ts today) | Discussed — boundary form is strictly more correct; verified no real input regresses (`/roots/...` never matched the old arm either) | S:90 R:90 A:90 D:85 |
| 3 | Certain | `shortenPath` keeps its step-2 truncation locally and stays private; only step 1 delegates; `HOME_PATTERNS` is deleted | Discussed — explicit in the agreed fix; truncation behavior change is out of scope | S:95 R:90 A:90 D:90 |
| 4 | Certain | The only behavior delta is the identity tip gaining `/root` coverage; PANE panel output unchanged for all real inputs | Verified at intake against format.ts:27, status-panel.tsx:40, session-row.tsx:135 on this worktree | S:85 R:80 A:85 D:80 |
| 5 | Confident | Unit tests only, no Playwright e2e | Discussed — code-quality's "UI changes SHOULD include e2e" is a SHOULD; no layout/interaction change exists to exercise, and the `/root` fix is pinned by format unit tests | S:80 R:85 A:75 D:70 |
| 6 | Confident | Exact implementation shape of the merged matcher (single alternation regex vs. small internal pattern list) is left to apply | Either satisfies the behavior table; single-regex extension of the existing form is the likely minimal edit | S:60 R:90 A:85 D:75 |
| 7 | Confident | Memory impact limited to a light `run-kit/ui/sidebar` touch (or a justified no-op) | The documented tip line already names the helper; no spec-level contract changes | S:65 R:90 A:75 D:75 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
