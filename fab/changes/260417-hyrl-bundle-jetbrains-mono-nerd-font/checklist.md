# Quality Checklist: Bundle JetBrainsMono Nerd Font as a webfont in the frontend

**Change**: 260417-hyrl-bundle-jetbrains-mono-nerd-font
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Three-weight webfont bundle: `app/frontend/package.json` declares the font dependency (path a) OR `app/frontend/public/fonts/` contains three `.woff2` files — `JetBrainsMonoNerdFont-Regular.woff2`, `JetBrainsMonoNerdFont-Bold.woff2`, `JetBrainsMonoNerdFont-Italic.woff2` (path b). Exactly one of path (a) / path (b) applies, with the decision recorded in `tasks.md` as `<!-- font-source-decision: ... -->`.
- [ ] CHK-002 Single `font-family` name: `globals.css` exposes one `font-family: "JetBrainsMono Nerd Font"` name across all three `@font-face` rules (different `font-weight` / `font-style`). No second family name (e.g., `JetBrains Mono`, `Symbols Nerd Font Mono`) is introduced for the terminal path.
- [ ] CHK-003 `font-display: block` for all three faces: every `@font-face` rule for `"JetBrainsMono Nerd Font"` in `globals.css` (or the fontsource override block) declares `font-display: block`. No rule remains with `font-display: swap` / `fallback` / `optional` / `auto`.
- [ ] CHK-004 Preload for Regular weight: `app/frontend/index.html` `<head>` contains `<link rel="preload" as="font" type="font/woff2" crossorigin>` with an `href` that resolves to the actual served path of the Regular `.woff2`.
- [ ] CHK-005 Await three font weights: `app/frontend/src/components/terminal-client.tsx` `init()` calls `Promise.all([document.fonts.load(...), document.fonts.load(...), document.fonts.load(...)])` for Regular, Bold, Italic at the chosen pixel size BEFORE `new Terminal(...)` and `terminal.open()`.
- [ ] CHK-006 Primary `fontFamily` is the bundled webfont: `terminal-client.tsx` passes `'"JetBrainsMono Nerd Font", ui-monospace, monospace'` to `new Terminal(...)`. The pre-change intermediate entries (`JetBrains Mono`, `Fira Code`, `SF Mono`, `Menlo`, `Monaco`, `Consolas`) are removed from this string.
- [ ] CHK-007 `LINE_HEIGHT` derivation unchanged: `terminal-client.tsx` line ~272 still reads `xtermRef.current?.options.fontSize` — no modification required or performed.

## Behavioral Correctness

- [ ] CHK-008 Cell measurement now uses the webfont metrics: on a fresh browser session, the webfont completes loading before `terminal.open()` runs, so xterm's one-shot cell measurement uses JetBrainsMono Nerd Font metrics — not fallback.
- [ ] CHK-009 Post-await guard is present: after the `await Promise.all(...)` line, `terminal-client.tsx` re-checks `cancelled || !terminalRef.current` before constructing the terminal, mirroring existing guards at the `await import(...)` sites.
- [ ] CHK-010 Concurrent (not sequential) font loads: the three `document.fonts.load(...)` calls are wrapped in a single `Promise.all(...)` — no sequential `await` per weight.
- [ ] CHK-011 Fallback-chain regression absent: the only font-family names declared in the terminal `fontFamily` are `"JetBrainsMono Nerd Font"`, `ui-monospace`, `monospace`. No legacy names crept back in.

## Scenario Coverage

- [ ] CHK-012 First-load scenario: manual verification with a fresh browser profile + `RK_PORT=3020 just dev` shows no per-character baseline wobble in a rendered prompt (both desktop 1024×768 / 13px and mobile 375×812 / 11px).
- [ ] CHK-013 Subsequent-navigation scenario: after a first load, an internal route change or page reload does not block on font download (< 50 ms) and renders the terminal immediately.
- [ ] CHK-014 Unmount-during-load scenario: navigating away while the terminal is awaiting fonts does not leak a constructed Terminal instance. (Code-level check: the post-await `cancelled` guard is present and reached.)
- [ ] CHK-015 Preload actually reused: browser DevTools Network shows the Regular `.woff2` fetched once (by the preload), not twice (once by preload + once by CSS `@font-face`). The preload `href` matches the CSS-resolved URL exactly.

## Edge Cases & Error Handling

- [ ] CHK-016 Webfont load catastrophically fails: if the woff2 URL is blocked (simulate via DevTools blocking pattern), the terminal eventually renders using `ui-monospace` (or generic `monospace`) after the `font-display: block` period — it does not hang indefinitely or crash.
- [ ] CHK-017 Component unmount during `await`: unmount mid-await does not throw; the init function exits cleanly after the await resolves and the `cancelled` guard matches.
- [ ] CHK-018 Size/weight parity at mobile: at 11px, the three `document.fonts.load(...)` calls use `11px`, not `13px`; at 13px desktop, they use `13px`, not `11px`. The pixel size passed to `load(...)` matches the `fontSize` passed to `new Terminal(...)`.

## Code Quality

- [ ] CHK-019 Pattern consistency: the new `await` + `cancelled` guard in `terminal-client.tsx` matches the style of existing `await import(...)` sites (lines 125, 146, 151, 161, 210 of the pre-change file) — same guard shape, same return pattern.
- [ ] CHK-020 No unnecessary duplication: the font `font-family` name `"JetBrainsMono Nerd Font"` is defined in exactly one place per concern (`globals.css` for `@font-face`, `terminal-client.tsx` for xterm `fontFamily`, `index.html` for preload `href`). No stray duplicate declarations.
- [ ] CHK-021 No magic numbers for font size: pixel size (11 / 13) is read from the same `isMobile` branch used to set `fontSize` — not duplicated as literals in the three `document.fonts.load(...)` calls.
- [ ] CHK-022 No shell-string or exec misuse introduced (N/A for this change — all work is frontend CSS/TS/HTML, but verified by code-review.md anti-pattern list).
- [ ] CHK-023 Tests added or updated where behavior changed: if the font-load await introduces a testable path, a unit test covering either the loading pathway or the guard behavior is added; otherwise, mark N/A with a brief reason (e.g., DOM-`document.fonts` API is not reliably testable in jsdom).

## Tests & Gates

- [ ] CHK-024 `cd app/frontend && npx tsc --noEmit` exits 0.
- [ ] CHK-025 `just test-frontend` (Vitest) exits 0.
- [ ] CHK-026 `just build` exits 0; `app/frontend/dist/` contains three `.woff2` files referenced by the built CSS (path a: fontsource-bundled; path b: copied from `public/fonts/`).
- [ ] CHK-027 `just test-backend` exits 0 (sanity — no expected impact).
- [ ] CHK-028 `just test-e2e` exits 0; any rebaselined visual snapshot is noted explicitly in tasks.md rework notes.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-### **N/A**: {reason}`
- Path-(a) vs path-(b) items: CHK-001 is satisfied by exactly one path; document which in tasks.md.
