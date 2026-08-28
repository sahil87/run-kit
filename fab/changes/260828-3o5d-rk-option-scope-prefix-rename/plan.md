# Plan: rk Option Scope-Prefix Rename (rk-private keys)

**Change**: 260828-3o5d-rk-option-scope-prefix-rename
**Intake**: `intake.md`

## Requirements

Rename map (15 renames + 1 delete; scope ∈ `srv` = `set-option -s`, `ses` = bare `-t =name:`, `win` = `-w`):

| Current | Target | Scope | Read treatment |
|---|---|---|---|
| `@rk_type` | `@rk_win_lens` | win | **dual-read** |
| `@rk_url` | `@rk_win_url` | win | **dual-read** |
| `@rk_present_root` | `@rk_win_present_root` | win | hard |
| `@rk_marker` | `@rk_win_marker` | win | hard |
| `@rk_flair` | `@rk_win_flair` | win | hard |
| `@rk_note` | `@rk_win_note` | win | **dual-read** |
| `@rk_role` | `@rk_win_role` | win | hard |
| `@rk_session_flair` | `@rk_ses_flair` | ses | hard |
| `@rk_board` | `@rk_ses_pin_board` | ses | hard |
| `@rk_home` | `@rk_ses_pin_home` | ses | hard |
| `@rk_board_order` | `@rk_ses_pin_order` | ses | hard |
| `@rk_ctl_keepalive` | **deleted** | ses | unset-only migration row (`New: ""`) |
| `@rk_session_order` | `@rk_srv_session_order` | srv | hard |
| `@rk_server_rank` | `@rk_srv_rank` | srv | hard |
| `@rk_origin` | `@rk_srv_origin` | srv | hard |
| `@rk_managed` | `@rk_srv_managed` | srv | hard |

Untouched (explicit non-goals): `@rk_win_color`/`@rk_ses_color` (Change 1), `@rk_ephemeral`, `@rk_protected`, `@rk_agent_state`, `@rk_chat` (Change 3/4).

### tmux: Scope-Prefixed Constants

#### R1: One definition per key, values per the target map
`internal/tmux` SHALL carry each renamed key exactly once as an exported constant with its Go identifier unchanged where one exists (`SessionOrderOption`, `ServerRankOption`, `OriginOption`, `ManagedOption`, `RoleOption`, `NoteOption`, `BoardOption`, `HomeOption`, `BoardOrderOption` — value-only change), SHALL introduce `SessionFlairOption = "@rk_ses_flair"` (no constant today), and SHALL introduce exported constants for the keys currently re-declared as literals/duplicates — `URLOption = "@rk_win_url"`, `LensOption = "@rk_win_lens"`, `PresentRootOption = "@rk_win_present_root"`, `MarkerOption = "@rk_win_marker"`, `FlairOption = "@rk_win_flair"` — so `cmd/rk/present.go`'s `presentURLOption`/`presentRootOption`/`presentTypeOption`, `api/present.go:36`'s `presentRootOption`, and `api/windows.go`'s `optKey*` block reference `tmux.*Option` exports rather than re-declaring strings. The three legacy dual-read names SHALL likewise live in one place (unexported constants in `internal/tmux`, shared by the migration table and the dual-read format fields). `EphemeralOption`/`ProtectedOption`/`AgentStateOption`/`ChatOption`/`ColorOption`/`SessionColorOption` values are untouched.

- **GIVEN** `tmux.RoleOption`
- **WHEN** the rename lands
- **THEN** its value is `"@rk_win_role"` and its identifier is unchanged
- **AND** `grep -rn '"@rk_role"' app/backend --include=*.go` hits only the legacy-name constant definition and the migration table

### tmux: Hard Renames (12 keys)

