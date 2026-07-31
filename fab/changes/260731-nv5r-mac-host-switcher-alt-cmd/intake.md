# Intake: Mac Host-Switcher Accelerators to ⌥⌘1–9

**Change**: 260731-nv5r-mac-host-switcher-alt-cmd
**Created**: 2026-07-31

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a synthesized live-conversation change description:

> Move the desktop-shell host-switcher accelerators on macOS from ⇧⌘1–9 to ⌥⌘1–9; keep ⇧Ctrl+1–9 on Windows/Linux.

The conversation had already resolved the design: the deciding defect is that ⇧⌘3/⇧⌘4/⇧⌘5 are macOS system-wide screenshot shortcuts which intercept before app menu accelerators — with 3+ hosts configured, keyboard-switching to hosts 3–5 takes screenshots instead of switching. ⌥⌘ was chosen because the SPA keybinding registry deliberately excludes Option from all chord tiers, making ⌥⌘ territory the page will never claim; Windows/Linux explicitly do NOT mirror the change (Ctrl+Alt is AltGr on many European layouts — Ctrl+Alt+digit would steal character typing in a terminal app, and there is no screenshot collision there).

## Why

1. **The pain point**: The desktop shell binds `Shift+CmdOrCtrl+${n}` menu accelerators for the Hosts switcher (`app/desktop/src/menu.ts`, `hostsMenu`). On macOS, ⇧⌘3, ⇧⌘4, and ⇧⌘5 are system-wide screenshot shortcuts, and system shortcuts intercept **before** app menu accelerators. On a default macOS install with 3+ hosts configured, switching to hosts 3–5 via keyboard does not work — it takes screenshots instead. This is a functional defect, not a polish item.

2. **If we don't fix it**: Host switching — the shell's only shell-tier keyboard claim — is silently broken for 3 of its 9 slots on the shell's primary platform. Users get a screenshot flash instead of a host switch, with no error and no discoverable cause.

3. **Why ⌥⌘ (and why mac-only)**:
   - The SPA keybinding registry (`app/frontend/src/lib/keybindings.ts`, module header ~line 24) deliberately excludes Option/Alt from all chord tiers ("Alt chords are never matched: Alt is not part of any tier (macOS uses it for character composition)"). ⌥⌘ is therefore territory the page will **never** claim — a structurally better long-term fit for the shell tier on mac than ⇧⌘, where today the shell's digits squat inside the SPA's own action tier (`shifted` = ⇧CmdOrCtrl), coordinated only by the hand-maintained claimed-key map.
   - After the change the ownership story on mac is clean: **page owns ⌘ and ⇧⌘, shell owns ⌥⌘**. It also frees ⇧⌘1–9 as future page real estate on mac.
   - No conflicts: the shell's only existing ⌥⌘ bindings are ⌥⌘H (hide-others role) and ⌥⌘I (devtools role); no macOS system or browser claim exists on ⌥⌘ digits.
   - **Windows/Linux keep ⇧Ctrl+1–9** (rejected alternative: mirroring the change). Ctrl+Alt is AltGr on many European keyboard layouts, so Ctrl+Alt+digit accelerators would steal character typing in a terminal app. There is no screenshot collision on Windows (Win+Shift+S) or Linux. The `menu.ts` header already blesses "symmetry of rule, not symmetry of accelerator table" — but the two-tier contract wording must change, since the shell tier stops being platform-neutral.
   - **Not solved (documented, unchanged)**: the AZERTY/shifted-digit Electron accelerator flakiness caveat (Electron resolves accelerators by character, not scancode; AZERTY digits require Shift) does not go away with ⌥⌘ — digit accelerators on non-US layouts remain a documented manual-verify item either way. No scancode workaround is in scope.

## What Changes

### 1. `app/desktop/src/menu.ts` — platform-split switcher accelerator

The Hosts switcher accelerator (currently line ~259):

```ts
accelerator: index < MAX_SWITCHER_ACCELERATORS ? `Shift+CmdOrCtrl+${index + 1}` : undefined,
```

