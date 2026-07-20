# Intake: Update & Version Standards Conformance

**Change**: 260719-er5k-update-version-standards-conformance
**Created**: 2026-07-20

## Origin

One-shot `/fab-new` invocation. User's raw input:

> Bring this repo into conformance with the shll toolkit 'update' and 'version' standards (docs/site/standards/update.md and version.md in the shll repo, or https://shll.ai/standards). Audit the update and --version subcommands against every MUST/SHOULD in both standards, fix any gaps found, and add/update tests pinning the fixed behavior. If the audit finds the repo is already fully conformant with no code changes needed, skip /git-pr entirely — do not open an empty PR.

The audit was performed **during intake** (both standards read via `shll standards update` / `shll standards version`; implementation read in `app/backend/cmd/rk/upgrade.go`, `root.go`, `api/update.go`, `internal/updatecheck/updatecheck.go`; existing tests read in `upgrade_test.go`, `root_test.go`). **A gap was found**, so the conditional "skip /git-pr if fully conformant" branch does NOT apply — the pipeline proceeds normally through ship.

Prior art: change `260717-c424-toolkit-standards-conformance` (PR #383) audited the toolkit standards at shll v0.0.23 and recorded posture in `docs/memory/run-kit/toolkit-standards.md` — but it predates the update standard's **brew-handling safety clause**, which cites an incident "Observed 2026-07-19" (a SIGKILL landing mid keg-swap). This change audits against the current standard text.

## Why

1. **The constitution binds this repo to the standards** (§ Toolkit Standards): "Standards added or revised there bind this repo without further amendment to this constitution." The update standard was revised (brew-handling safety clause, incident dated 2026-07-19) after the last conformance pass shipped on 2026-07-17.

2. **run-kit's `update` command currently contains the exact prohibited pattern.** `app/backend/cmd/rk/upgrade.go` runs `brew upgrade sahil87/tap/run-kit` under `context.WithTimeout(…, brewTimeout)` where `const brewTimeout = 120 * time.Second`, via `exec.CommandContext` with no `Cancel`/`WaitDelay` customization — so on timeout expiry Go's default cancel behavior sends **SIGKILL**. The standard: "**MUST NOT send `SIGKILL` to a package-manager subprocess mid-transaction**" and "**MUST NOT impose a short hard timeout on `brew upgrade`**." The consequence is not hypothetical — the standard documents the observed failure: Homebrew 6 makes an un-timed `api.github.com` call inside every tap-formula upgrade; a stall past 120s gets the wrapper's SIGKILL between `brew unlink` and `brew link`, leaving a corrupted keg and a dead binary (`zsh: permission denied: <tool>`).

3. **Both update entry points share the hazard.** The web one-click upgrade (`api/update.go`) spawns a detached `rk update --skip-brew-update`, which routes through the same `updateCmd` — fixing `upgrade.go` fixes both.

If unfixed, any slow network moment during an upgrade can brick the install. Everything else in both standards already passes (audit table below), so the fix is deliberately narrow.

## What Changes

### 1. Audit results (recorded for traceability; no code change for PASS rows)

**Update standard** (`shll standards update`):

| Clause | Verdict | Evidence |
|--------|---------|----------|
| MUST expose `update` subcommand, in place + post-upgrade side effects | PASS | `updateCmd` in `upgrade.go`; restarts daemon post-swap |
| MUST work standalone | PASS | plain cobra subcommand |
| MUST advertise literal `--skip-brew-update` in `update --help` | PASS | flag registered in `init()`; `TestUpdate_SkipBrewUpdateFlag_Registered` |
| MUST honor `--skip-brew-update` (skip internal `brew update`) | PASS | guarded at `upgrade.go:141`; `TestUpdate_SkipBrewUpdate_OmitsUpdateButUpgradesAndRestarts` |
| MUST exit 0 on success incl. already-up-to-date | PASS | returns nil on "Already up to date"; `TestUpdate_SkipBrewUpdate_ShortCircuitsWhenUpToDate` |
| MUST exit non-zero only on genuine failure | PASS | error paths are real failures (brew errors, daemon restart failure) |
| **MUST NOT SIGKILL a package-manager subprocess mid-transaction** | **FAIL** | `exec.CommandContext` default cancel = `os.Process.Kill()` (SIGKILL) on context expiry |
| **MUST NOT impose a short hard timeout on `brew upgrade`** | **FAIL** | `const brewTimeout = 120 * time.Second` (`upgrade.go:20`) — the incident's exact 120s figure |
| SHOULD: any bound generous + graceful (SIGTERM + grace) | **FAIL** (implement) | no `cmd.Cancel`/`cmd.WaitDelay` set anywhere in the brew seam |
| SHOULD self-update via brew only when brew-installed (`/Cellar/` gate, clear degrade message) | PASS | `selfpath.IsBrewInstalled` gate + guidance text; `TestUpdate_Quiet_NotBrewGuidanceSurvives` |
| One name, four places (repo = roster = formula leaf = binary) | PASS | `run-kit` everywhere (`sahil87/run-kit`, `sahil87/tap/run-kit`, `Use: "run-kit"`) |
| `v{semver}` release tags | PASS | tags `v3.8.0`…`v3.8.4` |
| Rename ships `formula_renames.json` | PASS (historical) | the `rk` → `run-kit` rename is the standard's own cited precedent; tap-side, already shipped |

**Version standard** (`shll standards version`):

| Clause | Verdict | Evidence |
|--------|---------|----------|
| MUST support `--version`, exit 0, version on stdout | PASS | cobra `Version: displayVersion()`; `TestVersionFlag` pins exit 0 + stdout |
| MUST respond within 2s / no network I/O on the version path | PASS | pure local ldflags string; no I/O |
| MUST have version token on first non-empty line | PASS | cobra default template emits exactly `run-kit version vX.Y.Z` (the RECOMMENDED canonical shape; satisfies `versionPrefixRE`) |
| Binary name on PATH equals tool name | PASS | binary `run-kit` |
| Keep a minimal test pinning exit 0 / line 1 / shape | PASS with minor gap | `TestVersionFlag`/`TestShortVersionFlag` pin `run-kit version dev` exactly — but the **release-shape path** (`displayVersion` prefixing `v` onto a numeric ldflags version) has no unit test |

### 2. Fix: graceful brew-mutation handling in `upgrade.go` (the only substantive code change)

Replace the short hard SIGKILL timeout on brew **mutations** with generous bounds and graceful termination, inside the existing `runBrewFn` default implementation (the single seam all brew calls route through — tests that stub `runBrewFn` are unaffected):

- **`brew upgrade`**: bound raised from 120s to a generous `brewUpgradeTimeout = 30 * time.Minute` (sized for a network transfer, per the standard).
- **`brew update`**: bound raised from 30s to `brewUpdateTimeout = 10 * time.Minute` — it is also a network-bound package-manager subprocess that can legitimately block for minutes; the MUST NOT-SIGKILL clause covers "a package-manager subprocess mid-transaction" generally.
- **Graceful cancel for the mutating subcommands (`update`, `upgrade`)**: set `cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }` and `cmd.WaitDelay = 30 * time.Second` (Go ≥1.20; repo is on Go 1.22). Semantics: on context expiry brew receives SIGTERM and gets a 30s grace window to unwind the keg swap before the runtime's final kill — matching the standard's "prefer SIGTERM plus a grace period".
- **Read-only brew calls keep short bounds**: `brew info --json=v2` (10s, `upgrade.go`) and `internal/updatecheck`'s `brew list --versions` (10s) are non-mutating queries — a kill there corrupts nothing and fast-fail is correct. No change.
- **Constitution tension resolved, not traded away**: § Process Execution requires `exec.CommandContext` with a timeout. We keep `CommandContext` and keep timeouts — just generous ones with graceful cancel — satisfying both the constitution and the standard's "if any bound exists, it SHOULD be generous and terminate gracefully". (The constitution's 5–10s/30s figures name tmux/build operations; brew is neither.)
- **`HOMEBREW_NO_GITHUB_API=1` is NOT set** in this change. The standard only says a bounded caller "should also consider" it; the generous bound + SIGTERM already satisfies the SHOULD, and the env var alters brew behavior beyond the update path's needs. Trivially reversible later if wanted.

Structure note: to make the cancel configuration unit-testable without spawning a real brew, extract the `exec.Cmd` construction into a small helper (e.g. `newBrewCmd(ctx context.Context, args ...string) *exec.Cmd`) that `runBrewFn`'s default impl calls; tests assert on the returned `*exec.Cmd` fields.

### 3. Tests pinning the fixed behavior

- **Unit-pin the brew command configuration** (via the extracted helper): for `update`/`upgrade` args — `Cancel != nil` and `WaitDelay == 30s`; for `info` — no graceful-cancel requirement. Behaviorally pin SIGTERM (not SIGKILL) delivery: run the helper's cmd against a short shell script that traps SIGTERM and exits cleanly, cancel the context, assert clean termination within the grace window (skippable with `testing.Short()` if slow).
- **Pin the generous bounds**: assert `brewUpgradeTimeout >= 30*time.Minute` and `brewUpdateTimeout >= 10*time.Minute` so a future refactor can't silently reintroduce a short hard cap (this is the regression the standard's failure-mode paragraph warns about).
- **Close the minor version-standard test gap**: add a `displayVersion` unit test in `root_test.go` covering `"1.2.3" → "v1.2.3"`, `"v1.2.3"` passthrough, `"dev"` passthrough — pinning the release shape `run-kit version v{semver}`, not just the dev sentinel.
- Existing `upgrade_test.go` seam tests (stubbed `runBrewFn`) and `root_test.go` version tests stay green unchanged.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) record the update + version standards audit at current standard text (post-2026-07-19 brew-safety clause): per-clause verdicts, the brew-graceful-termination fix (bounds + SIGTERM/WaitDelay values), and the read-only-vs-mutating brew call split
- `run-kit/architecture`: (modify) update the CLI `update` subcommand description (brew invocation discipline: generous bounds, SIGTERM + grace on mutations)

