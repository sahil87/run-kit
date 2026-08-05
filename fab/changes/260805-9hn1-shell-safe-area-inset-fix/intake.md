# Intake: Shell Safe-Area Inset Fix

**Change**: 260805-9hn1-shell-safe-area-inset-fix
**Created**: 2026-08-05

## Origin

`/fab-new shell-safe-area-inset-fix`, second attempt. A prior change (`260731-0fou-shell-safe-area-inset-fix`, uncommitted in worktree `run-kit.worktrees/shell-safe-area-inset-fix`) stalled at intake awaiting a DevTools probe from the affected macOS shell window; the probe never ran. In this session the user resolved the block by decision rather than evidence:

> No new DevTools probe evidence. Proceed on the already-diagnosed root cause instead: top-bar.tsx `pt-[env(safe-area-inset-top)]` has never been gated on `isShell()`, and the shell titlebar strip (ShellTitlebarStrip, 28px) already reserves that vertical space. Whatever the exact Electron-native painting mechanism turns out to be, gating the safe-area padding off inside the shell is the correct and sufficient fix regardless — it removes the double-reservation entirely rather than depending on knowing the precise rendering internals. Implement: (1) gate the `pt-[env(safe-area-inset-top)]` class on `isShell()` in top-bar.tsx, (2) add a unit test in top-bar.test.tsx asserting the safe-area class is present when isShell() is mocked false and absent when mocked true, (3) update docs/memory/run-kit/ui-patterns.md noting the interaction rule. Do not block on the DevTools probe for this fix.

