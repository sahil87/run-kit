# Intake: History Push on Window Switch

**Change**: 260715-m4xy-history-push-window-switch
**Created**: 2026-07-15

## Origin

Promptless dispatch (`/fab-proceed` create-intake subagent, `promptless-defer` mode) from a synthesized description of a diagnostic discussion. All code claims in the description were verified against source in the dispatching session AND re-verified in this session (file/line references below reflect the current tree).

> **Change type**: fix.
>
> **Problem**: The top-bar browser-history ◀ ▶ arrows (introduced by change 260714-uco1, PR #354, component `HistoryNav` in `app/frontend/src/components/top-bar.tsx` — raw `router.history.back()/forward()`) skip same-server window switches. Repro: navigate server1 win1 → win5 → win1 → server2 win2 → server2 win6; clicking Back lands on server1 win1, skipping every within-server hop.
>
> **Decided fix**: Remove `replace: true` from `navigateToWindow`'s `runSwitch` navigate call (push semantics), so all user-initiated window switches create history entries. Plain push, NO dedup of consecutive/revisited entries — w1→w5→w1 creates 3 entries and Back retraces every hop (explicit user requirement: "a lot of things are missing from back history").

Key decisions carried from the discussion: (1) push semantics with no dedup; (2) the SSE URL-writeback effect and `switchView` deliberately keep `replace: true` and MUST NOT be modified; (3) within-server Back/Forward tmux alignment is expected to ride the existing deep-link intent effect (verify in implementation).

## Why

1. **The pain point**: The history ◀ ▶ arrows shipped in 260714-uco1 (PR #354) are nearly useless for the dominant navigation pattern — switching windows within one server. `navigateToWindow`'s `runSwitch` (`app/frontend/src/app.tsx:787–796`) navigates with `replace: true`, so every user-initiated window switch — sidebar click, window-switcher ▾, command palette, keyboard shortcut — REPLACES the current history entry instead of pushing one. Only cross-server navigations (sidebar cross-server branch `app.tsx:1967`, spawn-agent cross-server branch `app.tsx:2319`, `navigateToWaitingTarget` `app.tsx:1841`) push, which is why only server boundaries survive in history. History trace for the repro: `[s1w1] →replace [s1w5] →replace [s1w1] →push [s1w1, s2w2] →replace [s1w1, s2w6]`; Back → s1w1, skipping every within-server hop.

2. **The consequence if unfixed**: Back/Forward silently drop most of the user's actual navigation trail ("a lot of things are missing from back history"). The arrows appear broken — the affordance was just shipped and its primary use case doesn't work.

3. **Why this approach**: The `replace: true` is a fossil — it predates the arrows (and predates PR #303's slide transition), dating from when window clicks were pure URL state-sync with no back affordance. Now that a back affordance exists, a user-initiated window switch IS a navigation and belongs in history. The one-line removal gives push semantics everywhere user intent drives the switch, while the two tmux/preference-driven `replace: true` sites stay untouched (see Constraints). Dedup of consecutive/revisited entries was explicitly rejected: the user wants every hop retraceable.

## What Changes

### 1. `navigateToWindow` push semantics (the fix)

`app/frontend/src/app.tsx`, inside `navigateToWindow`'s `runSwitch` (~line 787–796). Current code:

```ts
const runSwitch = (): Promise<unknown> => {
  pendingClickRef.current = { windowId };
  navigate({
    to: "/$server/$window",
    params: { server, window: windowId },
    // Window switch (sidebar/palette click): clear the `?view=` param so
    // the target window resolves its OWN view (localStorage + default
    // hint), not the outgoing window's. Same-window lens switches go
    // through `switchView`, which sets the param explicitly.
    search: {},
    replace: true,
  });
  ...
```

Remove the `replace: true` line — nothing else in the call changes (`search: {}` stays; the comment stays or is extended to note push-for-history). Every user-initiated window switch routed through `navigateToWindow` (sidebar same-server click, window-switcher ▾, command palette, keyboard shortcuts, spawn-agent same-server branch, board/tile entry points that delegate to it) now pushes a history entry.

**No dedup**: consecutive or revisited entries are NOT collapsed. w1→w5→w1 creates 3 entries; Back retraces every hop. This is the explicit requirement, not an oversight.

### 2. Constraints — deliberately unchanged (out of scope, MUST NOT be modified)

1. **SSE URL-writeback effect** (`app.tsx:733–763`, navigate at 755–762) keeps `replace: true` — tmux-driven corrections are not user intent; pushing there would spam history and fight the Back button (back → writeback would immediately re-push forward).
2. **`switchView`** (`app.tsx:420–432`, navigate at 424–429) keeps `replace: true` — same-window lens toggles (tty/web/chat) are per-viewer preferences already persisted to localStorage; Back must not step through lens flips.

Cross-server push sites (`handleSidebarSelectWindow` cross-server branch, spawn-agent `onSpawned` cross-server branch, `navigateToWaitingTarget`) already push and are untouched.

### 3. Expected interaction — tmux alignment on Back/Forward (verify in implementation)

After a history Back/Forward, the existing deep-link intent effect (`app.tsx:703–727`: URL window ≠ SSE active window → sets `pendingClickRef` + fires `selectWindow`) aligns tmux to the URL. Its `hasAlignedToUrlRef` guard is keyed on `${server}|${windowParam}` and re-arms whenever `windowParam` changes — which a Back/Forward hop always does — so within-server Back/Forward should drive tmux for free, the same path cross-server Back already exercises today. No new alignment code is planned; the implementation must verify this holds (e.g., the e2e asserts the landed window's terminal/heading renders, which requires the alignment to have fired).

Note: history Back/Forward bypasses `navigateToWindow` entirely (`HistoryNav` calls raw `router.history.back()/forward()`), so no slide transition plays on arrow navigation — existing behavior, unchanged.

### 4. Testing

Per `fab/project/code-quality.md`, the fix MUST include tests covering the changed behavior. The existing history-arrows e2e (`app/frontend/tests/e2e/window-heading.spec.ts:453`, "the ◀ ▶ arrows drive browser history") builds its history stack via `page.goto` full navigations — which always push — so it never exercises the in-app switch path where `replace: true` eats entries. It passes today and will keep passing; it does not cover this fix.

Add a Playwright e2e that switches windows **via the in-app UI** (e.g., sidebar window clicks or the window-switcher ▾) — w-a → w-b (→ optionally back to w-a for the no-dedup shape) — then asserts `history.back()` (via the ◀ arrow or `page.goBack()`) returns to the prior window URL and renders it, and Forward returns. Preferred placement: extend the existing `test.describe` block in `window-heading.spec.ts` (the arrows' home spec) and update the sibling `window-heading.spec.md` companion in the same commit (constitution: Test Companion Docs).

Project constraints: run e2e via `just test-e2e "<spec>:<line>"` — never raw playwright (port 3020 isolation).

## Affected Memory

- `run-kit/ui-patterns`: (modify) The top-bar HistoryNav / window-switch navigation entry — window switches through `navigateToWindow` now push history entries (Back/Forward retrace within-server hops); SSE writeback and lens switches remain `replace`.

## Impact

- `app/frontend/src/app.tsx` — one-line removal in `navigateToWindow`'s `runSwitch` (~line 795). Frontend-only; no backend/API change.
- `app/frontend/tests/e2e/window-heading.spec.ts` + `window-heading.spec.md` — new/extended e2e coverage for in-app-switch history semantics.
- Behavioral blast radius: history length grows with every window switch (previously ~1 entry per server visit). The SSE writeback still `replace`s tmux-driven corrections on top of the newest entry, so pushed entries record user hops only.

## Open Questions

None — the originating discussion resolved the approach, scope boundaries, and dedup policy explicitly; no Unresolved-grade decisions remained to defer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = remove `replace: true` from `navigateToWindow`'s `runSwitch` navigate call; plain push, NO dedup of consecutive/revisited entries | Discussed — explicit user decision ("a lot of things are missing from back history"); code location verified at app.tsx:795 | S:95 R:85 A:90 D:95 |
| 2 | Certain | SSE URL-writeback effect (app.tsx:755–762) keeps `replace: true` — out of scope, must not be modified | Discussed — explicit constraint with rationale (tmux corrections are not user intent; push would fight Back) | S:95 R:90 A:95 D:95 |
| 3 | Certain | `switchView` (app.tsx:424–429) keeps `replace: true` — out of scope, must not be modified | Discussed — explicit constraint with rationale (lens toggles are per-viewer prefs; Back must not step through them) | S:95 R:90 A:95 D:95 |
| 4 | Certain | Cross-server push sites (sidebar cross-server branch app.tsx:1967, spawn-agent app.tsx:2319, navigateToWaitingTarget app.tsx:1841) unchanged | Verified in source — they already push; the fix only makes within-server switches match | S:90 R:90 A:95 D:90 |
| 5 | Confident | No new tmux-alignment code: within-server Back/Forward relies on the existing deep-link intent effect (app.tsx:703–727) to align tmux to the URL | Discussed as "expected interaction (verify in implementation)"; guard re-arms on every windowParam change, and cross-server Back exercises this path today — but within-server Back via arrows is unproven until the e2e runs | S:80 R:75 A:75 D:75 |
| 6 | Confident | A same-window re-click may now push a duplicate history entry (no early return in navigateToWindow for windowId === current); accepted under the explicit no-dedup decision — verify TanStack Router's identical-href push behavior during implementation, do not add a guard | No-dedup was explicit; a duplicate-entry papercut is trivially reversible later and adding a guard now would contradict the stated requirement | S:60 R:85 A:75 D:65 |
| 7 | Confident | Test placement: extend the existing history-arrows `test.describe` in `window-heading.spec.ts` with an in-app-switch Back/Forward test + update sibling `window-heading.spec.md`, rather than a new spec file | The arrows' behavior already lives there (line 453); constitution requires the `.spec.md` companion update in the same commit; a new file is a valid alternative if the block grows unwieldy | S:65 R:90 A:85 D:70 |
| 8 | Confident | No slide transition on arrow Back/Forward (HistoryNav bypasses navigateToWindow) is existing behavior and stays unchanged — not part of this fix | Verified: HistoryNav calls raw `router.history.back()/forward()` (top-bar.tsx:180); the transition wrapper lives only inside navigateToWindow | S:70 R:80 A:80 D:75 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
