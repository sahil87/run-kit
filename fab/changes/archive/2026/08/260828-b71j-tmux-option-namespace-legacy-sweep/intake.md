# Intake: tmux Option Namespace + Legacy Sweep

**Change**: 260828-b71j-tmux-option-namespace-legacy-sweep
**Created**: 2026-08-28

## Origin

One-shot `/fab-draft` invocation, pointing at a pre-written plan document:

> Change 1 from fab/plans/sahil/26-08-28-tmux-option-scope-naming.md: run-kit namespace + legacy option-name migration sweep (fix). Read that plan files Change 1 section in full for exact scope, files, and acceptance criteria before drafting the intake.

The plan (`fab/plans/sahil/26-08-28-tmux-option-scope-naming.md`, drafted 2026-08-28 against `5bace0f3`) lays out a 4-change program moving every rk tmux user option to the `@rk_<scope>_<name>` scheme. **This intake covers Change 1 only** — the two keys currently outside the `@rk_` namespace (`@color`, `@session_color`) plus the generic legacy-option migration machinery that Changes 2 and 3 will later extend with more table rows. The plan's Change 2 (full rename of rk-private keys), Change 3 (externally-written keys, dual-read), and Change 4 (fab-kit) are explicitly **out of scope** here.

The rule of record already landed in `fab/project/context.md` § Conventions (2026-08-28): *"tmux user options are named `@rk_<scope>_<name>`, scope ∈ `srv` (`set -s`) · `ses` (bare `-t <session>:`) · `win` (`-w`) · `pane` (`-p`) — every key sits in the `@rk_` namespace and carries its scope in its name, and a name is never reused at another scope."* The option registry lives in `docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options.

Key decisions carried from the plan (see Assumptions for grading):
- Ship as a **separate PR** before Change 2; Change 2 rebases on this.
- Snapshots need **no on-disk migration** — `internal/snapshot` stores struct fields and only `restore.go` maps them to option names at restore time.
- The migration is **idempotent, logged per step, non-fatal** (Constitution II cold-start equivalence).
- Migration state is **in-memory only** (a per-daemon `migrated[server]` set) — no disk state (Constitution II).

Two deviations from the plan text discovered while verifying anchors at HEAD (`67f4a553`) are recorded in *What Changes* and *Assumptions*: (a) `tmux.RefreshSweep` is **not** a cadence — it runs only after a stale managed conf was force-written — so the sweep must hook the per-server `ReloadConfig` seams rather than a periodic loop; (b) `api/operator.go`'s color-tabs prompt instructs operator agents to run `tmux set-option -t @N '@color' …` directly, an rk-owned external writer the plan's target map omits.

## Why

**The bug class.** tmux format expansion resolves `#{@foo}` by walking **pane → window → session → global**. A user option set at an outer scope therefore shows up in every inner-scope read, and the inner-scope clear (`set-option -wu`) removes nothing because the inner scope never held it. Live symptom (2026-08-28): the `fabKit` session on server `fabKit1` carries a pre-split **session-scoped** `@color slate`; every window row in that session renders slate, and the window picker's "clear color" is a silent no-op. The operator unblocked it by hand with `tmux -L fabKit1 set-option -u -t 'fabKit:' @color`, which is exactly the kind of manual surgery rk should do for itself.

**Why the names are part of the fix.** The 22 current options avoid same-name/different-scope collisions today, but two keys — `@color` and `@session_color` — sit outside the `@rk_` namespace, so any tmux plugin, user `.tmux.conf`, or hand-typed command can collide with them (the `fabKit` leak was exactly a hand-set `@color` at the wrong scope). Moving them to `@rk_win_color` / `@rk_ses_color` puts them in the namespace, makes the scope readable from the name, and satisfies the context.md rule. The other 20 renames are Changes 2–3 (they need a dual-read window for hook-written keys); this change ships the two namespace escapees plus the machinery.

