# Plan: Per-Worktree E2E Test Isolation + Concurrency Throttle

**Change**: 260822-pz2e-per-worktree-e2e-isolation
**Intake**: `intake.md`

## Requirements

### Harness: Per-Worktree Identity Derivation

#### R1: Shared derivation helper `scripts/e2e-env.sh`
A new sourceable script `scripts/e2e-env.sh` SHALL compute the per-worktree e2e identity. All derivation logic lives here (Constitution VIII — justfile recipes stay one-liners).

- **Token**: `WT=$(basename "$(git rev-parse --show-toplevel)")` (fallback `basename "$PWD"` outside a git checkout), sanitized to lowercase alphanumerics with hyphens stripped, plus a 2-char hash tail derived from the absolute `--show-toplevel` path (so two same-named checkouts diverge). A token that ends up all-digits MUST be prefixed with `wt` so no derived socket name can ever satisfy `parseTestSocketPID`'s numeric second-to-last-field parse and be mistakenly swept by the Go post-sweep. NO special case for the primary repo — every checkout derives (user-final).
- **Port triple**: `E2E_PORT = 3400 + (hash % 100) * 3` where `hash` is POSIX `cksum` of the token — vite on `E2E_PORT`, Go backend on `E2E_PORT+1`, code-server/stub on `E2E_PORT+2` (`RK_CODE_SERVER_PORT`). The 3400–3699 block avoids 3000/3001, 3020/3021, 3100–3199 (`internal/remote/ports.go` tunnel range), 3333 (playwright fail-closed fallback), and 3939 (legacy stub default).
- **Socket family**: `E2E_TMUX_FAMILY="rk-test-e2e-${TOKEN}-"` (the anchor, WITH trailing hyphen) and `E2E_TMUX_SERVER="${E2E_TMUX_FAMILY}0"` (the primary). Every family member carries a role segment after the token; because tokens are hyphen-free, `familyA` prefixes a `familyB` name only when the tokens are equal — cross-family matching is impossible by construction under both glob and `HasPrefix` semantics. The `rk-test-` umbrella prefix is retained (see Design Decisions).
- **Overrides**: dedicated env vars win over derivation — `RK_E2E_PORT` (port triple base), preset `E2E_TMUX_SERVER`/`E2E_TMUX_FAMILY` (socket; a preset server with no preset family implies `family=${E2E_TMUX_SERVER}-`), preset `RK_CODE_SERVER_PORT`. The **ambient `RK_PORT` is NOT an override input** — direnv exports `RK_PORT=3000` into every shell (verified live), so consulting it would mean the derivation never applies.
- The helper is pure derivation: it probes no ports and mutates nothing, so repeated sourcing (e.g. a later `just pw`) is deterministic.

- **GIVEN** two sibling worktrees `run-kit` and `run-kit.worktrees/sunny-gazelle`
- **WHEN** each sources `scripts/e2e-env.sh`
- **THEN** each gets a distinct, deterministic `(E2E_PORT triple, E2E_TMUX_FAMILY)` identity, stable across invocations within the same worktree

- **GIVEN** a shell with direnv-ambient `RK_PORT=3000`
- **WHEN** `scripts/e2e-env.sh` is sourced with no `RK_E2E_PORT` set
- **THEN** `E2E_PORT` is the derived value, not 3000

#### R2: `scripts/test-e2e.sh` — derived identity, self-scoped stale-kill, family-scoped cleanup
`scripts/test-e2e.sh` SHALL source `scripts/e2e-env.sh` and replace its hardcoded `E2E_PORT=3020` / `E2E_TMUX_SERVER="rk-test-e2e"` (lines 4–5) with the derived values.

