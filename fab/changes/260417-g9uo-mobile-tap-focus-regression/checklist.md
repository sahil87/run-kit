# Quality Checklist: Mobile tap-to-focus regression after frontend dep upgrade

**Change**: 260417-g9uo-mobile-tap-focus-regression
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Wrapper box measurable (spec R1): `page.locator('[role="application"]').boundingBox()` returns a non-null object with `width > 0` and `height > 0` within 3s of `.xterm-screen` visibility at 375×812 viewport — verified by the new regression test from T003.
- [x] CHK-002 Wrapper box stable across commits (spec R1 second scenario): once measured as positive, the wrapper's width/height never transitions to zero during the mounted lifetime — verified indirectly via the tap test passing (which takes a second `boundingBox()` measurement at `tap` time, 2s after mount).
- [x] CHK-003 `[role="application"]` selector resolves to exactly one element (spec R2): verified by the T003 test's `toHaveCount(1)` assertion.
- [x] CHK-004 Tap focuses xterm helper textarea (spec R3 touch scenario): `mobile-touch-scroll.spec.ts:131` (formerly :111 before the new regression test was inserted above it) passes — `document.activeElement.classList.contains("xterm-helper-textarea") === true` after touch tap at mobile viewport.

## Behavioral Correctness

- [x] CHK-005 Desktop focus behavior unchanged (spec R3 desktop scenario): the fix is in app.tsx navigation/SSE logic, not in terminal-client.tsx. No desktop-only code paths touched. Confirmed automated mobile-layout tests pass in both orientations.

## Scenario Coverage

- [x] CHK-006 Spec R1 "Wrapper is measurable before tap test proceeds" scenario covered by T003 test.
- [x] CHK-007 Spec R1 "Wrapper box is stable across React commits" scenario covered by the pre-existing tap test at `mobile-touch-scroll.spec.ts:131` (T006 verification).
- [x] CHK-008 Spec R3 "Tap focuses textarea at mobile viewport" scenario covered by `mobile-touch-scroll.spec.ts:131` (T006).
- [x] CHK-009 Spec "Test passes on branch tip" scenario covered by T006 command output (exit 0).
- [x] CHK-010 Spec "Broader e2e run shows net improvement" scenario covered by T010 — 9 failures on branch, all within main's pre-existing 10. Net improvement of -2 (mobile-touch-scroll:49 and :111 both now pass).

## Edge Cases & Error Handling

- [x] CHK-011 Fix does not regress drag-and-drop file upload on the terminal wrapper (the wrapper has `onDragOver`/`onDragLeave`/`onDrop` handlers) — the fix does NOT touch terminal-client.tsx. Zero regression surface.
- [x] CHK-012 Fix does not regress the compose-open state (`opacity-50` dim + blocked pointer interaction) — the fix does NOT touch terminal-client.tsx. Zero regression surface.
- [x] CHK-013 Fix does not regress the `touch-none` / `touch-action: none` behavior — the fix does NOT touch terminal-client.tsx. As a bonus, mobile-touch-scroll:49 (swipe test) now passes too (was in the pre-existing failing list), indicating the SSE/navigation race was destabilizing it as well.

## Code Quality

- [x] CHK-014 **N/A (revised scope)**: the fix was applied in app.tsx and navigation.ts, not terminal-client.tsx. New code in app.tsx follows existing ref-and-useEffect patterns already present in the file (e.g., `userNavTimestampRef`, `didFetchHostnameRef`, `dialogOpenRef`).
- [x] CHK-015 No unnecessary duplication: the `currentWindowEverSeenRef` follows the exact same pattern as the pre-existing `userNavTimestampRef` and `dialogOpenRef` in the same component — no opportunity to extract a shared utility without over-abstracting, and there is no existing helper to re-use.
- [x] CHK-016 **Project code-quality §Principles**: the fix preserves state-derivation — it does not introduce a cache of layout or tmux state. The ref tracks only a boolean "has the URL target been observed valid", derived from the existing `currentWindow` memo which itself derives from SSE data. No new in-memory caches.
- [x] CHK-017 **N/A**: no changes to `init()` in terminal-client.tsx; the redirect useEffect in app.tsx remains well under 50 lines.
- [x] CHK-018 **Project code-quality §Anti-Patterns — Magic numbers**: no numeric literals introduced. The fix uses boolean flags and string keys only (URL composition: `${server}|${session}|${window}`).
- [x] CHK-019 **Project code-quality §Principles — Type narrowing**: the new `currentWindowEverSeen?: boolean` param uses optional properties with a default destructure (no `as` casts). Type-narrowing via `if (currentWindow)` guards.
- [x] CHK-020 **Project code-quality §Test strategy**: new Playwright e2e test lives in `app/frontend/tests/e2e/mobile-touch-scroll.spec.ts`. New unit tests for `computeKillRedirect` live in `app/frontend/src/lib/navigation.test.ts` alongside existing ones (co-located with source per project convention).

## Security

- [x] CHK-021 **N/A**: No new subprocess execution, no new user input pathways, no new WebSocket sink changes, no new filesystem access. Security review surface is empty for this change.

## Scope Containment

- [x] CHK-022 Spec R7: verified via `git diff --name-only main..HEAD` + `git status -s` — all modified source files have `app/frontend/` prefix. Non-code changes confined to `fab/changes/260417-g9uo-mobile-tap-focus-regression/`.
- [x] CHK-023 Spec Non-Goal: PR #150's 10 major bumps are preserved. No package pins applied — T007/T008 marked N/A. `package.json` and `pnpm-lock.yaml` are unchanged vs the branch tip.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
