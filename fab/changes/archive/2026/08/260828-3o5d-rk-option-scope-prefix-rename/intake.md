# Intake: rk Option Scope-Prefix Rename (rk-private keys)

**Change**: 260828-3o5d-rk-option-scope-prefix-rename
**Created**: 2026-08-28

## Origin

> Change 2 from fab/plans/sahil/26-08-28-tmux-option-scope-naming.md: run-kit full at-rk-scope-name rename for the 16 rk-private option rows (refactor). Read that plan files Change 2 section in full before drafting the intake. Note in the intake that this change depends on Change 1 (namespace and legacy sweep) having landed first -- it rebases on Change 1s renamed constants and extends the same migration table.

One-shot `/fab-draft` from the operator's plan document `fab/plans/sahil/26-08-28-tmux-option-scope-naming.md` § Change 2 (drafted 2026-08-28 against `5bace0f3`). Two clarifying questions were asked during intake:

1. **Externally-written window keys inside the "rk-private" 16** (`@rk_note`, `@rk_type`, `@rk_url`) — user chose **dual-read for now**: readers accept both old and new names, legacy support is removed in a later release, and the plan must carry an explicit **deprecation ledger** of everything to delete after a few releases.
2. **`@rk_owner` spec mentions** (never shipped in code) — user chose **remove the mentions** from `docs/specs/right-panel.md` and `docs/specs/surface-layout.md`.

### Dependency — Change 1 MUST land first

This change **depends on Change 1** of the same plan (run-kit · Namespace + Legacy Sweep: `@color` → `@rk_win_color`, `@session_color` → `@rk_ses_color`, new `tmux.MigrateLegacyOptions`, `rk doctor` legacy-count row). At intake time (2026-08-28, `67f4a553`) **Change 1 has not been drafted or merged** — there is no `MigrateLegacyOptions` in `app/backend/internal/tmux/` and `@color`/`@session_color` are still bare literals. This change:

- **rebases on Change 1's renamed constants** (`tmux.ColorOption`, `tmux.SessionColorOption`) and does not re-touch the two color keys;
- **extends Change 1's `MigrateLegacyOptions` table** with the rows below — it does not introduce a second migration mechanism;
- ships as a **separate PR** after Change 1's PR (plan § Sequencing note). If apply begins before Change 1 has merged, STOP and report — do not reimplement Change 1's pieces here.

## Why

**Problem.** tmux resolves `#{@foo}` by walking pane → window → session → global, so a user option set at an outer scope leaks into every inner-scope read, and an inner-scope `set-option -u` cannot clear it. The current `@rk_*` names carry no scope information (`@rk_role` is window-scoped, `@rk_origin` server-scoped, `@rk_chat` pane-scoped — the names look identical), the pin-session trio (`@rk_board`/`@rk_home`/`@rk_board_order`) is named for the concept rather than the carrier, `@rk_type` and `@rk_home` are generic, and `@rk_ctl_keepalive` has no reader at all. The "one name, one scope" rule (`fab/project/context.md` § Conventions) is currently held by discipline alone.

**Consequence of not doing it.** Every new option is another chance to reintroduce the `fabKit` `@color slate` leak class (a session-scoped stray painting every window in the session — the bug that triggered the plan). Reviewers cannot see scope collisions from a diff; `show-options` output does not sort by scope; the registry table has to be consulted for every read.

**Why this approach.** The target scheme `@rk_<scope>_<name>` with scope ∈ `srv` · `ses` · `win` · `pane` makes the invariant self-documenting and sortable. Change 1 already builds the migration machinery (per-row `{old, new, scope}` table, wrong-scope unset, idempotent, once per server per daemon lifetime) for the two out-of-namespace keys; this change is the mechanical-but-wide application of the same scheme to the remaining rk-private rows. The four externally-written keys (`@rk_ephemeral`, `@rk_protected`, `@rk_agent_state`, `@rk_chat`) are **excluded** — they need a hook-generation-gated dual-read window and are Change 3 (run-kit) + Change 4 (fab-kit).

Change type is **refactor**: no user-visible behavior changes; option names on the tmux substrate change, with a migration so existing servers converge.

## What Changes

