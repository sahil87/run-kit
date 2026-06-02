# Plan: Bundle JetBrainsMono Nerd Font as a webfont in the frontend

**Change**: 260417-hyrl-bundle-jetbrains-mono-nerd-font
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

<!-- font-source-decision: path-b-manual (npm registry has @fontsource/jetbrains-mono 5.2.8 but it is vanilla JetBrains Mono without Nerd Font patched glyphs; @fontsource/jetbrains-mono-nerd-font does not exist — 404 on npm registry 2026-04-17) -->

- [x] T001 Resolve font source — query the npm registry for `@fontsource/jetbrains-mono-nerd-font` (and fontsource-like aliases) to determine whether path (a) npm package or path (b) manual drop-in will be used. If a suitable package exists, capture its exact package name and version for T002. If not, confirm path (b) and document the decision inline in this tasks file as `<!-- font-source-decision: manual-drop-in (no fontsource package available) -->`.
- [x] T002 Add the font dependency OR prepare the manual-drop-in files, based on T001's outcome.
   - If path (a): `cd app/frontend && pnpm add <resolved-package>@<version>`; verify `app/frontend/package.json` dependencies entry and `pnpm-lock.yaml` are updated.
   - If path (b): Retain the existing `app/frontend/public/fonts/JetBrainsMonoNerdFont-Regular.woff2`. Download `JetBrainsMonoNerdFont-Bold.woff2` and `JetBrainsMonoNerdFont-Italic.woff2` from the current Nerd Fonts GitHub release and place both in `app/frontend/public/fonts/`. Do NOT re-download Regular. <!-- path-b taken: Bold + Italic .ttf downloaded from ryanoasis/nerd-fonts v3.4.0 via jsDelivr, converted via woff2_compress (system package), placed in app/frontend/public/fonts/ -->



## Phase 2: Core Implementation

- [x] T003 Update `app/frontend/src/globals.css` @font-face rules.
   - Replace the single existing `@font-face` (Regular-only, `font-display: swap`) with three `@font-face` rules (Regular 400/normal, Bold 700/normal, Italic 400/italic), all with `font-display: block`.
   - If path (a): replace the hand-authored rules with the package's documented CSS imports (e.g., `@import "@fontsource/jetbrains-mono-nerd-font/400.css";` equivalents for Bold + Italic), then add an override block declaring `font-display: block` for `font-family: "JetBrainsMono Nerd Font"` since most fontsource packages ship `font-display: swap` by default.
   - If path (b): author three `@font-face` rules directly in `globals.css` referencing `/fonts/JetBrainsMonoNerdFont-{Regular,Bold,Italic}.woff2`.
- [x] T004 Update the `fontFamily` passed to `new Terminal(...)` in `app/frontend/src/components/terminal-client.tsx` (around line 131–132) to `'"JetBrainsMono Nerd Font", ui-monospace, monospace'` — remove the intermediate `JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas` entries.
- [x] T005 Add the font-load await to the init routine in `app/frontend/src/components/terminal-client.tsx`. Insert the await BEFORE `new Terminal(...)` (around line 127–128):
    ```ts
    const fontPx = isMobile ? 11 : 13;
    await Promise.all([
      document.fonts.load(`${fontPx}px "JetBrainsMono Nerd Font"`),
      document.fonts.load(`bold ${fontPx}px "JetBrainsMono Nerd Font"`),
      document.fonts.load(`italic ${fontPx}px "JetBrainsMono Nerd Font"`),
    ]);
    if (cancelled || !terminalRef.current) return;
    ```
   Use `fontPx` in the subsequent `fontSize: isMobile ? 11 : 13` assignment to avoid recomputation (or keep the ternary — either is fine; the load calls must reference the same pixel size xterm will actually use).
- [x] T006 [P] Add the Regular-weight preload link to `app/frontend/index.html`. Insert inside `<head>` after the favicon link:
    ```html
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/JetBrainsMonoNerdFont-Regular.woff2" />
    ```
   If path (a) is chosen and the fontsource package serves the Regular `.woff2` at a different path (e.g., a hashed filename under `/assets/`), update the `href` to match the build-output path. When Vite fingerprints the asset, this may require a small build-time indirection (e.g., an `import` of the woff2 URL in `main.tsx` and then reading `import.meta.env` or equivalent). Prefer path (b) or a non-hashed public-path preload where possible; if this indirection adds complexity, omit the preload rather than ship a broken `href`.

## Phase 3: Integration & Edge Cases

