# Quality Checklist: Sidebar header "current item" affordances — Server collapsed shade + Sessions header name

**Change**: 260418-zar8-server-panel-collapsed-selected-shade
**Generated**: 2026-04-18
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Collapsed-header tint SHALL use selected shade when `tintOnlyWhenCollapsed` is set: `CollapsiblePanel` header with `tintOnlyWhenCollapsed=true` AND panel collapsed AND non-null tint → header background is `tint.selected`
- [x] CHK-002 Hover on selected-shade-tinted collapsed header stays at `tint.selected`: no `onMouseEnter`/`onMouseLeave` color swap in that branch; `tint.hover` is not applied
- [x] CHK-003 Sessions header displays `currentSession` on the right: rendered between "Sessions" label and `+` button, styled `truncate text-text-primary font-mono`
- [x] CHK-004 Sessions header normalizes to ServerPanel text-color conventions: outer header uses `text-text-secondary`; session-name span uses `text-text-primary`
- [x] CHK-005 Sessions header MUST NOT tint its background from current session color: header background stays default sidebar chrome
- [x] CHK-006 Legacy tint mode preserved: `tintOnlyWhenCollapsed` false/unset AND tint passed → header uses `tint.base` + `tint.hover` behavior unchanged

## Behavioral Correctness
- [x] CHK-007 ServerPanel collapsed with colored active server: collapsed-header color matches body tint of the active tile when panel expanded (both use `tint.selected`)
- [x] CHK-008 ServerPanel collapsed with uncolored active server: no background tint on header (null tint path)
- [x] CHK-009 ServerPanel expanded (tintOnlyWhenCollapsed=true): header has no tint; active tile body still uses `tint.selected` (unchanged at `server-panel.tsx:222-224`)

## Removal Verification
- [x] CHK-010 **N/A**: no deprecated requirements

## Scenario Coverage
- [x] CHK-011 "ServerPanel collapsed, active server has assigned color" scenario covered by unit test asserting collapsed-header `background-color` equals `tint.selected`
- [x] CHK-012 "ServerPanel expanded" scenario covered by unit test asserting no inline `background-color` when open
- [x] CHK-013 "Mouse enters collapsed, tinted ServerPanel header" scenario: manual verification (hovering does not change header color) OR derived from the absence of `onMouseEnter`/`onMouseLeave` handlers in the selected-shade branch
- [x] CHK-014 "A session is selected" and "No session is selected" scenarios: manual verification in browser (dev server) — text present when `currentSession` set, absent otherwise

## Edge Cases & Error Handling
- [x] CHK-015 Long `currentSession` name truncates with ellipsis via `truncate` utility; `+` button remains visible

## Code Quality
- [x] CHK-016 Pattern consistency: Sessions header markup mirrors the ServerPanel `headerRight` pattern (`server-panel.tsx:81-86`) exactly in class list and structure
- [x] CHK-017 No unnecessary duplication: reuses existing `RowTint.selected` + existing `truncate text-text-primary font-mono` convention — no new theme tokens, no new prop on `CollapsiblePanel`
- [x] CHK-018 Readability over cleverness: tint-shade selection expressed as a clear conditional (`tintOnlyWhenCollapsed ? tint.selected : tint.base`) rather than a helper indirection for one call site
- [x] CHK-019 Follow existing project patterns: edits stay within the existing sidebar component file layout; no new files introduced
- [x] CHK-020 Frontend type narrowing: any conditional on `currentSession` uses `if` / `&&` guards rather than `as` casts
- [x] CHK-021 New code includes tests covering changed behavior (T003 adds unit tests for tint shade selection)
- [x] CHK-022 **N/A**: no Playwright e2e test added — existing specs don't assert on sidebar header color/composition and per spec Assumption #11 no new Playwright is required for this change

## Security
- [x] CHK-023 **N/A**: no security surface — purely visual frontend change with no user input, no subprocess calls, no persistence changes

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-xxx **N/A**: {reason}`
