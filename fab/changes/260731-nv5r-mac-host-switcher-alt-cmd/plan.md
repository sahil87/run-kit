# Plan: Mac Host-Switcher Accelerators to ⌥⌘1–9

**Change**: 260731-nv5r-mac-host-switcher-alt-cmd
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Switcher Accelerator Platform Split

#### R1: Mac switcher moves to ⌥⌘1–9; win/linux stays ⇧Ctrl+1–9
The Hosts-switcher radio accelerators in `app/desktop/src/menu.ts` (`hostsMenu`) MUST be platform-split: `Alt+Cmd+${n}` on macOS (`isMac`) and `Shift+Ctrl+${n}` on Windows/Linux, still capped by `MAX_SWITCHER_ACCELERATORS` (9). Windows/Linux behavior MUST be byte-identical to today's `Shift+CmdOrCtrl+${n}` (which resolves to ⇧Ctrl there).

- **GIVEN** a macOS desktop shell with 3+ hosts configured
- **WHEN** the user presses ⌥⌘3 / ⌥⌘4 / ⌥⌘5
- **THEN** the shell switches to hosts 3–5 (no screenshot is taken — ⇧⌘3/4/5 are no longer bound, so the macOS screenshot system shortcuts no longer collide with host switching)
- **AND** on Windows/Linux ⇧Ctrl+1–9 switches hosts exactly as before

#### R2: `menu.ts` header contract rewrite
The two-tier rule header comment in `app/desktop/src/menu.ts` MUST be rewritten (not patched): shell tier = **⌥⌘ on mac, ⇧Ctrl on win/linux** (no longer platform-neutral); page tier = unshifted `CmdOrCtrl+<any>` (unchanged); on mac, ⇧⌘ now belongs to the page (the SPA's shifted action tier) with the documented carve-outs ⇧⌘R (forceReload role) and ⇧⌘Z (Edit redo role). The macOS exhaustive bound list MUST move the Hosts radios to ⌥⌘1–⌥⌘9 (noting ⌥⌘H hideOthers / ⌥⌘I devtools coexist in the same modifier family) and add the freed ⇧⌘1–9 to the guaranteed fall-through set (with a parenthetical that ⇧⌘3/4/5 are macOS screenshot system claims the page also can't receive). The win/linux table stays unchanged. The screenshot-interception rationale for the move MUST be recorded in the header, and the hardware-verify caveat MUST be retained and reworded for ⌥⌘ digits (AZERTY digits require Shift; Option composes characters; no scancode workaround).

- **GIVEN** a future contributor reading `menu.ts` to add a shell accelerator
- **WHEN** they read the header contract
- **THEN** it states the per-platform shell tier, the reason ⇧⌘ digits were abandoned on mac, the exhaustive per-platform bound sets, and the retained manual-verify caveat

### Frontend Registry: Claimed-Key Mirror

#### R3: Claims mirror platform split + mac screenshot system claims
`app/frontend/src/lib/keybindings.ts` MUST update the hand-maintained shell-claims mirror in the same change: `SHELL_SWITCHER_DIGITS` (shifted-tier `Digit1–Digit9`, owner `shell`) becomes `platform: "other"` only. On mac the shell's digit claim leaves the tier map entirely — `BindingTier` stays `"shifted" | "cmd" | "ctrl"`, no new tier is added (⌥⌘ is unrepresentable and un-capturable by design). The shifted tier MUST gain mac `system` claims `Digit3`/`Digit4`/`Digit5` labeled `"screenshot"` with `platform: "mac"` (no `shell` restriction — like the ⇧⌘Q logout row, they apply on both shell and browser hosts). Freed mac ⇧⌘1/2/6–9 carry no claims. Doc comments (`claimedKeys` header, the module-header Alt note, `SHELL_SWITCHER_DIGITS` comment) MUST be updated to read accurately. `resolveBindings` behavior MUST be unchanged: shell/system claims never disable bindings (only `browser` claims reserve).

- **GIVEN** `claimedKeys("mac", shell)` for either `shell` value
- **WHEN** filtering the shifted tier
- **THEN** it contains no shell-owned digit claims, contains system-owned `Digit3/4/5` labeled "screenshot", and `Digit1/2/6–9` are unclaimed
- **AND** `claimedKeys("other", …)` still returns the nine shell-owned switcher digits

### Frontend Overlay: Locked Rows + Tier Map

