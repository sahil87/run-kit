# Intake: tmux.conf Ownership (Config Phase 4)

**Change**: 260823-0tu6-tmux-conf-ownership
**Created**: 2026-08-23

## Origin

One-shot `/fab-new` invocation implementing **Phase 4 (tmux ownership)** of the consolidated config plan `fab/plans/sahil/26-08-23-config-consolidated.md`, all decisions settled in the 2026-08-23 brainstorm (record: the "Config Sanitization Board" artifact). Phase 1 (root + registry core, PR #720) is merged to main; this phase depends only on Phase 1's new config root (`$HOME/.config/run-kit/`) and runs independently of Phases 2/3.

> Implement Phase 4 (tmux.conf ownership): (1) `~/.config/run-kit/tmux.conf` is rk-OWNED, declared by a managed header with a content hash; (2) three-state check: missing → write the embed; managed & stale → force-write + reload sweep; hand-edited → hands off, doctor drift line carries the migration recipe; (3) refresh at daemon start (the EnsureConfig call site), never a timer — the reload sweep enumerates LIVE rk servers filtered to live sockets; (4) `tmux.d/user.conf` is the standard override file, scaffolded by every scaffold path; (5) hand-edited managed confs are never clobbered, never auto-migrated; (6) migration 2: `~/.rk/tmux.conf` + `~/.rk/tmux.d/` → `~/.config/run-kit/`; (7) docs layered cheapest-first with the history-limit caveat. Unit tests: three-state decision, live-socket filter. Verify every file/line anchor against post-Phase-1 code.

**Anchor verification performed at intake (post-Phase-1 main, cdaa10e1):**

- `EnsureConfig` call site is `cmd/rk/serve.go:120` (plan cites :122 — drifted by 2 lines, same site).
- `DefaultConfigPath` is still `~/.rk/tmux.conf` (`internal/tmux/tmux.go:86`) — migration 2 is genuinely open; Phase 1 moved only `settings.yaml`.
- `tmux.ListServers` (`internal/tmux/tmux.go:2516`) already IS the live-socket-filtered enumeration (probeServerAlive per socket) — the "live-socket filter" requirement rides it, no new probe machinery.
- `ReloadConfig(server)` exists (`internal/tmux/tmux.go:180`), sources `configPath` via `tmuxExecServer`.
- Phase 1 already landed the `tmux_conf` settings key + `RK_TMUX_CONF` escape and the `resolveConfigPath()` chain (`internal/tmux/tmux.go:102`); `settings.go:69-73` documents "the user owns the file — rk performs no ensure/refresh on it".
- The embedded conf (`configs/tmux/default.conf:94-96`) hardcodes `source-file -q ~/.rk/tmux.d/*.conf` — the drop-in path inside the embed must move with migration 2.
- Scaffold paths today: `tmux.EnsureConfig` (serve start), `tmux.ForceWriteConfig` (used by `POST /api/tmux/init-conf`, `api/tmux_config.go:22`), and `cmd/rk/initconf.go` (`rk mux init-conf` + hidden root alias, its own WriteFile — not ForceWriteConfig).
- Doctor precedent for the drift line: informational never-FAIL rows (`ephemeralServersCheck`, `tmuxDriftNotes` in `cmd/rk/doctor.go`), test seams via package vars (`tmuxServerList`).
- Docs surfaces: `README.md:304` (init-conf row, says `~/.rk/`); docs/site has NO "Customizing tmux" section yet (new); `configs/tmux/default.conf:3` comment says the stale `~/.run-kit/tmux.conf`.

## Why

1. **Pain**: rk's embedded tmux.conf never reaches existing installs — `EnsureConfig` writes only when the file is missing, and `rk update` never touches it. The `history-limit 100000` embed line is the first casualty: most existing installs predate it and silently keep tiny scrollback. Meanwhile users hand-edit the managed file because the `tmux.d/` override surface is invisible — then lose their edits to `init-conf --force`, the only refresh path offered.
2. **Consequence if unfixed**: every embed improvement strands on old installs forever; the only remedies are destructive (`--force` clobbers user edits) or manual. The config-consolidation plan's migration 2 also stays open, so `~/.rk/` cannot retire.
3. **Approach**: ownership declared in-band by a hash-stamped managed header. The hash makes "did the user edit this?" a local, deterministic check — no version registry, no timestamps, no extra state file (Constitution II). Refresh at daemon start only (updates restart the daemon), never a timer/watcher. Overrides get a first-class, visible home (`tmux.d/user.conf` scaffolded everywhere) so hand-editing the managed file stops being the path of least resistance.

## What Changes

### 1. Managed header + three-state check (`internal/tmux`)

The managed file's first line becomes:

```
# rk-managed sha256:<hex> — DO NOT EDIT; overrides go in ~/.config/run-kit/tmux.d/
```

where `<hex>` is the SHA-256 (lowercase hex) of the **body** — everything after the header line. Every rk write of the managed file writes header + embed body, stamping the hash of what it wrote.

A pure decision function classifies the on-disk file against the embed (unit-test target #1):

| State | Detection | Action |
|-------|-----------|--------|
| **missing** | stat fails NotExist | write header + embed body |
| **managed & current** | header present, body hashes to its own stamp, body == embed | no-op |
| **managed & stale** | header present, body hashes to its own stamp, body != embed | force-write header + new embed body, then reload sweep |
| **hand-edited** | no header, or body does not hash to the stamp | hands off — never written, never auto-migrated; doctor drift line carries the recipe |

The classification is exported (or seam-visible) so doctor and the ensure path share one implementation.

### 2. Refresh at daemon start + reload sweep

- `tmux.EnsureConfig()` (called at `cmd/rk/serve.go:120`) grows from ensure-if-missing into the three-state refresh above. No timer, no watcher — daemon start is the only trigger (updates restart the daemon).
- When (and only when) a stale managed file was force-written, run the **reload sweep**: enumerate servers via `tmux.ListServers` (already live-socket-probed — load-bearing: any tmux command on a dead socket resurrects a server) and call `tmux.ReloadConfig(server)` per live server. Per-server failures log and continue; the sweep never fails daemon start. The enumeration rides a package-level seam (mirroring doctor's `tmuxServerList`) so the live-only property is unit-testable (unit-test target #2).
- **Ownership escape unchanged**: when the resolved config path is not `DefaultConfigPath` (user set `tmux_conf` or `RK_TMUX_CONF`), rk performs **no ensure/refresh/doctor** on the file — "you own everything" mode, exactly as `settings.go` documents. `EnsureConfig` gains this gate explicitly.

### 3. Migration 2: `~/.rk/tmux.conf` + `~/.rk/tmux.d/` → `~/.config/run-kit/`

- `DefaultConfigPath` flips to `~/.config/run-kit/tmux.conf` (built from the same fixed root as `settings.Dir()` — `$HOME`-only, no XDG env, per Phase 1's pattern). The drop-in dir becomes `~/.config/run-kit/tmux.d/`.
- The embed's drop-in lines (`configs/tmux/default.conf:94-96` comment + `source-file -q ~/.rk/tmux.d/*.conf`) update to the new path; the stale `~/.run-kit/` comment at `default.conf:3` is corrected in passing. No tmux **option/behavior** content changes (the non-goal guards semantics, not the forced path move).
- Migration on ensure (the standard fallback-read/migrate-on-write/breadcrumb pattern from the plan, applied at daemon start / scaffold time):
  - Old `~/.rk/tmux.d/*.conf` drop-ins are **moved** into the new `tmux.d/` (they are the user's overrides and must keep applying); the old dir is breadcrumbed (e.g. renamed `tmux.d.migrated`), best-effort, never fatal.
  - Old `~/.rk/tmux.conf`: the three-state logic applies **at the NEW path** — the new file is written per §1 regardless. The old file: if byte-equal to the current embed it is breadcrumb-renamed (`tmux.conf.migrated`); anything else (old-embed pristine or hand-edited — pre-header files are indistinguishable) is **left untouched** and the doctor drift line carries the migration recipe. Never auto-migrated.
- `~/.rk/` retires only when all three plan migrations have landed (1 and 3 are Phase 1's; this completes 2) — actual removal of the dir is out of scope here (other tenants may remain, e.g. `code-server-bin`).

### 4. `tmux.d/user.conf` scaffold

Every scaffold path — `EnsureConfig`, `ForceWriteConfig`, `rk mux init-conf` (both cobra instances), `POST /api/tmux/init-conf` — ensures `tmux.d/` exists AND scaffolds `tmux.d/user.conf` as a **commented starter** (what the file is for, one or two commented example lines, pointer to numeric-prefixed siblings `10-*.conf` for ordering). An existing `user.conf` is **never overwritten** — scaffold only when absent. No new mechanism: the sourced drop-in dir is promoted, not replaced.

### 5. Doctor drift line (`cmd/rk/doctor.go`)

A new informational check row (never-FAIL posture, mirroring `ephemeralServersCheck` / `tmuxDriftNotes`):

- managed & current → OK note (e.g. `managed, current`)
- managed & stale → OK note naming the pending refresh (`stale — refreshes on next daemon start`)
- hand-edited → OK note carrying the **migration recipe**: move customizations into `~/.config/run-kit/tmux.d/user.conf`, then `rk mux init-conf --force` to restore the managed file
- old un-migrated `~/.rk/tmux.conf` present → same recipe, naming the old path
- `tmux_conf`/`RK_TMUX_CONF` set → row reports "user-owned (tmux_conf set) — unmanaged" (no drift analysis)

### 6. CLI copy + docs (layered cheapest-first)

1. **The header itself** (the cheapest doc — in the file at the moment of temptation).
2. **`rk doctor`** — §5.
3. **CLI copy**: `init-conf` success output names `user.conf` as the override home; the already-exists error states the recipe (not just "use --force"); `--force` help text scoped to the managed file ("Overwrite the rk-managed tmux.conf; overrides in tmux.d/ are untouched"); the `Short` text's `~/.rk/` becomes the new path.
4. **README + docs/site**: README:304 row updated (new path, user.conf); a new "Customizing tmux" docs/site section covering the managed header, `user.conf`, `10-*.conf` ordering, `tmux_conf` opt-out, and the refresh-on-daemon-start behavior. Checked against `shll standards` (Toolkit Standards constitution clause) before shipping.
5. **NOT the web app** (non-goal).

**Caveat documented wherever refresh is mentioned** (doctor note, docs/site section, README if refresh appears there): `history-limit`-class options apply only to panes created after reload — existing panes keep their old values.

### 7. Unit tests

- **Three-state decision**: table-driven over (missing / managed-current / managed-stale / hand-edited-no-header / hand-edited-hash-mismatch) → expected classification and write/no-write behavior.
- **Live-socket filter**: the reload sweep calls only servers the (stubbed) live enumeration returned — proving dead sockets are never touched; per-server error does not abort the sweep.
- Existing `initconf_test.go` / `doctor_test.go` extended for the new copy, `user.conf` scaffold, and the drift row's states.

## Affected Memory

- `run-kit/configuration`: (modify) tmux.conf becomes rk-owned via the hash-stamped managed header; three-state refresh at daemon start; migration 2 lands (tmux files leave `~/.rk/`); remaining-`~/.rk`-tenants list shrinks; `tmux_conf` opt-out semantics extended to "no ensure/refresh/doctor".
- `run-kit/agent-messaging`: (modify) the `rk mux init-conf` verb's contract changes — new destination path, `user.conf` scaffold, recipe-bearing error, `--force` scoped to the managed file.
- `run-kit/architecture`: (modify) daemon-start sequence gains the three-state refresh + conditional reload sweep; doctor gains the tmux-config row; `POST /api/tmux/init-conf` scaffold behavior.

## Impact

- `app/backend/internal/tmux/tmux.go` (init/DefaultConfigPath, EnsureConfig, ForceWriteConfig, ensureDropInDir, ReloadConfig) + a new managed-conf file (header/hash/three-state + migration + sweep) + unit tests
- `app/backend/cmd/rk/serve.go:120` region (refresh + sweep wiring), `cmd/rk/initconf.go` (+ its test), `cmd/rk/doctor.go` (+ its test)
- `app/backend/api/tmux_config.go` (init-conf handler comments/behavior via ForceWriteConfig)
- `configs/tmux/default.conf` (drop-in path lines + stale comment; `scripts/dev.sh` / `just setup` copy flow unchanged)
- `README.md:304`, `docs/site/` new "Customizing tmux" section
- No frontend changes; no API surface changes (existing endpoints keep their shapes)

## Open Questions

*(none — all decisions settled by the plan + brainstorm; remaining judgment calls are graded below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Managed header is line 1, exact copy from the plan; hash = SHA-256 lowercase hex of everything after the header line | Plan states the header verbatim; hash-scope (body-after-header) is the only workable reading of "hash-of-body" | S:95 R:85 A:90 D:90 |
| 2 | Certain | Three-state classification + actions exactly per the plan's table (missing/managed-stale/hand-edited) | Plan verbatim; discussed and settled 2026-08-23 | S:95 R:80 A:90 D:95 |
| 3 | Certain | Refresh only at daemon start (serve.go:120 EnsureConfig site), never a timer; anchor re-verified post-Phase-1 | Plan verbatim (":122" drifted to :120 — same call) | S:95 R:85 A:95 D:95 |
| 4 | Certain | Reload sweep rides `tmux.ListServers` (already live-socket-probed) + per-server `ReloadConfig`; no new probe machinery | Codebase answers this: ListServers IS the live filter; doctor's tmuxDriftNotes is the exact precedent | S:90 R:85 A:95 D:90 |
| 5 | Certain | `user.conf` commented starter scaffolded by all four scaffold paths; existing user.conf never overwritten | Plan: "scaffolded as a commented starter by every scaffold path"; never-overwrite follows from it being user-owned | S:90 R:90 A:90 D:85 |
| 6 | Confident | The embed's `source-file -q ~/.rk/tmux.d/*.conf` line moves to the new path — the "no change to embed CONTENTS" non-goal guards option semantics, not the root-path move migration 2 forces | The two plan clauses conflict literally; only this reading makes migration 2 executable (drop-ins at the new path would otherwise never be sourced) | S:70 R:75 A:80 D:70 |
| 7 | Confident | Migration mechanics: old drop-ins MOVED to new tmux.d/ (breadcrumb the old dir); old tmux.conf breadcrumb-renamed only when byte-equal to the current embed, otherwise left untouched with the doctor recipe (pre-header files can't prove managed-ness) | Plan gives the pattern (fallback-read, migrate on write, breadcrumb) + "an old hand-edited conf migrates per the doctor recipe, never automatically"; the byte-equal test is the only safe managed-detector for pre-header files | S:75 R:70 A:65 D:60 |
| 8 | Confident | Doctor drift line is an informational never-FAIL row covering the five states in §5, recipe = "move customizations to tmux.d/user.conf, then `rk mux init-conf --force`" | Doctor's established posture (ephemeral/drift rows never flip the verdict); recipe content follows from the design | S:75 R:85 A:80 D:75 |
| 9 | Certain | `tmux_conf`/`RK_TMUX_CONF` set ⇒ no ensure/refresh/doctor drift analysis ("you own everything") | Plan verbatim; settings.go:69-73 already documents it — this change makes EnsureConfig honor it explicitly | S:90 R:85 A:90 D:85 |
| 10 | Confident | Sweep failures degrade per-server (log + continue), never fail daemon start; sweep runs only on an actual stale→force-write transition | Matches the codebase's never-block drift posture; reloading unchanged config on every start would be wasted tmux traffic | S:65 R:85 A:85 D:80 |
| 11 | Confident | Managed-conf logic lands as a new file in `internal/tmux` beside EnsureConfig, with package-var seams for tests (doctor's tmuxServerList pattern) | Follows existing package layout and test-seam idiom; low-cost to relocate | S:60 R:85 A:85 D:80 |
| 12 | Certain | Docs layering + history-limit caveat exactly per plan; README:304 updated; docs/site "Customizing tmux" is a NEW section (verified absent); standards-checked via `shll standards` before shipping (Constitution: Toolkit Standards) | Plan verbatim + constitution clause | S:90 R:90 A:85 D:90 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
