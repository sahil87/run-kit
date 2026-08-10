# Intake: Closed PR Row Glyph

**Change**: 260810-xuej-closed-pr-row-glyph
**Created**: 2026-08-10

## Origin

Conversational — grew out of a `/fab-discuss` session investigating "why are the red glyphs missing" in a sidebar screenshot. The investigation established that the row's rest-state PR glyph deliberately excludes closed PRs (`prOwnsGlyph` is a positive `open`/`merged` allowlist), so the window `rvza-kimi` with `pr #570 · closed (draft)` rendered no glyph at all — while the PANE panel showed `closed` in red via the separate `PR_STATE_COLORS` text vocabulary.

> User: "hmm... any idea if we can show a closed PR? Check only for popular PR glyph color codes, so there's not a lot of learning curve"

Key decisions from the conversation:

- Adopt **GitHub's canonical PR vocabulary** (mirrored by `gh`, VS Code's GitHub extension, Graphite): open=green `git-pull-request`, draft=gray `git-pull-request-draft`, merged=purple `git-merge`, **closed=red `git-pull-request-closed`** (PR silhouette with an ✕).
- The color channel alone cannot carry closed: red is already taken by fail-ish open PRs (failing checks / changes requested). GitHub's own disambiguator is **shape, not color** — closed gets a distinct icon. Red-✕-icon = closed; red-normal-icon = failing.
- Anti-clutter tradeoff acknowledged: the original "closed never earns the glyph" rule kept dead PRs from lighting up red. A muted-gray closed-icon variant ("shape says closed, color says dead — ignore") was presented alongside the red proposal in the design mock. **User reviewed the mock and chose the muted variant** ("muted is ok"): closed = `text-text-secondary` + the distinct closed ✕ icon. The ✕ shape alone separates closed from draft (both use the inert gray token).
- User also directed (at go-ahead): **update the compositional reference SVG** — `docs/img/status-dot-reference.svg`, linked from `docs/site/status-dot.md` — whose glyph strip still reads "draft · closed → none".
- A **dot-mock design page** (from a previous session's scratchpad, previously served on port 8742) is copied into this change folder as `dot-mock/` and updated to show the proposed closed-PR glyph states; the user reviews the proposal there before apply.

## Why

1. **Pain point**: A window whose PR was closed unmerged shows *no* rest-state PR indicator. In the screenshot that seeded this change, `rvza-kimi`'s closed PR #570 was invisible in the sidebar — the user had to select the row and read the PANE panel to learn the PR is dead. Closed-unmerged is an outcome worth a glance-level signal: it usually means "this branch's PR was rejected/abandoned — the window needs a decision (rework, re-open, or kill)".
2. **Consequence of not fixing**: The glyph vocabulary stays a partial map of PR reality. Users who know a PR exists for a row read "no glyph" as "no PR" — a closed PR is indistinguishable from never having had one, which actively misleads during triage.
3. **Why this approach**: Extending the existing single-icon five-color glyph with GitHub's own closed state (red + distinct `git-pull-request-closed` icon) has zero learning curve — every GitHub user already reads that icon+color pair as "closed". Alternatives rejected: (a) closed→red on the *same* icon — collides with fail-ish red, GitHub never colors the plain PR icon red; (b) leaving closed glyph-less (status quo) — the misleading gap above; (c) a new color outside the popular vocabulary — learning curve the user explicitly ruled out.

## What Changes

### 1. `prOwnsGlyph` admits `closed` (`app/frontend/src/components/pr-status-model.ts`)

The gate stays a **positive allowlist** (this shape is load-bearing: the backend's branch channel maps unconfident states to an absent `prState` via `omitempty`, and a stateless PR must never own the glyph — a `!==` check would let it through):

```ts
export function prOwnsGlyph(win: WindowInfo): boolean {
  return !!win.prNumber && (win.prState === "open" || win.prState === "merged" || win.prState === "closed");
}
```

Update the gate's doc comment — "a dead closed PR never does" is no longer true; closed now earns the glyph in its distinct closed-icon form.

### 2. `prGlyphColor` gains a closed branch (same file)

The `closed` branch goes **above the fail branch** — a closed PR's check/review state is historical noise, the same first-match rationale that puts `merged` above `fail` in `prDotState`. Per the user's mock review, closed uses the **muted** token (`text-text-secondary` — the established inert/no-journey token, shared with draft; the ✕ icon is what separates closed from draft):

```ts
export function prGlyphColor(win: WindowInfo): string {
  if (win.prState === "closed") return "text-text-secondary"; // NEW — dead PR: muted; stale checks are noise
  if (prDotState(win) === "fail") return "text-red-400";
  if (win.prState === "open" && win.prIsDraft) return "text-text-secondary";
  if (win.prState === "open" && win.prChecks === "pending") return "text-yellow-400";
  return win.prState === "open" ? "text-accent-green" : "text-purple-400";
}
```

(A closed *draft* also reads closed — the existing draft branch is `open`-gated so this falls out by construction. The red GitHub-exact variant was considered and rejected by the user: dead PRs should not draw rest-state attention.)

### 3. New `GitPullRequestClosedIcon` (`app/frontend/src/components/sidebar/icons.tsx`)

A lucide `git-pull-request-closed` silhouette in the sibling icons' fixed idiom (`currentColor` stroke, `strokeWidth={2}`, `fill="none"`, round caps/joins, 24-unit viewBox, 13px default):

```tsx
export function GitPullRequestClosedIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* source branch: circle + vertical rail */}
      <circle cx="6" cy="6" r="3" />
      <path d="M6 9v12" />
      {/* ✕ where the merge arc was — the "closed" mark */}
      <path d="m21 3-6 6" />
      <path d="m21 9-6-6" />
      {/* truncated target rail + target circle */}
      <path d="M18 11.5V15" />
      <circle cx="18" cy="18" r="3" />
    </svg>
  );
}
```

### 4. Both glyph surfaces pick the icon by state

- `app/frontend/src/components/sidebar/window-row.tsx` (rest-state glyph, ~line 573): render `GitPullRequestClosedIcon` when `win.prState === "closed"`, else the existing `GitPullRequestIcon`.
- `app/frontend/src/components/session-tiles/session-tiles.tsx` (the same glyph on tiles): identical state-picked icon. **Caveat for apply**: this file contains a deliberate NUL byte (line ~63) — `grep` silently skips it; use `grep -a` or perl when searching it.

No backend change: `prState: "closed"` already flows (the PANE panel renders it today), and `WindowInfo["prState"]` already includes `"closed"` in its union.

### 5. Design artifact: `dot-mock/` in this change folder

The StatusDot/glyph mock page (rescued from the previous session's scratchpad: `index.html`, `status-dot-final-reference.svg`, `status-dot-matrix-current.svg`) is committed under `fab/changes/260810-xuej-closed-pr-row-glyph/dot-mock/` and extended with a proposal section: the six-state glyph strip (open green · draft gray · pending yellow · failing red · merged purple · **closed red-✕**), example sidebar rows demonstrating shape disambiguation (failing-red normal icon next to closed-red ✕ icon), and the muted-gray closed variant for comparison. The page's historical "draft · closed → none" strip is annotated as superseded by this proposal rather than edited away.

### 6. Docs: reference SVG + status-dot page (`docs/img/status-dot-reference.svg`, `docs/site/status-dot.md`)

The compositional reference SVG (linked from `docs/site/status-dot.md` §3 via the raw-GitHub URL) still encodes the five-state glyph strip with a combined "draft · closed → none" gray entry. Update both:

- **`docs/img/status-dot-reference.svg`** — the "3 · PR" strip becomes **six states**: split the gray entry into `draft` (gray *normal* PR icon) and `closed` (gray **✕** closed icon, NEW); heading text "five states" → "six states"; add the closed-icon `<path id="prClosed">` (or inline group) alongside the existing `#pr` def; update the bottom vocabulary note ("5 glyph states" → "6 glyph states"). Keep the visual idiom of the file (fill `#787c99` for both gray entries; label `closed` explicitly). The `defs` comment block's color legend gains the closed line.
- **`docs/site/status-dot.md`** — prose updates, all in the glyph/D2 sections:
  - §3 heading "(one channel, five states — never the dot)" → six states.
  - The `prOwnsGlyph` description (`open` or `merged`; "closed-unmerged … never own") → allowlist is `open`/`merged`/`closed`; unknown/unconfident states still never own.
  - The color table gains a `closed` row (gray `text-text-secondary`, distinct ✕ icon, "dead PR — muted; ✕ shape separates it from draft").
  - "A closed-unmerged PR earns **no glyph** (it keeps its register line only)" → closed earns the muted ✕ glyph (register line unchanged).
  - §D2: "A **closed-unmerged** PR is still derived (it shows in the L3 register) but earns no glyph" → now also feeds the muted ✕ glyph.
  - The Row-Minimalism table row "PR states (merged / failing / pending)" → include closed.
  - The line "a closed PR keeps its register line but shows no row glyph" (near line 173) → updated accordingly; session tiles sentence stays true (same pair on tiles).

### 7. Tests

- `pr-status-model.test.ts`: `prOwnsGlyph` admits closed (with `prNumber`), still rejects absent/unknown state; `prGlyphColor` returns red for closed, including closed+failing-checks and closed+draft (closed wins).
- `window-row.test.tsx` / `session-tiles.test.tsx`: closed PR renders the glyph with the closed icon; open/merged keep the existing icon.
- Playwright specs touching the glyph (e.g. `status-dot-tip`, `pr-status-sidebar`) updated if they assert glyph absence for closed; companion `.spec.md` files updated in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) the status-dot / PR-glyph section — glyph vocabulary grows from five states to six (closed = red + distinct closed icon); `prOwnsGlyph` allowlist now `open|merged|closed`.

## Impact

- `app/frontend/src/components/pr-status-model.ts` — gate + color chain (+ doc comments)
- `app/frontend/src/components/sidebar/icons.tsx` — new icon
- `app/frontend/src/components/sidebar/window-row.tsx` — state-picked icon
- `app/frontend/src/components/session-tiles/session-tiles.tsx` — state-picked icon (NUL-byte grep caveat)
- `docs/img/status-dot-reference.svg` — glyph strip five → six states
- `docs/site/status-dot.md` — glyph-section + D2 prose updates
- Unit tests colocated with the above; possibly two Playwright specs + `.spec.md` companions
- No backend, no API, no route changes. Purely additive to the glyph channel; the status dot is untouched (local/remote split preserved).

## Open Questions

- ~~Final color for the closed glyph: red (GitHub-exact) vs muted gray (anti-clutter)~~ — **Resolved**: user reviewed the `dot-mock/` page and chose **muted gray** (`text-text-secondary` + distinct ✕ icon). <!-- clarified: closed glyph color — user chose muted over GitHub-red after mock review -->

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend `prOwnsGlyph` as a positive allowlist (open/merged/closed), never a `!==` check | The allowlist shape is a documented load-bearing constraint in the gate's own comment (absent-state protection) | S:90 R:85 A:95 D:95 |
| 2 | Certain | Closed renders `text-text-secondary` (muted) + the distinct ✕ icon; ✕ shape alone separates closed from draft | User decided after mock review ("muted is ok") — red variant explicitly rejected | S:95 R:95 A:95 D:90 |
| 3 | Certain | Distinct closed icon (lucide `git-pull-request-closed` silhouette) disambiguates closed-red from failing-red | GitHub disambiguates by shape, not color; icons.tsx has a fixed lucide line-art idiom to follow | S:85 R:80 A:85 D:75 |
| 4 | Confident | `closed` branch sits above `fail` in `prGlyphColor` — stale checks on a dead PR are noise | Mirrors the merged-above-fail precedent already encoded in `prDotState`'s first-match order | S:70 R:90 A:80 D:70 |
| 5 | Certain | Both glyph surfaces (window-row + session-tiles) pick the icon by state | pr-status-model's own header comment names both as glyph consumers; leaving tiles behind would fork the vocabulary | S:75 R:85 A:90 D:85 |
| 6 | Certain | Frontend-only — backend already emits `prState: "closed"` | The PANE panel renders `closed (draft)` today; `WindowInfo["prState"]` union already includes it | S:85 R:90 A:95 D:95 |
| 7 | Certain | Update `docs/img/status-dot-reference.svg` (glyph strip → six states) + `docs/site/status-dot.md` prose | Explicit user direction at go-ahead; the SVG is linked from the doc page | S:95 R:90 A:90 D:95 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