- **Self-scoped stale-kill**: the line-38 kill keeps its shape but probes ONLY the derived triple (`E2E_PORT`, `+1`, `+2`) — nobody else can own those ports, so the machine-wide kill hazard is retired by construction. It legitimately claims the ports from this worktree's own leftover `just dev`/previous run. **Step-forward fallback**: only when a derived port remains busy AFTER the kill attempt (an unkillable/foreign owner — e.g. another user's process), step the triple forward by 3 within the block (bounded retries) and print a notice that a stepped-forward rig is not derivable by a later `just pw` (explicit `RK_E2E_PORT` override needed). Derivation in `e2e-env.sh` itself stays pure.
- **Family-scoped cleanup**: the EXIT-trap glob (line 31) keys on `${E2E_TMUX_FAMILY}*` — it only ever matches this worktree's own family (primary `…-0` + secondaries), never a sibling's.
- The `set -m` own-process-group launch machinery and PGID verification (lines 45–92) MUST be preserved byte-for-byte in behavior — it is the kill-0-grenade fix.
- `E2E_TMUX_FAMILY` SHALL be exported into the dev-server launch env (feeding `RK_SERVER_ALLOWLIST=$E2E_TMUX_FAMILY`, a prefix that admits the primary and every secondary) and into the Playwright invocation env (line 118) alongside the existing `RK_PORT`/`E2E_TMUX_SERVER`/`RK_CODE_SERVER_PORT`.

- **GIVEN** worktree A mid-run and worktree B starting `just test-e2e`
- **WHEN** B's stale-kill and (later) B's EXIT trap fire
- **THEN** A's listeners and A's socket family are untouched (distinct derived triples/anchors)

#### R3: Hermetic per-run state (`XDG_STATE_HOME`)
`scripts/test-e2e.sh` SHALL create a per-run temp dir (`mktemp -d`) and export it as `XDG_STATE_HOME` into the dev-server launch env, and remove it in the EXIT trap. This stops the e2e backend writing over the developer's real PR-status seed cache (`$XDG_STATE_HOME/rk/prstatus.json`) and makes snapshot/recovery-adjacent state per-run. `$HOME`-keyed state (`~/.rk/settings.yaml`) remains shared and out of scope.

- **GIVEN** a running `just test-e2e` suite
- **WHEN** the e2e backend writes its PR-status seed cache or layout snapshots
- **THEN** the writes land under the per-run temp dir, and the trap removes them at exit

### Harness: Concurrency Throttle

#### R4: flock counting semaphore around the Playwright run
`scripts/test-e2e.sh` SHALL wrap ONLY the Playwright invocation (line 118) in a flock counting semaphore (user-final design): N slot files `/tmp/rk-e2e-slot-<uid>-{0..N-1}`; non-blocking `flock -n` try on each in turn; if all busy, block on slot 0. `RK_E2E_SLOTS` overrides N (default 2; 1 = strict series). Gate on `command -v flock`: when absent (stock macOS), print a notice and run unthrottled — isolation still holds, only the load throttle degrades. Server startup is NOT throttled. `just pw` stays unthrottled (the ad-hoc/interactive lane).

- **GIVEN** `RK_E2E_SLOTS=1` and two sibling-worktree `just test-e2e` runs
- **WHEN** both reach the Playwright phase
- **THEN** the second blocks on slot 0 until the first's Playwright run releases it

- **GIVEN** a host without `flock(1)`
- **WHEN** `just test-e2e` runs
- **THEN** a notice is printed and the suite runs unthrottled

### Recipes: Derived Defaults and Env Precedence

