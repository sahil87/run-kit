# Plan: Static xterm imports

**Change**: 260531-m3pl-static-xterm-imports
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Setup

- [x] T001 Add six static top-of-file value imports to `app/frontend/src/components/terminal-client.tsx` — `import { Terminal } from "@xterm/xterm";`, `import { FitAddon } from "@xterm/addon-fit";`, `import { ClipboardAddon } from "@xterm/addon-clipboard";`, `import { WebLinksAddon } from "@xterm/addon-web-links";`, `import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";`, `import { WebglAddon } from "@xterm/addon-webgl";` — placed alongside the existing CSS side-effect import (:1) and React/local imports. Leave the CSS import (:1) and type-only refs (:60, :141) unchanged.

### Phase 2: Core Implementation

- [x] T002 Remove the two `await import()` calls at the top of `init()` (`@xterm/xterm` :147, `@xterm/addon-fit` :148) in `app/frontend/src/components/terminal-client.tsx`; the entry guard (:146 `if (!terminalRef.current) return;`) and the surviving font-load `await Promise.race` (:162-173) with its post-await guard (:177) remain. The pre-import "Component unmounted while awaiting imports" guard at :151 becomes redundant (no preceding await before the font-load section) and is removed — but the post-font-load guard at :177 is retained as the entry to terminal construction.
- [x] T003 Remove the `await import("@xterm/addon-clipboard")` (:195) and `await import("@xterm/addon-web-links")` (:200) in `init()`; reference `ClipboardAddon`/`WebLinksAddon` static symbols directly. Drop the now-redundant inter-addon `cancelled`-dispose guards at :196 and :201 (these existed solely to guard the removed `await import()` boundaries; the addon section is now synchronous after the single font-load await).
- [x] T004 Remove the `await import("@xterm/addon-unicode-graphemes")` (:209) in `init()`; reference `UnicodeGraphemesAddon` directly. Drop the redundant guard at :210. Preserve the `terminal.unicode.activeVersion = "15-graphemes"` line and the Unicode-before-WebGL ordering.
- [x] T005 Convert the WebGL load: remove `await import("@xterm/addon-webgl")` (:216) and reference the static `WebglAddon`. KEEP the `try/catch` around `new WebglAddon()` / `terminal.loadAddon(...)` for GPU-context runtime failures. Remove the redundant post-WebGL dispose guard at :221.

### Phase 3: Integration & Edge Cases

- [x] T006 Verify teardown soundness in `init()`: after `new Terminal(...)` is constructed, an unmount-during-the-now-synchronous addon section must still dispose the terminal. Ensure exactly one post-construction `cancelled` dispose guard remains before `setTerminalReady(true)` (the existing pre-`setTerminalReady` guard at :270-273 covers this once the inter-addon guards are removed). Confirm the post-font-load guard at :177 short-circuits before construction, and the effect-cleanup `terminal?.dispose()` (:294) is untouched. No constructed terminal may be left undisposed on any cancel path; no `await import()` of any xterm module remains.

### Phase 4: Polish

- [x] T007 Run typecheck (`cd app/frontend && npx tsc --noEmit`) and the scoped unit test (`cd app/frontend && pnpm exec vitest run src/components/terminal-client.test.tsx`); confirm clean typecheck and passing tests with no modification to `terminal-client.test.tsx`.

## Execution Order

- T001 blocks T002–T005 (static symbols must exist before the `await import()` calls referencing them are removed).
- T002–T005 are sequential edits within the same `init()` body (overlapping line context); apply top-to-bottom.
- T006 validates the combined teardown control flow after T002–T005.
- T007 runs last (verification gate).

## Acceptance

### Functional Completeness

