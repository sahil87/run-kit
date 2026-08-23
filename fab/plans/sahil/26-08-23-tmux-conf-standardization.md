# tmux.conf standardization + refresh — one owned file, one override surface

> Backlog detail doc — written 2026-08-23 as the companion to
> `26-08-22-config-consolidation.md`, after the terminal-tile-export follow-up
> (PR #686) surfaced that `rk update` never refreshes `~/.rk/tmux.conf` and the
> ensuing discussion surfaced the deeper problem: users hand-edit the main conf
> because the override surface is invisible, then lose their edits to the only
> refresh mechanism that exists (`init-conf --force`). Mechanisms below verified
> 2026-08-20–23 against main. Decisions recorded here were made in that session
> (rk-owned managed file, tmux.d/user.conf as the standard override, layered
> communication). Verify file/line anchors before implementing.

## Problem

Two coupled failures:

1. **rk's own defaults never reach existing installs.** The embedded conf is
   written to `~/.rk/tmux.conf` only when the file is MISSING (`EnsureConfig` at
   `rk serve` start — `cmd/rk/serve.go:122`). `rk update` never touches it, so
   fixes like `exit-empty off` (the server-death backstop), the extended-keys /
   csi-u block, or `history-limit 100000` reach only fresh installs. Ironically
   the RELOAD half already exists and fires constantly — `tmux.ReloadConfig`
   (`source-file`) runs best-effort on every relay WS attach
   (`api/terminals_ws.go:469`) plus `POST /api/tmux/reload-config` — but it
   re-sources the stale file forever.
2. **Users edit the managed file because the override surface is invisible.**
   The drop-in mechanism exists and is fully wired, but its only documentation
   is a comment at the BOTTOM of the conf and one README table row. So everyone
   edits `~/.rk/tmux.conf` directly, and the only way to pick up new rk defaults
   (`rk mux init-conf --force`) clobbers those edits. Nothing in install/update
   flows force-writes today — the overwrite loop is user-triggered, but it is
   the only refresh path we offer. An auto-refresh built without standardizing
   the override surface first would institutionalize the overwrite problem;
   this plan is therefore a prerequisite of the refresh, and they ship together.

## Inventory — every tmux-config mechanism today (verified 2026-08-23)

1. **Hand-editing `~/.rk/tmux.conf`** — the de-facto path. Unprotected; the
   do-not-edit hint is buried at the bottom; lost to any `--force` rewrite. The
   file's own header comment is stale (claims `~/.run-kit/tmux.conf`; the real
   path has been `~/.rk/tmux.conf` since the rename).
2. **`~/.rk/tmux.d/*.conf` drop-ins** — already wired end-to-end: the embedded
   conf's LAST line is `source-file -q ~/.rk/tmux.d/*.conf` (lexicographic
   order; sourced last, so user values win on conflicting options). The
   directory is created by every scaffold path (`EnsureConfig`,
   `ForceWriteConfig`, `rk mux init-conf`). Under-documented: one README row
   (`run-kit mux init-conf` table entry), the bottom-of-file comment, nothing
   on docs/site, nothing in `rk doctor`.
3. **`RK_TMUX_CONF` env var** (`internal/tmux/tmux.go` init) — full
   replacement: point rk at a different conf entirely; rk then manages nothing.
   Power-user/test escape. (Listed in the config-consolidation plan's phase-4
   stragglers as a candidate `config.yaml` key — see Relation below.)
4. **`rk mux init-conf [--force]`** (+ hidden root alias) and
   **`POST /api/tmux/init-conf`** (`ForceWriteConfig`) — the scaffold/refresh
   verbs; `--force` is today's only defaults-updater and it clobbers edits.
5. **Reload plumbing** — `tmux.ReloadConfig(server)` = `source-file
   <configPath>` on a named server: every relay WS attach (best-effort),
   `POST /api/tmux/reload-config`. Nothing calls it after a config WRITE.

## Design decisions