### 1. Target map for this change (15 renames + 1 delete)

| Current | Target | Scope | tmux flag | Constant today | Notes |
|---|---|---|---|---|---|
| `@rk_type` | `@rk_win_lens` | window | `-w` | `optKeyRkType` (api/windows.go:368), `presentTypeOption` (cmd/rk/present.go:111), literal in layout.go:84, restore.go | **dual-read** (see § 4) |
| `@rk_url` | `@rk_win_url` | window | `-w` | `optKeyRkURL` (api/windows.go:367), `presentURLOption` (cmd/rk/present.go:109), literal in layout.go:85, restore.go | **dual-read** (see § 4) |
| `@rk_present_root` | `@rk_win_present_root` | window | `-w` | `presentRootOption` (api/present.go:36 AND cmd/rk/present.go:110 — two copies) | |
| `@rk_marker` | `@rk_win_marker` | window | `-w` | `optKeyMarker` (api/windows.go:369), literal in layout.go:86, restore.go | |
| `@rk_flair` | `@rk_win_flair` | window | `-w` | `optKeyFlair` (api/windows.go:371), literal in layout.go:88, restore.go | |
| `@rk_note` | `@rk_win_note` | window | `-w` | `tmux.NoteOption` (tmux.go:94), `optKeyNote` (api/windows.go:372), literal in layout.go:91, restore.go | **dual-read** (see § 4) |
| `@rk_role` | `@rk_win_role` | window | `-w` | `tmux.RoleOption` (tmux.go:85), `optKeyRole` (api/windows.go:370), literal in layout.go:87, restore.go, cmd/rk/role.go | |
| `@rk_session_flair` | `@rk_ses_flair` | session | (none) | bare literal `"@rk_session_flair"` in tmux.go:860,2349,2358 — **no constant today**; introduce `tmux.SessionFlairOption` | |
| `@rk_board` | `@rk_ses_pin_board` | session on `_rk-pin-*` | (none) | `tmux.BoardOption` (board.go:21) | |
| `@rk_home` | `@rk_ses_pin_home` | session on `_rk-pin-*` | (none) | `tmux.HomeOption` (board.go:22) | |
| `@rk_board_order` | `@rk_ses_pin_order` | session on `_rk-pin-*` | (none) | `tmux.BoardOrderOption` (board.go:23) | |
| `@rk_ctl_keepalive` | **delete** | session on `_rk-ctl` | (none) | `tmuxctl.AnchorKeepaliveOption` (tmuxctl/client.go:26) | unset-only migration row |
| `@rk_session_order` | `@rk_srv_session_order` | server | `-s` | `tmux.SessionOrderOption` (tmux.go:25) | |
| `@rk_server_rank` | `@rk_srv_rank` | server | `-s` | `tmux.ServerRankOption` (tmux.go:31) | |
| `@rk_origin` | `@rk_srv_origin` | server | `-s` | `tmux.OriginOption` (tmux.go:43) | |
| `@rk_managed` | `@rk_srv_managed` | server | `-s` | `tmux.ManagedOption` (tmux.go:77) | |

**Not touched by this change** (explicit non-goals): `@rk_win_color`/`@rk_ses_color` (Change 1), `@rk_ephemeral`, `@rk_protected`, `@rk_agent_state`, `@rk_chat` (Change 3/4). Constants `EphemeralOption`, `ProtectedOption`, `AgentStateOption`, `ChatOption` keep their current values.