Findings carried over from the prior intake (its investigation remains valid context): the observed symptom is an opaque `titlebarHex`-colored band covering the entire top toolbar in the macOS desktop shell (screenshot `.uploads/260731191012-image.png` in the old worktree); the regression boundary is v3.12.11→v3.12.12, exactly one commit — `6abd8edf` (PR #487, the accent titlebar strip + hidden titlebar feature); a headless-Chromium reproduction (`shell-probe.mjs`) exonerated SPA-side composition in plain Chromium and showed forced `env(safe-area-inset-top)` produces pure downward displacement, never occlusion.

## Why

**Problem**: Inside the desktop shell (Electron, `titleBarStyle: "hiddenInset"` on macOS), the top bar's safe-area guard `pt-[env(safe-area-inset-top)]` (`app/frontend/src/components/top-bar.tsx:794`, added by 260724-2bmy for standalone PWA mode) double-reserves the titlebar band: the `ShellTitlebarStrip` (28px, from PR #487) already reserves that vertical space in the SPA's own layout, and the OS/Electron can additionally report the hidden-titlebar region as a non-zero `env(safe-area-inset-top)`. The code comment's assumption — "env() is 0 in browsers/desktop so this is a no-op there" — does not hold for the desktop shell.

**Consequence if unfixed**: the shell's top chrome mis-lays-out — v3.12.12 shipped with the toolbar unusable under a strip-colored band (the primary navigation and control surface), making the shell effectively broken.

**Why this approach**: the exact Electron-native painting mechanism behind the observed band was never empirically pinned (the DevTools probe was never run). The user decided the fix should not depend on knowing those internals: whichever agent paints the band, the SPA reserving the titlebar space **twice** (strip + safe-area padding) is a defect on its own, and removing the second reservation in-shell is correct and sufficient regardless. The probe-first path (the prior intake's Step 0) is explicitly abandoned as a blocker.

## What Changes

### 1. Gate the top-bar safe-area padding on `isShell()` (`app/frontend/src/components/top-bar.tsx`)

Current (top-bar.tsx:790–794):

```tsx
return (
    // pt guard: viewport-fit=cover (safe-area work, 260724-2bmy) can expose the
    // status-bar area in standalone PWA mode; env() is 0 in browsers/desktop so
    // this is a no-op there.
    <header className="px-3 pt-[env(safe-area-inset-top)] border-b-[3px] border-border">
```

New behavior: the `pt-[env(safe-area-inset-top)]` class is present when `isShell()` is false (browsers, PWA — byte-identical behavior to today, where `env()` is 0 outside standalone PWA anyway) and **absent** when `isShell()` is true (the `ShellTitlebarStrip` already reserves the titlebar band; the shell must not add a second reservation). Implementation shape (no `cn()` utility exists in this codebase — use a conditional template literal, matching local patterns):

```tsx
import { isShell } from "@/lib/shell";
// ...
<header
  className={`px-3 ${isShell() ? "" : "pt-[env(safe-area-inset-top)]"} border-b-[3px] border-border`}
>
```

Update the comment to state the interaction rule: the guard is for standalone-PWA `viewport-fit=cover`; inside the desktop shell the titlebar strip already reserves the top band and macOS hidden-titlebar windows can report that band as `safe-area-inset-top`, so the padding is dropped there to avoid double reservation. `isShell()` is read once per render — acceptable because the shell preload injects `window.runkitShell` via contextBridge before any SPA script runs, so the value is stable for the page's lifetime (no subscription/reactivity needed).

### 2. Unit test (`app/frontend/src/components/top-bar.test.tsx`)

Add a describe block asserting, on the rendered `<header>` (`screen.getByRole("banner")` or equivalent):

- `isShell()` false (default jsdom — `window.runkitShell` absent): className **contains** `pt-[env(safe-area-inset-top)]`
- `isShell()` true: className **does not contain** the class

Drive `isShell()` through its real seam rather than `vi.mock`: set `window.runkitShell = { version: "…", platform: "darwin" }` before render and `delete window.runkitShell` in cleanup — the established pattern from `src/lib/shell.test.ts`. The existing top-bar.test.tsx harness (router hooks mocked, ChromeProvider/ThemeProvider/ToastProvider wrappers) is reused as-is.

### 3. Memory update (`docs/memory/run-kit/ui-patterns.md`)

- **§ Safe-Area Insets** (~line 1939): the top-bar consumer entry gains the shell exception — the guard is `isShell()`-gated off inside the desktop shell because the titlebar strip already reserves the band (interaction rule: *edge-docked safe-area padding and shell-reserved chrome must not stack*).
- **Top-bar layout paragraph** (~line 883): the `pt-[env(safe-area-inset-top)]` mention gains the same in-shell exception note.

The main body of the memory write happens at hydrate as usual; this section records the user-directed content so hydrate needs no re-derivation.

### Explicitly out of scope

- **Bottom bar** (`bottom-bar.tsx` `pb-[max(0.375rem,env(safe-area-inset-bottom))]`): untouched — the `max()` floor degrades to the normal 6px at inset 0, and no shell symptom implicates it.
- **The DevTools probe / Electron-native paint investigation**: explicitly not a blocker for this fix. If the band symptom survives this fix in a release build, that investigation reopens as a separate change.
- Mobile/PWA safe-area behavior of 260724-2bmy must remain byte-identical in browsers/PWA (the class is only dropped when `isShell()` is true).
- `app/desktop` (shell side): no changes.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Safe-Area Insets + the top-bar layout paragraph — the "0 in browsers/desktop" claim gains the shell exception; records the rule that safe-area edge padding is dropped where shell chrome already reserves the edge
- `run-kit/desktop-shell`: (modify) § Hidden Titlebar & Accent Strip — cross-note that the SPA's top bar drops its safe-area guard in-shell because the strip owns the titlebar band reservation

## Impact

- `app/frontend/src/components/top-bar.tsx` — one className conditional + one import + comment update
- `app/frontend/src/components/top-bar.test.tsx` — new describe block (2 assertions)
- `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/desktop-shell.md` — hydrate-stage notes
- No backend, no routes, no API, no desktop-shell code
- Verification gates: `cd app/frontend && npx tsc --noEmit`; vitest (`just test-frontend`). Playwright cannot cover the shell (`isShell()` is false in e2e — `docs/memory/run-kit/desktop-shell.md` verification split), so the unit test + a manual in-shell check after release are the coverage surface. E2e unaffected.

## Open Questions

- Does this fix fully eliminate the observed band in the field? The double-reservation is fixed by construction, but the band's exact painting mechanism was never empirically pinned. Non-blocking by user decision — verify manually in the shell after release; if the band persists, reopen the Electron-native-paint investigation as a new change.
- The stale prior attempt (`260731-0fou`, uncommitted artifacts + zero-commit branch + worktree `shell-safe-area-inset-fix`) needs cleanup once this change lands. Housekeeping, not part of this change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = gate `pt-[env(safe-area-inset-top)]` on `isShell()` in top-bar.tsx: class present in browsers/PWA, absent in the desktop shell | User-directed verbatim this session; removes the double reservation (strip already reserves the titlebar band) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Diagnosis basis: double-reservation of the titlebar band (ShellTitlebarStrip + safe-area padding); fix is correct and sufficient regardless of the exact Electron-native paint mechanism; DevTools probe explicitly NOT a blocker | User decided this session, superseding the prior intake's probe-gated Unresolved; residual field-symptom risk accepted and recorded as a non-blocking open question | S:90 R:70 A:70 D:85 |
| 3 | Certain | Test = unit test in top-bar.test.tsx: safe-area class present with isShell() false, absent with isShell() true | User-directed verbatim | S:95 R:95 A:95 D:95 |
| 4 | Certain | Test drives `isShell()` via `window.runkitShell` injection/deletion (shell.test.ts pattern), not `vi.mock("@/lib/shell")` | Established codebase pattern exercises the real narrowing seam; trivially swappable if apply finds friction | S:70 R:95 A:90 D:75 |
| 5 | Certain | Implementation shape: conditional template literal (no `cn()` utility exists in this codebase); `isShell()` read once per render with no reactivity, since the preload injects the bridge before SPA boot | Verified — no `cn` export under `src/lib/`; bridge injection order is a documented shell property | S:75 R:90 A:85 D:80 |
| 6 | Certain | Scope: top bar only — bottom-bar `max()` floor untouched, browser/PWA behavior byte-identical, no `app/desktop` changes | User instruction + carried from prior intake's scoping; class removal is shell-only by construction | S:90 R:85 A:90 D:90 |
| 7 | Certain | Memory: ui-patterns.md is the user-named target; desktop-shell.md § Hidden Titlebar & Accent Strip gets a cross-note too | ui-patterns explicit in instruction; desktop-shell cross-note carried from prior intake and matches the two-file ownership split of this seam | S:80 R:90 A:80 D:80 |
| 8 | Certain | Change type `fix`; verification = tsc + vitest; no Playwright coverage possible (`isShell()` false in e2e), manual in-shell check post-release | Keyword-inferred type matches intent; the e2e limitation is a documented project fact | S:85 R:95 A:95 D:90 |

8 assumptions (7 certain, 1 confident, 0 tentative, 0 unresolved).