#### R4: Overlay switcher row shows ⌥⌘ on the mac display; digit cells follow claims
In `app/frontend/src/components/shortcuts-overlay.tsx`, the locked shell row "Switch to server 1–9" MUST render caps `["⌥","⌘","1…9"]` on the mac display and `["Shift","Ctrl","1…9"]` otherwise, while "Force reload" keeps the shared `tierCaps` (⇧⌘R / Shift+Ctrl+R). Tier-map digit cells follow the claims data automatically; the decorative digit-run ellipsis cell (standing for Digit3–Digit8) MUST key its claimed styling off a digit that keeps mid-run claims visible on both displays (`Digit3`: switcher-claimed on win/linux, screenshot-claimed on mac).

- **GIVEN** the shortcuts overlay with the display toggle set to macOS
- **WHEN** the locked SHELL section renders
- **THEN** the switcher row shows ⌥ ⌘ 1…9 and the Force reload row shows ⇧ ⌘ R
- **AND** the shifted tier map renders Digit1/2/9 unclaimed ("free") with the ellipsis cell styled claimed (the 3/4/5 screenshot claims)

### Tests & Sweep

#### R5: Unit tests conform to the new claim shape
`app/frontend/src/lib/keybindings.test.ts` (`claimedKeys` suite) MUST assert the platform split (win/linux keeps the digits; mac shifted has no shell digit claims, gains system screenshot claims on both hosts). `app/frontend/src/components/shortcuts-overlay.test.tsx` MUST assert the mac-display ⌥⌘ switcher caps and the disappearance of "server" digit claims on the mac display.

- **GIVEN** `just test-frontend`
- **WHEN** the suites run
- **THEN** all pass with the updated assertions

#### R6: No stale ⇧⌘-switcher references; e2e untouched
Stale comment references to the ⇧⌘1–9 switcher in `app/frontend/src/app.tsx` and `app/frontend/src/lib/palette-shell.ts` MUST be updated to the per-platform accelerators. A grep of `app/frontend/tests/e2e/` MUST confirm no e2e spec asserts switcher rows/claims (so no `.spec.ts`/`.spec.md` changes are needed).

- **GIVEN** the change is complete
- **WHEN** grepping the repo for `⇧⌘1`, `Shift+CmdOrCtrl+${`-style switcher accelerators and "Switch to server" in e2e
- **THEN** only intentionally per-platform references remain and no e2e assertion changed

### Non-Goals

- No mirroring of the ⌥⌘ move to Windows/Linux (Ctrl+Alt is AltGr on many European layouts)
- No scancode workaround for the AZERTY/shifted-digit Electron accelerator flakiness (remains a documented manual-verify item)
- No new `BindingTier`, no capture-model change (Alt chords stay rejected), no backend/API/route impact

## Tasks

### Phase 1: Core Implementation

- [x] T001 Platform-split the Hosts-switcher accelerator in `app/desktop/src/menu.ts` `hostsMenu` (`isMac ? Alt+Cmd+n : Shift+Ctrl+n`) and update the inline comment above it <!-- R1 -->
- [x] T002 Rewrite the `menu.ts` header contract (two-tier rule, mac exhaustive bound list, freed ⇧⌘1–9 fall-through, screenshot rationale, reworded hardware-verify caveat; win/linux table unchanged) <!-- R2 -->
- [x] T003 [P] Update the claims mirror in `app/frontend/src/lib/keybindings.ts`: `SHELL_SWITCHER_DIGITS` → `platform: "other"`; add mac system `Digit3/4/5` "screenshot" claims; update `claimedKeys` + module-header + const doc comments <!-- R3 -->
- [x] T004 Update `app/frontend/src/components/shortcuts-overlay.tsx`: mac-display switcher caps `⌥ ⌘ 1…9` in `shellRows`; ellipsis cell keyed off `Digit3`; comment updates <!-- R4 -->

### Phase 2: Tests

- [x] T005 [P] Update `app/frontend/src/lib/keybindings.test.ts` `claimedKeys` suite for the platform split + screenshot claims (both hosts) <!-- R5 -->
- [x] T006 [P] Update `app/frontend/src/components/shortcuts-overlay.test.tsx`: mac-display locked-row ⌥⌘ caps assertion + no "server"-titled digit cells on the mac display <!-- R5 -->

### Phase 3: Integration & Sweep

