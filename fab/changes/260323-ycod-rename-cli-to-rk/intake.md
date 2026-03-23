# Intake: Rename CLI Binary to rk

**Change**: 260323-ycod-rename-cli-to-rk
**Created**: 2026-03-23
**Status**: Draft

## Origin

> Check the homebrew distribution repo at ../homebrew-tap. The name run-kit right now conflicts with something else — that's why we use the full form in the brew install step "brew install wvrdz/tap/run-kit". Can we change the distribution name to rk?

Conversational exploration followed. User asked for a recommendation on CLI name (`rk` vs `run-kit`). Agent recommended `rk` with full rename (binary + formula) for consistency. User approved and requested full scope, which was produced collaboratively. User then requested change creation and full pipeline execution.

## Why

1. **Name conflict**: `run-kit` conflicts with an existing package, forcing users to type the fully-qualified `brew install wvrdz/tap/run-kit` instead of `brew install rk`.
2. **CLI ergonomics**: `rk` is 2 characters vs 7+hyphen. CLI tools get typed hundreds of times daily — `rk serve`, `rk version` is significantly faster. The hyphen in `run-kit` is especially painful (keyboard reach, breaks double-click word selection).
3. **Consistency**: The daemon internals already use `rk` prefix (`rk-daemon` socket, `rk` tmux session, `RK_*` env vars). The external binary name should match.
4. **Precedent**: Matches the naming style of `tu` (the other formula in the same tap) and popular CLI tools (`gh`, `jq`, `rg`, `fd`).

## What Changes

### 1. Go CLI Binary

- **Directory rename**: `app/backend/cmd/run-kit/` → `app/backend/cmd/rk/`
- **Cobra root command**: `Use: "run-kit"` → `Use: "rk"` in `root.go`
- **Version output**: `"run-kit version %s"` → `"rk version %s"` in `version.go`
- **All status/error messages** in `serve.go`: 6 occurrences of "run-kit daemon" → "rk daemon"
- **Upgrade command** in `upgrade.go`:
  - Cellar path check: `/Cellar/run-kit/` → `/Cellar/rk/`
  - Brew formula refs: `wvrdz/tap/run-kit` → `wvrdz/tap/rk`
  - Status messages: "run-kit" → "rk"
- **Init-conf command** in `initconf.go`: description mentions `~/.run-kit/` → `~/.rk/`
- **Version test**: `"run-kit version dev"` → `"rk version dev"` in `version_test.go`

### 2. Go Module Path

- `go.mod`: `module run-kit` → `module rk`
- **All import paths** throughout `app/backend/`: every `"run-kit/..."` import → `"rk/..."`
- This is a mechanical find-replace across all `.go` files

### 3. Config Directory

- `internal/tmux/tmux.go`: `DefaultConfigPath` changes from `~/.run-kit/tmux.conf` → `~/.rk/tmux.conf`

### 4. Build & Release Pipeline

- **`scripts/build.sh`**: output path `dist/run-kit` → `dist/rk`, source path `./cmd/run-kit` → `./cmd/rk`, echo messages
- **`justfile`**: all `dist/run-kit` refs → `dist/rk`, `go run ./cmd/run-kit` → `go run ./cmd/rk`
- **`.github/workflows/release.yml`**:
  - Artifact names: `run-kit-{os}-{arch}` → `rk-{os}-{arch}`
  - Binary inside tarball: `run-kit` → `rk`
  - Formula push path: `Formula/run-kit.rb` → `Formula/rk.rb`
- **`.github/formula-template.rb`**:
  - Class: `RunKit` → `Rk`
  - Asset URLs: `run-kit-darwin-arm64.tar.gz` → `rk-darwin-arm64.tar.gz` (etc.)
  - `bin.install "run-kit"` → `bin.install "rk"`
  - Test assertion: `"run-kit version"` → `"rk version"`

### 5. Homebrew Tap (separate repo: `/Users/sahil/code/wvrdz/homebrew-tap/`)

- **File rename**: `Formula/run-kit.rb` → `Formula/rk.rb`
- **Class**: `RunKit` → `Rk`
- **`bin.install`**: `"run-kit"` → `"rk"`
- **Test**: `"run-kit version"` → `"rk version"`, `#{bin}/run-kit` → `#{bin}/rk`
- **README.md**: formula table entry `run-kit` → `rk`
- **Keep unchanged**: `homepage` URL (points to GitHub repo `wvrdz/run-kit`) and release download URLs (these change via the release workflow, not the tap formula — the formula template in the main repo generates these)

### 6. README & Documentation

- Install instructions: `brew install wvrdz/tap/run-kit` → `brew install rk`
- CLI usage examples: `run-kit serve` → `rk serve`, etc.

### 7. Frontend (minimal)

- `app/frontend/src/app.tsx` line ~400: comment "Reset run-kit's tmux config" → "Reset rk's tmux config"

## Affected Memory

- `run-kit/architecture`: (modify) Update binary name references from `run-kit` to `rk`, config directory from `~/.run-kit/` to `~/.rk/`

## Impact

- **All Go source files**: import path rename (`run-kit/...` → `rk/...`)
- **Build pipeline**: artifact naming changes require coordinated release
- **Homebrew tap**: formula rename in separate repo
- **Existing installations**: users on old version need `brew untap && brew tap` or `brew uninstall run-kit && brew install rk`
- **No runtime behavior changes**: all tmux interaction, WebSocket relay, SSE, API routes are unchanged

## Open Questions

None — scope was fully explored in conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Binary name becomes `rk` | Discussed — user explicitly approved full rename | S:95 R:60 A:95 D:95 |
| 2 | Certain | Go module path changes to `module rk` | Discussed — user approved, mechanical find-replace | S:90 R:70 A:90 D:90 |
| 3 | Certain | Config dir changes to `~/.rk/` | Discussed — user approved for consistency | S:85 R:65 A:85 D:90 |
| 4 | Certain | GitHub repo name stays `wvrdz/run-kit` | Discussed — user approved to avoid breaking links/stars/forks | S:90 R:90 A:90 D:95 |
| 5 | Certain | Env var prefixes stay `RK_*` | Discussed — already matches new name | S:95 R:90 A:95 D:95 |
| 6 | Certain | Daemon socket stays `rk-daemon`, session stays `rk` | Discussed — already uses rk prefix | S:95 R:90 A:95 D:95 |
| 7 | Certain | Frontend test fixtures keep "run-kit" as sample session name | Discussed — it's example data, not binary name | S:85 R:95 A:85 D:90 |
| 8 | Confident | Homebrew tap changes committed separately in that repo | Not discussed — standard practice for cross-repo changes, easily adjusted | S:60 R:90 A:80 D:75 |
| 9 | Confident | No migration path for existing `~/.run-kit/` config dirs | Not discussed — early-stage project with few users, not worth the complexity | S:50 R:80 A:70 D:70 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