#### R2: Every production literal and format field uses the new names
All hard-renamed keys SHALL change with no legacy read: `layoutWindowFormat`/`layoutSessionFormat` (`internal/tmux/layout.go`), `ListSessions` format `#{@rk_session_flair}` → `#{@rk_ses_flair}` (tmux.go:869), `SetSessionFlair`/`UnsetSessionFlair` bare literals (tmux.go:2349/2358) routed onto `SessionFlairOption`, `roleCarriersFormat` (tmux.go:1893), `SetSessionOrder`/`GetSessionOrder`/`SetServerRank`/`GetServerRank`/`SetServerOrigin`/`GetServerOrigin` comment and code literals, `stampManagedOnBirth`, `api/windows.go` optKey allowlist (new keys only — no dual-accept), all `cmd/rk/*` writers and comment/doc mentions, `internal/snapshot/restore.go` `windowOptionOps`, `internal/sessions/sessions.go`, `internal/present/present.go`, `internal/validate/validate.go` (comments), and `api/operator.go` prompt text. `tmuxctl` loses its keepalive write (see R5). `docs`/`memory` are out of apply scope except the files listed in R10.

- **GIVEN** a window with `@rk_win_role operator` set via `set-option -w`
- **WHEN** `ListWindows` runs
- **THEN** `Role == "operator"` and a window carrying only legacy `@rk_role` reports no role
- **AND** the `POST /api/windows/{id}/options` allowlist accepts only the new key names

### tmux: Dual-Read Keys (3 keys)

#### R3: `@rk_note`/`@rk_type`/`@rk_url` read old and new, new wins; writers write only new
`ListWindows`' format and `parseWindows`, and `layoutWindowFormat`/`parseLayoutWindows`, SHALL carry both the legacy and the new format fields for exactly `@rk_type`/`@rk_url`/`@rk_note`, and the parsers SHALL prefer the new value, falling back to the legacy one. Note-pair ordering in both formats: new note as a strict single field second-to-last, legacy note LAST (tail-rejoin preserved for it — see Design Decisions). All writers (`POST /options` handler, `rk present`, `CreateWindowWithOptions`, frontend `client.ts`, `rk` CLI) SHALL write ONLY the new names. No other key gets a fallback. Verified at plan time: no production `GetWindowOption` read of `@rk_url` exists (`api/present.go`'s only read is `@rk_present_root` — a hard rename; `cmd/rk/present.go` is write-only), so no `GetWindowOption` fallback exists to build; any future reader follows new-then-old.

- **GIVEN** a window with only legacy `@rk_note "123:old"` set → **THEN** `ListWindows` reports the note
- **GIVEN** only new `@rk_win_note "123:new"` → **THEN** the note is reported
- **GIVEN** both set (`@rk_note "123:old"`, `@rk_win_note "456:new"`) → **THEN** new wins (`Note == "new"`, epoch 456)
- **AND** the same three cases behave identically for `@rk_type`/`@rk_win_lens` and `@rk_url`/`@rk_win_url` in both `parseWindows` and `parseLayoutWindows`

### tmux: Legacy Sweep Extension

#### R4: `legacyOptions` extended with the 16 rows
Change 1's `legacyOptions` table in `internal/tmux/legacy_options.go` SHALL gain the 15 rename rows plus `@rk_ctl_keepalive` as an unset-only row (`New: ""` — the code already supports it). Scopes: the seven window keys `scopeWindow`; `@rk_session_flair`, the three `_rk-pin-*` rows, and `@rk_ctl_keepalive` `scopeSession`; the four server rows `scopeServer`. Semantics stay Change 1's verbatim: right-scope copy-then-unset, wrong-scope purge (incl. global), idempotent, per-step logging, failures non-fatal. No second migration mechanism.

- **GIVEN** a test server pre-seeded with all 16 legacy names at their correct scopes
- **WHEN** `MigrateLegacyOptions` runs
- **THEN** every value sits under its new name at the same scope, `@rk_ctl_keepalive` is gone, and no legacy name remains
- **GIVEN** a legacy name set at a wrong scope → **THEN** it is unset with no copy-forward
- **GIVEN** a migrated server → **WHEN** swept again → **THEN** zero set/unset calls are issued