**Why a sweep, not just new names.** Renaming the code without touching existing servers would (1) strand every user's existing window/session colors (they'd vanish from the UI after upgrade), and (2) leave the wrong-scope `@color` that caused the bug in place. A one-shot, idempotent legacy sweep — copy old → new at the right scope, unset old, and **unset any legacy name found at a wrong scope** — is what actually removes the bug class rather than hiding it behind a rename. It also becomes the carrier Changes 2–3 extend with their rows, so it needs to be table-driven from day one.

**If we don't fix it.** The leak recurs whenever anyone sets `@color` at session or global scope (tmux plugins, muscle memory, an old conf), and rk has no self-healing path and no diagnostic (`rk doctor` is silent about it). Change 2's 15-row rename has nowhere to run without this machinery.

## What Changes

### 1. `internal/tmux` — option-name constants

Introduce two exported constants in `app/backend/internal/tmux/tmux.go` beside the existing `ManagedOption`/`HomeOption`/`BoardOrderOption` constants:

```go
// ColorOption is the window-scoped (-w) user option carrying a window's
// color descriptor ("4" / "1+3"). Scope-named per fab/project/context.md.
const ColorOption = "@rk_win_color"

// SessionColorOption is the session-scoped user option carrying a session's
// color descriptor. Distinct from ColorOption so hierarchical format
// lookup never leaks one scope's value into the other.
const SessionColorOption = "@rk_ses_color"
```

Retire every bare `"@color"` / `"@session_color"` literal in production code and re-point it at the constant. Verified sites at HEAD `67f4a553` (line numbers approximate):

| File | Sites |
|------|-------|
| `app/backend/internal/tmux/tmux.go` | `:860` session list format `#{@session_color}`; `:1127` window list format `#{@color}`; `:2323`/`:2331` `SetSessionColor`/`UnsetSessionColor`; `:2369`/`:2378` `SetWindowColor`/`UnsetWindowColor`; doc comments `:717`, `:975`, `:2313-2344`, `:2361-2373` |
| `app/backend/internal/tmux/layout.go` | `:70` `#{@session_color}`, `:83` `#{@color}` (snapshot-capture formats); comment `:27` |
| `app/backend/internal/snapshot/restore.go` | `:335` `add("@color", win.Color)` → `add(tmux.ColorOption, win.Color)`; the session-color restore literal in the same block |
| `app/backend/internal/snapshot/snapshot.go` | `:48` comment |
| `app/backend/internal/sessions/sessions.go` | `:23` comment |
| `app/backend/api/windows.go` | `:366` `optKeyColor = "@color"` → `tmux.ColorOption` (the `POST /api/windows/{id}/options` allowlist — Constitution I closed key set); comments `:444`, `:569` |
| `app/backend/api/sessions.go` | `:150` `handleSessionColor` (comment; calls `SetSessionColor`) |
| `app/backend/api/sse.go` | `:1748` comment |
| `app/backend/api/operator.go` | `:54` comment; **`:440`, `:446`, `:452`** — the color-tabs prompt text sent to operator agents (`tmux set-option -t @N '@color' '<value>'`, `-u '@color'`, "set only the three named options (@color, …)") → `@rk_win_color`. This is an rk-owned writer the plan's target map lists as "no external writers"; it MUST move with the code or operator agents will keep writing the legacy key. `operator_test.go:954/:961/:1100` assert the prompt text and move too. |

Frontend (`app/frontend/src`):
- `api/client.ts:753-756` — `setWindowColor` POSTs `{ "@rk_win_color": color }` instead of `"@color"`; doc comment `:440` (allowlisted keys) and `:1038` (`@session_color` descriptor) updated. `setSessionColor` posts to `/api/sessions/{s}/color` (server-side key), so only its comments change — verify.
- `types.ts:92` comment.
- `api/client.test.ts:670-709` — the three `setWindowColor` assertions re-pointed at `@rk_win_color`.
- `tests/e2e/window-marker-gutter.spec.ts:14,202-218,308-310` — POSTs `@color` via the options API; re-point (and its `.spec.md` companion if step text names the key — Constitution Test Companion Docs).