- **`~/.rk/tmux.conf` becomes rk-OWNED, declared by a managed header with a
  content hash at the TOP of the file**, e.g.
  `# rk-managed sha256:<hash-of-body> — DO NOT EDIT; overrides go in ~/.rk/tmux.d/`.
  The hash is of the managed body, stamped at write time. The header moves the
  do-not-edit signal to where every would-be editor actually looks; the hash
  makes "unmodified" a mechanical three-state check:
  - **missing** → write the embed (today's `EnsureConfig` behavior);
  - **managed and stale** (body hash matches its own stamp, embed differs) →
    force-write the new embed, then sweep `ReloadConfig` across LIVE rk servers;
  - **hand-edited** (hash mismatch, or header absent) → hands off entirely; a
    `rk doctor` drift line carries the migration recipe.
  A user who edits but keeps the old header line is correctly detected as
  modified (the stamp no longer matches the body).
- **Refresh runs at daemon start** (the `EnsureConfig` call site in serve
  startup), not on a timer — updates restart the daemon, so start-time is
  exactly when a new embed appears. The reload sweep enumerates live rk servers
  only, filtered to live sockets — any tmux command on a dead socket resurrects
  a server (known hazard), so the filter is load-bearing.
- **`~/.rk/tmux.d/user.conf` is the standard user override file**, scaffolded
  as a commented empty starter by every scaffold path (ensure/init/force). This
  is the "user_tmux.conf" idea realized INSIDE the already-sourced directory —
  zero new plumbing, a named, discoverable home for personal overrides, with
  numeric-prefixed sibling files (`10-*.conf`, `50-*.conf`) remaining available
  for ordering. No new mechanism is added; the existing one is crowned.
- **Hand-edited managed confs are never clobbered and never auto-migrated** —
  user intent cannot be reliably diffed out of a merged file. The doctor line
  (and the init-conf already-exists error) states the recipe: "move your
  customizations into ~/.rk/tmux.d/user.conf, then `rk mux init-conf --force`".
- **`RK_TMUX_CONF` unchanged**, documented as the "you own everything" mode —
  when set, rk performs no ensure/refresh/doctor on it.
- **Fix the stale header path** (`~/.run-kit/tmux.conf` → `~/.rk/tmux.conf`) in
  the same pass — or rather, the new managed header replaces that comment
  block entirely.
- **Expectation caveat, documented wherever the refresh is mentioned**:
  `history-limit`-class session options apply only to panes created AFTER the
  reload; nothing retrofits existing panes. (And alternate-screen TUI panes
  have no tmux scrollback at any limit — see memory
  `alt-screen-panes-defeat-capture-history`.)

## Communication — layered, cheapest-first

1. **The file itself**: the managed header at the top is the primary channel —
   it reaches exactly the person about to make the mistake, at the moment they
   are making it.
2. **`rk doctor`**: the drift line — reaches everyone who already made it.
3. **CLI**: `rk mux init-conf` success output and its "already exists (use
   --force)" error both name `tmux.d/user.conf`; `--force`'s help text notes it
   only touches the managed file, never `tmux.d/`.
4. **README + a short docs/site "Customizing tmux" section**: the durable
   reference — the standard override file, the drop-in ordering rule,
   `RK_TMUX_CONF`, and the new-panes-only caveat. (README/docs/site/CLI-help
   surfaces are bound by the shll toolkit standards — run `shll standards`
   before shaping them.)
5. **Not in the web app** — Constitution IV (minimal surface); this is a
   host/CLI concern. The settings pane planned in the config-consolidation
   companion is registry-driven instance settings, not a tmux.conf editor.

## Phasing

1. **Managed header + three-state refresh + reload sweep + user.conf scaffold +
   doctor line** — one fab change (backend `internal/tmux` + serve startup +
   doctor; unit tests for the three-state decision and the live-socket filter).
2. **Docs**: README section + docs/site page + CLI help/copy touches (same
   change or a docs-tail commit; standards-checked).

Small enough that 1+2 are likely a single change.

## Non-goals / guardrails

- No auto-migration of hand-edited confs (stated above).
- No new override mechanism — `tmux.d/` is promoted, not replaced.
- No timer/watcher-based refresh — daemon start only (Constitution: no
  supervisor creep; updates already restart the daemon).
- No web-app surface.
- No change to what the embedded conf CONTAINS (that is ordinary conf
  evolution; this plan is about ownership and delivery).

## Relation to the config-consolidation plan (the brainstorm hook)

`26-08-22-config-consolidation.md` decides `~/.config/run-kit/config.yaml`
(XDG, `run-kit` not `rk`) as the canonical settings home, while this plan — as
written — keeps `~/.rk/tmux.conf` + `~/.rk/tmux.d/`. That is a deliberate
open tension for the joint location brainstorm:

- Moving tmux config under `~/.config/run-kit/` (e.g. `tmux.conf` +
  `tmux.d/`) would give ONE config root for everything rk owns — but tmux.conf
  is not a settings-registry key (it is a whole rk-owned file with a user
  drop-in dir), so it would live BESIDE `config.yaml`, not inside it, and the
  move costs a path migration (`EnsureConfig` fallback-read + breadcrumb, the
  same pattern the consolidation plan uses for `settings.yaml`).
- `RK_TMUX_CONF` appears in both plans: consolidation phase 4 wants it demoted
  toward `config.yaml`; this plan keeps it as the full-replacement escape.
  Resolve together: a `tmux_conf` key in config.yaml could subsume the env var
  under the "code default < config.yaml < env (deployment only) < CLI flag"
  precedence.
- Whatever location wins, the OWNERSHIP model here (managed header + hash,
  tmux.d/user.conf as the override surface, three-state refresh) is
  location-independent and survives the move unchanged.

## Relation to in-flight work

Nothing in flight. PR #678 (terminal-tile export) and PR #686 (export honesty +
scrollback) are merged; this plan is the design source for the not-yet-drafted
refresh change. The `history-limit 100000` line already in the embed is the
first concrete beneficiary — most existing installs predate it.