### tmuxctl: Control Anchor Keepalive Removal

#### R5: `@rk_ctl_keepalive` machinery deleted
`tmuxctl.AnchorKeepaliveOption` (client.go:26), `setAnchorKeepalive` (client.go:654), its call site (client.go:503), and the `tmuxctl/doc.go:29` mention SHALL be removed. No replacement marker — the `_rk-ctl` anchor is identified by `tmux.ControlAnchorSessionName` already.

- **GIVEN** the deletion
- **WHEN** `grep -rn 'AnchorKeepalive\|setAnchorKeepalive' app/backend --include=*.go` runs
- **THEN** zero hits remain

### Snapshot: Literal-Only Rename

#### R6: Restore writes the new names; no on-disk migration
`snapshot/restore.go` `windowOptionOps` (:327–342) SHALL emit the new names for all six window options (`LensOption`, `URLOption`, `MarkerOption`, `FlairOption`, `RoleOption`, `NoteOption`). Stored snapshot structs are unchanged — only the restore literal map changes — and the round-trip test SHALL assert the new names on restore.

- **GIVEN** a snapshot whose `win.Role == "operator"`
- **WHEN** restored
- **THEN** the op list contains `@rk_win_role=operator` and no `@rk_role` literal

### Frontend: Payload Keys and Prose

#### R7: `client.ts` writes new keys; comment/doc mentions follow
`app/frontend/src/api/client.ts` SHALL POST `@rk_win_url` (setWindowUrl/updateWindowUrl), `@rk_win_marker`, `@rk_win_role`, `@rk_win_flair`, `@rk_win_note`, and `@rk_win_lens@-related payloads` under the new names; comment/doc mentions in `client.ts`, `types.ts`, `lib/window-view.ts`, `lib/surface-layout.ts`, `lib/palette/move.ts`, `lib/palette/server-adopt.ts`, `lib/web-url.ts`, `lib/present-auto-expand.ts`, `lib/web-zoom.ts`, `app.tsx`, `components/**` SHALL be renamed in prose.

- **GIVEN** `setWindowMarker(server, "@2", "solid")`
- **WHEN** it POSTs
- **THEN** the request body is `{"options":{"@rk_win_marker":"solid"}}`

### e2e and Scripts

#### R8: Specs stamp/assert new names; the e2e rig pre-seeds legacy names to exercise the sweep
Every `app/frontend/tests/e2e/*.spec.ts` that stamps or asserts a renamed key SHALL use the new name, and its sibling `*.spec.md` SHALL be updated in the same pass (Constitution § Test Companion Docs). `scripts/test-e2e.sh` SHALL rename its `@rk_managed` marking to `@rk_srv_managed` (its `@rk_ephemeral` seed stays — Change 3) and SHALL pre-seed legacy names (e.g. server-scope `@rk_origin`, `@rk_session_order`; a window-scope legacy role/url/note on the `e2e-init` window) so the once-per-daemon sweep is exercised when the rig's specs attach; a small spec SHALL assert the sweep converges legacy → new on the e2e rig. e2e runs ONLY via `just test-e2e "<spec>"`, never concurrent.

- **GIVEN** the e2e rig pre-seeded with `@rk_role=operator` on a window
- **WHEN** a spec attaches (managed server)
- **THEN** the daemon's sweep migrates it and the spec can assert `@rk_win_role` set / `@rk_role` unset

### Docs (apply-owned)

