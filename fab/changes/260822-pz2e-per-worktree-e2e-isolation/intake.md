# Intake: Per-Worktree E2E Test Isolation + Concurrency Throttle

**Change**: 260822-pz2e-per-worktree-e2e-isolation
**Created**: 2026-08-23

## Origin

Created via `/fab-draft` (promptless dispatch — no questions asked; would-be questions recorded as deferred Unresolved rows). The input is a synthesized description from a design discussion with the user; **user-decided points are FINAL**. Raw input:

> **Feature: per-worktree e2e test isolation + concurrency throttle** — multiple worktrees of run-kit must be able to run tests in parallel or in series without stepping on each other.
>
> **User-decided contract (final):**
> - **Layer 1 — per-worktree identity (parallel-correct).** Derive a suffix from the worktree: `WT=$(basename "$(git rev-parse --show-toplevel)")` (sanitized). NO 3020 special case anywhere — every checkout derives, the primary repo included (user explicitly dropped the muscle-memory carve-out).
>   - Ports: a deterministic hash of `$WT` into a reserved block of port-TRIPLES (vite / go backend = vite+1 per the justfile convention / code-server), e.g. `base + (hash % N) * 3`, choosing a block that AVOIDS 3100–3199 (the `rk remote` SSH-tunnel range — those local tunnel ports are persisted in remotes.yaml and immutable) and avoids 3000/3001 (live dev defaults). Deterministic so `just pw` finds the same server across invocations; step-forward fallback on the rare live-port collision.
>   - Socket: `E2E_TMUX_SERVER=rk-test-e2e-$WT`; secondary sockets nest under the worktree's own name so the cleanup glob only ever matches its own family. The stale-kill becomes self-scoped: only the derived ports are probed/killed (nobody else can own them), retiring the machine-wide kill entirely.
>   - State: `test-e2e.sh` sets `XDG_STATE_HOME` to a per-run temp dir — also makes snapshot/recovery specs hermetic.
>   - `just dev` / `just pw` / `just test-e2e` default from the same derivation (a small shared `scripts/e2e-env.sh` sourced by the script and the justfile recipes), so each worktree's externally-managed `pw` server is its own.
> - **Layer 2 — concurrency throttle (parallel-reliable).** The e2e suite is timing-sensitive under CPU load (window-heading/sync-latency flake class worsens under parallel Playwright+Vite+Go). Wrap the Playwright invocation in a flock counting semaphore over N slot files (`/tmp/rk-e2e-slot-{0..N-1}`: non-blocking try each in turn, then block on slot 0). Default N=2, N=1 = strict series, env-overridable (e.g. `RK_E2E_SLOTS`). ~10 lines of shell, no daemon.
> - **Non-goals:** sharing one dev server across worktrees (correctness requires the server to serve YOUR worktree's code); lock-only serialization without port isolation (cannot fix the stale-singleton hazard); changing CI sharding (CI runners are single-worktree and unaffected — a possible future change, explicitly out of scope).
> - `playwright.config.ts` keeps its fail-closed 3333 fallback for direct unset-env invocations (that guard stays); port otherwise flows from env as today.
> - Sweep hardcoded `3020` / literal `rk-test-e2e` references: `justfile` comments/recipes, `docs/` (context.md testing + Playwright-driven-development sections), and any e2e helpers assuming the literal socket name.
> - **Verification:** full `just test-e2e` green in one worktree, PLUS the point of the change: two simultaneous runs from sibling worktrees with no mutual interference (document as a manual/scripted verification step; also verify `just pw` against a derived-port server).

Gap analysis: no existing change or backlog item covers this. Auto-memory documents the hazards as operational lore (`e2e cross-worktree mutual kill`, `e2e stale e2e-init session recovery`, `test-e2e back-to-back ECONNREFUSED`) but no mechanism exists in the tree.

## Why

1. **The pain**: all worktrees of run-kit share one e2e identity — port pair 3020/3021, tmux socket `rk-test-e2e`, code-surface stub port 3939, and the developer's real `$XDG_STATE_HOME/rk`. Sibling worktrees running tests concurrently (a routine state on this box, where multiple fab agents work parallel changes) destroy each other's runs, and even *serial* use is hazardous: a stale `just pw` dev server left by another worktree serves the wrong code and inverts test verdicts (observed 2026-08-22: stale module state inverted both a failure repro and a clean-main baseline).

2. **The consequence of not fixing**: `scripts/test-e2e.sh` kills ANY listener on 3020/3021 machine-wide (line 38: `lsof -iTCP:$E2E_PORT -iTCP:$(( E2E_PORT + 1 )) -sTCP:LISTEN -t 2>/dev/null | xargs kill`), so one worktree starting a run kills another's in-flight run; the EXIT-trap cleanup reaps every socket matching `/tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}*` (line 31), so any sibling's socket family under that prefix is destroyed by someone else's teardown; two parallel runs of `code-surface.spec.ts` both bind a stub HTTP server on the shared `RK_CODE_SERVER_PORT` default 3939 (line 68) and the second gets EADDRINUSE; and the e2e backend writes over the developer's real PR-status seed cache under `$XDG_STATE_HOME/rk` (documented in `docs/memory/run-kit/architecture.md:631`: "it includes the e2e harness's :3020 server writing over the developer's real cache").

3. **Why this approach**: per-worktree *derived* identity makes parallel runs correct by construction (no coordination, no daemon — each worktree can only ever touch its own ports/socket/state), and a flock counting semaphore makes them *reliable* (the suite is timing-sensitive; the window-heading/sync-latency flake class worsens under parallel Playwright+Vite+Go CPU load). Rejected alternatives (user-final non-goals): sharing one dev server across worktrees (correctness requires the server to serve YOUR worktree's code); lock-only serialization without port isolation (cannot fix the stale-singleton wrong-code hazard).

## What Changes

### 1. `scripts/e2e-env.sh` — the shared derivation helper (new)

A small sourceable script that computes the per-worktree e2e identity. All logic lives here per Constitution VIII (justfile recipes stay one-line delegations to `scripts/`).

- **Worktree token**: `WT=$(basename "$(git rev-parse --show-toplevel)")`, sanitized to a lowercase alphanumeric token (see the nesting-proofing decision below). Fallback to `basename "$PWD"` when not in a git checkout. NO special case for the primary repo — every checkout derives (user-final).
- **Port triple**: deterministic hash of the token into a reserved block of port triples. Proposed concrete values: `E2E_PORT = 3400 + (hash % 100) * 3` — vite on `E2E_PORT`, Go backend on `E2E_PORT+1` (the justfile `dev` convention), code-server/stub on `E2E_PORT+2`. Range 3400–3699 avoids 3100–3199 (the `rk remote` tunnel range — `app/backend/internal/remote/ports.go` `PortRangeStart=3100`/`PortRangeEnd=3199`, ports persisted in remotes.yaml and immutable), 3000/3001 (live `rk serve`/dev defaults), 3020/3021 (legacy rig — transition safety while un-migrated checkouts exist), 3333 (the playwright fail-closed fallback), and 3939 (the legacy stub default). Hash via POSIX `cksum` (portable across Linux/macOS, no external deps). **Step-forward fallback**: on the rare live-port collision (a foreign owner on the derived triple), step forward by 3 within the block until free — with the documented caveat that a stepped-forward rig is no longer derivable by a later `just pw`, which then needs the explicit override.
- **Socket**: `E2E_TMUX_SERVER=rk-test-e2e-$WT`.
- **Code-surface stub port**: derived `E2E_PORT+2`, replacing today's fixed `RK_CODE_SERVER_PORT="${RK_CODE_SERVER_PORT:-3939}"` (`test-e2e.sh:68`) — this retires the fourth collision surface (parallel `code-surface.spec.ts` stub binds). `scripts/dev.sh`'s preset carve-out (line 46: a preset `RK_CODE_SERVER_PORT` means externally managed, nothing started) is unchanged and is exactly the seam the harness keeps using.
- **Overrides**: explicit, dedicated env vars win over derivation (e.g. `RK_E2E_PORT`, and the existing `E2E_TMUX_SERVER` when preset). The **ambient `RK_PORT` is deliberately NOT an override input** for the e2e identity — see § 4 (env precedence).

**Nesting-proofing (decided)**: worktree names are adjective-noun (`swift-mink`), and one name can be a prefix of another's socket family (`swift` vs `swift-mink`), which would re-create the exact cross-family glob/allowlist bleed this change retires. Decided mechanism: (a) the token is HYPHEN-FREE — lowercase alphanumerics from the basename with hyphens stripped, plus a 2-char hash tail derived from the absolute `--show-toplevel` path (so two same-named checkouts still diverge), e.g. `swift-mink` → `swiftminkc7`; (b) EVERY family member — the primary socket included — carries a hyphen-separated role segment after the token: primary `rk-e2e-<token>-0`, secondaries `rk-e2e-<token>-multi-*` / `rk-e2e-<token>-coupling-*`; (c) every family match (cleanup glob, `global-teardown.ts` scan, `RK_SERVER_ALLOWLIST` token) uses the prefix `rk-e2e-<token>-` INCLUDING the trailing hyphen. Because tokens are hyphen-free, `tokenA-` prefixes `tokenB-…` only when `tokenA == tokenB` — cross-family matching is impossible by construction, under glob and `HasPrefix` allowlist semantics alike (see `docs/memory/run-kit/tmux-sessions.md` § RK_SERVER_ALLOWLIST). The allowlist stays a pure env-value change; `matchesServerAllowlist` is untouched.
<!-- clarified: nesting-proof mechanism pinned — hyphen-free token + path-hash tail, role segment on every family member (primary = `-0`), all matching anchored on `rk-e2e-<token>-` with the trailing hyphen -->

### 2. `scripts/test-e2e.sh` — derived identity, self-scoped stale-kill, scoped cleanup, hermetic state

Current state (verified):
- Line 4–5: `E2E_PORT=3020` / `E2E_TMUX_SERVER="rk-test-e2e"` — hardcoded.
- Line 38: `lsof -iTCP:$E2E_PORT -iTCP:$(( E2E_PORT + 1 )) -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true` — kills ANY 3020/3021 listener machine-wide.
- Line 31: cleanup glob `for sock in "/tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}"*` — reaps every socket under the shared prefix, including a sibling worktree's family.
- Line 70: dev server launched with `RK_PORT=$E2E_PORT RK_SERVER_ALLOWLIST=$E2E_TMUX_SERVER RK_CODE_SERVER_PORT=$RK_CODE_SERVER_PORT exec just dev` (own process group via `set -m`; keep that machinery byte-for-byte — it is the kill-0-grenade fix).
- Line 118: `cd app/frontend && RK_PORT=$E2E_PORT E2E_TMUX_SERVER="$E2E_TMUX_SERVER" RK_CODE_SERVER_PORT="$RK_CODE_SERVER_PORT" pnpm exec playwright test "$@"`.
- No `XDG_STATE_HOME` handling anywhere in the script.

Changes:
- Source `scripts/e2e-env.sh`; `E2E_PORT`/`E2E_TMUX_SERVER`/`RK_CODE_SERVER_PORT` become the derived values.
- **Self-scoped stale-kill**: the line-38 kill keeps its shape but now probes ONLY the derived triple — nobody else can own those ports, so the machine-wide hazard is retired by construction (this is the fix for the documented `e2e cross-worktree mutual kill`). It also legitimately claims the port from this worktree's own leftover `just dev`/previous run.
- **Self-scoped cleanup glob**: the trap glob keys on the derived `E2E_TMUX_SERVER`, so it only ever matches this worktree's own family (primary + `<derived>`-nested secondaries).
- **Hermetic state**: export `XDG_STATE_HOME=<per-run temp dir>` (user-final: per-run, e.g. `mktemp -d`; removed in the trap) into the dev-server launch so the backend's two disk carve-outs — the snapshot store and the PR-status seed cache — are per-run. This stops the e2e backend writing over the developer's real seed cache (architecture.md:631) and makes snapshot/recovery-adjacent specs hermetic across worktrees. (Nuance, verified: `recovery-section.spec.ts` route-mocks `/api/recovery*`, and the snapshotter skips `@rk_ephemeral`-marked servers — which `test-e2e.sh:43` sets — so the concrete shared-write today is the seed cache; the XDG scoping is defense-in-depth for both. `$HOME`-keyed state (`~/.rk/settings.yaml`) remains shared and out of scope — the `board-list-reorder.spec.ts` snapshot/restore pattern documented in `docs/memory/run-kit/ui/dialogs-and-state.md:29` stays necessary.)

### 3. Concurrency throttle (Layer 2)

Wrap the line-118 Playwright invocation in a flock counting semaphore (user-final design): N slot files `/tmp/rk-e2e-slot-{0..N-1}`; non-blocking `flock -n` try on each in turn; if all busy, block on slot 0. `RK_E2E_SLOTS` overrides N (default 2; 1 = strict series). ~10 lines, no daemon. Implementation posture:
- Gate on `command -v flock` — stock macOS has no `flock(1)` (the script's existing comments deliberately keep macOS-portable, cf. the `set -m`-not-`setsid` note); when absent, print a notice and run unthrottled (isolation still holds; only the load throttle degrades).
- The throttle wraps ONLY the Playwright run, not server startup (server startup is cheap relative to the suite and port-isolated). `just pw` stays unthrottled — it is the ad-hoc/interactive lane (`--ui`, single specs).

### 4. `justfile` recipes + `scripts/dev.sh` — derived defaults and env precedence

Current state (verified):
- `justfile:102` (`pw` recipe): `cd app/frontend && RK_PORT="${RK_PORT:-3020}" E2E_TMUX_SERVER="${E2E_TMUX_SERVER:-rk-test-e2e}" pnpm exec playwright {{args}}` — plus the stale comments at line 95 ("port 3020 to avoid colliding with dev server on 3000/3001") and line 100 ("Requires a dev server on port 3020: RK_PORT=3020 just dev").
- `scripts/dev.sh:22`: `export RK_PORT="${RK_PORT:-3000}"`; code-server auto-port at line 49 (`RK_PORT+2`).
- **Env precedence hazard (verified live)**: `.envrc` runs `dotenv` + `dotenv_if_exists .env.local`, and both `.env` and `.env.local` set `RK_PORT=3000` — so every direnv-loaded shell in every worktree carries ambient `RK_PORT=3000` (confirmed in this session's environment). Any `${RK_PORT:-derived}` default would therefore NEVER derive in practice (this is the documented "`just pw` is poisoned by RK_PORT=3000" hazard). The derivation must not treat ambient `RK_PORT` as an override.

Changes (user-final: `just dev` / `just pw` / `just test-e2e` default from the same derivation, so each worktree's externally-managed `pw` server is its own):
- `pw` recipe: port/socket default from `scripts/e2e-env.sh` (via a thin `scripts/pw.sh` wrapper to keep the recipe a one-liner, Constitution VIII); ambient `RK_PORT` is not consulted; explicit `RK_E2E_PORT`/`E2E_TMUX_SERVER` override. No `:-3020` fallback survives anywhere.
- `test-e2e` recipe: unchanged shape (already delegates to the script).
- `dev` recipe / `dev.sh`: default port becomes the derived `E2E_PORT` (replacing the `:-3000` fallback as the *default*; explicit `--port`/`RK_PORT` still win). For the derivation to actually take effect, the `RK_PORT=3000` bootstrap line is removed from `.env` (the built-in default in `internal/config` is 3000, so daemon/prod behavior is unchanged) — with a migration note: existing gitignored `.env.local` copies still carry `RK_PORT=3000` and pin `just dev` to 3000 until hand-edited. Consequence, stated deliberately: one derived triple per worktree means `just dev` (the pw rig) and `just test-e2e` share ports within a worktree — `just test-e2e`'s now-self-scoped stale-kill claims the ports from your own `just dev`, which is the intended "one rig per worktree" semantic.
- Solo component recipes (`dev-backend:37`, `dev-frontend:41`, `dev-rk:33`) keep their `${RK_PORT:-3000}` fallbacks (solo-debug conveniences; explicit env is their documented usage).
- Justfile comment sweep: lines 95, 100 (and any other `3020`/`rk-test-e2e` literals).

### 5. `app/frontend/playwright.config.ts` — verify-only

Current state (verified): line 3 `const port = Number(process.env.RK_PORT ?? "3333");` (fail-closed — a direct unset-env `playwright test` connects to nothing rather than a live instance); webServer block (lines 43–48) is `command: 'echo "webServer managed externally"'` + `reuseExistingServer: true`; `workers: 1` with the serial-everywhere comment naming `rk-test-e2e` (line 13). Changes: **the 3333 fail-closed guard stays** (user-final); port continues to flow from `RK_PORT` in the env (set by `test-e2e.sh`/`pw.sh`); update the line-13 comment's literal socket name. No behavioral config change expected — this task is a plumbing check.

### 6. E2E helper + spec sweep

Verified current state of the literal-name surface:
- **Already derive from env** (no change beyond fallback review): `app/frontend/tests/e2e/_tmux.ts:30` (`export const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e"`) and `global-teardown.ts:5` (same fallback; prefix-scans `/tmp/tmux-<uid>`).
- **Hardcode the literal secondary prefix — must derive from `TMUX_SERVER`** (all four verified): `boards-multi-server.spec.ts:11` (`rk-test-e2e-multi-${process.pid}-…`), `multi-server-sidebar.spec.ts:11` (`rk-test-e2e-msb-…`), `sessions-scope-toggle.spec.ts:11` (`rk-test-e2e-scope-…`), `create-server-waiting.spec.ts:10` + `:82` (`rk-test-e2e-csw-…`, `rk-test-e2e-nope-…`). Secondary names keep the `<role>-<pid>-<epoch>` tail so `parseTestSocketPID` (second-to-last hyphen field) still parses.
- **Stale 3020 fallbacks**: `_boards.ts:106` (`baseURL ?? http://localhost:${process.env.RK_PORT ?? 3020}`) and `session-reorder.spec.ts:53` (same pattern) — align to the config's fail-closed 3333 (or a shared helper) so no code path silently targets 3020.
- Comment-only literals (`global-teardown.ts:8`'s stale `rk-test-e2e-coupling-*` example — that spec no longer exists — `top-bar-refresh.spec.ts` ":3020 backend" comments, `playwright.config.ts:13`) swept opportunistically.
- Go test fixtures are hermetic and stay untouched: `internal/config/config_test.go:128` (`t.Setenv("RK_PORT", "3020")`), `internal/tmuxctl/client_test.go:520–530` (fixture strings).
- `.github/workflows/ci.yml`: comment-only update (line ~111 "the shared rk-test-e2e server is naturally isolated between shards"). CI behavior is *unchanged by design* (non-goal): each shard is a single-worktree runner named `run-kit`, so all shards derive the same identity in isolated VMs; `git rev-parse` and `flock` are available on ubuntu runners.

### 7. Docs sweep (non-memory, this change) + memory (hydrate)

- `fab/project/context.md` § Testing (lines 63–73) and § Playwright-Driven Development (lines 75–86) — every "port 3020" / "RK_PORT=3020 just dev" / "rk-test-e2e" instruction becomes the derived-identity story (updated at hydrate per the standing convention).
- Companion `.spec.md` files: ~25 mention the literal rig ("started by `scripts/test-e2e.sh` on port 3020", "`rk-test-e2e`"). Constitution requires companion updates only when the sibling `.spec.ts` changes — so the four secondary-socket spec companions update in-change; a mechanical phrasing sweep of the rest ("the derived per-worktree e2e port/socket") is a Polish-phase task.
- Memory files carrying the rig truth update at hydrate — see Affected Memory.

### 8. Verification (user-final)

1. Full `just test-e2e` green in one worktree (derived identity end-to-end).
2. **The point of the change**: two simultaneous `just test-e2e` runs from sibling worktrees with no mutual interference — documented as a manual/scripted verification step (assert: distinct derived triples/sockets, both suites complete, neither cleanup touches the other's family, throttle serializes the Playwright phases when `RK_E2E_SLOTS=1`).
3. `just pw test <spec>` against a derived-port `just dev` server (the externally-managed-rig workflow) in a worktree.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) The e2e-rig naming truth: § E2E (Playwright) naming lists the four `rk-test-e2e` declaration sites (`tmux-sessions.md:459`) and the "fixed name" primary; § RK_SERVER_ALLOWLIST examples use the literal name/`:3020`; § teardown/cleanup documents the shared-prefix glob. All become the derived-identity story (token shape, family anchoring, allowlist token shape).
- `run-kit/architecture`: (modify) § Playwright E2E Tests (`_boards.ts` `apiBase` 3020 fallback note, ~line 1230) and the seed-cache viewer-wide notes (lines 631, 1145 — "the e2e harness's :3020 server writing over the developer's real cache" becomes false once XDG is per-run).
- `run-kit/ui/dialogs-and-state`: (modify) The "isolates the tmux server and the port, but NOT `$HOME`" note (line 29) gains the new isolation set: derived ports/socket + per-run `XDG_STATE_HOME`; `$HOME` (`~/.rk/`) still shared, snapshot/restore pattern still required.

## Impact

- **Files**: `scripts/e2e-env.sh` (new), `scripts/test-e2e.sh`, `scripts/dev.sh`, `scripts/pw.sh` (likely new, Constitution VIII), `justfile`, `.env` (drop the `RK_PORT=3000` bootstrap line), `app/frontend/playwright.config.ts` (comment/verify), `app/frontend/tests/e2e/` (4 secondary-socket specs + their `.spec.md`s, `_boards.ts`, `session-reorder.spec.ts`, `global-teardown.ts` comments), `.github/workflows/ci.yml` (comment only), `fab/project/context.md` + memory at hydrate.
- **No production code paths change**: the Go backend and frontend src are untouched; `RK_SERVER_ALLOWLIST`/`@rk_ephemeral`/snapshotter mechanisms are consumed as-is (only the *values* fed to them change). The nesting-proof decision keeps this airtight: the token-shape change is entirely on the env-value side; `matchesServerAllowlist` is untouched.
- **Operational migration**: existing worktrees' gitignored `.env.local` files still pin `RK_PORT=3000`; muscle-memory `RK_PORT=3020 just dev` stops matching anything (nothing listens on 3020 after migration). Both are documented, not code-guarded.
- **Risk**: lowest-risk failure mode is the derivation silently not applying (ambient env precedence) — mitigated by the dedicated-override design in § 4; the two-worktree parallel verification step is the direct proof.
- **CI**: unaffected by design (single-worktree shards; same-name derivation in isolated VMs).

## Open Questions

*None asked — promptless dispatch. No decision scored below the Unresolved threshold; the former Tentative (nesting-proof mechanism) was resolved in the design discussion and is pinned in § Derivation.*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Per-worktree identity derives from sanitized `basename $(git rev-parse --show-toplevel)`; NO 3020 special case, primary repo included | User-decided FINAL (explicitly dropped the muscle-memory carve-out) | S:95 R:70 A:90 D:95 |
| 2 | Certain | Deterministic hash of the token into a reserved port-triple block avoiding 3100–3199 and 3000/3001; step-forward fallback on live collision | User-decided FINAL; range constraints verified against `internal/remote/ports.go` | S:90 R:75 A:85 D:90 |
| 3 | Certain | Socket `rk-test-e2e-$WT`; secondaries nest under the worktree's own name; cleanup glob self-scoped; machine-wide port kill retired (probe/kill only the derived triple) | User-decided FINAL; current kill/glob verified at `test-e2e.sh:38`/`:31` | S:90 R:75 A:85 D:90 |
| 4 | Certain | `test-e2e.sh` exports a per-run temp `XDG_STATE_HOME` into the dev-server launch | User-decided FINAL; shared-write today verified (architecture.md:631 seed cache) | S:90 R:85 A:90 D:90 |
| 5 | Certain | flock counting semaphore over `/tmp/rk-e2e-slot-{0..N-1}`, default N=2, `RK_E2E_SLOTS` override, N=1 = series; non-blocking try each then block on slot 0 | User-decided FINAL, design given verbatim | S:95 R:90 A:90 D:90 |
| 6 | Certain | Non-goals hold: no shared dev server, no lock-only serialization, CI sharding untouched; `playwright.config.ts` keeps the fail-closed 3333 fallback | User-decided FINAL | S:90 R:80 A:90 D:95 |
| 7 | Certain | Change type `chore`, pinned explicit | Dev-harness tooling with no product behavior change; dispatcher delegated the taxonomy call (prefer chore/ci if inferred); `docs/specs/change-types.md` absent from this repo | S:80 R:95 A:85 D:75 |
| 8 | Certain | The four secondary-socket specs derive their prefixes from `_tmux.ts` `TMUX_SERVER` instead of literal `rk-test-e2e-`, keeping the `<role>-<pid>-<epoch>` tail | User contract said verify which already derive — verified NONE of the four do (boards-multi-server:11, multi-server-sidebar:11, sessions-scope-toggle:11, create-server-waiting:10/82); `parseTestSocketPID` right-anchored parse tolerates the longer prefix | S:75 R:85 A:85 D:80 |
| 9 | Certain | Derivation logic lives in `scripts/e2e-env.sh` (sourced by scripts); justfile recipes stay one-liners, `pw` via a thin `scripts/pw.sh` | Constitution VIII determines this | S:70 R:85 A:90 D:80 |
| 10 | Confident | All three recipes (`dev`/`pw`/`test-e2e`) default from ONE derived triple per worktree; within a worktree, dev rig and e2e run share ports (test-e2e's self-scoped stale-kill claims them from your own `just dev`) | The contract's trio sentence + purpose clause ("each worktree's externally-managed pw server is its own"); the shared-triple consequence is stated deliberately | S:65 R:70 A:55 D:50 |
| 11 | Confident | Ambient `RK_PORT=3000` (direnv-exported from `.env`/`.env.local`, verified live) is NOT an override input: `pw`/`test-e2e` use a dedicated `RK_E2E_PORT` override; `just dev` derivation is enabled by dropping the `RK_PORT=3000` line from `.env` (built-in default 3000 preserves daemon behavior), with an `.env.local` migration note | Without this the derivation never applies on direnv boxes (the documented "`just pw` poisoned by RK_PORT=3000" hazard); env-is-deployment-bootstrap convention supports the .env removal | S:40 R:70 A:60 D:40 |
| 12 | Confident | Concrete block values: base 3400, 100 triples (3400–3699); hash = POSIX `cksum` of the token | User gave "e.g." — specific numbers are mine; range verified clear of 3000/3001, 3020/3021, 3100–3199, 3333, 3939, ephemeral ranges; portable hash | S:55 R:85 A:75 D:60 |
| 13 | Confident | Throttle gated on `command -v flock` (skip with notice on stock macOS; present on Linux/CI); wraps only the Playwright invocation; `just pw` unthrottled | macOS has no flock(1) and the script is deliberately macOS-portable (its own `set -m` comment); pw is the interactive lane | S:60 R:90 A:70 D:65 |
| 14 | Confident | Companion `.spec.md` sweep: update in-change only where the sibling `.spec.ts` changes; mechanical phrasing sweep of the remaining ~25 "port 3020" mentions is a Polish task | Constitution scopes companion updates to spec changes; full sweep is low-value churn but cheap | S:40 R:80 A:55 D:40 |
| 15 | Confident | Solo recipes (`dev-backend`/`dev-frontend`/`dev-rk`) keep `${RK_PORT:-3000}`; Go test fixtures (config_test.go:128, client_test.go:520) untouched | Solo-debug conveniences with documented explicit-env usage; fixtures are hermetic (t.Setenv / literal strings) | S:50 R:90 A:70 D:60 |
| 16 | Certain | Nesting-proof naming pinned: hyphen-free token (basename, hyphens stripped) + 2-char absolute-path hash tail; role segment on EVERY family member (primary `rk-e2e-<token>-0`); all family matching (glob, teardown scan, allowlist) anchored on `rk-e2e-<token>-` with the trailing hyphen | Resolved in the design discussion: hyphen-free tokens make `tokenA-` prefix `tokenB-…` only when equal, so cross-family matching is impossible by construction under both glob and `HasPrefix` semantics; env-value-only, `matchesServerAllowlist` untouched | S:80 R:80 A:85 D:85 |

16 assumptions (10 certain, 6 confident, 0 tentative, 0 unresolved).