- [ ] A-001 Static imports: All six xterm-family symbols (`Terminal`, `FitAddon`, `ClipboardAddon`, `WebLinksAddon`, `UnicodeGraphemesAddon`, `WebglAddon`) are imported via static top-of-file `import` statements in `terminal-client.tsx`.
- [ ] A-002 No runtime imports remain: No `await import()` of any xterm module (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-clipboard`, `@xterm/addon-web-links`, `@xterm/addon-unicode-graphemes`, `@xterm/addon-webgl`) remains anywhere in the file; `init()` references the static symbols directly.
- [ ] A-003 CSS + type-only refs unchanged: The CSS side-effect import (:1) and the `import("@xterm/...")` type-only annotations (:60, :141) are left as-is.

### Behavioral Correctness

- [ ] A-004 Single-pane init parity: `init()` still constructs a `Terminal`, loads `FitAddon`/`ClipboardAddon`/`WebLinksAddon`/`UnicodeGraphemesAddon` and (GPU permitting) `WebglAddon`, calls `terminal.open()`, and runs `setTerminalReady(true)` gating the relay WS effect exactly as before.
- [ ] A-005 Unicode-before-WebGL order preserved: `UnicodeGraphemesAddon` is instantiated and `terminal.unicode.activeVersion = "15-graphemes"` is set before `WebglAddon` is instantiated.
- [ ] A-006 WebGL fallback contract: The `try/catch` around `new WebglAddon()` / `loadAddon` is retained; a GPU-context throw is swallowed silently and the canvas renderer continues; `init()` proceeds to wire handlers, the resize observer, and `setTerminalReady(true)`.

### Scenario Coverage

- [ ] A-007 Teardown across font-load await: An unmount during the font-load race short-circuits `init()` before constructing the terminal (post-font-load guard at :177 retained).
- [ ] A-008 Teardown after construction: An unmount after `new Terminal(...)` but before `setTerminalReady(true)` disposes the terminal inside a `try/catch` and returns early; the effect-cleanup `terminal?.dispose()` on true unmount is unchanged.
- [ ] A-009 Existing unit test passes unchanged: `terminal-client.test.tsx` is NOT modified and its tests (Unicode-width init order/`allowProposedApi`/`activeVersion`, scroll-lock focus prevention) pass against the static-import source.

### Edge Cases & Error Handling

- [ ] A-010 No orphaned terminal on cancel: On every cancel path after construction, the constructed `terminal` is disposed (wrapped in `try/catch` for WebGL-teardown throws); no relay is opened and the terminal is not marked ready.

### Code Quality

- [ ] A-011 Pattern consistency: New static imports follow the file's existing import grouping/style; the `init()` body matches surrounding synchronous addon-loading style.
- [ ] A-012 No unnecessary duplication: No reintroduced or duplicated import logic; the single font-load await is the only async boundary in `init()`.
- [ ] A-013 Type narrowing over assertions: No new `as` casts introduced; existing type-narrowing patterns (the local `const term = terminal;`) preserved.
- [ ] A-014 No magic strings/numbers introduced: No new unnamed literals added by the refactor.
- [ ] A-015 Typecheck + tests green: `npx tsc --noEmit` is clean and the scoped vitest run passes.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Static import placement follows the existing top-of-file grouping (CSS side-effect first, then value imports) | Matches the file's current import organization; constitution/code-quality require following existing patterns | S:90 R:95 A:95 D:90 |
| 2 | Certain | The pre-import guard at :151 is removed (no await precedes the font-load section after imports go static); the post-font-load guard at :177 is the surviving entry guard before construction | Derived directly from spec Requirement "Teardown correctness" — only the surviving await boundary must stay guarded | S:90 R:85 A:90 D:90 |
| 3 | Certain | A single post-construction `cancelled` dispose guard (the existing :270-273 block) suffices for the now-synchronous addon section | Spec states the addon-loading sequence is synchronous after the font-load await, so one post-construction guard before `setTerminalReady` is sufficient | S:90 R:85 A:90 D:90 |
| 4 | Certain | Verification = typecheck (`npx tsc --noEmit`) + scoped vitest run; no full E2E | Per apply directive and code-quality Verification gates 1-2; E2E deferred to review/orchestrator | S:95 R:90 A:95 D:95 |

4 assumptions (4 certain, 0 confident, 0 tentative, 0 unresolved).