#### R9: Code-adjacent docs renamed; `@rk_owner` mentions removed from specs
`docs/site/skill.md` (:63,:87) and `docs/site/skill/display.md` (:41,:52,:68–70,:86–87,:90) SHALL name the new keys and carry a one-line "legacy names still read for now" note (toolkit-standards checked — `skill` + `readme-extraction` standards govern; edits are rename-only). `scripts/sync-skill.sh` SHALL be re-run so the embedded copies stay byte-identical (drift-guard tests). `README.md:202` SHALL read `@rk_ses_pin_board`. `docs/specs/surface-layout.md`, `window-views.md`, `cli-layering.md`, `themes.md`, `agent-state.md`, `right-panel.md`, `docs/specs/index.md` SHALL name the new keys, and `right-panel.md` (:10,:21,:98,:168–190), `surface-layout.md`'s :208 row, and `specs/index.md`'s Right Panel entry SHALL drop `@rk_owner` entirely (never shipped in code). Memory edits are hydrate's; historical files (`docs/memory/run-kit/log.md`, `log.seed.md`, `docs/wiki/*.html`) untouched.

- **GIVEN** `grep -rn '@rk_owner' docs/specs`
- **THEN** zero hits

### Non-Goals
- Renaming `@rk_ephemeral`/`@rk_protected`/`@rk_agent_state`/`@rk_chat` (Change 3/4) or the Change-1 color keys.
- Dual-read for any key beyond the documented three; dual-ACCEPT on the API allowlist.
- On-disk snapshot migration (structs unchanged — restore literal map only).
- A second migration mechanism (table extension only).
- `docs/memory/` edits (hydrate owns them) and historical files.

### Design Decisions

#### Note-pair capture ordering: new note single field, legacy note last
**Decision**: in `ListWindows`' format and `layoutWindowFormat` alike, `@rk_win_note` occupies a strict single field second-to-last and legacy `@rk_note` stays LAST with the tail-rejoin (`strings.Join(parts[N:], listDelim)`) semantics it has today; the parser prefers the new field and falls back to the rejoined legacy tail.
**Why**: two free-text fields cannot both enjoy tail-rejoin; legacy notes already in the wild keep today's exact read path, while rk-written new notes are control-char-stripped at write time (`api/windows.go` note validation) so a single field is safe; the alternative (`@rk_win_note` last) would regress legacy-note reads during the transition window.
**Rejected**: capturing the note pair via a separate `show-options` read — a second tmux call per capture for a transition-only concern; rejected as needless complexity.
*Introduced by*: 260828-3o5d-rk-option-scope-prefix-rename

#### Dual-read carried in the list format, not a second call
**Decision**: legacy and new fields ride the same `list-windows` format line; parsers pick new-then-legacy positionally.
**Why**: zero extra subprocess per read; capture and parse are same-binary so positional fields are unambiguous.
**Rejected**: `show-options` dual-read per window — O(windows) extra calls on every sidebar tick.
*Introduced by*: 260828-3o5d-rk-option-scope-prefix-rename

#### API allowlist hard-cuts to new names
**Decision**: the `POST /options` allowlist accepts only new key names; legacy keys 400.
**Why**: dual-read exists for tmux-substrate writes made outside rk's binary (agent/operator text, stale scripts); rk's own API is a writer, and writers switch to new names now (intake § 4).
**Rejected**: accepting legacy keys on the API and rewriting them — extends the transition surface for no external writer.
*Introduced by*: 260828-3o5d-rk-option-scope-prefix-rename

