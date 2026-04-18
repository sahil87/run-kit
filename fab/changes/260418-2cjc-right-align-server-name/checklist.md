# Quality Checklist: Right-align Server Name in Server Panel Header

**Change**: 260418-2cjc-right-align-server-name
**Generated**: 2026-04-18
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Fixed Panel Title: `ServerPanel` passes `title="Server"` (static string, no server-name interpolation) to `CollapsiblePanel` — verify in `app/frontend/src/components/sidebar/server-panel.tsx`.
- [ ] CHK-002 Server Name Rendered in Right Slot: The active server name is rendered via the `headerRight` prop, placing it inside `CollapsiblePanel`'s `ml-auto` right-aligned wrapper.
- [ ] CHK-003 Server Name Styling Mirrors Host: The server name span carries `text-text-primary`, `font-mono`, and `truncate` classes — matches `host-panel.tsx:34`.
- [ ] CHK-004 Refresh Spinner Coexists With Server Name: When `refreshing` is true, `LogoSpinner` renders as a sibling of the name span within `headerRight`; when false, only the name is rendered.
- [ ] CHK-005 No Other Header Behavior Changes: `headerAction` (`+` button), `storageKey`, `defaultOpen`, `onToggle`, `contentClassName`, `tint`, `tintOnlyWhenCollapsed`, `resizable`, `defaultHeight`, `minHeight`, `mobileHeight`, and the tile grid body are untouched by this change.

## Behavioral Correctness
- [ ] CHK-006 Title no longer embeds server name: The string `Tmux · ` (with U+00B7) is removed from the codebase in `server-panel.tsx`; the title displays only `Server` regardless of active server.
- [ ] CHK-007 Name position is stable across server switches: Switching the active server updates only the name text in the right slot — the left-side chevron and title remain visually fixed.

## Scenario Coverage
- [ ] CHK-008 `openPanel` test helper updated: `server-panel.test.tsx:53` uses `screen.getByRole("button", { name: /Server/ })` in place of `/Tmux/`.
- [ ] CHK-009 New right-slot coverage test added: A new test renders `ServerPanel` without opening it and asserts both the static `Server` title and the active server name (e.g., `work`) appear in the document — behaviorally validating the right-slot contract.
- [ ] CHK-010 Existing `ServerPanel` tests continue to pass: Session count rendering, active-tile marking, click-to-switch, empty state, `+` button, color picker, kill button, refresh-on-open, listbox role, and title attribute tests all pass without further modification.
- [ ] CHK-011 Long server names truncate: A server name exceeding header width visibly ellipsizes via `truncate` on its container; the chevron and title do not shift or wrap.

## Edge Cases & Error Handling
- [ ] CHK-012 Refresh state transitions: Spinner renders after (to the right of) the name during `refreshing === true`, and disappears cleanly when the refresh promise settles — name remains in place both before and after.
- [ ] CHK-013 Collapsed panel still shows name: Even when the panel is collapsed (`defaultOpen={false}` or user-toggled closed), the server name remains visible in the header right slot — it is header chrome, not body content.

## Code Quality
- [ ] CHK-014 Pattern consistency: The `headerRight` construction mirrors `host-panel.tsx:32-42` (fragment with primary identifier + secondary indicator); no new patterns introduced.
- [ ] CHK-015 No unnecessary duplication: No new helper components, no new CSS utility classes — the change reuses existing `CollapsiblePanel` props and existing `LogoSpinner` import.
- [ ] CHK-016 Type narrowing over assertions (frontend principle): No `as` casts introduced — this is a pure JSX/prop change with no type surface.
- [ ] CHK-017 No god-function regression: `ServerPanel` stays within its existing line budget; the header construction adds only a small local binding (`headerRight`).
- [ ] CHK-018 Test coverage for changed behavior: Per `code-quality.md` — the title/right-slot changes have explicit test coverage via the updated helper and the new behavior test.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-XXX **N/A**: {reason}`
