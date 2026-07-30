# Intake: `rk desktop` — Quarantine-Free Desktop Installer

**Change**: 260730-pl4v-rk-desktop-install
**Created**: 2026-07-30

## Origin

Conversational. The desktop shell (PR #462) and its release CI (PR #464) shipped, and the first real DMG install hit macOS Gatekeeper: *"Apple could not verify 'Run Kit.app' is free of malware…"*. The user asked how to run it without macOS deleting it, then how to avoid repeating the workaround on every update.

Discussion sequence and decisions:

1. **Per-download friction confirmed.** `xattr -dr com.apple.quarantine` or Privacy & Security → "Open Anyway" clears it, but quarantine is stamped per download, so the workaround repeats on every desktop update. The brew-installed `rk` server binary is unaffected — only the manually-downloaded DMG carries the tax.
2. **Homebrew Cask was proposed and rejected on evidence.** The suggestion (from an external source) claimed casks are quarantine-free because brew downloads via curl. This is outdated: modern Homebrew *deliberately applies* `com.apple.quarantine` itself — verified in `Library/Homebrew/cask/quarantine.rb` on Homebrew 6.0.13. A cask would show the identical Gatekeeper dialog. The `--no-quarantine` escape hatch is user-side only; a formula cannot opt its own users out. Cask remains a reasonable future distribution convenience, but it does not solve this problem.
3. **Notarization deferred.** $99/year Developer ID + notarization is the only fix covering every channel (browser downloads, casks, AirDrop). User decision: **later, not now**.
4. **CLI installer chosen.** The true mechanism is that quarantine comes from the *downloading application* honoring `LSFileQuarantineEnabled` — browsers do, plain command-line tools do not. A `curl`-based installer therefore produces a genuinely quarantine-free install, on first install and on every update.
5. **Delivery: `rk` subcommand, not a piped shell script.** User selected the Go subcommand over `curl … | sh` and over shipping both. Rationale carried from the options: reuses existing release-resolution and `selfpath` patterns, is unit-testable in Go, and avoids the trust problem of piping a remote script to a shell. Accepted cost: the `rk` CLI must be installed first (via Homebrew) — acceptable, since the desktop shell is a client *of* an `rk serve` instance and every desktop user already has the CLI.
6. **Version source: the installed app's `Info.plist`.** User selected deriving the installed version from `/Applications/Run Kit.app/Contents/Info.plist` at check time over assuming parity with the `rk` CLI version. Derivation is correct (a CLI upgrade does not move the app) and matches Constitution II — no state file.

## Why

**The problem.** Every desktop-shell update currently requires the user to either run an `xattr` incantation or walk the System Settings → Privacy & Security → "Open Anyway" flow. On Sequoia the older right-click → Open bypass no longer works, so the friction is worse than it used to be. For a tool whose whole point is fast keyboard-driven access, a multi-step OS security dance per update is a real adoption tax — and instructing users to strip quarantine flags teaches a habit that is bad security practice generally.

**Why not the alternatives.** Notarization is the correct long-term answer but costs $99/year and is deferred. Homebrew Cask does not work (see Origin #2) — the belief that it does is a common and load-bearing misconception, which is why it is recorded here explicitly. Auto-update via electron-updater would fix *subsequent* updates but not the first install, and it is a larger change inside the Electron app.

**Why this works.** Quarantine is applied by the downloading application, not by macOS unconditionally. A Go program fetching over HTTPS sets no quarantine attribute, so an app it installs launches cleanly — first time and every time. This is not a bypass of Gatekeeper's intent: the user is explicitly invoking a trusted, already-installed toolkit binary to fetch a release from a known repository, which is the same trust model as `brew install`.

**Second benefit.** It gives the desktop shell an update path at all. Today there is none — the user must notice a release, download a DMG, and drag it over manually.

## What Changes

### New subcommand group: `rk desktop`

Registered in `cmd/rk/root.go` alongside the existing commands, following the `daemonCmd` parent/child pattern (`cmd/rk/daemon.go`):

```
rk desktop install     # fetch the latest DMG, install to /Applications
rk desktop update      # same, but no-op when already current
rk desktop status      # show installed version vs latest (read-only)
```

**Platform gate**: all three are macOS-only. On Linux they exit non-zero with `rk desktop is macOS-only (the shell is packaged as a macOS .app)`. The commands stay *registered* on all platforms so `rk help-dump` output is platform-stable (the help-dump standard treats the command tree as a contract surface).

### Install flow (`rk desktop install`)

1. **Resolve the latest release.** Query the GitHub releases API for `sahil87/run-kit` — `https://api.github.com/repos/sahil87/run-kit/releases/latest` — and select the asset matching the host architecture: `run-kit-desktop-{version}-arm64.dmg` on `arm64`, `-x64.dmg` on `amd64` (`runtime.GOARCH`). Public repo, so unauthenticated; honor `GITHUB_TOKEN` when present purely for rate-limit headroom.
2. **Download** the asset to a temp file via `net/http` with a context timeout (DMGs are ~110MB — size this at the constitution's build-op tier or above, not the 10s tmux tier). Show progress unless `--quiet`.
3. **Verify the download.** Check the SHA256 against the release's digest when the API supplies one, and independently run `codesign --verify --deep --strict` on the `.app` inside the mounted image before installing. A DMG that fails either check is discarded with a non-zero exit — this installer is precisely the code path that bypasses Gatekeeper's own check, so it must do the verification itself. This is the security-critical requirement of the change.
4. **Mount** with `hdiutil attach -nobrowse -readonly -mountpoint <tmpdir>`, via `exec.CommandContext` with an argument slice (Constitution I).
5. **Install**: remove any existing `/Applications/Run Kit.app`, then copy the mounted `.app` into `/Applications`. Use `ditto` (`exec.CommandContext`) rather than a hand-rolled Go tree copy — it is the macOS-correct tool for preserving bundle metadata and signatures, and Constitution III says wrap rather than reinvent.
6. **Detach** the mount in a `defer` so an aborted or failed install never leaves a stray mount.
7. **Report** the installed version and path.

**Flags**: `--version <tag>` to install a specific release rather than latest; `--force` to reinstall even when current; `--path <dir>` to install somewhere other than `/Applications` (default `/Applications`).

### Update flow (`rk desktop update`)

Same as install, preceded by a version comparison: read `CFBundleShortVersionString` from `/Applications/Run Kit.app/Contents/Info.plist` (via `plutil -extract … raw`, or a plist parse — the implementation may choose, but it must not shell out with a constructed string), compare against the latest release using the existing semver helpers' logic in `internal/updatecheck` (`anyIncrease` and friends). When already current, report and exit 0 without downloading. `--force` overrides.

**If the app is not installed**, `update` reports that and points at `rk desktop install` (exit non-zero — an update of nothing is a user error, not a silent no-op).

**Running-app handling**: if "Run Kit" is running, the copy would replace a live bundle. Detect it and refuse with guidance to quit the app first, rather than corrupting a running process. `--force` does *not* override this — force is about version state, not about overwriting a running app.

### Status (`rk desktop status`)

Read-only: prints installed version (or "not installed"), latest available version, and whether an update is available. Honors the toolkit's `--quiet` convention. This is the seam a future update-chip integration would read.

### Suggested code layout

- `cmd/rk/desktop.go` + `desktop_test.go` — cobra wiring, flags, platform gate, output (mirrors `cmd/rk/daemon.go`'s parent/child shape).
- `internal/desktop/` — the installer library: release resolution, download, verify, mount/copy/detach, installed-version probe. Parameterized and electron-free so it unit-tests without network or a real DMG (mirror the `internal/desktop`-style seam discipline in `app/desktop/src/servers.ts`, and the `runBrewFn`/`checkFn` package-var seam idiom in `cmd/rk/upgrade.go` and `internal/updatecheck`).

Seams for testing: an HTTP-client/release-resolver seam and a command-runner seam for `hdiutil`/`ditto`/`codesign`, so the whole flow is exercisable with stubs. `internal/updatecheck` already establishes this pattern (`checkFn` as a struct field so parallel tests do not race).

### Docs

README gains a desktop-install section; the existing DMG instructions (which currently imply a manual download) should point at `rk desktop install` as the primary path, with the manual download plus `xattr` retained as the fallback for someone without the CLI.

## Affected Memory

- `run-kit/architecture`: (modify) — CLI subcommands section gains the `rk desktop` group; note `internal/desktop` in the backend-libraries table
- `run-kit/desktop-shell`: (modify) — distribution/installation section: `rk desktop install` becomes the primary install path; record why quarantine-free works and why Homebrew Cask does not
- `run-kit/toolkit-standards`: (modify) — new subcommand surface must be checked against the help-dump and Principle 9 (`--quiet`) standards

## Impact

- **New code**: `cmd/rk/desktop.go`, `cmd/rk/desktop_test.go`, `internal/desktop/*.go` + tests. Est. 400–600 lines including tests.
- **Modified**: `cmd/rk/root.go` (one `AddCommand`), `README.md`.
- **No frontend, no API, no tmux, no daemon changes.** The subcommand is self-contained and does not touch the server.
- **Dependencies**: none new — `net/http`, `os/exec`, `runtime` are stdlib. Deliberately avoids a GitHub API client library.
- **External surfaces**: GitHub releases API (unauthenticated, rate-limited to 60 req/hr per IP — acceptable for a manual command; a clear error on 403 rate-limit is required).
- **Verification**: Go unit tests with stubbed seams, plus a manual end-to-end run on a Mac against a real release. The e2e path cannot be CI-tested (needs macOS + a published DMG), so the manual pass is the gate.
- **Sequencing**: depends on PR #465 (the ad-hoc signing fix) being merged and a release cut with working DMGs — until then there is no correctly-signed asset to install. The signature-verification step in flow #3 would reject every currently-published DMG, which is correct behavior.

## Open Questions

- Should `rk desktop status` eventually feed the existing update chip in the web UI (the `updatecheck` → SSE → frontend path), so the dashboard surfaces a stale desktop app? Out of scope here; `status` is being shaped as the seam that would make it a small follow-up.
- Should the installer support installing to `~/Applications` automatically when `/Applications` is not writable (a managed-Mac scenario)? Currently handled by the explicit `--path` flag; auto-fallback deferred until someone hits it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery is an `rk` subcommand, not a piped shell script or both | User selected explicitly from presented options with the tradeoffs stated | S:95 R:70 A:90 D:95 |
| 2 | Certain | Installed version is derived from the app's `Info.plist`, not assumed equal to the `rk` CLI version | User selected explicitly; also the only correct option (a CLI upgrade does not move the app) and matches Constitution II | S:95 R:85 A:95 D:95 |
| 3 | Certain | Homebrew Cask is not pursued as the fix | Verified against Homebrew 6.0.13 source (`cask/quarantine.rb` applies the attribute deliberately); a cask would reproduce the exact dialog | S:90 R:80 A:95 D:90 |
| 4 | Certain | Notarization is deferred, not rejected | Explicit user decision this session ("notarization later not right now") | S:100 R:90 A:95 D:100 |
| 5 | Certain | Subprocess calls (`hdiutil`, `ditto`, `codesign`, plist read) use `exec.CommandContext` with argument slices and timeouts | Constitution I and § Process Execution — non-negotiable | S:90 R:85 A:100 D:95 |
| 6 | Confident | The installer verifies the DMG's signature and (when available) checksum before installing | This code path deliberately bypasses Gatekeeper's check, so it must perform its own; not doing so would turn a convenience feature into a malware vector | S:75 R:45 A:85 D:80 |
| 7 | Confident | Install target defaults to `/Applications`, overridable via `--path` | Standard macOS convention; the flag covers the non-writable/managed-Mac case without auto-magic | S:70 R:85 A:80 D:75 |
| 8 | Confident | `ditto` is used for the bundle copy rather than a Go tree walk | macOS-correct for preserving bundle metadata and signatures; Constitution III (wrap, don't reinvent) | S:65 R:80 A:80 D:70 |
| 9 | Confident | Commands stay registered on Linux but exit non-zero with a macOS-only message | Keeps the `rk help-dump` command tree platform-stable (help-dump is a contract surface per toolkit standards) while making the constraint explicit | S:60 R:85 A:75 D:70 |
| 10 | Confident | A running "Run Kit" blocks install/update, and `--force` does not override it | Overwriting a live bundle risks corrupting the running process; `--force` is scoped to version state, a distinct concern | S:60 R:75 A:80 D:70 |
| 11 | Tentative | Release resolution hits the GitHub API directly rather than delegating to `shll` | `internal/updatecheck` delegates version checks to `shll check-updates` (Constitution III), but that reports brew-visible tool versions — it has no notion of a per-arch DMG asset URL, which is what this needs. Worth re-checking whether `shll` grew an asset-resolution surface before implementing | S:55 R:60 A:50 D:45 |
| 12 | Tentative | `rk desktop status` is included in v1 rather than deferred | Small addition over the machinery `update` already needs, and it is the seam for a future update-chip integration; could be cut if scope pressure appears | S:45 R:80 A:60 D:50 |

12 assumptions (5 certain, 5 confident, 2 tentative, 0 unresolved).