## Impact

- `app/backend/cmd/rk/upgrade.go` — timeout constants, `runBrewFn` default impl / extracted `newBrewCmd` helper (only substantive code change)
- `app/backend/cmd/rk/upgrade_test.go` — new pins for cancel config + bounds
- `app/backend/cmd/rk/root_test.go` — `displayVersion` unit test
- No API, frontend, or daemon changes. The web one-click upgrade path (`api/update.go` → detached `rk update --skip-brew-update`) inherits the fix automatically.
- `internal/updatecheck` unchanged (read-only brew query, deliberately out of scope).

## Open Questions

- None — the input was specific (audit two named standards, fix gaps, pin with tests), and the codebase + standards text answered every decision point.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Audit scope = exactly the two named standards (`update`, `version`), read via `shll standards <name>` from the installed shll | User named both standards and their canonical sources explicitly | S:90 R:90 A:95 D:90 |
| 2 | Certain | The sole MUST violation is the SIGKILL-capable short hard timeout on brew mutations (`brewTimeout=120s` on `upgrade`, 30s on `update`); every other clause passes with existing tests/evidence | Verified by reading both standards against `upgrade.go`, `root.go`, `api/update.go`, tests, and git tags — per-clause table in What Changes | S:85 R:85 A:95 D:90 |
| 3 | Confident | Fix shape: keep `exec.CommandContext` + timeouts (constitution § Process Execution) but generous (30 min upgrade / 10 min update) with `cmd.Cancel`=SIGTERM + `cmd.WaitDelay`=30s grace | Satisfies both the standard's SHOULD ("generous, SIGTERM + grace") and the constitution; exact durations are judgment calls within the standard's "sized for a network transfer" guidance | S:70 R:75 A:80 D:65 |
| 4 | Confident | Read-only brew calls (`brew info`, `brew list --versions`) keep their short 10s bounds | The safety clause targets mid-transaction keg mutations; killing a read query corrupts nothing and fast-fail is correct there | S:65 R:85 A:80 D:70 |
| 5 | Confident | `brew update` is included in the graceful-mutation treatment (not just `brew upgrade`) | The MUST NOT-SIGKILL clause says "a package-manager subprocess mid-transaction" generally, and `brew update` is network-bound with the same stall profile | S:60 R:80 A:70 D:60 |
| 6 | Confident | Do NOT set `HOMEBREW_NO_GITHUB_API=1` | Standard says "should also consider" (optional); graceful bound already satisfies the SHOULD; the env var changes brew behavior beyond this path and is trivially addable later | S:55 R:85 A:60 D:50 |
| 7 | Certain | Naming/release clauses need no code change (tags `v3.8.4` are v-semver; `run-kit` is one string across repo/formula/binary; rename precedent already shipped tap-side) | Verified against git tags, `root.go` `Use:`, and the standard's own citation of the rk→run-kit rename as the shipped precedent | S:80 R:90 A:85 D:85 |
| 8 | Certain | Add a `displayVersion` unit test to close the release-shape pin gap (only the `dev` sentinel is currently pinned) | The version standard asks for a minimal test pinning the shape; the v-prefix path is the one shll actually parses in production | S:70 R:95 A:90 D:85 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