Nothing else is user-visible: the read side (`ListWindows`/`ListSessions` format fields) keeps its field positions; only the format literal changes.

### 2. `internal/tmux` — `MigrateLegacyOptions`

New file `app/backend/internal/tmux/legacy_options.go` (name at implementer's discretion; keep it in `internal/tmux` — code-quality.md: all tmux interaction goes through `internal/tmux/`).

```go
// optionScope selects the set-option flag and the carrier enumeration.
type optionScope int
const (
    scopeServer  optionScope = iota // set-option -s        ; one carrier: the server
    scopeSession                    // set-option -t <ses>: ; carriers: list-sessions
    scopeWindow                     // set-option -w -t @N  ; carriers: list-windows -a
    scopePane                       // set-option -p -t %N  ; carriers: list-panes -a
)

type legacyOption struct {
    Old   string      // legacy name, e.g. "@color"
    New   string      // target name, e.g. ColorOption; "" = unset-only row
    Scope optionScope // the ONE scope the name is legitimate at
}

// legacyOptions is the migration table. Changes 2 and 3 append rows here.
var legacyOptions = []legacyOption{
    {Old: "@color",         New: ColorOption,        Scope: scopeWindow},
    {Old: "@session_color", New: SessionColorOption, Scope: scopeSession},
}

// MigrateLegacyOptions moves every legacy user option on `server` to its
// scope-named successor and removes legacy names found at any scope.
// Idempotent; per-step logged; never returns a fatal error to callers that
// must not fail (Constitution II — a failed or skipped sweep leaves the
// server exactly as cold-start would).
func MigrateLegacyOptions(ctx context.Context, server string) error
```

Per row, the algorithm:

1. **Right-scope move.** Enumerate carriers at `row.Scope` with a format carrying both names — e.g. for window scope `list-windows -a -F '#{window_id}\t#{@color}\t#{@rk_win_color}'` (session scope: `list-sessions -F '#{session_name}\t…'`, using `=name:` targets when writing — see memory `tmux-bare-session-target-window-collision`; server scope: `show-options -sv`). For every carrier where **old is non-empty at that scope** (use `show-options -<flag>v -t <target> @old` to confirm the value is *held* at this scope, not inherited — the enumeration format alone cannot distinguish): if new is unset, `set-option <flag> -t <target> @new <value>`; then `set-option <flag>u -t <target> @old`. If new is already set, leave new untouched and only unset old.
2. **Wrong-scope purge.** For every scope ≠ `row.Scope` (server, every session, every window, every pane), where `show-options -<flag>v -t <target> @old` reports a value held at that scope, `set-option <flag>u -t <target> @old`. Values are **not** copied forward from a wrong scope — a session-level `@color` was never a legitimate window color. Do NOT purge the *new* name at wrong scopes in this change (nothing writes it there yet; keep the sweep minimal).
3. Each set/unset logs at `slog.Info` with `server`, `option`, `scope`, `target` fields; each failure logs `slog.Warn` and continues to the next carrier. Return value: the first error encountered (for tests/`rk mux adopt` reporting); callers on daemon paths ignore it after logging.
4. All tmux calls go through the existing `tmuxExecServer`/`tmuxExecRawServer` runner helpers (Constitution I — argv slices, `exec.CommandContext`, `TmuxTimeout`).

Idempotency contract: a second run on the same server issues zero `set-option` calls.

### 3. Hook points — once per server per daemon lifetime

The plan says "hook the migration into the managed-conf apply path so it runs once per server per daemon lifetime". At HEAD the managed-conf apply is **not periodic**: `tmux.RefreshSweep` (`managedconf.go:215`) runs only when a stale managed conf was force-written at daemon start. The reliable per-server seams are the `ReloadConfig` call sites. Wire the sweep as follows:

- Add an unexported package-level guard in `internal/tmux`: `legacyMigrated sync.Map` (or mutex + `map[string]bool`) keyed by server name, plus `MigrateLegacyOptionsOnce(ctx, server)` that checks-and-marks **before** running so concurrent WS attaches don't double-run. Mark on attempt, not on success — a failing server must not be re-swept on every attach (log once; `rk mux adopt` / daemon restart retries).
- Call `MigrateLegacyOptionsOnce` from:
  1. `tmux.RefreshSweep` — per managed server, after `sweepReloadConfig`.
  2. `api/terminals_ws.go` `reloadConfigForAttach` — after the managed check passes (this is the seam that hits every server a browser ever opens, i.e. the "cadence" the plan assumed).
  3. `api/servers.go` adopt handler (`POST /api/servers/adopt`, `:362`) and `cmd/rk/mux_adopt.go` `runMuxAdopt` (`:108`) — after the successful reload; for the CLI, run the sweep unconditionally (not `Once`) and print a one-line summary (`migrated N option(s)` / `no legacy options`), since the CLI is the operator's explicit retry.
  4. `api/tmux_config.go` `handleTmuxReloadConfig` (`POST /api/tmux/reload-config`) — after reload.
- **Managed-only.** Every daemon-side call site is already gated on `IsManagedServer`; the sweep MUST keep that gate — rk never rewrites options on a server it did not birth or adopt (same rule as the conf reload).
- Add a seam var (`sweepMigrateLegacy = MigrateLegacyOptionsOnce` etc.) matching the existing `sweepReloadConfig`/`attachReloadConfig` test-substitution pattern so handler tests can assert the call without a live tmux.
- After a sweep that changed anything on a daemon path, wake the SSE hub so the sidebar repaints without waiting for the 12s safety poll (memory `row-color-safety-poll-latency`; the adopt handler already wakes the hub — reuse that path).

### 4. `rk doctor` row

Add `legacyOptionsCheck()` in `app/backend/cmd/rk/doctor.go`, modelled on `ephemeralServersCheck` (`:148`): always OK-shaped (informational, never flips the verdict), enumerates live servers via the same live-socket-probed `ListServers` (never touch a dead socket — memory `tmux-client-cmd-resurrects-stale-sockets`), and for each server asks `internal/tmux` for a count of legacy names still present at any scope (expose a `CountLegacyOptions(ctx, server) (int, error)` sibling that shares the table and enumeration with the migrator — no second copy of the walk). Row name `legacy tmux options`; note `none` when clean, else `N server(s) still carry legacy option names (@color/@session_color) — attach from the dashboard or run \`rk mux adopt <server>\` to sweep`. Include external (unmanaged) servers in the count with a distinct phrasing (`… of which M external — rk will not rewrite those`), because the doctor row is diagnostic and the unmanaged case is exactly the one the daemon will never heal. `--json` carries the note verbatim (toolkit-standards).

### 5. Docs

- `docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options: rename the `@color` and `@session_color` rows to `@rk_win_color` / `@rk_ses_color`; add a **Legacy names** column (populated for these two rows, `—` elsewhere); add a short § Legacy Option Migration subsection documenting the table, the right-scope-move / wrong-scope-purge algorithm, the once-per-daemon guard, the hook seams, and the doctor row. Update the prose paragraph that says "session color is `@session_color` while window color is `@color`".
- `docs/memory/run-kit/layout-snapshots.md` — restore-time option literal now `tmux.ColorOption`/`SessionColorOption` (mention only if the file names the literal).
- `docs/memory/run-kit/operator-actuation.md` — the color-tabs prompt names the new key.
- `docs/memory/run-kit/ui/*.md` — any `@color` mention in the label-picker / sidebar docs.
- `docs/memory/run-kit/toolkit-standards.md` / `rk doctor` help text if a doctor row list exists there.
- `fab/project/context.md` rule already links the registry — no change.

### 6. Tests

- **Migration unit on a real test socket** (pattern: existing `tmux_test.go` socket tests / `snapshot/integration_test.go:78`, which already seeds `@session_color` via `set-option -t =alpha:`): (a) legacy at right scope → value moved to new name, old unset; (b) legacy at wrong scope (session-level `@color`, the `fabKit` case; also a global `@color` via `set-option -g`) → unset, nothing copied; (c) new already set + old set → old unset, new value untouched; (d) second run → zero `set-option` calls (assert via the seam or by diffing `show-options` output); (e) failure on one carrier → others still processed, error returned.
- `MigrateLegacyOptionsOnce` guard: second call same server → no-op; different server → runs.
- Handler/CLI seam tests: `terminals_ws` pre-attach path calls the sweep only for managed servers; adopt handler + `rk mux adopt` call it; `reload-config` endpoint calls it.
- `doctor_test.go`: `legacyOptionsCheck` note shapes (none / N servers / external phrasing), always OK.
- Re-point existing color read/write tests at the new names: `tmux_test.go:190,1934-1956` and every format-fixture comment; `windows_test.go` (all `@color` POST bodies — ~15 sites); `operator_test.go:954,961,1100`; `snapshot/restore_test.go:150` (`window-opts @1 @color=2,…` fixture); `snapshot/integration_test.go:78`; frontend `client.test.ts:670-709`; e2e `window-marker-gutter.spec.ts`.
- **e2e against legacy-seeded server** (plan's sequencing note): one Playwright spec (or a step in `window-marker-gutter.spec.ts`) seeds a session-scoped `@color` on the e2e server before attach and asserts the window rows are NOT tinted after connect and the picker's clear works — this is the regression test for the actual bug. Run via `just test-e2e "<spec>"`, never raw playwright.

### 7. Manual verification (operator, post-merge)

```
tmux -L fabKit1 list-sessions -F '#{session_name} [#{@color}] [#{@rk_ses_color}]'
```
shows `fabKit [] []` after the daemon's first attach-time sweep; window picker "clear color" works; `rk doctor` shows `legacy tmux options: none`.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) registry rows for the two renamed keys, new Legacy-names column, new § Legacy Option Migration (table, algorithm, hook seams, once-guard, doctor row)
- `run-kit/layout-snapshots`: (modify) restore-time literal → `tmux.ColorOption`/`SessionColorOption`, if named
- `run-kit/operator-actuation`: (modify) color-tabs prompt writes `@rk_win_color`
- `run-kit/architecture`: (modify) only if it enumerates `ReloadConfig` seams — add the sweep hook
- `run-kit/toolkit-standards`: (modify) `rk doctor` row list, if enumerated
- `run-kit/ui/*`: (modify) any label-picker/sidebar mention of `@color`

## Impact

- **Backend** (`app/backend`): `internal/tmux` (constants, new migrator + once-guard + count helper, `RefreshSweep` hook), `internal/snapshot/restore.go`, `api/windows.go` allowlist, `api/operator.go` prompt, `api/terminals_ws.go`, `api/servers.go` adopt, `api/tmux_config.go`, `cmd/rk/doctor.go`, `cmd/rk/mux_adopt.go`. All new subprocess calls via existing runner helpers (Constitution I). No new disk state (Constitution II).
- **Frontend** (`app/frontend/src`): `api/client.ts` key string + comments, `types.ts` comment; unit + e2e test literals.
- **API surface**: `POST /api/windows/{id}/options` accepts `@rk_win_color` and **rejects** `@color` (400, closed allowlist) — a hard cut, no dual-accept, since the only clients are this repo's frontend and rk-authored operator prompts. `POST /api/sessions/{s}/color` unchanged.
- **Upgrade behavior**: existing colors survive via the sweep on first attach/adopt/reload; a server never attached after upgrade keeps legacy names until touched (doctor reports it). External (unmanaged) servers are never rewritten.
- **Downstream**: Changes 2 and 3 extend `legacyOptions`; Change 4 (fab-kit) is untouched by this change (fab-kit reads only `@rk_agent_state`).
- **Scale**: ~15 production files, ~10 test files, 3–5 memory files. SMALL.

## Open Questions

- None blocking. See Assumptions #6, #7, #10 for the judgment calls made where the plan text and HEAD diverge.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is plan Change 1 only: `@color`→`@rk_win_color`, `@session_color`→`@rk_ses_color`, plus table-driven `MigrateLegacyOptions` machinery; Changes 2–4 excluded | User named Change 1 explicitly; plan section read in full | S:95 R:90 A:95 D:95 |
| 2 | Certain | Target names `@rk_win_color` / `@rk_ses_color`; constants `ColorOption` / `SessionColorOption` in `internal/tmux` | Verbatim from plan target map + Change 1 text; matches context.md rule | S:95 R:85 A:95 D:95 |
| 3 | Certain | `change_type = fix` | Plan's execution notes: "1 = `fix`" | S:95 R:95 A:95 D:95 |
| 4 | Certain | No on-disk migration state — in-memory `migrated[server]` set only; sweep idempotent, per-step logged, non-fatal | Plan text + Constitution II | S:90 R:80 A:95 D:95 |
| 5 | Certain | Wrong-scope legacy values are unset, never copied forward | Plan: "Also unset any legacy name found at a wrong scope"; a session-level `@color` was never a legitimate window color | S:90 R:80 A:90 D:90 |
| 6 | Confident | Sweep hooks at the `ReloadConfig` call seams (`RefreshSweep`, pre-attach reload, adopt handler, `rk mux adopt`, reload-config endpoint), not a periodic loop | Plan assumed the managed-conf path "visits every managed server on a cadence"; at HEAD `RefreshSweep` runs only after a force-written stale conf. The attach seam is the real per-server touchpoint. Reversible — one extra call site either way | S:75 R:80 A:80 D:70 |
| 7 | Confident | `api/operator.go` color-tabs prompt text moves to `@rk_win_color` in this change (plus its tests) | Plan's target map says `@color` has no external writers, but the operator prompt is an rk-owned writer instructing agents to set bare `@color`; leaving it would keep re-creating legacy keys. rk owns the text | S:80 R:90 A:90 D:85 |
| 8 | Confident | `POST /options` allowlist is a hard cut — accepts `@rk_win_color`, rejects `@color` with 400; no dual-accept | Only callers are this repo's frontend and rk-authored prompts, both updated in the same PR; a closed set is the Constitution I posture | S:70 R:85 A:85 D:75 |
| 9 | Confident | Once-guard marks on *attempt*, not success; `rk mux adopt` runs the sweep unconditionally and prints a summary | Prevents per-attach retry storms on a broken server while giving the operator an explicit retry verb | S:60 R:90 A:80 D:70 |
| 10 | Confident | Doctor row counts external (unmanaged) servers too, with distinct phrasing; daemon sweep stays managed-only | Doctor is diagnostic; the unmanaged case is exactly what the daemon will never heal, so hiding it defeats the row. Rewrite gate mirrors the existing conf-reload rule | S:65 R:90 A:80 D:70 |
| 11 | Confident | "Held at this scope" is determined with `show-options -<flag>v -t <target>` per carrier, not the inherited format value | tmux formats inherit; only `show-options` at a scope reports what that scope holds. Needed for wrong-scope purge correctness | S:70 R:85 A:85 D:80 |
| 12 | Tentative | New `legacy_options.go` file in `internal/tmux` rather than appending to `tmux.go` | `tmux.go` is ~3k lines; a table-driven migrator Changes 2–3 will grow deserves its own file. Implementer may fold in if project pattern prefers | S:50 R:95 A:60 D:55 |
| 13 | Tentative | Frontend test-fixture / `data-*` attribute sweep limited to the sites found by grep at HEAD; no rename of any `color`-named TS identifiers | Only the tmux key string changes; TS field names (`win.Color`) are internal and untouched | S:55 R:90 A:70 D:60 |

13 assumptions (5 certain, 6 confident, 2 tentative, 0 unresolved).
