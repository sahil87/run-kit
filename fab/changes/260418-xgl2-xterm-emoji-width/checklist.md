# Quality Checklist: Fix xterm.js emoji / wide-character rendering

**Change**: 260418-xgl2-xterm-emoji-width
**Generated**: 2026-04-18
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Unicode 15 Grapheme Widths Active: `@xterm/addon-unicode-graphemes` appears as a dependency in `app/frontend/package.json` and is reflected in `app/frontend/pnpm-lock.yaml`.
- [ ] CHK-002 Unicode 15 Grapheme Widths Active: `app/frontend/src/components/terminal-client.tsx` constructs `new Terminal({ ..., allowProposedApi: true })`.
- [ ] CHK-003 Unicode 15 Grapheme Widths Active: After `terminal.open(...)`, the init effect dynamic-imports `@xterm/addon-unicode-graphemes`, calls `terminal.loadAddon(new UnicodeGraphemesAddon())`, and sets `terminal.unicode.activeVersion = "15-graphemes"`.
- [ ] CHK-004 Unicode 15 Grapheme Widths Active: The addon load follows the existing dynamic-import + `cancelled` guard + disposal pattern used by Clipboard / WebLinks / WebGL in the same effect.
- [ ] CHK-005 Unicode 15 Grapheme Widths Active: The Unicode addon load precedes the WebGL addon load in source order.
- [ ] CHK-006 Dependency Install Orthogonality: No backend Go files are modified.
- [ ] CHK-007 Dependency Install Orthogonality: `fontFamily`, `document.fonts.load(...)` awaits, and font-related timing in `terminal-client.tsx` are unchanged.
- [ ] CHK-008 Why-Comment Present: A comment immediately above the Unicode addon load explains that xterm defaults to Unicode 6 widths, tmux lays out with wcwidth-based widths, and the addon keeps them in sync.

## Behavioral Correctness
- [ ] CHK-009 Emoji followed by ASCII: running `printf 'ASCII before ✅ ASCII after\n'` in a pane renders without ghost overlap and the ASCII tail starts at the column tmux targets.
- [ ] CHK-010 Grapheme cluster widths: flag emoji, ZWJ sequences, and skin-tone modifiers render as 2-cell clusters with no visible mis-alignment on the following character.
- [ ] CHK-011 ASCII-only unchanged: pure-ASCII output is visually identical to pre-change behavior.

## Scenario Coverage
- [ ] CHK-012 Before-and-after visual: manual Playwright check performed at both desktop (≥1024px) and mobile (375×812) viewports with emoji content present; no ghost glyphs or overlapping text.
- [ ] CHK-013 Backend unchanged: `cd app/backend && go test ./...` passes with no modified files under `app/backend/`.
- [ ] CHK-014 Font loading unchanged: `document.fonts.load(...)` sequence and `fontFamily` string in `terminal-client.tsx` match pre-change content.

## Edge Cases & Error Handling
- [ ] CHK-015 Mid-init teardown: if the component unmounts between `terminal.open()` and the UnicodeGraphemesAddon dynamic import returning, the `cancelled` guard disposes the terminal and returns without calling `loadAddon` — matching sibling addon behavior.
- [ ] CHK-016 Addon import failure: if the dynamic import rejects, init fails loudly rather than leaving the terminal in a half-initialised state (fine to throw — parity with Clipboard / WebLinks, which are also not wrapped in try/catch).

## Code Quality
- [ ] CHK-017 Readability over cleverness: new code reuses the sibling-addon dynamic-import idiom; no bespoke patterns.
- [ ] CHK-018 Follow existing project patterns: `cancelled` guard + `try { terminal.dispose(); } catch {}` on teardown matches the existing lines in the same effect.
- [ ] CHK-019 No database / ORM / migration code introduced (constitution II).
- [ ] CHK-020 No shell string construction / direct exec introduced (constitution I — the change is frontend-only, but the principle holds broadly).
- [ ] CHK-021 No god functions added (>50 lines): the addon load is a short block inside the existing `init` function.
- [ ] CHK-022 No magic strings added without rationale: `"15-graphemes"` is a documented xterm API constant; no other new literals.
- [ ] CHK-023 No duplication of existing utilities: the addon load reuses the existing dynamic-import + `cancelled` pattern rather than extracting a helper prematurely.
- [ ] CHK-024 Comment discipline: the one new comment encodes WHY (Unicode 6 vs tmux wcwidth); no narration of WHAT.
- [ ] CHK-025 New features include tests covering changed behavior: the addon load path is exercised by existing `terminal-client.test.tsx` mounts; behavior-specific tests are not required for a width-table change (verified visually per CHK-012).

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