- [x] T007 Update stale ⇧⌘1–9 switcher comment references in `app/frontend/src/app.tsx` (~line 2336) and `app/frontend/src/lib/palette-shell.ts` (~line 4); re-run the e2e grep to confirm no spec asserts switcher rows <!-- R6 -->
- [x] T008 Verify: `just check` (tsc), `just test-frontend` (Vitest), desktop package compile + node:test (`app/desktop`: `pnpm run compile && pnpm test` — no just recipe exists for the desktop package), and `just test-e2e shortcut-registry` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `hostsMenu` binds `Alt+Cmd+${n}` on darwin and `Shift+Ctrl+${n}` elsewhere, capped at `MAX_SWITCHER_ACCELERATORS` (9); hosts beyond 9 get `undefined`
- [x] A-002 R2: The `menu.ts` header states shell tier = ⌥⌘ (mac) / ⇧Ctrl (win/linux), records the ⇧⌘3/4/5 screenshot-interception rationale, moves the mac Hosts radios to ⌥⌘1–9 in the exhaustive list, adds freed ⇧⌘1–9 to the fall-through set, keeps the win/linux table unchanged, and retains the reworded ⌥⌘-digit hardware-verify caveat
- [x] A-003 R3: `SHELL_SWITCHER_DIGITS` carries `platform: "other"`; `claimedKeys("mac", …)` shifted tier has no shell digit claims and gains system `Digit3/4/5` "screenshot" claims in both hosts; `BindingTier` is unchanged (no Option tier)
- [x] A-004 R4: The overlay's locked switcher row renders ⌥ ⌘ 1…9 on the mac display and Shift Ctrl 1…9 otherwise; Force reload keeps the shared tier caps; the ellipsis cell keys off `Digit3`

### Behavioral Correctness

- [x] A-005 R3: `resolveBindings` enable/disable behavior is unchanged — system/shell claims never disable a binding; only `browser` claims reserve
- [x] A-006 R1: Windows/Linux switcher behavior is byte-identical (⇧Ctrl+1–9; the accelerator-string change from `Shift+CmdOrCtrl` to explicit `Shift+Ctrl` is representation-only)

### Scenario Coverage

- [x] A-007 R5: `keybindings.test.ts` asserts the digit-claim platform split and the mac screenshot claims (both hosts); `shortcuts-overlay.test.tsx` asserts the mac-display ⌥⌘ locked row and the absence of "server" digit claims there; both suites pass
- [x] A-008 R6: e2e grep confirms no switcher-row assertions exist (no `.spec.ts`/`.spec.md` changed); stale ⇧⌘1–9 comments in `app.tsx` and `palette-shell.ts` updated

### Code Quality

- [x] A-009 Pattern consistency: changes follow surrounding conventions (claims-as-data rows mirroring the ⇧⌘Q logout shape; per-platform menu builders branching on `isMac`; free-form locked-row caps arrays)
- [x] A-010 No unnecessary duplication: no new tier, resolver branch, or capture path — pure data + presentation changes reusing existing seams

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Manual-verify (documented, not automated): ⌥⌘1–9 switching on macOS hardware incl. a non-US layout spot-check; win/linux ⇧Ctrl+1–9 unchanged — Electron menu accelerators are not exercisable from the SPA e2e harness

## Deletion Candidates

None — this change is a modifier remap plus its documentation/claims mirror; it makes no existing file, function, branch, or config row redundant. The `SHELL_SWITCHER_DIGITS` const narrows to `platform: "other"` but is still consumed by `claimedKeys` for win/linux, and `tierCaps` in `shortcuts-overlay.tsx` retains two live call sites (Force reload, DevTools) after `switcherCaps` split off.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The decorative digit-run ellipsis cell keys its claimed styling off `Digit3` (was `Digit1`) | The ellipsis stands for Digit3–Digit8; after the split, mac Digit1 is unclaimed, so keeping the old key would render the 3/4/5 screenshot claims invisible in the tier map — the intake's "verify its presentation" item resolved toward honesty; win/linux rendering is unchanged (all nine digits claimed there) | S:70 R:95 A:85 D:75 |
| 2 | Confident | `SHELL_SWITCHER_DIGITS` keeps its name; its doc comment states the win/linux-only scope | Intake offers name/comment update "if it no longer reads accurately" — the const still is the shell's switcher digit claim set; a comment is the smaller diff | S:60 R:95 A:85 D:70 |
| 3 | Confident | Desktop package verification runs via its own `pnpm run compile && pnpm test` in `app/desktop` | No `just` recipe covers the desktop package's compile/node:test (only dev-desktop/build-desktop, which launch/package Electron); the just-recipes rule exists for port isolation of frontend/Playwright runs, which does not apply here | S:65 R:90 A:85 D:70 |
| 4 | Confident | Stale ⇧⌘1–9 comment references in `app.tsx` and `palette-shell.ts` are updated in this change | The intake's mirror-doc scope ("doc comments updated") plus the repo-wide grep surfaced exactly these two; leaving them would contradict the rewritten contract | S:70 R:95 A:90 D:80 |

4 assumptions (0 certain, 4 confident, 0 tentative).
