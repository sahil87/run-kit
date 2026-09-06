# Intake: rk cron CLI

**Change**: 260906-bi3v-rk-cron-cli
**Created**: 2026-09-06

## Origin

Operator dispatch (one-shot, autonomous): C2 of the cron clock plan
(`fab/plans/sahil/26-09-06-cron-clock-plan.md`), wave 1, parallel with C3, depending on
C1 (`internal/cron` core + evaluator — 260906-3jtn, PR #855, merged into this worktree's base).
Design authority: `docs/specs/cron.md` § API & CLI. Seed:

> rk cron CLI: add subcommand (schedule flags, creator auto-capture from $TMUX_PANE -> role/pane
> target; session capture lands in C9 -- out of scope here), list [--json], rm, mute, pin, and the
> invoker verb rk cron tick (flock-guarded, idempotent).

## Why

1. **The substrate has no user/agent-facing surface.** C1 shipped `internal/cron` as a library
   only — entry files, the stateless evaluator, the delivery log, `Tick` — with no way to create,
   inspect, or remove an entry, and no way to invoke a tick outside a Go test. The plan's Wave 2
   gate explicitly requires "`rk cron add/list/rm` from inside an agent pane works without flags
   beyond the schedule" — that is this change.
2. **Without it, wave 2 blocks.** C4 (operator-tick seeding) and the manual gate need the CLI to
   verify behavior on a live server; agents cannot program recurring work at all.
3. **Why a CLI (vs API-first)**: the spec fixes the CLI as the agent-facing mutation surface —
   agents live in panes where `$TMUX_PANE` gives creator identity for free ("the agent that uses
   it becomes the target costs no arguments"); the HTTP API is a separate later change (C5).

## What Changes

All changes live in `app/backend/cmd/rk/` (new files) consuming the shipped `internal/cron`
package — **no changes to `internal/cron` evaluation semantics**. No daemon ticker, no HTTP API,
no injection delivery (those are C3/C5), no `session` target auto-capture or orphan GC (C8/C9).

### New cobra family: `rk cron`

`cmd/rk/cron.go` — family parent following the `rk mux` pattern (`cmd/rk/mux.go`): a persistent
`-L/--server` flag inherited by the entry-file-scoped verbs (`add`, `list`, `rm`, `mute`, `pin`).
Server resolution order (the documented mux order): explicit `-L` wins, else the caller's own
server derived from the original `$TMUX` socket basename (`tmux.OriginalTMUX` — `internal/tmux`'s
init strips `$TMUX` from the process), else the default server. The resolved server name is the
cron file slug (validated by `cron.ValidSlug` before any path is built). `tick` is the exception:
it takes no `-L` and rejects an explicitly-set inherited one (`muxRejectInheritedServerFlag`
pattern) because `cron.Tick` sweeps **all live servers** by design.

Per-verb files with colocated tests, mirroring the mux family layout: `cron_add.go`,
`cron_list.go`, `cron_rm.go`, `cron_mute.go` (mute + pin), `cron_tick.go`. Package-level function
seams for tmux/dir/now (the `role.go` / `mux_*.go` testing idiom) so tests run without a live
server and with `env -u TMUX -u TMUX_PANE` hygiene.

### `rk cron add <payload>` — schedule flags + creator auto-capture

Spec form: `rk cron add <payload> --every 1h | --backoff | --cron "<expr>" [--name N]
[--deliver when-idle] [--if-absent skip]` — agent-friendly: no flags beyond the schedule required
when run inside a pane.

- **Payload**: positional, required — the text delivered on a fire.
- **Schedule** (exactly one of, mutually exclusive — error on zero or 2+):
  - `--every <dur>` — Go duration (`1h`, `90s`), must be positive (schema validation).
  - `--backoff` — anchor `operator-idle` (the only anchor C1 defines), defaults `min: 60s`,
    `max: 30m` (the spec's operator-tick values), overridable via `--min <dur>` / `--max <dur>`
    (schema enforces `max ≥ min`). `--min`/`--max` without `--backoff` is an error.
  - `--cron "<expr>"` — stored as schema-valid intent; the C1 evaluator skips it with a
    `schedule-kind-unsupported` diagnostic, so `add` prints a one-line note that cron-expression
    evaluation lands in a later wave (C9). Accepting-and-noting beats rejecting: the spec's CLI
    table includes it and the entry becomes live the moment C9 lands.
- **Creator auto-capture** (`$TMUX_PANE` + the caller's socket):
  - `created_by: {pane: $TMUX_PANE, at: now}` — `created_by.session` is left EMPTY: agent chat
    session capture (`@rk_pane_agent_session`) is C9's scope per the seed.
  - **Default target**: if the caller's window carries `@rk_win_role=operator` →
    `target: {kind: role, role: operator}`; else `target: {kind: pane, pane: $TMUX_PANE}`.
    (Session targets are not auto-created in this change.)
  - **Explicit target flags**: `--role operator` / `--pane %N` (mutually exclusive) override
    auto-capture. Outside tmux (`$TMUX_PANE` unset), an explicit target flag is REQUIRED — hard
    error otherwise (the `rk role` posture: a typed command must not guess a server or target).
- **Optional flags**: `--name <N>` (display name; defaults to a payload prefix), `--deliver
  immediate|when-idle` (default `immediate`), `--if-absent skip|notify|respawn` (default `skip`),
  `--pinned`. Values are stored verbatim in the schema; enforcement of `deliver`/`if_absent` is
  C3's scope.
- Writes via `cron.Add` (atomic read-modify-write, id generation, validation — a corrupt file
  refuses to mutate). On success prints the assigned 4-char id and a one-line entry summary.
- No `--wake-on` / `--suppress-while` flags: the operator-tick entry that needs them is seeded
  programmatically by `rk operator` in C4; keeping the flag surface minimal is deliberate
  (Constitution IV posture).

### `rk cron list [--json]`

Disk-derived ONLY — entry file + delivery log, **zero tmux commands** (no next-fire/rung/orphan
derivation; those need live facts and are C5's API scope — and a list that probed sockets could
resurrect dead servers). Human output: one row per entry — id, name, schedule summary
(`every 1h` / `backoff 60s→30m` / `cron <expr>`), target (`role:operator` / `pane:%12`), deliver,
flags (`muted`, `pinned`), and last-fired (newest delivery-log line for the entry, `-` when
none). `--json` emits the same records as a JSON array on stdout (data on stdout — Toolkit
Principle 9). Empty file → empty table / `[]`, exit 0. Load diagnostics (corrupt entries) print
to stderr without failing the listing (tolerant-load posture).

### `rk cron rm <id>` · `rk cron mute <id> [--off]` · `rk cron pin <id> [--off]`

Thin wrappers over `cron.Remove` / `cron.SetMuted` / `cron.SetPinned`. Unknown id → non-zero
exit with `no entry <id>` on stderr. `--off` unsets (unmute/unpin); the bare verb sets. Each
prints a one-line confirmation on stdout.

### `rk cron tick`

The invoker verb: a thin wrapper over `cron.Tick(ctx, cron.Deps{})` with production defaults —
the non-blocking flock, live-server filter, TMUX scrub, tolerant load, and idempotency are all
inherited from C1, not reimplemented. Behavior:

- **Held lock** (`ErrTickHeld` handled inside `Tick`): clean quiet exit 0 — no output, no error
  (skip-on-contention is correct because ticks are idempotent).
- **Deliverer**: none is wired in this change — C3 (parallel) owns injection-engine delivery;
  until it lands, fires record outcome `no-deliverer` in the delivery log and the fire/log/cursor
  choreography still exercises. The C2/C3 seam is exactly the `Deliverer` field of `cron.Deps`.
- Prints a one-line summary (servers swept, fires, diagnostics count) on stdout; a real error
  (dir resolution, lock file creation) exits non-zero via RunE.
- Bounded context per Constitution §I (tick sweep timeout; C1's per-call tmux timeouts apply
  underneath).

### Tests & standards

- Per-verb `*_test.go` in `cmd/rk` using the function seams; all tests hardened against ambient
  tmux env (`TMUX`/`TMUX_PANE` scrubbed — the PR #793 lesson).
- `help_dump_test.go` / toolkit help-dump standard: the new family and verbs join the audited
  surface; Principle 9 holds (confirmations/data on stdout, errors via RunE to stderr,
  non-zero exits).
- No e2e/frontend tests — no UI surface in this change.

## Affected Memory

- `run-kit/cron`: (modify) add the CLI surface — verb table, server resolution, creator
  auto-capture + default-target rule, the add-flag ↔ schema mapping, tick's invoker posture
  (nil-Deliverer seam to C3, quiet held-lock exit)
- `run-kit/toolkit-standards`: (modify) extend the help-dump/P9 audited-surface inventory with
  the `cron` family

## Impact

- **Code**: new `cmd/rk/cron*.go` + tests (~6 files + tests); registration in `main.go`'s root
  command. Consumes `internal/cron` (Add/Remove/SetMuted/SetPinned/LoadEntries/ParseLog/Tick,
  DefaultDir/ValidSlug) and `internal/tmux` (OriginalTMUX, window-role read for auto-capture,
  ValidPaneID). No `internal/cron` behavior changes expected; if a small read helper is missing
  (e.g., exported log-tail-per-entry accessor), add it there with tests rather than duplicating
  parsing in cmd.
- **No** frontend, API, daemon, settings, or tmux.conf changes.
- **Downstream**: C4 seeds the operator-tick entry via the library (not this CLI); C3 replaces
  the nil Deliverer; C5 adds the HTTP mutation surface; C9 adds session capture + cron-expression
  evaluation. Gate (c) of wave 2 ("add/list/rm from inside an agent pane, no flags beyond the
  schedule") is verified against this change.
- **Tests to run**: `go test ./cmd/rk/... ./internal/cron/...` (scoped), then the backend suite.

## Open Questions

- None — the spec's CLI table, the plan's C2 row, and the C1 memory file resolve the surface;
  remaining shape choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is C2 only: CLI over the shipped `internal/cron`; no daemon ticker, HTTP API, delivery impl, session capture, or orphan GC | Plan's change breakdown fixes the wave split; seed restates it | S:90 R:85 A:95 D:95 |
| 2 | Certain | Verb set + flag shapes follow the spec's CLI table (`add <payload> --every\|--backoff\|--cron`, `list [--json]`, `rm`, `mute`) plus seed-added `pin` and `tick` | `docs/specs/cron.md` § API & CLI is explicit; seed names pin/tick | S:90 R:80 A:90 D:90 |
| 3 | Confident | Family mirrors `rk mux`: persistent `-L` on entry-scoped verbs, resolution `-L` > caller's socket > default server; `tick` rejects `-L` (sweeps all live servers) | Established mux pattern; `cron.Tick` is all-server by C1 design | S:75 R:75 A:85 D:80 |
| 4 | Certain | Auto-capture writes `created_by: {pane, at}` with `session` left empty | Seed: "session capture lands in C9 — out of scope here" | S:85 R:80 A:90 D:90 |
| 5 | Confident | Default target: `role:operator` when the caller's window holds `@rk_win_role=operator`, else `pane:$TMUX_PANE`; `--role`/`--pane` override; outside tmux an explicit target is required (hard error) | Spec's creator-auto-capture rule minus its session leg; `rk role`'s no-guessing posture for the outside-tmux case | S:70 R:75 A:80 D:70 |
| 6 | Confident | `--backoff` is bare with anchor `operator-idle`, defaults `min 60s`/`max 30m`, `--min`/`--max` overrides | Spec CLI shows bare `--backoff`; schema needs anchor+min+max; only one anchor exists; defaults are the spec's operator-tick values | S:50 R:80 A:55 D:45 |
| 7 | Confident | `--cron "<expr>"` is accepted and stored with a printed not-yet-evaluated note (C1 skips kind `cron`) | Spec table includes it; schema validates it; rejecting would contradict the spec, silence would be a footgun | S:60 R:85 A:65 D:55 |
| 8 | Confident | Mute/pin unset via `--off` on the same verb (no separate unmute/unpin verbs) | Smallest surface satisfying the UI's toggle semantics; SetMuted/SetPinned take a bool | S:55 R:85 A:70 D:55 |
| 9 | Confident | `list` is disk-only (entries + delivery log): no tmux commands, no next-fire/rung/orphan columns (C5's derivation scope) | Zombie-server rule (any tmux cmd on a dead socket resurrects it); plan puts derivations in C5 | S:65 R:80 A:80 D:70 |
| 10 | Certain | `tick` wraps `cron.Tick` with zero-value `Deps` (nil Deliverer → `no-deliverer` outcomes until C3); held lock exits 0 quietly | C1 memory fixes Tick's contract and the Deliverer seam; plan makes delivery C3's scope | S:85 R:85 A:95 D:90 |
| 11 | Confident | No `--wake-on`/`--suppress-while` add flags; C4 seeds the operator entry via the library | Spec's CLI table omits them; C4 row owns seeding; minimal-surface posture | S:60 R:80 A:80 D:75 |
| 12 | Confident | cmd tests use package-level fn seams + scrubbed `TMUX`/`TMUX_PANE`; help-dump/P9 standards updated for the new family | role.go/mux idiom; cmd-rk ambient-env lesson (PR #793); toolkit-standards memory | S:60 R:80 A:80 D:75 |

12 assumptions (4 certain, 8 confident, 0 tentative, 0 unresolved).