**Constant naming convention.** Go constant identifiers keep their current names where they exist (`RoleOption`, `NoteOption`, `BoardOption`, …) — only the string values change — except where a new constant is introduced (`SessionFlairOption`) or a duplicate is consolidated (`presentRootOption` in `api/present.go` and `cmd/rk/present.go` → one exported `tmux.PresentRootOption`; likewise `presentURLOption`/`presentTypeOption` and `api/windows.go`'s `optKey*` block should reference `tmux.*Option` exports rather than re-declaring literals, so the name lives in exactly one place per key).

### 2. Backend — constants and every raw literal

Files with `@rk_`/`#{@` literals outside tests at intake time (verified `67f4a553`):

- `app/backend/internal/tmux/tmux.go` — constants at :25,31,43,77,85,94; `ListSessions` format at :860 (`#{@rk_session_flair}`); `SetSessionFlair`/`UnsetSessionFlair` at :2349/:2358; every other `@rk_role`/`@rk_note`/`@rk_session_order`/… literal or format field.
- `app/backend/internal/tmux/board.go` — `BoardOption`/`HomeOption`/`BoardOrderOption` values.
- `app/backend/internal/tmux/layout.go` — snapshot capture format fields :70–91 (`#{@rk_type}`, `#{@rk_url}`, `#{@rk_marker}`, `#{@rk_role}`, `#{@rk_flair}`, `#{@rk_note}`); the field-index comments (`Field 11 (@rk_role)` …) follow. Note `@rk_note` MUST stay the last field (free text, tab-delimited).
- `app/backend/internal/tmux/pane_target.go` — comment mentions only.
- `app/backend/internal/snapshot/restore.go` `windowOptionOps` (:335–341) — the restore-time literal map (`add("@rk_type", win.RkType)` …) → new names. **No on-disk snapshot migration**: snapshots store struct fields (`win.Color`, `win.RkType`, `win.Role` …), so only these literals change.
- `app/backend/api/windows.go` — `optKey*` block :366–372 and the `POST /api/windows/{windowId}/options` allowlist; handler comments :444–486.
- `app/backend/api/present.go:36` `presentRootOption`.
- `app/backend/cmd/rk/present.go:109–111`, `cmd/rk/role.go` (incl. `Long:` help text at :42 — **Toolkit-standards pass required**, Constitution § Toolkit Standards: run `shll standards` and check the governing standard before changing help output), `cmd/rk/notify.go`, `cmd/rk/origin.go`, `cmd/rk/url.go`, `cmd/rk/mux.go`, `cmd/rk/mux_send.go`, `cmd/rk/mux_adopt.go`, `cmd/rk/serve.go` (comment mentions).
- `app/backend/internal/tmuxctl/client.go` — delete `AnchorKeepaliveOption` (:26), `setAnchorKeepalive` (:654) and its call site (:503); update `tmuxctl/doc.go:29`. The `_rk-ctl` anchor is identified by `tmux.ControlAnchorSessionName` already — no replacement marker.

### 3. Migration table extension

Extend Change 1's `MigrateLegacyOptions` table with the 16 rows above: 15 `{old, new, scope}` copy-then-unset rows, plus `@rk_ctl_keepalive` as an **unset-only** row (no `new`). Semantics are Change 1's verbatim: per row enumerate carriers at the row's scope; where old is set, `set-option <flag> -t <target> @new <value>` if new is unset, then unset old; unset any legacy name found at a wrong scope; idempotent; every step logged; failures non-fatal (Constitution II cold-start equivalence). The `_rk-pin-*` rows and `@rk_ses_flair` are session-scope rows (bare `-t <session>`, no flag — plan § Execution notes: `-s` would hit the server scope and do nothing).

**Dual-read rows** (`@rk_note`, `@rk_type`, `@rk_url` — see § 4) migrate normally (copy-forward then unset old): the sweep converges existing carriers; the dual-read exists to catch **post-sweep** legacy writes from stale agent/operator text until the next sweep.

### 4. Dual-read for the three externally-written window keys (user decision)

`@rk_note` (registry documents operators/agents writing it via `set-option -wt "$TMUX_PANE"`), `@rk_type` and `@rk_url` (documented in `docs/site/skill.md:63` read snippet and `docs/site/skill/display.md` § Appendix manual recipe as direct `tmux set-option -w` writes) have writers outside rk's binary. Change 1's sweep runs once per server per daemon lifetime, so a legacy write after the sweep would otherwise be invisible until daemon restart.

Decision: **readers accept both names, new wins when both are set; writers switch to the new names now.**

- `layout.go` window capture format: add `#{@rk_win_lens}`, `#{@rk_win_url}`, `#{@rk_win_note}` fields alongside the legacy `#{@rk_type}`, `#{@rk_url}`, `#{@rk_note}` fields; parser prefers new, falls back to old. `@rk_note`/`@rk_win_note` free-text constraint: both note fields must be the trailing fields (put legacy `@rk_note` last, new `@rk_win_note` second-to-last, or capture the note pair via a separate `show-options` read — apply decides, records in plan Design Decisions). Field-count comments updated.
- `ListWindows` format (tmux.go) — same treatment for the window fields it carries (`@rk_type` field 9, `@rk_url` field 10, note field).
- `tmux.GetWindowOption` callers for `@rk_url`/`@rk_present_root` in `api/present.go` and `cmd/rk/present.go`: read new then old for `@rk_url` only (`@rk_present_root` has no external writer and is a hard rename).
- Writers (`POST /options` handler, `rk present`, `CreateWindowWithOptions`, frontend `client.ts`, `rk` CLI) write **only** the new names.
- **No dual-read** for the other 12 renamed keys — hard rename.
- The plan's `## Requirements` MUST carry a **`### Deprecated Requirements` / deprecation ledger** listing, per item, what is removed in the follow-up release: the three legacy format fields + parser fallbacks, the legacy `GetWindowOption` fallback, the legacy rows in the registry's **Legacy names** column, and the `docs/site` mentions of the old names. Mirror the ledger into `docs/memory/run-kit/tmux-sessions.md` so the follow-up ("run-kit · remove legacy reads", plan § Follow-up) has a checklist to execute.

### 5. Frontend

- `app/frontend/src/api/client.ts` — `/options` payload keys: `"@rk_url"` (:465), `"@rk_marker"` (:769), `"@rk_role"` (:784), `"@rk_flair"` (:798), `"@rk_note"` (:813); doc comments at :440,:762,:775,:790,:805,:862,:875. `"@color"` (:756) is Change 1's.
- Comment/doc mentions in `lib/window-view.ts`, `lib/surface-layout.ts`, `lib/palette/move.ts`, `lib/palette/server-adopt.ts`, `lib/web-url.ts`, `lib/present-auto-expand.ts`, `lib/web-zoom.ts`, `app.tsx` (:913,2343,2450,2506,2610,2639,2641,2726,3187) — rename in prose; `swatch-popover.tsx` has no `@rk_` mention at intake time (plan note stale — verify, skip if none).
- Unit tests naming the keys: `lib/window-view.test.ts`, `lib/surface-layout.test.ts`, `api/client.test.ts`, `components/host-overview-page.test.tsx`, `components/iframe-window.test.tsx`, `components/sidebar/row-flyout-card.test.tsx`, `components/sidebar/index.test.tsx`.
- Playwright specs that **stamp options directly via tmux or the options API** (must use new names, and their `.spec.md` companions updated in the same commit — Constitution § Test Companion Docs): `compose-strip.spec.ts:89` (`@rk_url`), `web-tile-chrome.spec.ts:43–44,152,183,208` (`@rk_url`, `@rk_present_root`), `operator-pinned-row.spec.ts:26,65,86` (`@rk_role`), `top-bar-overflow.spec.ts:515` (`@rk_url`), plus any in `web-view-lens`, `present-auto-expand`, `window-marker-gutter`, `sort-windows`, `session-reorder`, `server-reorder`, `right-panel`, `code-surface`, `web-tile-zoom`, `web-tile-find`, `surface-layout`, `connection-budget`, `protected-kill-confirm` (grep-verified list of files mentioning the keys; many are comment-only).

### 6. Docs

- `docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options — **registry table rewritten in target order, grouped by scope** (`srv` → `ses` → `win` → `pane`), with the **Legacy names** column Change 1 introduces filled for every renamed row; `@rk_ctl_keepalive` row removed; § boards prose renamed; deprecation ledger appended (see § 4).
- Other memory files with old names (grep-verified): `architecture.md`, `api-and-sockets.md`, `layout-snapshots.md`, `configuration.md`, `agent-messaging.md`, `daemon-lifecycle.md`, `operator-actuation.md`, `test-sockets.md`, `toolkit-standards.md`, `ui/keyboard-and-palette.md`, `ui/boards.md`, `ui/dialogs-and-state.md`, `ui/status-signals.md`, `ui/lenses-and-layout.md`, `ui/sidebar.md`, `index.md`. `log.md`/`log.seed.md` are historical — leave untouched.
- Specs: `docs/specs/surface-layout.md` (`@rk_type` retirement map → `@rk_win_lens`; :208 row lists `@rk_owner` — remove that key from the row), `docs/specs/window-views.md`, `docs/specs/cli-layering.md`, `docs/specs/themes.md`, `docs/specs/agent-state.md` (only where it names a Change-2 key; `@rk_agent_state` itself is Change 3), `docs/specs/right-panel.md` — **remove the `@rk_owner` mentions** (:10,:21,:98,:168–190 § Companion Windows) and the `@rk_owner` phrase in `docs/specs/index.md:31`. `@rk_owner` never shipped in code (zero hits in `app/`, `scripts/`); the parked companion-windows change re-introduces its option under the new scheme when resumed.
- Public agent-facing docs (toolkit-standards governed — `docs/site/`): `docs/site/skill.md:63,87` and `docs/site/skill/display.md:41,52,68–70,86–87,90` → new names. The manual-recipe appendix targets "older rk versions"; after this change it should show the new names and note the legacy names are still read for now.
- `README.md:202` (`@rk_board` → `@rk_ses_pin_board`).
- `docs/wiki/*.html` design studies — historical, leave untouched.

### 7. Tests

- Go: `internal/tmux/tmux_test.go`, `board_test.go`, `snapshot/restore_test.go`, `snapshot/integration_test.go`, `cmd/rk/present_test.go`, `notify_test.go`, `role_test.go`, `url_test.go`, `origin_test.go`, `api/sessions_test.go`, `operator_test.go`, `windows_test.go` — literals re-pointed.
- Snapshot round-trip test asserts the new names on restore.
- Migration test (extends Change 1's, real test socket): a server pre-seeded with **all 16 legacy names at their correct scopes** → fully renamed, `@rk_ctl_keepalive` gone, second run no-op; a legacy name at a wrong scope → unset.
- Dual-read tests: window with only `@rk_note` legacy set → note read; only new → read; both → new wins. Same for `@rk_type`/`@rk_url`.
- e2e: per plan § Sequencing, the PR's e2e must run against a server **pre-seeded with legacy names** to exercise the sweep (extend `scripts/test-e2e.sh` seeding or a dedicated spec).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) registry table regrouped by scope with Legacy names filled; `@rk_ctl_keepalive` row removed; boards prose renamed; deprecation ledger for the three dual-read keys
- `run-kit/architecture`: (modify) option-name mentions (`@rk_origin`, `@rk_managed`, `@rk_session_order`, …)
- `run-kit/layout-snapshots`: (modify) capture format fields / restore literal map under new names; dual-read fields documented
- `run-kit/ui/boards`: (modify) `_rk-pin-*` option names → `@rk_ses_pin_*`
- `run-kit/ui/lenses-and-layout`: (modify) `@rk_type` → `@rk_win_lens`, `@rk_url` → `@rk_win_url`
- `run-kit/ui/sidebar`: (modify) `@rk_session_order`/`@rk_server_rank`/flair/marker/note/role mentions
- `run-kit/ui/status-signals`, `run-kit/ui/dialogs-and-state`, `run-kit/ui/keyboard-and-palette`: (modify) mentions
- `run-kit/api-and-sockets`, `run-kit/configuration`, `run-kit/agent-messaging`, `run-kit/daemon-lifecycle`, `run-kit/operator-actuation`, `run-kit/test-sockets`, `run-kit/toolkit-standards`: (modify) mentions
- `run-kit/index`: (modify) regenerated by hydrate

## Impact

- **Substrate contract**: every tmux server rk manages carries renamed options after the daemon's first sweep; other rk instances (older binaries) sharing a server would read empty values until upgraded — acceptable for a single-operator tool, but note in the PR body.
- **Cross-repo**: fab-kit reads only `@rk_agent_state` (Change 3/4) — untouched here. fab-kit skill prose mentions `@rk_role`/`@rk_url`/`@rk_type` (docs only; Change 4 updates them).
- **API**: `POST /api/windows/{id}/options` allowlist keys change (`@rk_win_*`); frontend and e2e are the only clients. Endpoint paths/verbs unchanged (Constitution IX).
- **CLI help**: `rk role` `Long:` text names the option — toolkit-standards check.
- **Layout snapshots**: recovery backups store struct fields, so pre-change snapshots restore correctly with new names (only the restore literal map changes). Verify with `snapshot/integration_test.go`.
- **Pre-seeded e2e**: `scripts/test-e2e.sh` writes `@rk_ephemeral`/`@rk_managed` at :91,:96 — `@rk_managed` → `@rk_srv_managed` is this change's (server-scoped, rk-private); `@rk_ephemeral` stays (Change 3).
- **Scale**: ~11 backend files + 3 constant blocks, ~12 Go test files, ~10 frontend source + 7 unit-test files, ~20 e2e spec/companion pairs (mostly comments), ~17 memory files, 6 spec files, 2 docs/site files, README.

## Open Questions

- Layout-capture field layout for the dual-read note pair (`@rk_note` free text must be last; two free-text fields cannot both be last) — apply decides between trailing-pair ordering with a delimiter guarantee vs a separate `show-options` read, and records it in plan Design Decisions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change 1 must merge before this change's apply begins; this change extends `MigrateLegacyOptions` rather than introducing its own sweep | Plan § Sequencing note + user's draft instruction; verified Change 1 not yet drafted at `67f4a553` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Target names per the plan's target map (`@rk_win_lens`, `@rk_ses_pin_*`, `@rk_srv_*`, …); `@rk_ctl_keepalive` deleted with `AnchorKeepaliveOption`/`setAnchorKeepalive` | Plan is explicit; no reader of keepalive verified (`grep` = definition + one setter) | S:95 R:85 A:95 D:95 |
| 3 | Certain | Dual-read (new wins) for `@rk_note`, `@rk_type`, `@rk_url`; hard rename for the other 12; plan carries a deprecation ledger | Asked — user chose "Dual read for now… keep noting down what deprecated stuff needs to be removed" | S:90 R:85 A:95 D:95 |
| 4 | Certain | Remove `@rk_owner` mentions from `right-panel.md`, `surface-layout.md`, `specs/index.md` | Asked — user chose "Remove the mentions"; key never shipped in code | S:95 R:90 A:95 D:95 |
| 5 | Certain | Change type `refactor` | Plan § Execution notes names it; no behavior change | S:95 R:95 A:95 D:95 |
| 6 | Confident | Go constant identifiers keep their names (value-only change); introduce `tmux.SessionFlairOption`; consolidate the duplicate `presentRootOption`/`presentURLOption`/`presentTypeOption` and `api/windows.go` `optKey*` literals onto exported `tmux.*Option` constants | Plan says "rename constants … and every raw literal"; one-definition-per-key is the natural way to stop literal drift; reversible | S:70 R:85 A:80 D:80 |
| 7 | Confident | Externally-written keys `@rk_ephemeral`/`@rk_protected`/`@rk_agent_state`/`@rk_chat` untouched, including `scripts/test-e2e.sh:91`; `@rk_managed` in that script IS renamed | Plan's explicit split between Change 2 and Change 3 | S:90 R:85 A:90 D:90 |
| 8 | Confident | Historical files (`log.md`, `log.seed.md`, `docs/wiki/*.html`) left as-is | Logs are append-only history; wiki studies are design artifacts | S:75 R:95 A:85 D:85 |
| 9 | Confident | `docs/site/skill.md` + `skill/display.md` updated to new names with a "legacy names still read" note; toolkit-standards checked before editing `docs/site/` and `rk role` help | Constitution § Toolkit Standards; user chose dual-read so the note is accurate | S:80 R:90 A:80 D:85 |
| 10 | Tentative | e2e legacy pre-seeding done by extending `scripts/test-e2e.sh`'s server-marking block rather than a dedicated spec | Plan requires the sweep be exercised by e2e but not how; either is cheap to swap | S:60 R:80 A:60 D:55 |
| 11 | Tentative | Dual-read `GetWindowOption` fallback applies to `@rk_url` only (not `@rk_present_root`) | `@rk_present_root` has no documented external writer; `display.md:69` documents it as set by `rk present` only | S:65 R:80 A:70 D:65 |

11 assumptions (5 certain, 4 confident, 2 tentative, 0 unresolved).