- [x] T007 Verify the font-load await respects `cancelled` / `!terminalRef.current` guards. Confirm the existing pattern (see lines 125, 146, 151, 161, 210 of the pre-change file) is mirrored for the new await. The guard MUST follow the `await Promise.all([...])` line and MUST check both `cancelled` and `!terminalRef.current`. <!-- verified: guard present at lines 140-141 after the Promise.all, matching the existing pattern -->
- [x] T008 Sanity-grep the codebase for any other `font-family` references that might need updating: `rg -n "JetBrains Mono|Fira Code|SF Mono|Menlo|Monaco|Consolas" app/frontend/`. Confirm only `globals.css` `--font-mono` and `components/terminal-client.tsx` `fontFamily` are affected. If `--font-mono` is trimmed, trim to `"JetBrainsMono Nerd Font", ui-monospace, monospace`; otherwise leave untouched per Assumption #17 (optional cleanup). <!-- only globals.css --font-mono still has long tail; left untouched per Assumption #17 (optional cleanup, avoids rebaselining unrelated snapshots) -->


## Phase 4: Polish / Verification

- [x] T009 Run `cd app/frontend && npx tsc --noEmit` — must exit 0 (frontend type check). <!-- ran via `just check` (tsc --noEmit wrapper); exit 0 -->

- [x] T010 Run `just test-frontend` — all Vitest unit tests must pass. Investigate any failures per Requirement: "Existing tests continue to pass" — fix or rebaseline only if invalidated by legitimate behavior change. <!-- 419/419 tests pass after stubbing document.fonts in src/test-setup.ts (jsdom does not implement the FontFaceSet API; stubbed a minimal load()/ready surface mirroring the existing ResizeObserver stub pattern) -->
- [x] T011 Run `just build` — Vite bundle must include the three `.woff2` files and `@font-face` URLs must resolve to served paths. Inspect `app/frontend/dist/` to confirm. <!-- ran `just build`; dist/fonts/ contains all three woff2; dist/index.html has preload link; build exit 0 -->
- [x] T012 [P] Run `just test-backend` — sanity check that backend tests still pass (no expected impact; this is a guard against accidental changes). <!-- pre-existing unrelated failure in internal/sessions TestFetchPaneMapIntegration (tmux list-sessions env issue); confirmed fails identically on base branch via git stash so not caused by this change; all other backend packages pass -->
- [x] T013 Run `just test-e2e` — Playwright e2e tests on port 3020. Investigate any visual failures: if a snapshot diff is legitimately caused by the font change (new font metrics eliminating wobble), rebaseline the snapshot and note it explicitly here as a rework comment. <!-- 7 tests flake with identical failures on base (confirmed via git stash -u baseline run): api-integration create-session, sidebar-panels 4 tests, sidebar-window-sync, sync-latency — all tmux/SSE-timing flakes on this remote VM, none related to font change. Playwright chromium browser was not pre-installed (fixed with `pnpm exec playwright install chromium`). No visual/snapshot tests failed from font metrics change. -->
- [ ] T014 Manual Playwright verification (optional but recommended): with `RK_PORT=3020 just dev` running, open a window with a powerline status bar and confirm per-character baselines align cleanly at both desktop (1024×768, 13px) and mobile (375×812, 11px) viewports. Capture two screenshots (`.playwright-artifacts/` or similar) for the PR body. <!-- optional; skipped in subagent run (no interactive environment for manual visual verification) -->


---

## Execution Order

- **Phase 1 → Phase 2**: T001 blocks T002; T002 blocks T003.
- **Within Phase 2**: T003 and T004 are independent of each other. T005 depends on T004 (same file). T006 is independent of T003–T005.
- **Phase 2 → Phase 3**: T003–T006 must complete before T007–T008.
- **Within Phase 3**: T007 depends on T005 (same code path); T008 is independent.
- **Phase 3 → Phase 4**: All Phase 3 tasks complete before Phase 4 verification.
- **Within Phase 4**: T009 first (cheapest, fail-fast). T010, T011, T012 are independent (mark [P] where applicable). T013 depends on T011 (needs working build). T014 is optional, runs last.

## Notes

- **Path decision record**: T001 SHALL write the chosen path (a or b) inline in this file as a `<!-- font-source-decision: ... -->` comment so review / hydrate can audit the choice without re-running the registry query.
- **Rework gate**: If any of T009–T013 fails AND the failure is a legitimate regression (not a stale test), uncheck the relevant Phase 2 / 3 task(s) with `<!-- rework: reason -->` and re-run from the unchecked task forward.

## Acceptance

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
