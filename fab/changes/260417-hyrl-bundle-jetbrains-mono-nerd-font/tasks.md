# Tasks: Bundle JetBrainsMono Nerd Font as a webfont in the frontend

**Change**: 260417-hyrl-bundle-jetbrains-mono-nerd-font
**Spec**: `spec.md`
**Intake**: `intake.md`

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
