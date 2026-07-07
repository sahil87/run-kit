# Intake: run-kit Command Alias

**Change**: 260707-ook7-run-kit-command-alias
**Created**: 2026-07-07

## Origin

One-shot `/fab-new` invocation, no prior discussion in the conversation.

> Allow the command run-kit also to work - maybe make rk an alias of run-kit

The user's literal phrasing ("make rk an alias of run-kit") implies `run-kit` as the canonical name; the intake keeps `rk` canonical and adds `run-kit` as the alias because the user-visible outcome is identical (both commands work) and the reverse direction would churn release artifacts, the formula name, and the Homebrew-install detection for zero functional gain. See Assumption 1.

## Why

The project is named **run-kit** (repo `sahil87/run-kit`, docs, README branding), but the only installed command is `rk`. Someone who knows the tool by its project name types `run-kit` and gets `command not found` — a discoverability papercut at the very first touchpoint.

The naming drift is already visible in our own artifacts: `docs/memory/run-kit/architecture.md` (line ~541) informally writes "`run-kit version`" and "`run-kit update`", and the constitution's Self-Improvement Safety section says "`run-kit serve --restart`" — humans (and our own docs) naturally reach for the long name. If we don't fix it, the docs/command mismatch persists and every new user pays the papercut once.

Why this approach over alternatives: a Homebrew symlink alias is the standard, zero-code way to ship two command names for one binary (works in scripts, hooks, and non-interactive shells — unlike a shell alias), and it requires no changes to release artifacts or the binary itself.

## What Changes

### Homebrew formula: install `run-kit` as a symlink alias of `rk`

`.github/formula-template.rb` `def install` currently installs only the `rk` binary. Add a symlink alongside it:

```ruby
def install
  bin.install "rk"
  bin.install_symlink bin/"rk" => "run-kit"
end
```

And extend the formula `test do` block to assert the alias resolves and runs:

```ruby
test do
  assert_match "rk version", shell_output("#{bin}/rk --version")
  assert_match "rk version", shell_output("#{bin}/run-kit --version")
end
```

This template is substituted and pushed to `sahil87/homebrew-tap/Formula/rk.rb` by CI on the next release tag (`.github/workflows/release.yml` "Update Homebrew tap" step) — the alias reaches users on their next `rk update` / `brew upgrade` after the next release. No CI workflow changes are needed: the cross-compile step, tarball layout (`rk-<os>-<arch>.tar.gz` containing a single `rk` member), and sed substitution are untouched.

### No Go code changes — the binary is already invocation-name-agnostic (verified)

- Daemon start/restart resolves the binary via `os.Executable()` + `filepath.EvalSymlinks()` (`app/backend/internal/daemon/daemon.go:249`), never argv[0].
- `rk update`'s Homebrew-install detection resolves `os.Executable()` through `EvalSymlinks` and checks for the `/Cellar/rk/` path marker (`app/backend/cmd/rk/upgrade.go:62,88`). A `bin/run-kit` symlink resolves through Homebrew's `bin/rk` link into `/Cellar/rk/<version>/bin/rk`, so `run-kit update` detects the brew install and upgrades identically.
- `rk agent-setup` pins hook paths via the same executable-resolution seam (`app/backend/cmd/rk/agent_setup.go:98`).

Cobra's `Use: "rk"` (`app/backend/cmd/rk/root.go:24`) stays static — `run-kit --help` will print usage as `rk [command]`, which is accepted (it teaches the shorter canonical command; see Assumption 4).

### Docs

- `docs/site/install.md` § Install: after "This puts the `rk` binary on your `PATH`.", note that the formula also installs `run-kit` as an interchangeable alias.
- `README.md`: mention the alias once wherever the install command is introduced (audit the install/quickstart snippet; one sentence, not a rebrand).

### Non-Goals

- **No binary rename.** Release artifact names, tarball contents, the formula name (`brew install sahil87/tap/rk`), and the `/Cellar/rk/` detection marker all stay keyed on `rk`.
- **No tap formula alias** (`brew install sahil87/tap/run-kit`). That is an `Aliases/` entry in the separate `sahil87/homebrew-tap` repo — possible follow-up, out of scope here.
- **No dev-build symlink.** `just build` keeps producing only `bin/rk`; dev flows go through `just` recipes.
- **No shell-alias approach** — wouldn't work in scripts or hooks.

## Affected Memory

- `run-kit/architecture`: (modify) — record the `run-kit` symlink alias in the formula/deployment section (formula-template.rb install + test blocks; command surface now `rk` | `run-kit`).

## Impact

- `.github/formula-template.rb` — install + test blocks (the substantive change).
- `docs/site/install.md`, `README.md` — one-line alias mentions.
- No Go source changes; no CI workflow changes; no frontend changes.
- Effect is release-gated: users get the alias on the first `brew upgrade` after the next tagged release.
- Test surface: the formula `test do` block runs at `brew install`/`brew test` time; there is no in-repo Go/frontend test seam for a formula-template change (the code-quality "must include tests" principle is satisfied by the formula test assertion — the only executable seam this change has).

## Open Questions

None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Keep `rk` as the canonical installed binary; `run-kit` is the symlink alias (inverts the user's literal "rk an alias of run-kit" phrasing) | User hedged with "maybe"; outcome is identical either way (both commands work), and renaming would churn release artifact names, tarball contents, the formula name, and `upgrade.go`'s `/Cellar/rk/` marker for zero user-visible gain | S:55 R:75 A:85 D:60 |
| 2 | Certain | Mechanism is Homebrew `bin.install_symlink` in the formula — not a second shipped binary, not a shell alias | Standard Homebrew idiom; works in scripts/hooks; no artifact or binary changes needed | S:60 R:85 A:90 D:85 |
| 3 | Confident | Scope is the command on PATH only — no tap formula alias (`brew install sahil87/tap/run-kit`) | User said "the command run-kit"; formula aliases live in the separate homebrew-tap repo; noted as possible follow-up | S:50 R:80 A:70 D:55 |
| 4 | Confident | Cobra `Use:` stays `"rk"` — `run-kit --help` prints usage as `rk [command]`; no argv[0]-dynamic Use string | Cosmetic only; canonical-name help is common CLI practice and teaches the shorter command; dynamic Use adds code for no functional gain | S:40 R:90 A:75 D:60 |
| 5 | Confident | No dev-build symlink — `just build` keeps producing only `bin/rk` | Install surface is Homebrew; dev environments invoke via `just` recipes and `bin/rk` directly | S:35 R:85 A:60 D:50 |
| 6 | Certain | No Go code changes are required for the alias to work end-to-end (serve, daemon, update, agent-setup) | Verified in code: `os.Executable()` + `EvalSymlinks` everywhere; `/Cellar/rk/` marker survives symlink resolution (`upgrade.go:88`, `daemon.go:249`) | S:70 R:90 A:95 D:90 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