becomes platform-split (the `isMac` const already exists in the module):

```ts
accelerator:
  index < MAX_SWITCHER_ACCELERATORS
    ? isMac
      ? `Alt+Cmd+${index + 1}`
      : `Shift+Ctrl+${index + 1}`
    : undefined,
```

`MAX_SWITCHER_ACCELERATORS` stays 9. The inline comment above the accelerator (lines ~256–258, "Shell tier (see the two-tier rule above): ⇧⌘1–9 (mac) / ⇧Ctrl+1–9 (win/linux)…") is updated to the new split.

### 2. `app/desktop/src/menu.ts` — header contract rewrite (lines ~12–50)

The two-tier rule header comment is the governing contract and must be rewritten, not patched:

- **Two-tier rule**: the shell tier stops being platform-neutral. New wording along the lines of: page tier = unshifted `CmdOrCtrl+<any>` (never bound by the shell, any platform — unchanged); shell tier = **⌥⌘ on mac, ⇧Ctrl on win/linux** — shell chrome MAY claim keys there, sparingly; today's only claim is the Hosts switcher (1–9). On mac, ⇧⌘ now also belongs to the page (the SPA's action tier), with the documented View carve-out ⇧⌘R (forceReload role) and the ⇧⌘Z Edit redo role.
- **macOS exhaustive bound-accelerator list**: Hosts radios move from "⇧⌘1–⇧⌘9 (the shell tier)" to "⌥⌘1–⌥⌘9 (the shell tier)"; note that ⌥⌘H (hideOthers) and ⌥⌘I (devtools) coexist in the same modifier family as documented carve-outs/roles. The guaranteed fall-through set gains the freed ⇧⌘1–9 (future page real estate; ⇧⌘3/4/5 are macOS screenshot system claims the page also can't receive — worth a parenthetical).
- **Windows/Linux table**: unchanged (⇧Ctrl+1–9 Hosts switcher, ⇧Ctrl+R, ⇧Ctrl+I, F11). Spell the accelerator string change (`Shift+CmdOrCtrl` → explicit per-platform strings) as an implementation note if useful, but behavior on win/linux is byte-identical.
- **Hardware-verify caveat**: retained and reworded — ⌥⌘digit switching on non-US layouts (AZERTY digits require Shift; Option composes characters) remains the manual-verify item; no scancode workaround in v1.
- The reason for the move (⇧⌘3/4/5 macOS screenshot interception — system shortcuts beat menu accelerators) is recorded in the header so the contract explains itself.

### 3. `app/frontend/src/lib/keybindings.ts` — hand-maintained shell-claims mirror

The desktop-shell memory rule requires the mirror to be updated **in the same change** as any shell accelerator change.

- `SHELL_SWITCHER_DIGITS` (~line 163) currently claims `Digit1–Digit9` on tier `"shifted"`, owner `"shell"`, **no platform restriction** (applies to both platforms and both host kinds). It becomes **platform-split: the shifted-tier digit claim applies only to `platform: "other"`** (win/linux). On mac, the shell's digit claim moves off the tier map entirely — `BindingTier` is `"shifted" | "cmd" | "ctrl"` and Option is deliberately not a tier, so ⌥⌘1–9 is *unrepresentable* (and un-capturable: `captureFromEvent` rejects Alt chords) — which is exactly the point of the move. No new tier is added.
- **New mac system claims** (the "keep the tier map honest" item, accepted into scope): the shifted tier gains `Digit3`/`Digit4`/`Digit5` claims with `owner: "system"`, `platform: "mac"`, label `"screenshot"` — mirroring the existing ⇧⌘Q logout row (`{ code: "KeyQ", tier: "shifted", label: "logout", owner: "system", platform: "mac" }`). Like logout, these apply on both shell and browser hosts (screenshots are system-wide). The freed mac ⇧⌘1/2/6–9 digits carry **no** claims — they are unclaimed future page real estate.
- Doc comments updated: the `claimedKeys()` header (~lines 209–219, "⇧CmdOrCtrl+1–9 switcher … apply everywhere") and the module-header claimed-key-map mention, plus the `SHELL_SWITCHER_DIGITS` name/comment if it no longer reads accurately (e.g. note it is the win/linux-only claim).
- Consequence to verify in `resolveBindings`/conflict paths: shell/system claims never disable bindings (only `browser` claims do), so no binding enable/disable behavior changes; capture warnings on mac ⇧⌘digit chords switch from "claimed by shell (server)" to "claimed by system (screenshot)" for 3/4/5 and disappear for the rest.

### 4. Shortcuts overlay (`app/frontend/src/components/shortcuts-overlay.tsx`)

- **Locked shell rows** (~lines 223–237): `shellRows` renders "Switch to server 1–9" with `tierCaps` = `["⇧","⌘",key]` on mac display / `["Shift","Ctrl",key]` otherwise. The switcher row must render **`["⌥","⌘","1…9"]` on the mac display** while "Force reload" keeps ⇧⌘R and the win/linux rows stay Shift+Ctrl — i.e. the switcher row's caps diverge from the shared `tierCaps` helper on mac. Locked rows are free-form caps arrays (not tier-constrained), so this needs no registry/tier change.
- **Tier map**: digit cells follow the claims data — on the mac display the shifted-tier digit cells stop rendering claimed "server" and instead render Digit3/4/5 claimed "screenshot" (owner system) with 1/2/6–9 unclaimed. The decorative digit-run ellipsis cell (~line 310) styles itself off the digit claim — verify its presentation on both platform displays after the data change.
- The overlay's explanatory copy (e.g. "shell menu accelerators inside the shell" hints) is checked for stale ⇧⌘-switcher references.

### 5. Tests

- **Unit (Vitest)** — these assert the current shape and MUST change with the mirror:
  - `app/frontend/src/lib/keybindings.test.ts` `claimedKeys` suite: "claims the shifted shell digits + R everywhere…" asserts mac shifted contains `Digit1`/`Digit9` — becomes the platform-split assertion (win/linux keeps the digits; mac shifted has no shell digit claims, gains system `Digit3/4/5` screenshot claims). "every pre-n789 claim carries tier 'shifted'" iterates `platform: "other"` only and survives, but re-verify.
  - `app/frontend/src/components/shortcuts-overlay.test.tsx` (~line 37): asserts the locked row "Switch to server 1–9" and the locked-row aria-labels — update for the mac ⌥⌘ caps if the test renders a mac display.
- **E2E (Playwright)** — per the known risk that specs assert UI-chrome details: a grep of `app/frontend/tests/e2e/` for switcher-claim/overlay-row assertions (`Switch to server`, digit claims, `1–9`) found **no e2e assertions on the switcher rows today** — `shortcut-registry.spec.ts` asserts overlay toggle, page-tier-map presence (`/page tier —/`), and mac browser-reserved behavior, none of which this change touches. Re-run the grep after the change; if any spec is updated, its sibling `.spec.md` updates in the same commit (constitution: Test Companion Docs).
- **Manual-verify item** (documented, not automated): ⌥⌘1–9 switching on macOS hardware, including a non-US layout spot-check; win/linux ⇧Ctrl+1–9 unchanged. Electron menu accelerators are not exercisable from the SPA e2e harness.

## Affected Memory

- `run-kit/desktop-shell`: (modify) the menu keyboard-tier seam — two-tier contract rewording (shell tier = ⌥⌘ on mac / ⇧Ctrl on win/linux), the Hosts switcher accelerator move and its screenshot-collision rationale, the retained AZERTY manual-verify caveat
- `run-kit/ui-patterns`: (modify) keybinding registry section — claimed-key map changes (shifted digit claims now win/linux-only; mac ⇧⌘3/4/5 system screenshot claims), locked shell-row rendering of ⌥⌘1…9 on mac

## Impact

- `app/desktop/src/menu.ts` — accelerator + header contract (desktop shell, Electron main process; no runtime behavior change on win/linux)
- `app/frontend/src/lib/keybindings.ts` — claims data + doc comments (pure data change; no `BindingTier` change, no matching/capture logic change)
- `app/frontend/src/lib/keybindings.test.ts` — claimedKeys assertions
- `app/frontend/src/components/shortcuts-overlay.tsx` — locked shell rows + tier-map digit cells
- `app/frontend/src/components/shortcuts-overlay.test.tsx` — locked-row assertions
- `app/frontend/tests/e2e/shortcut-registry.spec.ts` (+ `.spec.md`) — expected untouched; verify by grep after the change
- No backend, API, or route impact. No new dependencies.

## Open Questions

None — the change description resolves all decision points; see Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mac Hosts-switcher accelerator becomes `Alt+Cmd+${n}` (⌥⌘1–9); Windows/Linux stays `Shift+Ctrl+${n}` (⇧Ctrl+1–9), explicitly not mirrored | Discussed — deciding defect is macOS ⇧⌘3/4/5 screenshot interception; Ctrl+Alt is AltGr on European layouts so win/linux must not follow; no system/browser claim on mac ⌥⌘ digits | S:95 R:70 A:90 D:95 |
| 2 | Certain | `menu.ts` two-tier header contract is rewritten: shell tier = ⌥⌘ on mac / ⇧Ctrl on win/linux; mac exhaustive bound list updated (Hosts radios ⌥⌘1–9, ⇧⌘1–9 freed to the page); win/linux table unchanged | Discussed — the description names the header rework as required; "symmetry of rule, not symmetry of accelerator table" already blesses per-platform tables | S:90 R:90 A:90 D:90 |
| 3 | Certain | `keybindings.ts` claimed-key mirror updates in the same change: `SHELL_SWITCHER_DIGITS` shifted-tier digit claims become `platform: "other"` only; no new `BindingTier` for Option | Discussed — desktop-shell memory rule mandates same-change mirror updates; the description specifies the platform-split representation and that Option stays a non-tier | S:90 R:85 A:90 D:80 |
| 4 | Confident | Mac ⌥⌘ host-switching is surfaced in the overlay only via the locked shell row (caps `⌥ ⌘ 1…9` on the mac display); it does not enter the tier map or the capture model (Alt chords rejected by design) | The description flags overlay surfacing as a design decision to capture; locked rows are free-form caps arrays so this is the minimal honest representation — a new tier was explicitly ruled out | S:65 R:90 A:80 D:65 |
| 5 | Confident | The optional item is in scope: ⇧⌘3/4/5 recorded as mac `system` claims labeled "screenshot" (both hosts, like the existing ⇧⌘Q logout row); freed mac ⇧⌘1/2/6–9 stay unclaimed | Description says "worth capturing … would keep the tier map honest"; trivially reversible data rows mirroring an existing pattern | S:70 R:90 A:75 D:55 |
| 6 | Certain | The AZERTY/shifted-digit accelerator flakiness caveat stays a documented manual-verify item (reworded for ⌥⌘ digits); no scancode workaround | Discussed — explicitly constrained out of scope; the caveat is layout-based and survives the modifier change | S:90 R:85 A:90 D:90 |
| 7 | Certain | Unit tests (`keybindings.test.ts` claimedKeys suite, `shortcuts-overlay.test.tsx` locked rows) update to the new claim shape; e2e specs verified by grep (none assert switcher rows today) | Tests conform to spec (constitution Test Integrity); grep of `app/frontend/tests/e2e/` performed during intake found no switcher-row assertions | S:85 R:90 A:90 D:85 |
| 8 | Confident | Change type is `fix` — the driving motivation is the broken hosts-3–5 switching defect on macOS, not a new capability | The description names the screenshot collision "the deciding defect"; keyword inference from the slug would otherwise default to `feat` | S:70 R:95 A:85 D:75 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
