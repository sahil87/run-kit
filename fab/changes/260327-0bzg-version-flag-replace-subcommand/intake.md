# Intake: Replace `rk version` Subcommand with `--version` / `-v` Flag

**Change**: 260327-0bzg-version-flag-replace-subcommand
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Change `rk` CLI to use `--version` and `-v` flags instead of the `rk version` subcommand for printing the version. Currently `rk version` outputs `rk version 0.3.0`. Replace the `version` subcommand with a `--version` / `-v` global flag that prints the same output. Remove the `version` subcommand entirely.

One-shot request with clear, specific scope. No ambiguity in the desired behavior.

## Why

The `rk version` subcommand is a non-standard pattern for Go CLI tools. The idiomatic convention (used by `go`, `docker`, `kubectl`, `cobra` itself) is `--version` / `-v` as a global flag on the root command. This change aligns `rk` with user expectations for how version information is accessed in CLI tools.

If left unchanged, users unfamiliar with `rk` will instinctively try `rk --version` or `rk -v` and get an error, which creates a poor first-run experience. The subcommand also occupies a slot in the help output that could be reserved for more meaningful commands.

## What Changes

### Remove the `version` subcommand

- Delete `app/backend/cmd/rk/version.go` entirely (the file defines only `versionCmd`)
- Delete `app/backend/cmd/rk/version_test.go` entirely
- Remove `rootCmd.AddCommand(versionCmd)` from the `init()` function in `app/backend/cmd/rk/root.go`

### Add `--version` / `-v` global flag to root command

In `app/backend/cmd/rk/root.go`:

- Use Cobra's built-in `rootCmd.Version` field. Setting `rootCmd.Version = version` enables Cobra's native `--version` flag behavior automatically.
- Cobra's default version output format is `{cmd.Name()} version {version}`, which matches the current `rk version 0.3.0` format exactly. No custom template needed.
- Cobra automatically registers both `--version` and `-v` flags when `Version` is set.

The resulting behavior:

```
$ rk --version
rk version 0.3.0

$ rk -v
rk version 0.3.0

$ rk version
Error: unknown command "version" ...
```

### Update tests

- Remove the `version_test.go` file (tests for the deleted subcommand)
- Update `root_test.go`: remove `"version"` from the `TestRootCmdHasSubcommands` expected map
- Add a new test in `root_test.go` verifying that `rk --version` produces `rk version dev` output (matching the test-time `version = "dev"` default)

### Update architecture memory

The `docs/memory/run-kit/architecture.md` file references `version` as a Cobra subcommand. This will need updating post-implementation to reflect the flag-based approach.

## Affected Memory

- `run-kit/architecture`: (modify) Update CLI subcommand listing to remove `version` subcommand and note `--version`/`-v` flag instead

## Impact

- **CLI entrypoint** (`app/backend/cmd/rk/`): Three files changed (root.go modified, version.go deleted, version_test.go deleted), one file updated (root_test.go)
- **Build system**: No changes -- the `version` variable is still set via `-ldflags -X main.version=...` at build time
- **User-facing**: `rk version` will stop working; `rk --version` and `rk -v` will work instead. This is a breaking change to the CLI interface but the tool is pre-1.0 and the new interface is more conventional
- **No API changes**: This is CLI-only; no HTTP endpoints, frontend, or tmux integration affected

## Open Questions

None. The scope is clear and Cobra's built-in `Version` field handles the mechanics.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use Cobra's built-in `rootCmd.Version` field | Cobra natively supports `--version`/`-v` when `Version` is set -- this is the idiomatic approach and avoids custom flag handling | S:95 R:90 A:95 D:95 |
| 2 | Certain | Output format remains `rk version {version}` | Cobra's default version template produces exactly this format, matching the current output | S:90 R:95 A:90 D:95 |
| 3 | Certain | Delete `version.go` and `version_test.go` entirely | The user explicitly requested removing the subcommand entirely; these files contain only the subcommand definition and its tests | S:95 R:85 A:95 D:95 |
| 4 | Confident | Breaking change is acceptable | Tool is pre-1.0 and the new interface is more conventional; the user explicitly requested this change | S:85 R:70 A:75 D:85 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