#### R5: `just pw` / `just dev` / `.env` derive from the same identity
- **`pw`**: a new thin `scripts/pw.sh` sources `e2e-env.sh`, then runs `cd app/frontend && RK_PORT=$E2E_PORT E2E_TMUX_SERVER=… E2E_TMUX_FAMILY=… RK_CODE_SERVER_PORT=… pnpm exec playwright "$@"`. The justfile `pw` recipe becomes a one-liner delegating to it (Constitution VIII). Ambient `RK_PORT` is not consulted; `RK_E2E_PORT`/preset `E2E_TMUX_SERVER` override. NO `:-3020` fallback survives anywhere.
- **`dev` / `scripts/dev.sh`**: the default port becomes the derived `E2E_PORT` (source `e2e-env.sh`; `export RK_PORT="${RK_PORT:-$E2E_PORT}"`) — explicit `--port`/preset `RK_PORT` still win. The `RK_PORT=3000` bootstrap line is dropped from `.env` (the built-in default in `internal/config` is 3000, so daemon/prod behavior is unchanged). Migration note documented: gitignored `.env.local` copies still carry `RK_PORT=3000` and pin `just dev` to 3000 until hand-edited. Deliberate consequence: within one worktree, `just dev` (the pw rig) and `just test-e2e` share the derived triple — test-e2e's self-scoped stale-kill claims the ports from your own `just dev` (the intended "one rig per worktree" semantic).
- **Solo recipes** (`dev-backend`, `dev-frontend`, `dev-rk`) keep their `${RK_PORT:-3000}` fallbacks (solo-debug conveniences).
- **Justfile comment sweep**: lines 95, 100 (and the `dev` recipe's "Default: 3000" comment) lose their `3020`/`rk-test-e2e`/stale-default literals.

- **GIVEN** a direnv shell whose `.env.local` no longer pins `RK_PORT`
- **WHEN** `just dev` then `just pw test <spec>` run in the same worktree
- **THEN** both resolve the same derived triple and the spec runs against that worktree's own rig

#### R6: `app/frontend/playwright.config.ts` — verify-only
The fail-closed `RK_PORT ?? "3333"` guard (line 3) SHALL stay (user-final); port continues to flow from env. The line-13 comment's literal `rk-test-e2e` is updated. No behavioral config change.

- **GIVEN** a direct `playwright test` with no env set
- **WHEN** it starts
- **THEN** it targets :3333 and connects to nothing (fail-closed preserved)

### Specs & Helpers: Literal-Name Sweep

#### R7: Secondary sockets and teardown derive from the family
- `_tmux.ts` SHALL export `TMUX_FAMILY = process.env.E2E_TMUX_FAMILY ?? \`${TMUX_SERVER}-\`` alongside the existing `TMUX_SERVER` env read.
- The four literal-prefix sites SHALL build from `TMUX_FAMILY` instead of literal `rk-test-e2e-`, keeping the `<role>-<pid>-<epoch>` tail intact so `parseTestSocketPID` (second-to-last hyphen field) still parses: `boards-multi-server.spec.ts:11`, `multi-server-sidebar.spec.ts:11`, `sessions-scope-toggle.spec.ts:11`, `create-server-waiting.spec.ts:10` and `:82`. Their sibling `.spec.md` companions update in the same commit (Constitution — Test Companion Docs).
- `global-teardown.ts` SHALL scan on `process.env.E2E_TMUX_FAMILY ?? (process.env.E2E_TMUX_SERVER ?? "rk-test-e2e")` — family-anchored when the harness provides it, old behavior as fallback — and its stale `rk-test-e2e-coupling-*` comment example (that spec no longer exists) is corrected.
- Stale `3020` fallbacks align to the config's fail-closed 3333: `_boards.ts:106` (`apiBase`) and `session-reorder.spec.ts:53`.
- Comment-only `:3020`/literal-socket mentions swept opportunistically: `top-bar-refresh.spec.ts` (":3020 backend" ×3), `web-tile-find.spec.ts:206`, `playwright.config.ts:13`.
- Go test fixtures stay untouched (`internal/config/config_test.go:128`, `internal/tmuxctl/client_test.go` fixture strings — hermetic).

- **GIVEN** the harness exports `E2E_TMUX_FAMILY=rk-test-e2e-<token>-`
- **WHEN** `boards-multi-server.spec.ts` creates its second server
- **THEN** the server is named `rk-test-e2e-<token>-multi-<pid>-<epoch>` — inside this worktree's family, admitted by the allowlist, reaped by this worktree's teardown only

#### R8: CI unaffected by design
`.github/workflows/ci.yml` gets a comment-only update (~line 111). CI behavior is unchanged: each shard is a single-worktree runner, so all shards derive the same identity in isolated VMs; `git`, `cksum`, and `flock` are available on ubuntu runners.

- **GIVEN** a CI shard
- **WHEN** `just test-e2e` runs there
- **THEN** the derived identity is stable within the VM and no workflow step changes

### Verification

#### R9: Verification contract (user-final)
1. Full `just test-e2e` green in one worktree (derived identity end-to-end) — executable in-change.
2. Two simultaneous sibling-worktree runs with no mutual interference — documented as a manual/scripted verification step (distinct triples/anchors, both suites complete, neither cleanup touches the other's family, `RK_E2E_SLOTS=1` serializes the Playwright phases). Documented, not executed in-change (sibling worktrees belong to other agents).
3. `just pw test <spec>` against a derived-port `just dev` server — documented as part of the same manual step.

- **GIVEN** the completed change
- **WHEN** `just test-e2e` runs in this worktree
- **THEN** the suite passes on the derived port/socket with no 3020/`rk-test-e2e`-literal dependence

### Non-Goals

- Sharing one dev server across worktrees (correctness requires the server to serve YOUR worktree's code) — user-final.
- Lock-only serialization without port isolation (cannot fix the stale-singleton wrong-code hazard) — user-final.
- Changing CI sharding — out of scope.
- `$HOME`-keyed state isolation (`~/.rk/settings.yaml`) — the `board-list-reorder.spec.ts` snapshot/restore pattern stays necessary.
- Go production code changes — `matchesServerAllowlist`, `IsTestServerName`, the snapshotter, and `@rk_ephemeral` mechanisms are consumed as-is; only the env *values* fed to them change.

### Design Decisions

#### Keep the `rk-test-` umbrella in the family anchor
**Decision**: The socket family is `rk-test-e2e-<token>-` (primary `rk-test-e2e-<token>-0`), not the intake shorthand `rk-e2e-<token>-`.
**Why**: The `rk-test-` prefix is load-bearing in three shipped contracts (`docs/memory/run-kit/tmux-sessions.md`): `IsTestServerName` (`HasPrefix "rk-test-"`) drives the tmuxctl supervisor's resurrection guard — a correctness guard that stops daemon bootstrap resurrecting leaked test sockets; bare `rk mux reap` defaults to `--prefix rk-test`; and the name umbrella is the documented treated-as-ephemeral belt. Dropping to `rk-e2e-` would silently exit all three. Every nesting-proof property survives: the token is hyphen-free, so `rk-test-e2e-<tokenA>-` prefixes `rk-test-e2e-<tokenB>-…` only when the tokens are equal.
**Rejected**: The literal `rk-e2e-<token>-` spelling from the intake's pinned decision — it carries no stated rationale for shedding `rk-test-`, and shedding it regresses the resurrection guard and reap coverage.
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

#### `E2E_TMUX_FAMILY` as a first-class exported env var
**Decision**: The derivation helper exports both the anchor (`E2E_TMUX_FAMILY`, trailing hyphen included) and the primary (`E2E_TMUX_SERVER = family + "0"`); the trap glob, `RK_SERVER_ALLOWLIST`, `global-teardown.ts`, and spec secondary names all consume the family.
**Why**: With a role segment on the primary (`-0`), the primary's own name is no longer the family prefix — globbing `${E2E_TMUX_SERVER}*` would match only `…-0*` and leak secondaries. A dedicated anchor variable keeps every matcher on the same string instead of four sites re-deriving "strip the trailing role".
**Rejected**: Deriving the family in each consumer by string-stripping the primary's `-0` tail — four fragile copies of the same slice, and a preset `E2E_TMUX_SERVER` override would strip a character that isn't a role segment.
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

#### Step-forward only on an unkillable foreign owner
**Decision**: `e2e-env.sh` derivation is pure (no port probing). `test-e2e.sh` first kills listeners on the derived triple (self-claim — they are this worktree's by construction); only if a port is STILL busy after the kill does it step the triple forward by 3 (bounded), with a printed notice that `just pw` then needs `RK_E2E_PORT`.
**Why**: Probing inside the derivation would make `just pw` non-deterministic (it could derive past a rig the harness just started). Killing first preserves the "claim from your own leftover `just dev`" semantic; stepping is reserved for the genuinely-foreign case (hash collision with another user/process).
**Rejected**: Probe-and-step inside `e2e-env.sh` (breaks the deterministic-rediscovery property `just pw` depends on); treating any listener as foreign (would never reclaim your own leftover rig).
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

## Tasks

### Phase 1: Setup

- [x] T001 Create `scripts/e2e-env.sh`: worktree token (basename of `git rev-parse --show-toplevel`, `$PWD` fallback; lowercase-alnum, hyphens stripped; `wt` prefix when all-digits; 2-char hash tail from the absolute toplevel path), `cksum`-hashed port triple `E2E_PORT=3400+(hash%100)*3`, `E2E_CODE_SERVER_PORT=E2E_PORT+2` (RK_CODE_SERVER_PORT never assigned — exposed under the E2E_ name so sourcing can't masquerade as dev.sh's externally-managed preset), `E2E_TMUX_FAMILY=rk-test-e2e-<token>-`, `E2E_TMUX_SERVER=${E2E_TMUX_FAMILY}0`; override precedence (`RK_E2E_PORT`, preset `E2E_TMUX_SERVER`/`E2E_TMUX_FAMILY`/`RK_CODE_SERVER_PORT`; a preset server with no preset family implies family = the server name as-is); ambient `RK_PORT` never consulted; pure (no probing, no mutation) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Rework `scripts/test-e2e.sh`: source `e2e-env.sh`; self-scoped stale-kill probing only the derived triple (E2E_PORT, +1, +2) with the bounded step-forward-on-unkillable-owner fallback + notice; EXIT-trap glob anchored on `${E2E_TMUX_FAMILY}*`; export `E2E_TMUX_FAMILY` into the dev-server launch (`RK_SERVER_ALLOWLIST=$E2E_TMUX_FAMILY`) and the Playwright env; preserve the `set -m` PGID machinery unchanged <!-- R2 -->
- [x] T003 Add hermetic state to `scripts/test-e2e.sh`: `mktemp -d` per run, exported as `XDG_STATE_HOME` into the dev-server launch env, `rm -rf` in the EXIT trap <!-- R3 -->
- [x] T004 Add the flock counting semaphore to `scripts/test-e2e.sh` wrapping only the Playwright invocation: slot files `/tmp/rk-e2e-slot-<uid>-{0..N-1}`, non-blocking try each then block on slot 0, `RK_E2E_SLOTS` (default 2), `command -v flock` gate with unthrottled-notice fallback <!-- R4 -->
- [x] T005 [P] Create `scripts/pw.sh` (source `e2e-env.sh`, run playwright with the derived `RK_PORT`/`E2E_TMUX_SERVER`/`E2E_TMUX_FAMILY`/`RK_CODE_SERVER_PORT`); repoint the justfile `pw` recipe at it as a one-liner; remove every `:-3020` / literal `rk-test-e2e` fallback from the recipe and its comments (justfile lines 95, 100–102) <!-- R5 -->
- [x] T006 [P] Derived default port for `just dev`: `scripts/dev.sh` sources `e2e-env.sh` and defaults `RK_PORT` to `$E2E_PORT` (explicit `--port`/preset `RK_PORT` still win); drop the `RK_PORT=3000` line from `.env` (keep `RK_HOST`); update the justfile `dev`/`test-e2e` recipe comments' stale port literals; leave `dev-backend`/`dev-frontend`/`dev-rk` fallbacks untouched <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Export `TMUX_FAMILY` from `app/frontend/tests/e2e/_tmux.ts` (`process.env.E2E_TMUX_FAMILY ?? TMUX_SERVER + "-"`); rebuild the four secondary/created-server names from it, keeping `<role>-<pid>-<epoch>` tails: `boards-multi-server.spec.ts:11`, `multi-server-sidebar.spec.ts:11`, `sessions-scope-toggle.spec.ts:11`, `create-server-waiting.spec.ts:10`+`:82`; update the four sibling `.spec.md` companions in the same commit <!-- R7 -->
- [x] T008 [P] `global-teardown.ts`: scan prefix becomes `E2E_TMUX_FAMILY ?? E2E_TMUX_SERVER ?? "rk-test-e2e"`; fix the stale `rk-test-e2e-coupling-*` comment example <!-- R7 -->
- [x] T009 [P] Align stale 3020 fallbacks to fail-closed 3333: `_boards.ts:106` (`apiBase`) and `session-reorder.spec.ts:53` <!-- R7 -->
- [x] T010 [P] Comment-only sweep: `playwright.config.ts:13` socket literal, `top-bar-refresh.spec.ts` ":3020 backend" mentions, `web-tile-find.spec.ts:206`, `.github/workflows/ci.yml` ~line 111 <!-- R6, R8 -->

### Phase 4: Polish

- [x] T011 Verification: run full `just test-e2e` in this worktree (must be green on the derived identity); document the two-worktree parallel check and the `just dev` + `just pw` derived-rig workflow as a manual verification procedure in this plan's `## Notes` <!-- R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Sourcing `scripts/e2e-env.sh` yields a deterministic identity — same values across repeated invocations in one worktree, distinct values in a sibling worktree (verifiable by sourcing with two different toplevel paths)
- [x] A-002 R1: Derived ports live in 3400–3699 and the derivation ignores ambient `RK_PORT`; `RK_E2E_PORT` and preset `E2E_TMUX_SERVER`/`E2E_TMUX_FAMILY` override
- [x] A-003 R2: No machine-wide port kill remains — the stale-kill probes only the derived triple; the trap glob and `RK_SERVER_ALLOWLIST` are anchored on `E2E_TMUX_FAMILY` (trailing hyphen included)
- [x] A-004 R3: `XDG_STATE_HOME` is a per-run temp dir exported into the dev-server launch and removed by the trap
- [x] A-005 R4: The flock semaphore wraps only the Playwright run, honors `RK_E2E_SLOTS` (default 2), and degrades to an unthrottled run with a notice when `flock` is absent
- [x] A-006 R5: `just pw` derives via `scripts/pw.sh`; no `:-3020` or literal `rk-test-e2e` fallback survives in the justfile; `scripts/dev.sh` defaults to the derived port with explicit overrides intact; `.env` no longer sets `RK_PORT`
- [x] A-007 R7: The four secondary-socket sites build names from `TMUX_FAMILY` and their `.spec.md` companions are updated in the same commit

### Behavioral Correctness

- [x] A-008 R2: A stepped-forward triple only occurs when a derived port stays busy after the kill attempt, and prints the `just pw` override notice
- [x] A-009 R6: `playwright.config.ts` keeps the fail-closed `?? "3333"` port guard with no behavioral config change
- [x] A-010 R7: `_boards.ts` `apiBase` and `session-reorder.spec.ts` fall back to 3333, never 3020

### Scenario Coverage

- [x] A-011 R9: Full `just test-e2e` passes in this worktree on the derived identity
- [x] A-012 R9: The two-worktree parallel verification and the derived-rig `just dev`+`just pw` workflow are documented as a manual procedure in `## Notes`

### Edge Cases & Error Handling

- [x] A-013 R1: Outside a git checkout the token falls back to `basename "$PWD"`; an all-digits token gains the `wt` prefix so no family name can parse as a PID-bearing test socket
- [x] A-014 R8: `.github/workflows/ci.yml` changes are comment-only

### Code Quality

- [x] A-015 Pattern consistency: shell additions follow the existing scripts' style (bash strict mode, comment discipline stating constraints not narration); justfile recipes remain one-line delegations (Constitution VIII)
- [x] A-016 No unnecessary duplication: the derivation logic exists only in `scripts/e2e-env.sh` — no consumer re-derives the token, ports, or family anchor

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Executable gate outcome (T011, run in this worktree)

The full-suite gate ran three times on the derived identity (`E2E_PORT=3667`, family `rk-test-e2e-sunnygazelleac-`, plus one run under `RK_E2E_SLOTS=1`): each ended 328–330 passed, 2 skipped, exit 1 on the SAME 8 hover-popup tests (`row-flyout.spec.ts` ×6, `row-identity-tips.spec.ts` ×2) — all 8 fail on the card/tip never appearing after `hover()`. Attribution evidence: (a) both specs pass 18/18 when re-run isolated (`just test-e2e row-flyout row-identity-tips`, 22.7s) on the derived rig; (b) a baseline run with this change's diff FULLY STASHED (old 3020/`rk-test-e2e` harness) fails with the identical 8-test set — the flake predates and is independent of this diff; (c) the failure persists under `RK_E2E_SLOTS=1`, so it is not cross-worktree load the throttle governs but an in-suite interaction flake on this box (~140 worktrees, many live agents; a stale `e2e-flaky-spec-triage` worktree exists for this flake class). Everything this change touched (derivation, self-scoped kill/cleanup, family-anchored secondaries/teardown, hermetic XDG state, throttle acquire path, `pw.sh`) was exercised green in all three runs.

### Manual verification procedure (R9 items 2–3 — not executed in-change)

Sibling worktrees on this box belong to other live agents, so these run by hand:

1. **Two-worktree parallel isolation** — in each of two sibling worktrees (e.g. `run-kit` and `run-kit.worktrees/sunny-gazelle`):
   - Print each identity: `bash -c 'source scripts/e2e-env.sh; echo "$E2E_PORT $E2E_TMUX_FAMILY"'` — assert distinct port triples and distinct family anchors.
   - Run `just test-e2e` in BOTH at the same time. Assert: both suites complete green; each worktree's sockets (`/tmp/tmux-$(id -u)/rk-test-e2e-<token>-*`) survive the sibling's teardown; no sibling port in 3400–3699 is killed mid-run.
   - With `RK_E2E_SLOTS=1` exported in both, repeat: the second run's Playwright phase must log `e2e throttle: all 1 slot(s) busy — blocking on slot 0` and start only after the first releases the slot.
2. **Derived-rig `just dev` + `just pw` workflow** — in one worktree whose `.env.local` does NOT pin `RK_PORT` (a stale `.env.local` still carries `RK_PORT=3000` and pins `just dev` there until hand-edited):
   - `just dev &` — assert Vite/Go come up on the derived triple (`E2E_PORT`/`+1`; code-server on `+2`).
   - `just pw test <spec>` — assert the spec runs green against that rig (pw derives the identical identity, so no env passing is needed).
   - `just test-e2e` afterwards — assert its self-scoped stale-kill reclaims the triple from the leftover `just dev` (the intended one-rig-per-worktree semantic).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Family anchor spelled `rk-test-e2e-<token>-` (keeping the `rk-test-` umbrella), not the intake's pinned `rk-e2e-<token>-` shorthand | The `rk-test-` prefix is load-bearing in three shipped contracts (supervisor resurrection guard, `rk mux reap` default prefix, `IsTestServerName` ephemeral belt — tmux-sessions.md); the intake is internally inconsistent (§1 says `rk-test-e2e-$WT`, the pinned decision says `rk-e2e-`); every nesting-proof property survives the longer spelling | S:55 R:80 A:85 D:75 |
| 2 | Confident | A dedicated `E2E_TMUX_FAMILY` env var carries the anchor; primary = `family + "0"`; all matchers and spec secondaries consume the family | With a role segment on the primary, the primary's name is no longer the family prefix — a single exported anchor beats four consumers re-deriving it by string-stripping | S:60 R:85 A:80 D:70 |
| 3 | Confident | Step-forward fires only when a derived port is still busy after the self-claim kill (unkillable/foreign owner); derivation itself stays probe-free | Keeps `just pw` deterministic rediscovery intact while preserving the claim-from-own-leftover-rig semantic the intake states deliberately | S:50 R:80 A:70 D:60 |
| 4 | Certain | All-digits tokens get a `wt` prefix so no derived socket name can satisfy `parseTestSocketPID` and be swept by a concurrent Go post-sweep | Defensive one-liner; `parseTestSocketPID` takes the numeric second-to-last hyphen field and the token occupies that position in the primary's name | S:60 R:90 A:90 D:85 |
| 5 | Confident | Verification #2/#3 (two-worktree parallel run, `just dev`+`just pw` rig) are documented manual procedures, not executed in-change | Sibling worktrees on this box belong to other live agents — running a second full suite in one of them from this change is not safely automatable; the single-worktree green run plus construction-level isolation is the in-change proof | S:60 R:75 A:70 D:65 |

5 assumptions (1 certain, 4 confident, 0 tentative).
