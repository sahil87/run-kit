# Intake: Desktop Shell Windows & Linux Packaging

**Change**: 260730-ler1-desktop-windows-linux-packaging
**Created**: 2026-07-30

## Origin

Conversational — from a `/fab-discuss` session. The user asked:

> How difficult is it to generate the electron app for Windows and Linux also?

Assessment during discussion: mechanically easy — the shell (`app/desktop`, shipped 260728-04pg) is a pure viewer with zero native dependencies (three devDeps, `npmRebuild: false`, no `child_process`), which is the best-case Electron portability profile — but the keyboard seam doesn't translate as-is. The user then set the governing principle ("Whatever is Cmd+\<ANY\> for Mac can be Ctrl+\<ANY\> for Windows") and the seam redesign was split into its own change: **`260730-9lez-shell-keyboard-tier-symmetry`, which this change depends on**. This intake covers ONLY the cross-platform build: packaging targets, per-platform menu application, build scripts, and release CI.

## Why

1. **The shell is macOS-only by packaging, not by architecture.** Nothing in the viewer-shell design is Mac-specific — it loads an `rk serve` URL over HTTP; `runkitShell.platform` already exposes `process.platform`. Users on Windows or Linux desktops get the same browser keyboard ceiling the shell exists to remove (browser-reserved Ctrl-tier there), and currently have no shell at all.
2. **User-set symmetry principle**: the product intent is Cmd-on-Mac ↔ Ctrl-on-Windows parity — one keyboard contract across platforms, which requires actual Windows/Linux builds to be real.
3. **Cheap to do now**: `electron-builder` already drives the mac DMG pipeline; Windows/Linux are additional targets on the same tool, additive CI jobs on the same release workflow, and the artifact/version conventions are already established (`run-kit-desktop-{version}-{arch}.{ext}`, version from the release job's output).

If we don't: the keyboard-tier symmetry work (9lez) has no consumer beyond macOS, and non-Mac users are stuck with the browser tab and its reserved-key ceiling.

## What Changes

### 1. electron-builder targets (`app/desktop/electron-builder.yml`)

- **Windows**: NSIS installer, x64. Artifact `run-kit-desktop-${version}-${arch}.${ext}` (naming convention unchanged).
- **Linux**: AppImage + deb, x64 and arm64. Same artifact naming.
- macOS config untouched.
- **Signing posture mirrors the mac decision**: Windows ships unsigned — the accepted cost is a SmartScreen "unrecognized app" first-launch dialog, the same personal-infra posture as the mac ad-hoc signing (no Developer ID, no notarization there; no Authenticode here). Linux requires no signing. The `after-pack.js` ad-hoc codesign hook stays mac-only (guard on `electronPlatformName`).

### 2. Per-platform menu application (`app/desktop/src/menu.ts`)

Builds on the two-tier `CmdOrCtrl` table from 9lez (hard dependency — without it, the switcher's old Ctrl+1–9 binding steals the page tier on Windows/Linux):

- **Edit roles omitted on Windows/Linux**: the ⌘Z/X/C/V/A menu roles exist because clipboard in web content is dead on macOS without them — a macOS quirk. Chromium handles Ctrl+C/V/X/A/Z natively on Windows/Linux, so those accelerators are NOT bound there and the page tier stays completely clean. Symmetry of rule, not symmetry of accelerator table.
- **App-menu / window-menu variants**: the macOS App menu (⌘Q/⌘H/⌥⌘H) and custom Window template are mac-only shapes; Windows/Linux get the conventional minimal equivalents (File → Quit, no hide roles) without binding anything in the page tier.
- `window-all-closed` already quits on non-mac — no change.

### 3. Build scripts (`scripts/build-desktop.sh`, `justfile`)

- `build-desktop.sh` is currently Mac-only (hard `--mac` + icon check). Extend to platform-branching (`--mac`/`--win`/`--linux` per host platform, or an explicit target argument) while keeping the justfile recipe a one-liner (Constitution VIII). Version injection via `--config.extraMetadata.version` is platform-neutral and unchanged.
- Icons: the committed 1024px `build/icon.png` is sufficient source material — electron-builder derives the Windows `.ico` and uses the png directly for Linux. No new committed assets expected; `scripts/generate-icons.sh` untouched unless the ico derivation proves lossy.

### 4. Release CI (`.github/workflows/release.yml`)

Two additive jobs mirroring `desktop-macos` (needs: release, version from the release job's output, frozen deps under Node 22, `--publish never`, `gh release upload --clobber`):

- **`desktop-linux`** on `ubuntu-latest` — AppImage + deb, x64 + arm64.
- **`desktop-windows`** on `windows-latest` — NSIS x64. Native runner rather than wine cross-compilation: cleaner, and runner minutes are not a constraint here.
- The codesign verification hard-gate stays mac-only (the ad-hoc signature is a macOS launch requirement; there is no equivalent invariant to assert on the other platforms).

### 5. Verification split

Compile/tsc/node:test/vitest remain Linux-CI-runnable. New hardware-verify items: Windows first-launch SmartScreen walkthrough, Linux AppImage launch on a real distro, and the Ctrl+C/Ctrl+V ↔ xterm.js interplay on Windows/Linux (the equivalent of the existing mac ⌘C/⌘V item — load-bearing in a terminal product, and untestable in CI).

## Affected Memory

- `run-kit/desktop-shell`: (modify) packaging section gains win/linux targets + signing posture; menu seam gains the per-platform application (Edit-role omission); verification split extended
- `run-kit/architecture`: (modify) release flow / CI section gains the `desktop-linux` and `desktop-windows` jobs

## Impact

- `app/desktop/electron-builder.yml`, `app/desktop/after-pack.js` (platform guard)
- `app/desktop/src/menu.ts` (per-platform table application; the contract itself comes from 9lez)
- `scripts/build-desktop.sh`, `justfile`
- `.github/workflows/release.yml`
- Release surface: each tagged release grows from 2 desktop assets to ~6 (mac arm64/x64 DMG, linux x64/arm64 AppImage + deb, win x64 exe)
- **Dependency**: `260730-9lez-shell-keyboard-tier-symmetry` must land first (or in the same release). Sequencing is a hard ordering constraint, not a soft preference.

## Open Questions

- Is Windows arm64 worth a target now, or wait for demand? (Deferred — x64-only assumed below; adding it later is a config-line change.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Both Windows AND Linux are in scope | Discussed — the user's question named both; the symmetry principle names Windows explicitly | S:90 R:80 A:90 D:90 |
| 2 | Certain | Hard dependency on 9lez (keyboard-tier symmetry) landing first | Discussed — shipping win/linux with the old Ctrl+1–9 switcher contradicts the shell's premise on those platforms | S:85 R:70 A:90 D:90 |
| 3 | Confident | Windows ships unsigned; SmartScreen friction accepted | Discussed — mirrors the established mac ad-hoc posture (no notarization) for a personal-infra tool | S:70 R:80 A:80 D:75 |
| 4 | Confident | Edit-role accelerators omitted on Windows/Linux (Chromium native clipboard); page tier fully clean there | Discussed — "symmetry of rule, not symmetry of accelerator table" | S:70 R:85 A:80 D:80 |
| 5 | Confident | Linux formats: AppImage + deb | Not discussed; AppImage is the zero-install default, deb covers the Debian/Ubuntu majority — clear front-runner pair, config-level reversible | S:30 R:85 A:70 D:60 |
| 6 | Confident | Windows format: NSIS installer, x64 only | Not discussed; electron-builder's default Windows target, matches user expectations; win-arm64 deferred as an open question | S:30 R:85 A:75 D:70 |
| 7 | Confident | Linux arch coverage: x64 + arm64 | Not discussed; mirrors the per-arch convention of the rk binaries and mac DMGs; cheap on ubuntu runners | S:25 R:85 A:65 D:60 |
| 8 | Confident | Native runners (windows-latest / ubuntu-latest), no wine cross-compilation | Not discussed; simplest correct CI shape, mirrors desktop-macos job structure | S:55 R:90 A:85 D:80 |

8 assumptions (2 certain, 6 confident, 0 tentative, 0 unresolved).
