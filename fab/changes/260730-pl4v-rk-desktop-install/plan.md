# Plan: `rk desktop` — Quarantine-Free Desktop Installer

**Change**: 260730-pl4v-rk-desktop-install
**Intake**: `intake.md`

## Requirements

### CLI: `rk desktop` command group

#### R1: Command group registered on all platforms, macOS-only at runtime
`rk desktop` SHALL be a cobra parent command (mirroring the `daemonCmd` parent/child shape) with children `install`, `update`, and `status`, registered on `rootCmd` on every platform so the `rk help-dump` command tree is platform-stable. On a non-darwin platform every child MUST exit non-zero (operational, exit 1) with the message `rk desktop is macOS-only (the shell is packaged as a macOS .app)`.

- **GIVEN** a Linux host
- **WHEN** `rk desktop install` runs
- **THEN** it exits 1 with the macOS-only message on stderr
- **AND** `rk help-dump` still lists the `desktop` subtree

#### R2: Release resolution via the GitHub releases API
The installer MUST resolve releases from `https://api.github.com/repos/sahil87/run-kit/releases/latest` (or `.../releases/tags/{tag}` when `--version` is given), selecting the DMG asset matching the host architecture (`runtime.GOARCH`: `arm64` → `-arm64.dmg`, `amd64` → `-x64.dmg`, asset prefix `run-kit-desktop-`). Requests SHALL be unauthenticated by default and MUST honor `GITHUB_TOKEN` when set (Bearer auth, rate-limit headroom only). An HTTP 403 MUST produce a clear rate-limit error naming `GITHUB_TOKEN` as the remedy. No GitHub API client library SHALL be added — `net/http` + `encoding/json` only.

- **GIVEN** a published release `v3.13.0` with per-arch DMG assets
- **WHEN** `ResolveRelease` runs on an arm64 host with no tag
- **THEN** it returns version `3.13.0`, the `run-kit-desktop-3.13.0-arm64.dmg` asset URL, and the asset's sha256 digest when the API supplies one
- **AND** a 403 response yields an error mentioning the GitHub API rate limit and `GITHUB_TOKEN`

