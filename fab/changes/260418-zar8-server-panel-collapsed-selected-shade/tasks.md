# Tasks: Sidebar header "current item" affordances — Server collapsed shade + Sessions header name

**Change**: 260418-zar8-server-panel-collapsed-selected-shade
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

*No setup tasks. Pure edits to existing components and tests.*

## Phase 2: Core Implementation

- [x] T001 [P] Update `app/frontend/src/components/sidebar/collapsible-panel.tsx`: in the header render block (currently lines 260–288), when `headerTint` is non-null AND `tintOnlyWhenCollapsed` is true, use `headerTint.selected` for the static background and keep it flat at `headerTint.selected` on hover (no `onMouseEnter`/`onMouseLeave` color swap in that branch). When `headerTint` is non-null AND `tintOnlyWhenCollapsed` is false/unset, preserve the existing `tint.base` + `tint.hover` behavior unchanged. Rationale lives in the per-spec Design Decisions (Options A + H1).

- [x] T002 [P] Update `app/frontend/src/components/sidebar/index.tsx` Sessions header (currently lines 510–522): (a) change the header wrapper class from `text-text-primary` to `text-text-secondary` so the baseline matches `CollapsiblePanel`'s header; (b) render `{currentSession && <span className="ml-auto flex items-center gap-1 min-w-0 truncate"><span className="truncate text-text-primary font-mono">{currentSession}</span></span>}` between the "Sessions" label and the `+` button; (c) ensure the `+` button's wrapper span only uses `ml-auto` when `currentSession` is null so layout stays right-anchored in both cases. Do NOT apply any background tint to the Sessions header.

## Phase 3: Integration & Edge Cases

- [x] T003 Update `app/frontend/src/components/sidebar/collapsible-panel.test.tsx`: add three tests for tint shade selection: (a) `tintOnlyWhenCollapsed=true`, panel collapsed, `tint` passed → header inline `background-color` equals `tint.selected`; (b) `tintOnlyWhenCollapsed=true`, panel open → header has no inline `background-color` (neither `.base` nor `.selected`); (c) `tintOnlyWhenCollapsed=false` (legacy mode), `tint` passed → header inline `background-color` equals `tint.base`. Use a fixture tint like `{ base: "rgb(10, 20, 30)", hover: "rgb(20, 40, 60)", selected: "rgb(40, 80, 120)" }` and read back `element.style.backgroundColor` (jsdom normalizes to rgb strings). *(Added 5 tests total; also updated `sidebar.test.tsx` to scope session-name lookups to the Navigate button — the Sessions header now renders the current session name, so unqualified `getByText("run-kit")` was ambiguous.)*

- [x] T004 Run the frontend test suite scoped to the sidebar (`cd app/frontend && npm test -- collapsible-panel`) to confirm T003 passes and no other `collapsible-panel.test.tsx` tests regress. If the full suite needs a sanity check, run `npm test -- sidebar` (still scoped). Do not run the full app test suite unless scoped runs reveal cross-file regressions. *(Full suite run: 28 files / 447 tests passed.)*

- [x] T005 Run TypeScript check on the frontend (`cd app/frontend && npm run typecheck` or equivalent from `package.json`'s scripts) to confirm no type regressions from the JSX edits in T001/T002. *(`npx tsc --noEmit` in app/frontend — clean, no errors.)*

## Phase 4: Polish

*No polish tasks — this is a narrow visual fix.*

---

## Execution Order

- T001 and T002 are fully independent (different files) and may run in parallel.
- T003 depends on T001 (the new test asserts the new behavior; must run after T001 lands).
- T004 depends on T001 and T003.
- T005 depends on T001 and T002.
- T004 and T005 may run in parallel (different commands, no shared state).

## Files Touched (expected)

| File | Task | Change |
|------|------|--------|
| `app/frontend/src/components/sidebar/collapsible-panel.tsx` | T001 | Header tint branch uses `.selected` + flat hover when `tintOnlyWhenCollapsed` is true |
| `app/frontend/src/components/sidebar/index.tsx` | T002 | Sessions header shows `currentSession` + normalizes text-color |
| `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` | T003 | Three new tests for tint shade selection |
