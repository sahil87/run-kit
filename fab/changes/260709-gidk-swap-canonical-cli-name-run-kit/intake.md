# Intake: Swap Canonical CLI Name to run-kit

**Change**: 260709-gidk-swap-canonical-cli-name-run-kit
**Created**: 2026-07-09

## Origin

Promptless dispatch (Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a synthesized user-conversation description. No questions were asked; all conversation decisions are encoded in the Assumptions table.

> Swap the canonical CLI identity from `rk` to `run-kit`. `run-kit` becomes the primary command name; `rk` remains a permanently-supported, fully-interchangeable alias so no existing command, script, or hook breaks.

Key context from the conversation:

- The project's discovery-layer identity is already `run-kit` everywhere: GitHub repo `sahil87/run-kit`, the shll.ai page at `https://shll.ai/run-kit`, the shll roster's `Repo: "run-kit"` field, description "Run-kit".
- The published website install step is `shll install run-kit`, but shll's roster has `Name: "rk"` (exact-match), so that instruction fails today. The user will update the `shll` and `shll.ai` repos separately — those repos are OUT OF SCOPE for this change.
- The original run-kit→rk rename (archived change `260323-ycod-rename-cli-to-rk`, March 2026) was motivated by the Homebrew-core `run-kit` name conflict for unqualified `brew install`. The shll meta-CLI now owns the install layer and always installs fully qualified (`brew install sahil87/tap/<formula>`), so the conflict no longer constrains naming. The user explicitly stated they are no longer worried about the overlap.
- The completed change `260707-ook7-run-kit-command-alias` added `run-kit` as a Homebrew symlink alias but kept `rk` canonical (its Assumption 1 explicitly inverted the user's phrasing). This change deliberately reverses that canonical direction with the new shll rationale.

**Gap analysis**: `260707-ook7` covers the alias *mechanics* (formula symlink, docs alias mention — already shipped: `.github/formula-template.rb` has the `run-kit` symlink and both-name test today), but it kept `rk` canonical. No existing mechanism covers the canonical-direction swap; this change builds on ook7's shipped state.

**Corrections made while verifying against code** (the synthesized description was checked file-by-file):

1. The version-output test assertions live in `app/backend/cmd/rk/root_test.go` (lines 52, 68: `want := "rk version dev"`) — there is no `version_test.go`.
2. `resolveRkPath` is at `app/backend/cmd/rk/agent_setup.go:92` (`exec.LookPath("rk")`), not line 98.
3. `upgrade.go`'s non-brew reinstall hint prints `brew tap sahil87/tap` + `brew install rk` (lines 91–92) — the two-step form, not the fully-qualified one-liner.

## Why

**Problem**: The tool has two identities. The discovery layer (GitHub repo, shll.ai page, shll roster `Repo:` field, README title) says `run-kit`; the command layer (Cobra `Use`, version string, help-dump `tool:` field, Homebrew formula `rk.rb`, docs install voice) says `rk`. The published website install step `shll install run-kit` fails today because shll's roster matches on `Name: "rk"` exactly. Every touchpoint where the two identities meet is a papercut, and the user has decided to consolidate on `run-kit`.

**Consequence of not fixing**: The website's own install instruction stays broken (or the shll roster keeps the awkward `Name: "rk"` mismatch with its `Repo: "run-kit"`), help output and version strings keep teaching a name that differs from every discovery surface, and the identity drift compounds with each new consumer (help-dump JSON, shll roster, docs).

**Why this approach** (canonical swap with permanent alias) **over alternatives**:

- *Keeping `rk` canonical and only fixing website copy* — rejected: the user wants identity consolidation on `run-kit`, not another patch over the drift.
- *Shell alias for the second name* — rejected: doesn't work in scripts, hooks, or non-interactive shells.
- *argv[0]-dynamic Cobra `Use`* — rejected: breaks help-dump determinism (shll.ai regenerates the help JSON by running the CLI on a schedule; output must not depend on which name invoked it) and adds code for no gain.
- *Renaming the Go module path / internals* — rejected: pure churn; touching `~/.rk/` or daemon session names would break existing installs' state.

The original reason `rk` won (Homebrew-core `run-kit` conflict for unqualified `brew install`) no longer applies: the shll meta-CLI always installs fully qualified (`brew install sahil87/tap/<formula>`), so the tap-scoped name cannot collide.

## What Changes

### 1. Cobra root identity — `app/backend/cmd/rk/root.go`

Current (lines 23–25):

```go
var rootCmd = &cobra.Command{
	Use:     "rk",
	Short:   "rk — tmux session manager with web UI",
```

Becomes:

```go
var rootCmd = &cobra.Command{
	Use:     "run-kit",
	Short:   "run-kit — tmux session manager with web UI",
```

- `Use` stays a **static string** — argv[0]-dynamic `Use` was explicitly rejected (help-dump determinism).
- Version output flows automatically from Cobra's version template (which prints the root display name): `rk --version` and `run-kit --version` both print `run-kit version v1.5.3` (dev builds: `run-kit version dev`).
- Update the `displayVersion()` doc comment's example (`"rk version v1.5.3"` → `"run-kit version v1.5.3"`, root.go:14).
- Tests: `root_test.go:52` and `:68` change `want := "rk version dev"` → `"run-kit version dev"`.

### 2. help-dump frozen JSON contract — `app/backend/cmd/rk/help_dump.go`

- `buildDump` (line 87): `Tool: "rk"` → `Tool: "run-kit"`.
- `schemaVersion` stays `1` — this is a value change within the frozen shape `{tool, version, captured_at, schema_version, root}`, not a shape change.
- `root.name`, `root.path`, and every `usage`/`text` string follow automatically from the Cobra `Use` change (`captureNode` uses `cmd.Name()`/`CommandPath()`/`UseLine()`/`UsageString()`).
- Tests: `help_dump_test.go:51–52` (`doc.Tool`), `:60–64` (`doc.Root.Name`, `doc.Root.Path`) change `"rk"` → `"run-kit"`. The usage assertion at `:197` compares against `rootCmd.UseLine()` and is self-consistent.
- Consumer note: shll.ai pulls this JSON on a schedule by running the CLI itself; the user coordinates the shll.ai consumer side separately (out of scope).

### 3. Shell completion binds BOTH names — `app/backend/cmd/rk/shell_init.go`

After the `Use` swap, cobra generates completion for `run-kit` only (zsh function `_run-kit` registered via `compdef _run-kit run-kit`; bash entry function `__start_run-kit` registered via a `complete ... run-kit` line). Without an extra registration, the daily-typed `rk` **silently loses tab completion**. Required:

- **zsh**: append an extra `compdef _run-kit rk` line after the cobra-generated script.
- **bash**: append an extra `complete` line for `rk` using the same entry function and the same flags cobra's generated script uses for the primary name (e.g. `complete -o default -F __start_run-kit rk` — copy the exact generated invocation's flags).
- `shellInitBanner` text updates: `# run-kit(1) zsh completion`, install hint `eval "$(run-kit shell-init zsh)"`, the explanatory note's `rk <subcommand>` phrasing → `run-kit <subcommand>`, and error messages (`rk shell-init: missing shell...` → `run-kit shell-init: ...`).
- The `zshCompinitShim` comment text mentioning `_rk`/`rk` updates to match the generated names.
- fish/powershell outputs keep cobra's single-name (`run-kit`) binding — zsh/bash are the documented targets (see Assumption 9).
- Tests: `shell_init_test.go` — banner anchors (`# rk(1) zsh completion` → `# run-kit(1) ...`, eval hints), `:56` `compdef _rk rk` → assert BOTH `compdef _run-kit run-kit` (generated) and `compdef _run-kit rk` (appended), `:96` `__start_rk` → `__start_run-kit` plus the appended `rk` complete line; the no-wrapper test should anchor on both `rk()` and `run-kit()` forms; error-message assertions follow the new prefix.

### 4. Formula template flips real-vs-alias — `.github/formula-template.rb`

Current (shipped by ook7): `class Rk`, `bin.install "rk"`, `bin.install_symlink bin/"rk" => "run-kit"`, tests assert `"rk version"`. Becomes:

```ruby
class RunKit < Formula
  # ... urls/sha blocks unchanged (tarballs keep rk-{os}-{arch}.tar.gz with a single rk member) ...

  def install
    bin.install "rk" => "run-kit"
    bin.install_symlink bin/"run-kit" => "rk"
  end

  test do
    assert_match "run-kit version", shell_output("#{bin}/run-kit --version")
    assert_match "run-kit version", shell_output("#{bin}/rk --version")
  end
end
```

- The formula installs the tarball's `rk` binary **renamed at install time** to `run-kit`, and symlinks `rk` back. The physical binary in the tarball is NOT renamed (user-stated invariant).
- The `desc`/`homepage`/`url` lines are unchanged.

### 5. Release workflow pushes the new formula file — `.github/workflows/release.yml`

"Update Homebrew tap" step (lines 145–157): the sed output path `>/tmp/homebrew-tap/Formula/rk.rb` → `Formula/run-kit.rb`, `git add Formula/rk.rb` → `Formula/run-kit.rb`, commit message `"rk ${version}"` → `"run-kit ${version}"`. The cross-compile step (lines 83–98) is untouched: outputs stay `dist/rk-{os}-{arch}/rk` and `rk-{os}-{arch}.tar.gz`.

**Sequencing dependency (out of scope but binding)**: the `sahil87/homebrew-tap` repo must gain `formula_renames.json` mapping `"rk": "run-kit"` (and drop the old `Formula/rk.rb`) **before or with** the next release, so existing `rk` installs upgrade seamlessly via brew's rename redirect. That tap-repo work is a separate follow-up handled next.

### 6. `rk update` / upgrade.go moves to the new formula identity — `app/backend/cmd/rk/upgrade.go`

- Homebrew-install marker: `strings.Contains(resolved, "/Cellar/rk/")` (line 88) and `strings.Index(resolved, "/Cellar/rk/")` (line 141) → `"/Cellar/run-kit/"`; update the comments at lines 57 and 139.
- Formula refs: `brew info --json=v2 sahil87/tap/rk` (line 112) and `brew upgrade sahil87/tap/rk` (line 132) → `sahil87/tap/run-kit`.
- Stable bin path: `brewBinPath := resolved[:cellarIdx] + "/bin/rk"` (line 145) → `"/bin/run-kit"`.
- Messages: `"rk v%s was not installed via Homebrew."` (line 89) → `run-kit` phrasing; the reinstall hint `brew install rk` (line 92) → `brew install run-kit` (after the existing `brew tap sahil87/tap` line); `"Restarting rk daemon..."` / `"rk daemon started (…)"` (lines 149, 153) → `run-kit` phrasing (the printed socket/session names `rk-daemon` are internal identifiers and stay); `Short: "Update rk to the latest version"` (line 81) → `run-kit`.
- Tests: `upgrade_test.go` — stub Cellar paths (lines 90, 125, 152: `/opt/homebrew/Cellar/rk/9.9.9/bin/rk` etc.) → `/Cellar/run-kit/<v>/bin/run-kit`; the restart-path assertion (lines 118–119, `/bin/rk` suffix) → `/bin/run-kit`; brew-arg recordings of `sahil87/tap/rk` → `sahil87/tap/run-kit`.
- **Transition safety** (verified reasoning): an old installed binary runs its OLD logic — resolves its own path under `/Cellar/rk/`, so the marker matches; runs `brew upgrade sahil87/tap/rk`, which brew's `formula_renames` redirects to `run-kit`; derives `<prefix>/bin/rk` for the daemon restart, which still exists because the new formula symlinks `rk`. The old flow completes. The NEW logic only needs the new markers — no dual-marker back-compat in code (Assumption 6).

### 7. agent-setup hook path resolution — `app/backend/cmd/rk/agent_setup.go`

`resolveRkPath` (line 92) currently prefers `exec.LookPath("rk")`. New installs SHOULD prefer `exec.LookPath("run-kit")` with `exec.LookPath("rk")` fallback, then the existing `os.Executable()` fallback (Assumption 7 — plan-level detail; the user stated either order is functionally correct since both stable symlinks resolve to the same binary). Existing installed hooks embed `/opt/homebrew/bin/rk` and keep working forever because the `rk` symlink persists. The hook-command shape, `rkHookMarker`/`rkHookMarkerAgentHook` identification, and `validateHookPath` are unchanged (a `run-kit` path contains no shell-unsafe characters). The existing `resolveRkPath` test (`agent_setup_test.go:388–400`) asserts only non-empty + absolute and is order-agnostic.

### 8. User-facing message-string sweep — `app/backend/cmd/rk/`

All user-facing strings that name the command switch to `run-kit` phrasing. Representative inventory (the plan should do a comprehensive grep of `cmd/rk/`):

- `daemon.go:9–20` — `Short`/`Long` ("Manage the background rk daemon (tmux-managed rk serve)", "'rk daemon <subcommand> --help'").
- `daemon_start.go:27–42,70`, `daemon_stop.go:15–37`, `daemon_restart.go:14–56`, `daemon_status.go:51–57,147,154` — help text and printed messages ("rk daemon started (…)", "rk daemon stopped", "rk daemon not running", "`rk daemon stop --force`").
- `serve.go:73–77` — Long-help examples (`rk serve`, `RK_HOST=0.0.0.0 RK_PORT=8080 rk serve`, "'rk daemon start'"). The `RK_HOST`/`RK_PORT` env var names are internal and stay.
- `context.go:141–147` — the `rk context` markdown output's command listing ("- `rk serve` — Start the HTTP server" etc.).
- `layout.go:45` — `"rk riff: unknown --layout …"` error prefix.
- `reaper.go`, `doctor.go`, `notify.go`, `status.go`, `initconf.go`, `riff.go`, `agent_setup.go`, `agent_hook.go` — `Short`/`Long` help text and error prefixes naming `rk <subcommand>`.
- Cobra-derived `UseLine()`/help output follows the root `Use` automatically.

**Sweep exclusions** (internal identifiers that appear inside messages but MUST NOT change): `rk-daemon` socket/session names, `rk-test` reaper prefixes, `RK_*` env vars, `~/.rk/` paths, `@rk_*` tmux option names, `bin/rk`/`dist/rk` paths.

### 9. Docs voice — `README.md`, `docs/site/install.md`

Editorial swap: teach `run-kit` as the canonical command with `rk` presented as the short alias (reverse of today's framing). This is an **editorial pass, not a token find-replace** — prose referring to internals keeps `rk`:

- Install command: `brew install sahil87/tap/rk` (README:56, install.md:10) → `brew install sahil87/tap/run-kit`.
- Alias sentences flip: README:67 ("The formula also installs `run-kit` as an interchangeable alias of `rk`") and install.md:13 ("This puts the `rk` binary on your `PATH`. The formula also installs `run-kit` as an interchangeable alias…") → the formula installs `run-kit` with `rk` as the fully-interchangeable short alias.
- Primary examples switch: `run-kit serve -d`, `run-kit update`, `run-kit riff …`, `run-kit agent-setup`, `run-kit doctor`, `run-kit shell-init`, the command-reference table, upgrade instructions (`rk update` → `run-kit update`), install.md's intro line "How to install `rk`…".
- KEEP as-is: `rk-daemon` tmux server name (README:115, 251), `RK_HOST`/`RK_PORT` env vars, `~/.rk/` config dir, `@rk_agent_state`/`@rk_board` option names, `bin/rk` dev-build references, repo-internal links/anchors, and references to other tools' formulas (`sahil87/tap/wt`, `sahil87/tap/all`).
- The mental-model/branding prose ("rk is two independent halves…") is re-voiced to run-kit where it names the command; presenting `rk` as the short alias people type daily is encouraged (e.g. keep a note that `rk` remains fully supported).
- Other `docs/site/` pages (`workflows.md`, `status-dot.md`, `notifications.md`) are NOT in scope for this pass (Assumption 8) — both names remain interchangeable, so existing `rk` prose stays correct.

### Invariants (MUST NOT change)

- `rk` remains a real on-PATH executable name (symlink) **indefinitely** — installed agent-setup hooks embed `/opt/homebrew/bin/rk`, and fab-kit skills gate on `command -v rk`.
- Internals stay `rk`: Go module path (`module rk`), `cmd/rk/` directory, `RK_*` env vars, `rk-daemon` socket / tmux session names, `~/.rk/` config dir, `dist/rk` build output, `bin/rk` dev build, and release artifact names `rk-{os}-{arch}.tar.gz` containing a single `rk` member (the physical binary is not renamed; the formula renames at install time).
- Both names remain fully interchangeable for every subcommand.

### Out of Scope

- `sahil87/homebrew-tap` repo changes (`formula_renames.json` mapping `"rk": "run-kit"`, removing the old `Formula/rk.rb`) — separate follow-up handled next; sequencing dependency noted in § 5.
- `shll` repo roster changes and shll.ai site copy — user handles independently.

## Affected Memory

- `run-kit/architecture`: (modify) — canonical command name is now `run-kit` with `rk` as the permanent alias; formula/deployment details (formula `run-kit.rb`, install-time rename + `rk` symlink, `/Cellar/run-kit/` upgrade marker, `sahil87/tap/run-kit` refs); help-dump `tool: "run-kit"`.
- `run-kit/agent-state`: (modify) — `resolveRkPath` preference order (`run-kit` first, `rk` fallback) if the plan adopts it; note that installed hooks embedding `…/bin/rk` remain valid.

## Impact

- **Go source** (`app/backend/cmd/rk/`): `root.go`, `help_dump.go`, `shell_init.go`, `upgrade.go`, `agent_setup.go`, plus the message-string sweep across `daemon*.go`, `serve.go`, `context.go`, `layout.go`, `reaper.go`, `doctor.go`, `notify.go`, `status.go`, `initconf.go`, `riff.go`, `agent_hook.go`. No API/frontend behavior changes (frontend has no user-facing `rk`-command strings — verified; only code comments).
- **Go tests**: `root_test.go`, `help_dump_test.go`, `shell_init_test.go`, `upgrade_test.go` (assertion updates); `agent_setup_test.go` unaffected by the LookPath-order choice.
- **Release plumbing**: `.github/formula-template.rb`, `.github/workflows/release.yml` (tap-push step only).
- **Docs**: `README.md`, `docs/site/install.md` (editorial voice swap).
- **Effect is release-gated** for installed users: the new formula identity reaches them on the first release after this merges, and REQUIRES the tap-repo `formula_renames.json` follow-up to land before/with that release.
- **Test seam**: `just test-backend` covers every Go change; the formula `test do` block covers the install-time rename + both-name assertion at `brew install`/`brew test` time (no in-repo executable seam for the formula/workflow files, same as ook7).
- **No changes** to: module path, package layout, env vars, socket/session names, config dir, build outputs, release artifact names, frontend, API surface.

## Open Questions

None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Canonical swap via static Cobra `Use: "run-kit"` (+ `Short`); version output becomes `run-kit version X` for both invocation names; argv[0]-dynamic `Use` rejected | Explicit user decision with stated reasoning (help-dump determinism); verified `root.go:24` and cobra version-template behavior | S:90 R:70 A:90 D:90 |
| 2 | Certain | Internals stay `rk`: module path, `cmd/rk/`, `RK_*` env, `rk-daemon` socket/session names, `~/.rk/`, `dist/rk`, `bin/rk`, artifact names `rk-{os}-{arch}.tar.gz` with single `rk` member | Explicit user invariant ("the physical binary does not need renaming"); renaming internals would break existing installs' state | S:95 R:85 A:90 D:90 |
| 3 | Certain | Formula flips real-vs-alias: `class RunKit` pushed as `Formula/run-kit.rb`, `bin.install "rk" => "run-kit"`, `bin.install_symlink bin/"run-kit" => "rk"`, test asserts both names output "run-kit version"; release.yml tap-push step follows | Explicit user decision with exact mechanics agreed in conversation; verified current template + workflow lines | S:90 R:75 A:85 D:85 |
| 4 | Certain | Completions bind BOTH names: extra zsh `compdef _run-kit rk` and bash `complete … rk` registration lines appended after the cobra-generated script; banner/install-hint text updates | Explicit user decision — without it the daily-typed `rk` silently loses tab completion; verified `shell_init.go` emits single-name cobra output today | S:85 R:80 A:85 D:85 |
| 5 | Confident | help-dump `tool:` changes `"rk"` → `"run-kit"` with `schema_version` staying 1 (value change, not shape change); shll.ai consumer side coordinated separately by the user | User decided the field change and owns the consumer; schema_version semantics ("bump only on breaking shape change") read from `help_dump.go:15` — a value change within the frozen shape | S:80 R:60 A:80 D:80 |
| 6 | Confident | `upgrade.go` moves wholly to new markers (`/Cellar/run-kit/`, `sahil87/tap/run-kit`, `/bin/run-kit`) with NO dual-marker back-compat; old-binary transition rides brew `formula_renames` + the persistent `rk` symlink | Conversation-verified transition walk-through (old logic self-resolves under `/Cellar/rk/`, brew redirects the upgrade, `bin/rk` symlink persists for the restart); depends on the tap follow-up sequencing (row 10) | S:80 R:55 A:75 D:70 |
| 7 | Confident | `resolveRkPath` for NEW hook installs prefers `exec.LookPath("run-kit")` with `LookPath("rk")` fallback, then `os.Executable()` | User explicitly deferred as plan-level ("either is functionally correct" — both stable symlinks hit the same binary); run-kit-first matches the new canonical identity; existing hooks unaffected; test is order-agnostic | S:50 R:90 A:70 D:50 |
| 8 | Confident | Docs voice swap scoped to `README.md` + `docs/site/install.md`; other `docs/site/` pages, specs, and memory prose keep `rk` (memory updates via hydrate) | User named exactly these two files; both names stay interchangeable so other pages remain correct; editorial-not-find-replace rule stated by user | S:75 R:85 A:75 D:70 |
| 9 | Confident | fish/powershell shell-init outputs keep cobra's single-name (`run-kit`) binding; only zsh/bash (the documented targets) get the dual registration | Conversation specified zsh/bash lines only; `shell_init.go` documents fish/powershell as undocumented freebies; trivially reversible if wanted later | S:35 R:85 A:65 D:50 |
| 10 | Confident | Tap-repo follow-up (`formula_renames.json` `{"rk": "run-kit"}`, drop old `Formula/rk.rb`) is OUT of this change's scope but MUST land before/with the next release — recorded as a sequencing note, not implemented here | User explicitly scoped the tap repo out and stated the sequencing dependency; this intake's job is to note it for ship/release coordination | S:80 R:50 A:70 D:75 |
| 11 | Confident | Message-string sweep covers all user-facing `cmd/rk` strings (help Short/Long, printed messages, error prefixes like `rk riff:` / `rk shell-init:`), excluding internal identifiers appearing inside messages (`rk-daemon`, `rk-test`, `RK_*`, `~/.rk/`, `@rk_*`) | User decided "user-facing message strings switch to run-kit phrasing"; the exclusion list follows directly from the internals-stay-rk invariant; comprehensive grep is a plan task | S:70 R:80 A:80 D:65 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).