#### R3: Bounded download with progress
The DMG download MUST run over `net/http` under a generous context timeout (≥ the constitution's 30s build-op tier — DMGs are ~110MB) into a temp file that is always cleaned up. Download progress SHALL print to the chatter channel (suppressed by `--quiet`); outcome lines are data.

- **GIVEN** a resolved release asset
- **WHEN** the download runs without `--quiet`
- **THEN** progress prints to stderr and the temp file is removed after install (or on failure)

#### R4: Self-verification before install (security-critical)
Because this code path deliberately produces a quarantine-free install (bypassing Gatekeeper's own check), the installer MUST verify the download itself: (a) compare the SHA256 of the downloaded bytes against the release asset's digest when the API supplies one, and (b) run `codesign --verify --deep --strict` on the `.app` inside the mounted image before copying. A DMG failing either check MUST be discarded with a non-zero exit and no changes to the install target.

- **GIVEN** a downloaded DMG whose sha256 differs from the release digest
- **WHEN** verification runs
- **THEN** install aborts non-zero before mounting, and the temp file is deleted
- **AND GIVEN** a mounted `.app` that fails `codesign --verify --deep --strict`, install aborts non-zero and nothing is copied to the install target

#### R5: Mount/copy/detach via exec.CommandContext argument slices
Mounting MUST use `hdiutil attach -nobrowse -readonly -mountpoint <tmpdir> <dmg>`; the bundle copy MUST use `ditto <src.app> <dest.app>` (never a hand-rolled Go tree copy); the mount MUST be detached in a `defer` so an aborted install never leaves a stray mount. Every subprocess (`hdiutil`, `ditto`, `codesign`, `plutil`, `pgrep`) MUST go through `exec.CommandContext` with an explicit argument slice and a timeout (Constitution I / § Process Execution); no shell strings.

- **GIVEN** a verified mounted DMG
- **WHEN** the copy step fails
- **THEN** the deferred `hdiutil detach` still runs and no stray mount remains

#### R6: Install semantics (`rk desktop install`)
Install SHALL: resolve the release (latest, or `--version <tag>`), download, verify, stage the new bundle into the target directory (copy to a temp name via `ditto`), then atomically replace any existing app (remove old + rename staged → final), and report the installed version and path (data). The long-running copy MUST complete before the existing install is touched, so a mid-copy failure never destroys a working install. The target directory defaults to `/Applications` and is overridable via `--path <dir>`. When the resolved version is already installed, install SHALL report and exit 0 without downloading unless `--force` is given.

- **GIVEN** `/Applications/Run Kit.app` at v3.13.0 and latest release v3.13.0
- **WHEN** `rk desktop install` runs
- **THEN** it reports already-installed and exits 0 without downloading
- **AND WHEN** `rk desktop install --force` runs, it downloads and reinstalls

#### R7: Update semantics (`rk desktop update`)
Update SHALL derive the installed version from `<path>/Run Kit.app/Contents/Info.plist` (`CFBundleShortVersionString`, read via `plutil -extract … raw` through the command-runner seam — never a constructed shell string, never assumed equal to the `rk` CLI version), compare against the latest release using the existing semver-increase logic in `internal/updatecheck` (exported as `AnyIncrease`, not duplicated), and: when already current, report and exit 0 without downloading (`--force` overrides); when the app is not installed, exit non-zero pointing at `rk desktop install`.

- **GIVEN** installed v3.12.2 and latest v3.13.0
- **WHEN** `rk desktop update` runs
- **THEN** it installs v3.13.0
- **AND GIVEN** installed == latest, it prints an up-to-date outcome line and exits 0 with no download
- **AND GIVEN** no installed app, it exits non-zero with a message pointing at `rk desktop install`

#### R8: Running-app refusal
When the "Run Kit" app at the install target is running, install/update MUST refuse (non-zero) with guidance to quit the app first, before any download. `--force` MUST NOT override this refusal — force is scoped to version state, not to overwriting a live bundle.

- **GIVEN** a running Run Kit process from the target bundle path
- **WHEN** `rk desktop update --force` runs
- **THEN** it refuses non-zero with quit-the-app guidance and downloads nothing

#### R9: Status (`rk desktop status`)
`rk desktop status` SHALL be read-only: print installed version (or not-installed), latest available version, and whether an update is available. All of its output is data (the requested result), so `--quiet` legitimately changes nothing; exit 0 whether or not an update is pending.

- **GIVEN** installed v3.12.2 and latest v3.13.0
- **WHEN** `rk desktop status` runs
- **THEN** stdout reports both versions and that an update is available, exit 0

#### R10: Toolkit output + exit-code conventions
The subcommands MUST route output through the shared `outputSink` (`newSink(cmd)`): outcome lines and status reports are data (stdout, survive `--quiet`); progress/decoration is chatter (stderr, dropped by `--quiet`); errors flow through `RunE` returns and always survive. Exit codes follow the toolkit convention: usage errors 2 (inherited via root's FlagErrorFunc/usageArgs wrap), operational failures 1.

- **GIVEN** `rk desktop status --quiet`
- **WHEN** it succeeds
- **THEN** stdout carries the report unchanged and stderr is empty
- **AND** `rk desktop install --nope` exits 2

#### R11: Seam-parameterized, electron-free installer library
The installer logic SHALL live in `internal/desktop` parameterized by explicit seams — an HTTP client (release API + download) and a command-runner func for `hdiutil`/`ditto`/`codesign`/`plutil`/`pgrep` — held as struct fields (so parallel tests do not race, mirroring `internal/updatecheck.checkFn`), unit-testable on Linux without network or a real DMG. The cmd layer keeps thin cobra wiring with package-level seam vars (mirroring `runBrewFn`/`resolveExeFn` in `upgrade.go`) so `desktop_test.go` exercises flag plumbing and flows via stubs.

- **GIVEN** the Go test suite on a Linux CI host
- **WHEN** `go test ./...` runs
- **THEN** the full resolve/download/verify/mount/copy flow is exercised through stubs (httptest server + recorded runner) with no network, no macOS tools

### Docs: install path

#### R12: README + install docs gain the desktop-install section
`README.md` and `docs/site/install.md` SHALL document `rk desktop install` as the primary desktop-app install path (and `rk desktop update` for updates), with the manual DMG download from GitHub Releases plus the quarantine workaround (`xattr -dr com.apple.quarantine` / "Open Anyway") retained as the fallback for someone without the CLI. Per install-composition Policy B, no per-formula `brew install sahil87/tap/…` instruction may be introduced.

- **GIVEN** the updated docs
- **WHEN** a user looks for how to install the desktop app
- **THEN** `rk desktop install` is presented first, with the manual DMG + quarantine workaround as fallback
- **AND** `grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/` still returns zero hits

### Non-Goals
- Notarization / Developer ID signing — explicitly deferred by user decision (intake Origin #3).
- Homebrew Cask distribution — verified not to solve the quarantine problem (intake Origin #2).
- Auto-update inside the Electron app (electron-updater) — larger change, out of scope.
- Feeding `rk desktop status` into the web-UI update chip — `status` is shaped as the seam; the integration is a future change.
- Auto-fallback to `~/Applications` when `/Applications` is unwritable — covered by the explicit `--path` flag.

## Tasks

### Phase 1: Setup

- [x] T001 Export `AnyIncrease(installed, latest string) bool` from `app/backend/internal/updatecheck/updatecheck.go` (thin wrapper over `anyIncrease`) + a locking test in `updatecheck_test.go` <!-- R7 -->

### Phase 2: Core Implementation

- [x] T002 `app/backend/internal/desktop/desktop.go` — `Installer` struct with seams (`Client *http.Client`-compatible Doer, `Run` command-runner func field, `Repo`, `Arch`, `InstallDir`, `Token`, `APIBase`, `Progress io.Writer`), `New()` defaults, timeout constants <!-- R11 -->
- [x] T003 `app/backend/internal/desktop/release.go` + `release_test.go` — `ResolveRelease(ctx, tag)`: latest/tag endpoints, arch asset selection, digest parse, GITHUB_TOKEN header, 403 rate-limit error, 404 tag error (httptest-backed tests) <!-- R2 --> <!-- rework: must-fix zero-call-sites — `Release.Tag` (release.go:18) has no production reader; delete the field and its two test references (or add the consumer that justifies it) -->
- [x] T004 `app/backend/internal/desktop/installed.go` + `installed_test.go` — `InstalledVersion(ctx)` (Info.plist probe via `plutil` through the runner seam; missing plist → not installed) and `AppRunning(ctx)` (`pgrep -f` via the runner seam) <!-- R7 -->
- [x] T005 `app/backend/internal/desktop/install.go` + `install_test.go` — `Install(ctx, rel)`: bounded download to temp file with sha256 + progress, digest check, `hdiutil attach` (arg slice), locate `.app`, `codesign --verify --deep --strict`, stage-then-atomic-replace copy (`ditto` to a temp name in InstallDir, then remove-old + rename), deferred detach + cleanup; failure at every stage leaves no mount/temp residue and touches no install target <!-- R3 --> <!-- rework: should-fix — (a) RemoveAll(dest) ran BEFORE ditto (install.go:83): a mid-copy failure destroyed the working install, contradicting the install.go:31 doc promise; stage into InstallDir under a temp name, then remove-old+rename (updated R6). (b) dest was derived from the DMG's bundle basename (install.go:82) while InstalledVersion/AppRunning key on AppBundleName — derive dest from AppBundleName and validate the mounted bundle's name against it. (c) nice-to-have folded in: re-run the cheap AppRunning pgrep immediately before the destructive replace to close the multi-minute download/codesign TOCTOU window -->

### Phase 3: Integration & Edge Cases

- [x] T006 `app/backend/cmd/rk/desktop.go` — `desktopCmd` parent (daemonCmd shape) + `install`/`update`/`status` children: macOS gate (`desktopGOOS` seam var, PersistentPreRunE, exit 1 message), flags (`--version`/`--force`/`--path` on install; `--force`/`--path` on update; `--path` on status), `outputSink` routing, already-current short-circuits, not-installed update error, running-app refusal (pre-download, not overridden by `--force`), installer factory seam var <!-- R1 --> <!-- rework: should-fix — (a) add `Long:` blocks to the parent and all three children, mirroring the daemon children (help-dump publishes UsageString; document that --force overrides version state but NOT the running-app refusal, that update deliberately has no --version, and --path's managed-Mac rationale). (b) reject an explicitly-empty `--path ""` as a usage error instead of silently falling back to /Applications (desktop.go:115) -->
- [x] T007 Register `desktopCmd` in `app/backend/cmd/rk/root.go` `init()`; add `desktop` to `TestRootCmdHasSubcommands` expected map in `root_test.go` <!-- R1 -->
- [x] T008 `app/backend/cmd/rk/desktop_test.go` — platform gate (non-darwin exits 1 with exact message; children blocked), registration + flag presence, flow tests via stubbed installer factory on a forced-darwin gate: install already-current/–force, update not-installed error text, update up-to-date no-download, running-app refusal beats `--force`, status report shape, `--quiet` data-vs-chatter split, usage errors exit 2 <!-- R10 -->

### Phase 4: Polish

- [x] T009 Docs: `README.md` desktop-app section (primary `rk desktop install` path, manual DMG + quarantine fallback) and `docs/site/install.md` matching section; verify Policy B grep stays clean <!-- R12 -->

## Execution Order

- T001 before T006 (update flow imports `updatecheck.AnyIncrease`)
- T002 blocks T003–T005; T003–T005 block T006; T006 blocks T007–T008
- T009 is independent, may run last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk desktop` group with `install`/`update`/`status` is registered on `rootCmd` on all platforms; non-darwin invocations exit 1 with the exact macOS-only message — `root.go:57` registers unconditionally; `desktop.go:55-60` PersistentPreRunE gate; `TestDesktopMacOSGate` asserts the exact message + exit 1 for all three children
- [x] A-002 R2: Release resolution hits the GitHub releases API (latest + `--version` tag), selects the correct per-arch asset, honors `GITHUB_TOKEN`, and surfaces a clear 403 rate-limit error — `release.go:72-135`; `release_test.go` covers latest path, `v`-normalized tag path, Bearer header, 403 wording (`rate limit` + `GITHUB_TOKEN`)
- [x] A-003 R3: Download runs under a generous context timeout into a temp file that is always cleaned up; progress is chatter — `install.go:102-151` (`downloadTimeout` 15m), `defer os.Remove(dmgPath)` at `install.go:44` plus explicit removes on both failure paths; progress writes to `ins.Progress` wired to `sink.chatter` (`desktop.go:118`)
- [x] A-004 R4: SHA256-vs-digest (when supplied) and `codesign --verify --deep --strict` both gate the install; either failure discards the DMG with a non-zero exit — `install.go:143-149` and `install.go:78-80`; `TestInstallChecksumMismatchAbortsBeforeMount` proves zero subprocesses ran, `TestInstallCodesignFailureAbortsAndDetaches` proves no `ditto` and the existing bundle survives
- [x] A-005 R5: `hdiutil`/`ditto`/`codesign`/`plutil`/`pgrep` all run via `exec.CommandContext` argument slices with timeouts; detach is deferred — single `runCommand` seam (`desktop.go:127-139`) is the only exec site; per-call `context.WithTimeout` at every call site; detach in `defer` at `install.go:60-68` on `context.Background()`
- [x] A-006 R6: Install defaults to `/Applications`, honors `--path` and `--version`, short-circuits when current unless `--force`, stages then atomically replaces (mid-copy failure never destroys the existing install), and reports version + path — `--path` defaults to `desktop.DefaultInstallDir` (`desktop.go:126`) and an explicitly-empty value is a usage error (`desktop.go:155-157`); currency short-circuit at `desktop.go:184-188`; `ditto` now stages to `.Run Kit.app.staging` INSIDE InstallDir (`install.go:101-112`) and only then remove-old + rename (`install.go:123-130`); outcome line `desktop.go:198`. `TestInstallMidCopyFailurePreservesExistingInstall` proves a `ditto` failure leaves the old bundle intact; `TestInstallSuccessFlow` asserts the ditto destination is the staged path
- [x] A-007 R7: Update derives installed version from Info.plist via `plutil`, compares with `updatecheck.AnyIncrease`, no-ops (exit 0) when current, errors (non-zero) with an `rk desktop install` pointer when not installed — `installed.go:19-39`, `desktop.go:177`, `desktop.go:167-170`; `TestDesktopUpdateNotInstalled` / `TestDesktopUpdateAlreadyUpToDate` / `TestDesktopUpdateInstallsNewer`
- [x] A-008 R8: A running Run Kit blocks install/update before download with quit guidance; `--force` does not override — `desktop.go:145-147` (install) and `desktop.go:183-185` (update), both after the currency check and before `Install`; `TestDesktopRunningAppBlocksEvenWithForce` asserts both commands refuse under `--force` with 0 asset downloads
- [x] A-009 R9: `rk desktop status` is read-only, prints installed/latest/update-available as data, exits 0 — `desktop.go:195-226` uses only `Dataf`, no `Install` call; `TestDesktopStatusReport` / `TestDesktopStatusNotInstalled` assert the report shape and 0 asset downloads
- [x] A-010 R12: README + docs/site/install.md present `rk desktop install` as the primary desktop install path with the manual DMG + quarantine fallback; Policy B grep stays clean — new "Desktop app (macOS)" sections in both files lead with `rk desktop install` and keep the manual DMG + `xattr`/"Open Anyway" fallback; the new prose introduces **no** `brew install`/`sahil87/tap` string. NOTE: the Policy-B grep is not zero overall — `README.md:40` (the pre-existing `rk`→`run-kit` formula-rename note) matches at HEAD too, so the non-zero grep is pre-existing and not introduced here

### Behavioral Correctness

- [x] A-011 R7: Installed version comes from the app bundle's Info.plist at check time — never assumed equal to the `rk` CLI version — `installed.go` reads `<InstallDir>/Run Kit.app/Contents/Info.plist`; the `rk` `version` ldflags var is never referenced in `internal/desktop` or `cmd/rk/desktop.go`
- [x] A-012 R10: Outcome/status lines are data (survive `--quiet`); progress is chatter (dropped); usage errors exit 2, operational failures exit 1 — `Dataf` for every outcome/report line, `Notef` + `ins.Progress` for narration; `TestDesktopQuietSplitsDataFromChatter` asserts stdout keeps the outcome and stderr is empty; `TestDesktopUsageErrorsExitTwo` covers `--nope` and extra-arg for all three children; gate/not-installed errors assert exit 1

### Scenario Coverage

- [x] A-013 R2: httptest-backed tests cover latest + tagged resolution, per-arch asset match, missing-asset error, 403, and 404 — `release_test.go`: `TestResolveReleaseLatestSelectsArchAsset` (arm64+amd64 subtests, `.blockmap` decoy present), `TestResolveReleaseTagNormalizesBareSemver`, `TestResolveReleaseMissingArchAsset`, `TestResolveReleaseRateLimitError` (403), `TestResolveReleaseTagNotFound` (404)
- [x] A-014 R4: Tests cover digest mismatch abort and codesign-failure abort (stubbed runner) — `TestInstallChecksumMismatchAbortsBeforeMount`, `TestInstallCodesignFailureAbortsAndDetaches`
- [x] A-015 R8: Test covers `update --force` still refused while the app is running — `TestDesktopRunningAppBlocksEvenWithForce` (covers `install --force` too)

### Edge Cases & Error Handling

- [x] A-016 R5: A failure after mount still detaches (deferred) — no stray mount; temp DMG removed on every path; a staged temp bundle left by a failed replace is cleaned up — detach deferred at `install.go:71-79` on `context.Background()`; `defer os.Remove(dmgPath)` at `install.go:55` plus explicit removes on both download failure paths; every post-ditto failure branch calls `os.RemoveAll(staged)` (`install.go:110`, `:119`, `:124`, `:128`) and a leftover staged bundle from an interrupted prior run is reclaimed at `install.go:102`. `assertNoStagedResidue` asserts zero residue in the codesign-failure, bundle-name-mismatch, mid-copy-failure, and running-app-recheck tests; `TestInstallSuccessFlow` seeds a stale staged dir and proves it is reclaimed
- [x] A-017 R2: Unsupported `runtime.GOARCH` yields a clear error rather than a wrong asset — `archLabel` (`release.go:46-55`) errors before any HTTP request; `TestResolveReleaseUnsupportedArch`
- [x] A-018 Pattern consistency: cmd wiring mirrors `daemon.go`/`upgrade.go` (parent/child, seam vars, outputSink) **including `Long:` help blocks on the desktop commands** (the daemon-children pattern; help-dump publishes UsageString); library mirrors `updatecheck`'s field-seam idiom — `Long:` blocks now on the parent (`desktop.go:38-54`, the daemon.go "Subcommands:" + "See '… <subcommand> --help'" shape) and all three children (`desktop.go:66-80`, `:89-102`, `:111-117`), documenting the `--force` version-state-only scoping, update's deliberate absence of `--version`, and `--path`'s managed-Mac rationale; `TestDesktopRegisteredWithChildrenAndFlags` asserts non-empty `Long` on all four plus the two documented semantics. Seam vars `desktopGOOS`/`newDesktopInstallerFn` mirror `runBrewFn`/`resolveExeFn`; `Installer`'s `Client`/`Run` are struct fields per `updatecheck.checkFn`
- [x] A-019 No unnecessary duplication: semver comparison reused from `internal/updatecheck` (exported `AnyIncrease`), not reimplemented; no new dependencies — `AnyIncrease` is a 3-line wrapper over the existing `anyIncrease`; `internal/desktop` imports stdlib only (no go.mod change)

### Security

- [x] A-020 R4: The installer performs its own signature + checksum verification precisely because it bypasses Gatekeeper's check; no verification path can be skipped by flags — neither `--force` nor `--quiet` nor `--path` reaches the verify branches; `Install` has no skip parameter. Residual (documented, per Assumption #11): an absent API digest downgrades to codesign-only, noted on the chatter channel
- [x] A-021 R5: No shell-string subprocess construction anywhere in the new code; all `exec.CommandContext` with argument slices and timeouts — `runCommand` (`desktop.go:127`) is the sole exec site in the new code; no `sh -c`, no `exec.Command`, no string interpolation into a command; every call site wraps a `context.WithTimeout`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The end-to-end path (real DMG on a real Mac) cannot run in CI — the manual pass on a Mac remains the final gate (intake § Impact).

## Deletion Candidates

- `docs/memory/run-kit/toolkit-standards.md` (§ install-composition Policy B scenario) — the scenario asserts the audit grep `grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/` "returns zero hits", but `README.md:40` (the `rk`→`run-kit` formula-rename note) has matched since before this change. The claim is stale independent of this diff; hydrate should re-scope it to exclude the formula-rename note or drop the zero-hits wording.
- `app/backend/internal/desktop/install.go:192-203` (`findAppBundle`) — a candidate for *replacement* rather than deletion: it returns the first `.app` alphabetically and `Install` then validates the name against `AppBundleName`, so the two-step is strictly weaker than statting `<mount>/Run Kit.app` directly (see the should-fix finding). Collapsing them removes a function.
- Nothing else. `Release.Tag` (the previous cycle's zero-call-sites must-fix) is **resolved** — the field is gone from `release.go` and from both test references. This change otherwise adds a new command surface and makes no existing code redundant: `internal/updatecheck`'s `anyIncrease` is now also reached through the exported `AnyIncrease` wrapper, but both remain used (the unexported original keeps its in-package call sites).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Release resolution hits the GitHub API directly — `shll` has no asset-resolution surface | Verified live this session: `shll check-updates --help` reports versions/notify only, no per-arch asset URLs; resolves the intake's Tentative #11 | S:85 R:80 A:95 D:90 |
| 2 | Confident | A bare-semver `--version` argument is normalized to the `v`-prefixed tag (`3.12.2` → `v3.12.2`) | Release tags are `v{semver}` (release CI + version standard); accepting both forms is the obvious ergonomic default | S:60 R:90 A:85 D:80 |
| 3 | Confident | Asset selected by prefix `run-kit-desktop-` + suffix `-{arch}.dmg` rather than an exact constructed filename | Robust to tag/version formatting drift while matching the intake's stated naming convention exactly | S:65 R:90 A:80 D:75 |
| 4 | Confident | `pgrep -f <app>/Contents/MacOS` detects the running app; a non-zero pgrep is treated as not-running | Detection is best-effort guard against overwriting a live bundle; pgrep exit 1 means no match, and macOS always ships pgrep | S:55 R:75 A:75 D:65 |
| 5 | Confident | `install` (not just `update`) short-circuits when the resolved version is already installed, unless `--force` | The intake defines `--force` as "reinstall even when current", which implies install checks currency | S:70 R:90 A:80 D:80 |
| 6 | Confident | `update` carries `--force`/`--path` but not `--version` — a pinned version is `install --version` | Update means "go to latest" (intake: same as install *preceded by a version comparison* against latest); minimal surface (Constitution IV) | S:55 R:90 A:75 D:65 |
| 7 | Confident | Subprocess/download bounds: API 30s, download 15m, hdiutil 2m, codesign 5m, ditto 5m, detach 1m, probes 10s | Intake mandates "the constitution's build-op tier or above" for the ~110MB download; codesign --deep over an Electron bundle reads every file | S:60 R:85 A:80 D:75 |
| 8 | Confident | `rk skill` bundle and skill topic pages are untouched | The bundle is a capability briefing, not a command enumeration; help-dump auto-covers the new tree via the cobra walk, and editing the bundle would trip the byte-equality drift guard for no standard-mandated gain | S:55 R:85 A:75 D:70 |
| 9 | Confident | Semver reuse is a thin exported `updatecheck.AnyIncrease` wrapper, not a moved/duplicated helper package | Smallest diff honoring "no duplication"; the helpers stay where their existing tests live | S:60 R:85 A:85 D:75 |
| 10 | Confident | `status` output is entirely data (`--quiet` changes nothing) | Mirrors the `rk status`/`reaper` posture recorded in toolkit-standards memory: a read-only report is the requested result | S:65 R:90 A:85 D:80 |
| 11 | Tentative | The GitHub asset `digest` field (`sha256:<hex>`) is the checksum source; when absent the checksum step is skipped with a chatter note and codesign remains the hard gate | Intake says "when the API supplies one"; digest presence varies by upload path, and failing hard on absence would break installs of otherwise-valid releases | S:50 R:70 A:55 D:50 |
| 12 | Tentative | Running-app refusal happens before download (both commands), keyed on the target bundle path | Fails fast before a 110MB fetch; the intake orders it within the install step but refusing early is strictly less wasteful and behaviorally identical | S:45 R:85 A:70 D:60 |
| 13 | Certain | `Release.Tag` is deleted rather than given a consumer | Review-preferred option; every consumer uses `Version`, and outcome lines already print `"v" + Version`, so a Tag consumer would be manufactured | S:85 R:90 A:90 D:85 |
| 14 | Confident | The staged bundle uses a deterministic dot-prefixed sibling name (`.Run Kit.app.staging`) inside InstallDir, cleared before staging and on every failure path | Staging in InstallDir keeps the final rename same-volume (atomic); the deterministic name self-heals leftovers from a crashed prior run; concurrent installs are out of scope (one command, one installer) | S:55 R:85 A:80 D:70 |
| 15 | Confident | The pre-replace TOCTOU re-check lives inside `Install` (library-level), erroring with quit-the-app wording and removing the staged copy | Only a check after the long download/codesign closes the window; wording mirrors the cmd-layer `errDesktopAppRunning` refusal so both refusals read the same | S:60 R:85 A:80 D:75 |
| 16 | Certain | An explicitly-empty `--path ""` is rejected via `usageError` (exit 2) inside the shared `desktopInstaller` builder, before any installer construction or network work | The rework comment dictates the behavior; `usageError` is the toolkit's established exit-2 wrapper (root FlagErrorFunc / usageArgs) | S:85 R:90 A:90 D:85 |

16 assumptions (3 certain, 11 confident, 2 tentative).
