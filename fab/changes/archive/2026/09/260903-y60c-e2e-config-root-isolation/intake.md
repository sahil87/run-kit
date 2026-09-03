# Intake: E2E Config-Root Isolation

**Change**: 260903-y60c-e2e-config-root-isolation
**Created**: 2026-09-03

## Origin

> e2e config-root isolation — eliminate the shared ~/.config/run-kit/config.yaml cross-worktree race in e2e tests

Conversational: emerged from a `/fab-discuss` session analyzing cross-worktree test interference. A full hazard sweep (Go tests, frontend unit tests, Playwright specs, shell scripts) identified this as **the single true correctness leak** in an otherwise well-isolated rig (derived port triples, per-worktree tmux socket families, per-run temp `XDG_STATE_HOME`, `RK_SERVER_ALLOWLIST`). The user approved the recommended fix direction: an env-gated config-root override mirroring the `RK_SERVER_ALLOWLIST` precedent, chosen over redirecting `$HOME` for the dev-server subtree.

## Why

1. **The pain point**: `settings-dialog.spec.ts` and `board-list-reorder.spec.ts` snapshot, mutate (through the live API: `instance_name`, `board_order`), and restore the developer's **real** `~/.config/run-kit/config.yaml`. `pwa-assets.spec.ts` reads the same file (tolerantly). `scripts/test-e2e.sh:14-18` documents the gap explicitly: "`$HOME`-keyed state (~/.config/run-kit/config.yaml) stays shared."
2. **The consequence**: with parallel agents running `just test-e2e` in multiple worktrees (the standard workflow), overlapping runs race in three ways: (a) last-writer-wins restore — worktree A restores its pre-B snapshot over B's writes, corrupting the developer's real config; (b) mid-run cross-talk — both backends read the same file, so B's `board_order` write changes A's `GET /api/boards` ordering assertions (flaky failures); (c) both runs' `Date.now().slice(-6)`-derived board names coexist in the same shared `board_order` list.
3. **Why this approach**: the backend resolves the config root via `os.UserHomeDir()` (`app/backend/internal/settings/settings.go:96,116`). An env-gated override read in-package (production byte-identical when unset) exactly mirrors the shipped `RK_SERVER_ALLOWLIST` test-isolation design (`docs/memory/run-kit/test-sockets.md` § env-gated allowlist). Rejected alternative: overriding `$HOME` for the whole `just dev` subtree — larger blast radius (moves `~/.rk` managed tmux.conf, node/pnpm caches, anything home-keyed in the toolchain) for the same isolation win. Rejected alternative: a cross-worktree flock around the config-touching specs — serializes instead of isolating, and requires every future spec author to know the file is dangerous.

## What Changes

### Backend: env-gated config-root override in `internal/settings`

`app/backend/internal/settings/settings.go` gains a test-isolation env var (proposed name `RK_CONFIG_DIR`), read in-package via `os.Getenv` — matching the `RK_SERVER_ALLOWLIST` / `RK_TMUX_CONF` precedent, NOT threaded through `internal/config`:

- **Unset / whitespace-only (production default)**: behavior byte-identical to today — `Dir()` returns `$HOME/.config/run-kit`, `configPath()` returns `$HOME/.config/run-kit/config.yaml`.
- **Set (test only)**: `Dir()` returns the env value verbatim as the config root; `configPath()` returns `{value}/config.yaml`. The directory is created on save exactly as the fixed root is today.

Every consumer of `Dir()`/`configPath()` inherits the override, so `/api/settings`, board persistence, and the PWA accent read all point at the isolated root together — the same "scope at the shared root, not one consumer" rationale recorded for the allowlist.

Constitution note: Principle IV's "ONLY keys with env forms" clause governs user-facing deployment configuration; `RK_CONFIG_DIR` is a test-isolation var in the same class as the already-shipped `RK_SERVER_ALLOWLIST` (which also shipped without a constitution amendment). The settings.go doc comment ("The config root is fixed at $HOME/.config/run-kit") is updated to state the test-only carve-out.

Unit tests: extend `internal/settings/settings_test.go` with `t.Setenv`-based cases for set/unset/whitespace values.

### Harness: `scripts/test-e2e.sh` wires the isolated root

- Create `"$E2E_STATE_HOME/config"` (under the existing per-run `mktemp -d`, already removed by the EXIT trap).
- Add `RK_CONFIG_DIR=$E2E_STATE_HOME/config` to the dev-backend launch env (the `bash -c "… exec just dev"` line, alongside `RK_SERVER_ALLOWLIST` and `XDG_STATE_HOME`).
- Add the same `RK_CONFIG_DIR` to the `run_playwright` env so specs and backend agree on the path.
- Update the header comment that currently documents the `$HOME`-stays-shared gap.

### Specs: path from env, snapshot/restore kept as fallback

`settings-dialog.spec.ts` and `board-list-reorder.spec.ts` compute `SETTINGS_PATH` as:

```ts
const CONFIG_DIR = process.env.RK_CONFIG_DIR ?? join(homedir(), ".config", "run-kit");
const SETTINGS_PATH = join(CONFIG_DIR, "config.yaml");
```

The existing beforeAll/afterAll snapshot/restore pattern is **kept**, not removed: `just pw` runs against a `just dev` rig that does NOT set `RK_CONFIG_DIR` (interactive lane, real config), so the specs must still protect the real file in that mode. Under `just test-e2e` the snapshot/restore becomes a harmless no-op against the per-run temp file. Spec intent comments (constitution: Test Intent Comments) are updated to state both modes.

`pwa-assets.spec.ts` needs no change (tint-agnostic by design).

## Affected Memory

- `run-kit/configuration`: (modify) the fixed-root story gains the test-only `RK_CONFIG_DIR` carve-out (unset ⇒ byte-identical production)
- `run-kit/test-sockets`: (modify) the isolation posture section gains the config-root leg alongside ports/sockets/`XDG_STATE_HOME`

## Impact

- `app/backend/internal/settings/settings.go` + `settings_test.go` — the override seam
- `scripts/test-e2e.sh` — env wiring for backend + playwright, header comment
- `app/frontend/tests/e2e/settings-dialog.spec.ts`, `app/frontend/tests/e2e/board-list-reorder.spec.ts` — path derivation + intent comments
- No API surface change, no production behavior change (env unset ⇒ no-op)

## Open Questions

- None blocking. The env var name (`RK_CONFIG_DIR`) is a Tentative assumption — see Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Env-gated override over `$HOME` redirection | Discussed — recommended for smaller blast radius; user approved the plan containing this recommendation | S:80 R:75 A:80 D:70 |
| 2 | Tentative | Env var named `RK_CONFIG_DIR` | Naming not discussed; `RK_CONFIG_HOME`/`RK_SETTINGS_DIR` equally valid; trivially renameable pre-merge <!-- assumed: RK_CONFIG_DIR name — follows RK_* convention, "DIR" says it's a directory path --> | S:40 R:90 A:60 D:45 |
| 3 | Confident | Specs keep snapshot/restore as the non-harness fallback | `just pw` runs against a `just dev` rig without the var — real config still needs protecting there | S:70 R:80 A:85 D:75 |
| 4 | Confident | Constitution IV's env-key clause does not block a test-isolation var | `RK_SERVER_ALLOWLIST` shipped as the same class without amendment; clause governs deployment binding keys | S:65 R:70 A:75 D:70 |
| 5 | Certain | Override read in-package via `os.Getenv`, unset ⇒ byte-identical production behavior | Deterministic from the recorded allowlist design decision in `docs/memory/run-kit/test-sockets.md` | S:85 R:90 A:95 D:90 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).
