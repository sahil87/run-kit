# Intake: Delegate `rk riff` launcher resolution to `fab agent --print`

**Change**: 260703-w884-riff-launcher-fab-agent-print
**Created**: 2026-07-03

## Origin

Synthesized from a live conversation and dispatched promptless (`/fab-proceed`-style create-intake dispatch). The user diagnosed that `rk riff` ignores their configured launcher and agreed on delegation to the fab CLI:

> `resolveLauncher()` in `app/backend/cmd/rk/riff.go` resolves the agent launcher by reading `agent.spawn_command` from `fab/project/config.yaml` via `fabconfig.ReadSpawnCommand`. The project's config has been migrated to the newer fab-kit schema (fab_version 2.13.3): the launcher now lives at `providers.<name>.session_command` with per-tier model/effort profiles under `agent.tiers` — `agent.spawn_command` no longer exists. As a result `rk riff` silently falls back to the hardcoded `defaultLauncher` and ignores the user's configured session command. Agreed solution: rewrite `resolveLauncher()` to execute `fab agent --print` (timeout, trim stdout, silent fallback), and delete `fabconfig.ReadSpawnCommand` plus its tests. Rejected alternatives: teaching `internal/fabconfig` the new schema (reimplements fab-kit's tier→provider→session_command resolution and breaks on the next schema change — constitution §III Wrap, Don't Reinvent), and keeping `ReadSpawnCommand` as a second fallback (dead code).

Key decisions carried from the conversation are recorded in `## Assumptions` (rows 1-4, 8-9).

## Why

1. **Pain point**: `rk riff` spawns Claude panes with the wrong launcher. `resolveLauncher()` (riff.go:349) reads the `agent.spawn_command` key, which no longer exists in the fab-kit 2.13.3 config schema, so every riff invocation silently falls back to `defaultLauncher = "claude --dangerously-skip-permissions"` (riff.go:40) — dropping the user's configured session command `claude --dangerously-skip-permissions --effort xhigh -n "$(basename "$(pwd)")"` (its `--effort` and window-naming flags).
2. **Consequence if unfixed**: every riff-spawned agent session runs without the configured effort level and session naming, and the divergence is invisible (the fallback is silent by design). The gap re-widens with every future schema evolution as long as rk parses fab's config itself.
3. **Why this approach**: `fab agent --print` prints the fully-resolved default-tier session command — fab-kit's own resolution (tier → provider → `session_command`, with `{model}`/`{effort}` substitution via fab's `internal/spawn.WithProfile`). Delegating to the fab CLI means rk can never drift from fab's schema again. This is constitution §III (Wrap, Don't Reinvent) applied to fab-kit's own binary. Verified locally, `fab agent --print` outputs:

   ```
   claude --dangerously-skip-permissions --effort xhigh -n "$(basename "$(pwd)")" --model claude-fable-5 --effort xhigh
   ```

   The default tier is semantically correct: it is the tier fab-kit itself uses for `fab batch`/`fab agent` interactive workers — the same role a riff pane plays.

## What Changes

### 1. Rewrite `resolveLauncher()` in `app/backend/cmd/rk/riff.go`

Replace the config-file read with a subprocess call to `fab agent --print`:

- Execute via `exec.CommandContext` with an explicit argument slice (`"fab", "agent", "--print"`) and a 10-second timeout, following the existing `tmuxTimeout` pattern in riff.go (constitution §I + §Process Execution). Introduce a named timeout constant alongside `wtTimeout`/`tmuxTimeout` (e.g., `fabTimeout = 10 * time.Second`).
- Capture stdout (`cmd.Output()`, not `CombinedOutput()` — stderr must not pollute the launcher string), `strings.TrimSpace` it, and use the result as the launcher when it is a non-empty single line.
- **On any failure, fall back silently to `defaultLauncher`**: `fab` not on PATH, non-zero exit, timeout, empty/whitespace-only output. No stderr noise, never errors — preserving `resolveLauncher`'s current documented never-errors posture (riff.go runRiff Step 5 comment).
- Rely on fab's own cwd-based repo discovery (`fab agent` defaults to "current repo"); `rk riff` always runs inside the repo, so the `--repo` flag and rk's `config.FindGitRoot` walk are unnecessary in `resolveLauncher` (see Assumptions row 5).
- The current shape, for reference (riff.go:349-362):

  ```go
  func resolveLauncher() string {
      cwd, err := os.Getwd()
      if err != nil {
          return defaultLauncher
      }
      root := config.FindGitRoot(cwd)
      if root == "" {
          return defaultLauncher
      }
      if v := fabconfig.ReadSpawnCommand(root); v != "" {
          return v
      }
      return defaultLauncher
  }
  ```