#### No `GetWindowOption` fallback exists to build
**Decision**: the `@rk_url` fallback is positional (list formats) only; `@rk_present_root` is a hard rename on the sole `GetWindowOption` reader (`api/present.go`).
**Why**: verified against the current tree — no production code reads `@rk_url` through `GetWindowOption` (the intake's § 4 bullet about a `GetWindowOption` `@rk_url` read refers to readers that do not exist in-tree); building a fallback for a nonexistent reader would be dead code.
**Rejected**: preemptive dual-read helper on `GetWindowOption` — unused abstraction.
*Introduced by*: 260828-3o5d-rk-option-scope-prefix-rename

### Deprecated Requirements

This section is the **deprecation ledger** for the follow-up "run-kit · remove legacy reads" release — every legacy read path / legacy row / doc mention that release MUST delete (mirrored into `docs/memory/run-kit/tmux-sessions.md` by hydrate):

#### Legacy dual-read format fields and parser fallbacks
**Reason**: `@rk_type`/`@rk_url`/`#{@rk_note}` fields in `ListWindows`' format, `layoutWindowFormat`, and the `parseWindows`/`parseLayoutWindows` legacy-field fallbacks exist only to catch post-sweep legacy writes from stale external writers; after a few releases the sweep has converged every carrier and stragglers are unsupported.
**Migration**: delete the legacy fields from both formats and the fallback branches, leaving the new-name fields only.

#### Registry "Legacy names" column entries for the 15 renamed keys
**Reason**: `docs/memory/run-kit/tmux-sessions.md` § Server-Scoped User Options lists the old→new pair per renamed row; once the legacy names are no longer read anywhere, the column entries for these 15 rows are retired.
**Migration**: drop the 15 rows' Legacy-names entries (the `@color`/`@session_color` rows from Change 1 may go in the same pass when its window also elapses).

#### `docs/site` "legacy names still read" notes
**Reason**: `docs/site/skill.md` and `docs/site/skill/display.md` carry a one-line transitional note; it must be removed when the legacy reads are.
**Migration**: delete the note lines, leaving only the new names.

#### Unexported legacy-name constants
**Reason**: `legacyTypeOption`/`legacyURLOption`/`legacyNoteOption` (`app/backend/internal/tmux/tmux.go`) exist only as the single definition shared by the migration-table rows and the dual-read format fields.
**Migration**: once the dual-read fields are gone, inline the three strings into their `legacyOptions` rows (or delete them with the rows when the table becomes unset-only) and remove the constants.

#### Dual-read and legacy-rejection tests
**Reason**: `TestParseWindowsDualRead` / `windowLineDualRead` (`internal/tmux/tmux_test.go`), `layoutLineDualRead` (`internal/tmux/layout_test.go`), and `TestWindowOptionsLegacyKeysRejected` (`api/windows_test.go`) pin behavior that stops existing when the legacy reads are removed.
**Migration**: delete the dual-read tests with the fallbacks; keep the API rejection test only if the allowlist still needs a negative case for arbitrary unknown keys (rename it accordingly).

#### e2e legacy pre-seed and sweep spec
**Reason**: the legacy pre-seed block in `scripts/test-e2e.sh` (server-scope `@rk_origin`/`@rk_session_order`, window-scope `@rk_role`/`@rk_url`/`@rk_note` on the init window) and `app/frontend/tests/e2e/legacy-scope-sweep.spec.ts` + `.spec.md` exist to exercise the sweep over legacy names; both carry "removed when the deprecation window closes" comments.
**Migration**: delete the pre-seed block and the spec pair in the same release that turns the migration table unset-only (a purge-only table still needs one regression test — fold it into `legacy-color-sweep` if that spec survives).

## Tasks

### Phase 1: Backend Constants & Production Renames

- [x] T001 Backend constants + production sweep: rename values of existing constants and add `SessionFlairOption`/`URLOption`/`LensOption`/`PresentRootOption`/`MarkerOption`/`FlairOption` exports in `app/backend/internal/tmux/tmux.go` (+ `board.go` values); consolidate `cmd/rk/present.go`'s `present*Option` and `api/present.go`'s `presentRootOption` and `api/windows.go`'s `optKey*` onto `tmux.*Option`; re-point every hard-renamed literal/comment in `tmux.go` (incl. `ListSessions` format, `roleCarriersFormat`, `SetSessionFlair`/`UnsetSessionFlair`, session-order/rank/origin/managed helpers), `layout.go` (hard-rename fields), `board.go`, `internal/snapshot/restore.go` + `snapshot.go`, `internal/sessions/sessions.go`, `internal/present/present.go`, `internal/validate/validate.go` (comments), `api/*.go`, `cmd/rk/*.go` (incl. `role.go` `Long:` text — toolkit `principles` standard checked, rename-only). Unexported legacy-name constants (`@rk_type`/`@rk_url`/`@rk_note`) defined for the table + dual-read fields to share. Verify `cd app/backend && go build ./...`. <!-- R1 R2 R6 -->
- [x] T002 Extend `internal/tmux/legacy_options.go`'s `legacyOptions` with the 16 rows (window rows `scopeWindow`; `@rk_session_flair` + three pin rows + `@rk_ctl_keepalive` `scopeSession`; server rows `scopeServer`; keepalive `New: ""`). <!-- R4 -->
- [x] T003 Dual-read machinery in `internal/tmux/tmux.go` (`ListWindows` format + `parseWindows`) and `internal/tmux/layout.go` (`layoutWindowFormat` + `parseLayoutWindows`): append `#{@rk_win_lens}`, `#{@rk_win_url}`, `#{@rk_win_note}` (single field) and legacy `#{@rk_type}`, `#{@rk_url}`, `#{@rk_note}` (LAST, tail-rejoin) fields; parsers pick new, fall back to legacy; field-count comments updated. Verify `go build ./...`. <!-- R3 -->
- [x] T004 Delete keepalive: `tmuxctl.AnchorKeepaliveOption`, `setAnchorKeepalive`, its call site in `internal/tmuxctl/client.go`, and the `tmuxctl/doc.go` mention. `go build ./...`. <!-- R5 -->

### Phase 2: Tests & Clients

- [x] T005 Backend Go tests: re-point literals in `internal/tmux/tmux_test.go`, `board_test.go`, `legacy_options_test.go`, `snapshot/restore_test.go`, `snapshot/integration_test.go`, `cmd/rk/present_test.go`, `notify_test.go`, `role_test.go`, `url_test.go`, `origin_test.go`, `api/sessions_test.go`, `operator_test.go`, `windows_test.go`; extend `legacy_options_test.go` — full-legacy-server (all 16 names at correct scopes) → fully renamed + keepalive gone + second-run no-op + wrong-scope unset; add dual-read unit tests (old-only / new-only / both → new wins) for the three keys against `parseWindows` and `parseLayoutWindows`; snapshot round-trip asserts new names. Run `go test ./...`. <!-- R3 R4 R6 -->
- [x] T006 [P] Frontend: `app/frontend/src/api/client.ts` payload keys + comments; prose renames in `types.ts`, `lib/window-view.ts`, `lib/surface-layout.ts`, `lib/palette/move.ts`, `lib/palette/server-adopt.ts`, `lib/web-url.ts`, `lib/present-auto-expand.ts`, `lib/web-zoom.ts`, `app.tsx`, `components/**`; re-point `client.test.ts`, `lib/window-view.test.ts`, `lib/surface-layout.test.ts`, `components/host-overview-page.test.tsx`, `components/iframe-window.test.tsx`, `components/sidebar/row-flyout-card.test.tsx`, `components/sidebar/index.test.tsx`, `components/session-tiles/session-tiles.test.tsx`. Run `npx tsc --noEmit && npx vitest run`. <!-- R7 -->
- [x] T007 [P] e2e: update stamping/asserting specs (+ sibling `.spec.md` same pass): `compose-strip`, `web-tile-chrome`, `operator-pinned-row`, `top-bar-overflow`, `web-view-lens`, `present-auto-expand`, `window-marker-gutter`, `session-reorder`, `server-reorder`, `right-panel`, `code-surface`, `web-tile-zoom`, `web-tile-find`, `surface-layout`, `operator-session-promotion`, `sort-windows` (comment greps confirm which), and `tests/e2e/_tmux.ts` helpers; `scripts/test-e2e.sh` marking block: `@rk_managed` → `@rk_srv_managed` + legacy pre-seed (server-scope `@rk_origin`/`@rk_session_order`; window-scope `@rk_role`/`@rk_url`/`@rk_note` on `e2e-init`) with a comment pointing at the sweep. <!-- R8 -->
- [x] T008 [P] Add `app/frontend/tests/e2e/legacy-scope-sweep.spec.ts` + `.spec.md`: seed legacy options on a window in the rig, drive `POST /api/tmux/reload-config`, assert new names present and legacy unset (extends the `legacy-color-sweep` precedent). <!-- R8 -->

### Phase 3: Docs

- [x] T009 Docs: `docs/site/skill.md` + `docs/site/skill/display.md` (new names + one-line legacy-note; `shll standards` skill/readme-extraction checked), re-run `scripts/sync-skill.sh`; `README.md:202`; `docs/specs/surface-layout.md`, `window-views.md`, `cli-layering.md`, `themes.md`, `agent-state.md`, `right-panel.md`, `specs/index.md` renames + full `@rk_owner` removal. <!-- R9 -->

### Phase 4: Verification

- [x] T010 Run the touched e2e specs serially via `just test-e2e "<spec>"` (one invocation may list several specs; never two concurrent invocations). <!-- R8 -->
- [x] T011 Full gates: `cd app/backend && go build ./... && go vet ./... && go test ./...`; `cd app/frontend && npx tsc --noEmit && npx vitest run`; final literal sweep grep — hits only in `legacy_options.go`/`legacy_options_test.go` (table rows + legacy-name constants), the dual-read legacy format fields/parsers and their tests, the e2e legacy pre-seed, and the `"legacy names still read"` doc notes. <!-- R1 R2 R3 R4 -->

## Execution Order

- T001 → T003 → T004 (same files in `internal/tmux`); T002 is independent but kept sequential with the backend sweep
- T005 after T001–T004 (tests assert the new machinery)
- T006/T007/T008 (frontend, e2e edits, docs) independent of the backend sequence — T006 and T009 run in parallel with T001–T005; T007/T008 follow once backend is green
- T010 after T005–T008; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: renamed constant values match the target map; identifiers unchanged; `SessionFlairOption`/`URLOption`/`LensOption`/`PresentRootOption`/`MarkerOption`/`FlairOption` exported; legacy-name unexported constants shared by table + formats
- [x] A-002 R2: hard-renamed literal sweep complete (final grep clean per T011)
- [x] A-003 R3: `parseWindows` and `parseLayoutWindows` dual-read the three keys, new wins; writers write only new names
- [x] A-004 R4: `legacyOptions` carries 16 new rows with correct scopes; keepalive row unset-only
- [x] A-005 R5: keepalive constant/function/call/doc gone; `go build` green
- [x] A-006 R6: `windowOptionOps` emits new names only
- [x] A-007 R7: `client.ts` POST payload keys renamed; `client.test.ts` asserts them
- [x] A-008 R8: touched e2e specs + companions use new names; `test-e2e.sh` pre-seeds legacy names; `legacy-scope-sweep` spec added
- [x] A-009 R9: docs updated; `@rk_owner` fully removed from `docs/specs/`; `sync-skill.sh` re-run (drift-guard green)

### Behavioral Correctness

- [x] A-010 R3: a window with both old and new set reports the new value, for all three keys, in both parsers
- [x] A-011 R4: full-legacy-server migration test passes on a real test socket; second run issues zero set/unset calls
- [x] A-012 R6: snapshot round-trip (structs stored) restores to new option names

### Removal Verification

- [x] A-013 R5: `grep -rn 'AnchorKeepalive\|setAnchorKeepalive\|@rk_ctl_keepalive' app/backend` hits only the migration table row / its test
- [x] A-014 R9: `grep -rn '@rk_owner' docs/specs` returns zero hits

### Scenario Coverage

- [x] A-015 R3: dual-read unit tests cover old-only / new-only / both for all three keys in `parseWindows` AND `parseLayoutWindows`
- [x] A-016 R4: migration test covers all 16 legacy names at correct scopes, wrong-scope purge, keepalive deletion, idempotency
- [x] A-017 R8: `just test-e2e` passes for every touched spec, serially

### Edge Cases & Error Handling

- [x] A-018 R3: legacy note tail-rejoin preserved (tabs in legacy notes survive); new note treated as a strict single field
- [x] A-019 R4: a legacy name at a wrong scope is unset without copy-forward (asserted in the migration test)

### Code Quality

- [x] A-020 Pattern consistency: constants follow the `tmux.*Option` export idiom; migration rows follow the `{Old, New, Scope}` shape; no new mechanisms
- [x] A-021 No unnecessary duplication: each renamed key's string lives in exactly one place (constant); legacy names in one unexported-constant definition each
- [x] A-022 All tmux calls via existing `exec.CommandContext` helpers with timeouts; no shell strings (Constitution I)
- [x] A-023 No magic strings: new literals flow through named constants; comments updated to match
- [x] A-024 Comments state constraints (dual-read fallback rules, note-field ordering invariant); no narration/changelog voice
- [x] A-025 `.spec.md` companions updated in the same pass as their `.spec.ts` (Constitution § Test Companion Docs)

### Security

- [x] A-026 R2: the `POST /options` allowlist remains a closed set — renamed keys only, no widening

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/api/windows.go:366-372` (`optKey*` block) — now one-for-one aliases of the `tmux.*Option` exports; the alias layer can be dropped for direct `tmux.XOption` references at its handful of use sites (the single-definition goal R1 set is already met, so this is optional tidying).

(The transition-only legacy machinery — dual-read format fields, parser fallbacks, legacy constants, e2e pre-seed — is covered by the planned-removal ledger in `## Deprecated Requirements`, not discovered here; `AnchorKeepaliveOption`/`setAnchorKeepalive` were deleted by the change itself.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Note-pair capture ordering: new note strict single field second-to-last, legacy note last with tail-rejoin | Resolves the intake's one Open Question without asking; legacy notes keep today's exact read path; write-side strips control chars so the new note's single field is safe | S:75 R:80 A:75 D:70 |
| 2 | Confident | Dual-read carried positionally in the list format (no extra `show-options` call) | Intake listed both options; same-binary format makes positional fields unambiguous; cost-free | S:70 R:85 A:80 D:75 |
| 3 | Confident | API allowlist accepts new names only (no dual-accept) | Dual-read is for substrate-level external writers; rk's API is a writer and writes new names | S:70 R:90 A:80 D:75 |
| 4 | Confident | No `GetWindowOption` `@rk_url` reader exists in-tree, so no fallback is built; `@rk_present_root` stays a hard rename | Verified by grep against the current tree (the intake's fallback bullet refers to readers that do not exist); intake assumption 11 carried | S:60 R:90 A:75 D:65 |
| 5 | Confident | `shll standards` checked (`skill`, `readme-extraction`, `principles`); docs edits are rename-only and conform | Constitution § Toolkit Standards honored at plan time; shll available | S:80 R:90 A:85 D:80 |
| 6 | Tentative | e2e legacy pre-seed by extending `scripts/test-e2e.sh`'s marking block (plus one small sweep-assertion spec) | Intake assumption 10 carried — plan requires the sweep exercised in e2e but not how | S:60 R:80 A:60 D:55 |
| 7 | Tentative | Frontier between "touched" and untouched e2e specs decided per-file by grep for the renamed names (stamping/asserting vs comment-only) | The intake's file list is grep-verified but stale post-Change-1; per-file grep is the same rule with fresh numbers | S:55 R:90 A:65 D:60 |

7 assumptions (0 certain, 5 confident, 2 tentative).