- The resolved command embeds `$(basename "$(pwd)")`, which expands at pane-spawn time inside the existing `sh -i -c` wrap — the already-documented exception to constitution §I (rk-riff.md §Single-Quote Escaping / §Security). The trust boundary is unchanged and actually narrows: the launcher now comes from the `fab` binary's stdout (itself resolved from the committed `fab/project/config.yaml`), the same "config ≙ committed code" boundary.

### 2. Delete `fabconfig.ReadSpawnCommand` (`app/backend/internal/fabconfig/fabconfig.go`)

- Remove `ReadSpawnCommand` (fabconfig.go:61-85) and the now-orphaned `fabConfig` struct (fabconfig.go:30-34, used only by `ReadSpawnCommand`).
- `ReadPresets` / `ReadPresetsOrdered` and all preset types **remain** — riff presets are untouched.
- Update comments that reference the deleted symbol: the package doc comment, the `fabConfig` struct comment, and `ReadPresets`'s doc line "matches the silent-fallback posture of ReadSpawnCommand" (fabconfig.go:100-102) — the silent-fallback posture stays, only the cross-reference target changes.

### 3. Update user-facing help text and comments in `riff.go`

- The `Long` help's "Launcher resolution:" paragraph (riff.go:101-104: "If 'fab/project/config.yaml' has 'agent.spawn_command'…") must describe the new behavior: resolved via `fab agent --print` (default tier), falling back to `claude --dangerously-skip-permissions` when `fab` is unavailable or fails.
- The Prerequisites bullet and the runRiff "Step 5: launcher resolution" comment get the same treatment.
- Drop the now-unused `rk/internal/config` import from riff.go if `FindGitRoot` is no longer referenced there (`readPresetsForRepo`/`readPresetsOrderedForRepo` still use it — verify before removing).

### 4. Tests

- **`app/backend/cmd/rk/riff_test.go`**: `TestResolveLauncher` (table of 5 config-file cases), `TestResolveLauncher_ReadsFromSubdir`, and `TestFabconfigIntegration` all assert the dead config-read path — rewrite/delete them. New coverage via a test seam: the current `resolveLauncher` is untestable-as-subprocess, so split it into a thin exec wrapper plus a pure post-processing helper (mirroring riff.go's established pure-helper seam pattern: `parseWorktreePath`, `parsePaneID`, `buildWtDeleteArgs`), e.g. a pure `parseFabAgentOutput(stdout string, err error) string` covering: success → trimmed command; error → ""; empty/whitespace stdout → ""; multi-line stdout → "" (fallback). End-to-end `resolveLauncher` behavior (fab found vs not found) is covered by staging a stub `fab` executable on a temp-dir `PATH` (see Assumptions row 7).
- **`app/backend/internal/fabconfig/fabconfig_test.go`**: delete `TestReadSpawnCommand` and `TestReadSpawnCommand_EmptyRoot`; keep all `ReadPresets`/`ReadPresetsOrdered` tests and any shared helpers they use.
- Gate: `cd app/backend && go test ./...` green.

### Non-goals

- **Duplicate `--effort xhigh` in the resolved command** (once from the user's `session_command` string, once appended by fab's profile injection): last-wins, harmless, config hygiene for the user — explicitly out of scope.
- No change to preset resolution, pane composition, layouts, fan-out, or any other riff behavior.
- No new schema parsing in `internal/fabconfig` (the rejected alternative).

## Affected Memory

- `run-kit/rk-riff`: (modify) Launcher resolution is documented in §Workflow Step Order (step 6: "fabconfig.ReadSpawnCommand or hardcoded default"), §`internal/fabconfig/` Package (public API listing), §Presets (validation posture cross-reference), §Security / Trust Boundary (`agent.spawn_command` mention), §Tests, and §Related Files — all need updating to the `fab agent --print` delegation and the shrunk fabconfig API.

## Impact

- `app/backend/cmd/rk/riff.go` — `resolveLauncher()` rewrite, new timeout const, help text + comments, possible import pruning
- `app/backend/cmd/rk/riff_test.go` — launcher test rewrite (new seam), removal of config-read launcher tests
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadSpawnCommand` + `fabConfig` struct deletion, comment updates
- `app/backend/internal/fabconfig/fabconfig_test.go` — `ReadSpawnCommand` test deletion
- `docs/memory/run-kit/rk-riff.md` — hydrate-stage updates
- **New soft runtime dependency**: the `fab` binary on PATH. Soft because absence degrades silently to `defaultLauncher` — same failure posture as today's missing-config case. No backend API, frontend, or e2e surface is touched.

## Open Questions

- None — all decision points were resolved in the originating conversation or graded below; nothing landed at Unresolved.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delegate launcher resolution to `fab agent --print` (default tier), not a fabconfig schema re-teach | Discussed — user chose CLI delegation over reimplementing fab's tier→provider resolution; constitution §III; default tier verified as fab's own batch/agent worker tier | S:90 R:75 A:90 D:90 |
| 2 | Certain | On any failure (`fab` absent, non-zero exit, timeout, empty output) fall back silently to `defaultLauncher` | Discussed — preserves the current silent best-effort posture; never errors, no stderr noise | S:90 R:85 A:90 D:90 |
| 3 | Certain | Delete `fabconfig.ReadSpawnCommand` + its tests + the orphaned `fabConfig` struct; keep `ReadPresets`/`ReadPresetsOrdered` | Discussed — the key it reads is dead in the 2.13.3 schema; keeping it as a second fallback was explicitly rejected as dead code | S:90 R:80 A:90 D:85 |
| 4 | Certain | Subprocess uses `exec.CommandContext` + explicit arg slice + 10s named timeout const following the `tmuxTimeout` pattern | Discussed — constitution §I and §Process Execution mandate the pattern; 10s named in the conversation | S:85 R:95 A:90 D:75 |
| 5 | Confident | Rely on fab's own cwd-based repo discovery; drop `config.FindGitRoot`/`--repo` from `resolveLauncher` | `fab agent` defaults to the current repo and walks up like `FindGitRoot`; `rk riff` always runs in-repo; less reimplementation. Easily reinstated via `--repo <root>` if a divergence surfaces | S:70 R:85 A:80 D:70 |
| 6 | Confident | Trimmed stdout containing an embedded newline (multi-line output) is treated as malformed → fallback | Conversation specified "trim the single-line stdout"; a valid session command is one line; conservative fallback matches the silent posture | S:65 R:90 A:80 D:65 |
| 7 | Confident | Test seam: split into pure post-processing helper (`parseFabAgentOutput`-style) + stub `fab` executable on temp-dir PATH for end-to-end cases | Conversation delegated the seam design, pointing at riff.go's established pure-helper pattern (`parseWorktreePath`, `parsePaneID`); PATH-stub is the standard Go technique for exec-path coverage | S:60 R:85 A:75 D:55 |
| 8 | Certain | Update riff.go `Long` help ("Launcher resolution:"), Prerequisites bullet, and Step-5 comment to describe the new resolution | Help text currently documents the dead `agent.spawn_command` behavior; code-quality requires docs match behavior | S:75 R:95 A:95 D:90 |
| 9 | Certain | Duplicate `--effort` in the resolved command is out of scope (user config hygiene) | Discussed — last-wins, harmless, explicitly excluded from this change | S:90 R:95 A:90 D:95 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
