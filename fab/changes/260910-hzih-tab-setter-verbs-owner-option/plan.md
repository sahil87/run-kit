# Plan: `rk tab` signal setter verbs + `@rk_win_owner`

**Change**: 260910-hzih-tab-setter-verbs-owner-option
**Intake**: `intake.md`

## Requirements

### CLI: `rk tab` signal setter verbs

#### R1: Five setter verbs share one argument shape
`rk tab` SHALL gain the subcommands `mark`, `note`, `color`, `flair`, and `owner`. Each SHALL accept `[@N] <value>` to set and `[@N] --off` to unset, where `[@N]` is the family's existing tab address grammar (`@N`, `=session:window`, or omitted for the caller's own tab) and `-L/--server` is the family's persistent flag. Argument resolution MUST be positional and deterministic: two positional args ⇒ address then value; one positional arg ⇒ the address when `--off` is set, else the value; zero args ⇒ own tab and requires `--off` (a set needs a value). `--off` combined with a value MUST be a usage error (exit 2). Arg-count violations MUST exit 2 (wrapped by `usageArgs` at the add site, the `tab_code.go` idiom).

- **GIVEN** a caller inside a tmux pane
- **WHEN** it runs `rk tab mark auto:2`
- **THEN** `@rk_win_marker` on the caller's own window is set to `auto:2` and stdout is `auto:2`

- **GIVEN** any caller
- **WHEN** it runs `rk tab flair @7 --off`
- **THEN** `@rk_win_flair` is unset on window `@7`, stdout is empty, exit 0 — also when the option was already unset

- **GIVEN** any caller
- **WHEN** it runs `rk tab color @7 3 --off`
- **THEN** the command exits 2 with a usage error naming that `--off` takes no value, and nothing is written

#### R2: Validation reuses the shared closed sets; invalid values exit 2 and write nothing
Each verb MUST validate through `internal/validate` before any tmux write and MUST NOT carry its own token list: `mark` via `validate.ValidateMarkerValue` (retired flat tokens such as `pipe`/`hatch` are rejected — `NormalizeMarker` is read-side compat only), `color` via `validate.ValidateColorValue` then `validate.NormalizeColorValue` (the normalized form is what is stored and printed), `flair` via `validate.ValidateFlairValue`, `owner` via the new `validate.ValidateOwnerValue`. An invalid value MUST exit 2 (usage class, the malformed-layout precedent) with the validator's message on stderr; tmux failures and not-in-tmux stay exit 1.

- **GIVEN** any caller
- **WHEN** it runs `rk tab mark pipe`
- **THEN** exit 2, stderr carries the marker closed-set message, and no `set-option` runs

- **GIVEN** any caller
- **WHEN** it runs `rk tab color @7 " 01 + 3 "`
- **THEN** `@rk_win_color` is stored as `1+3` and stdout is `1+3`

#### R3: `note` stamps the epoch and applies the API's text rule from one shared validator
`rk tab note [@N] <text>` SHALL trim the text, reject text longer than 120 characters or containing any control rune, and treat text that trims to empty as a usage error pointing at `--off`. The value `-` SHALL read all of stdin as the text (then the same rule — an embedded newline is a control rune and is rejected). On success it SHALL store `<unix-epoch>:<trimmed>` using the process clock and print that stored value. The trim/length/control-rune rule MUST live once, as `validate.ValidateNoteText(text string) (trimmed string, errMsg string)`, consumed by both the `/options` handler in `api/windows.go` (replacing its private `windowNoteMaxLen` constant and inline loop) and this verb.

- **GIVEN** a caller in a pane
- **WHEN** it runs `rk tab note "tests green, drafting PR"`
- **THEN** `@rk_win_note` is `<epoch>:tests green, drafting PR` and stdout echoes the same value

- **GIVEN** any caller
- **WHEN** it runs `rk tab note "   "`
- **THEN** exit 2 with a message naming `--off`, nothing written

#### R4: Output, exit codes, and the SSE wake follow the family contract
Every set MUST print exactly one datum on stdout via `sink.Dataf` (survives `--quiet`); `--off` MUST print nothing. After a successful set or unset the verb MUST fire the fail-silent `tabWakeFn` SSE-hub wake for the resolved server, after the data output; a failed validation or tmux write MUST NOT wake. Each verb's `Long` help MUST name its accepted value set (layered help), and `tab.go`'s parent `Long` subcommand table MUST list the five verbs.

- **GIVEN** the test seam records wakes
- **WHEN** `rk tab flair @7 nyan` succeeds
- **THEN** exactly one wake is recorded for the resolved server, after `nyan` was printed

- **GIVEN** the same seam
- **WHEN** `rk tab flair @7 bogus` is rejected
- **THEN** no wake is recorded

### Backend: the `@rk_win_owner` option

#### R5: `@rk_win_owner` is a closed-set window option with a validator
`internal/tmux` SHALL define `OwnerOption = "@rk_win_owner"`. `internal/validate` SHALL define `ownerTokens = []string{"operator"}`, `OwnerValues = closedSet(ownerTokens)`, and `ValidateOwnerValue(value string) string` (the `roleTokens`/`ValidateRoleValue` idiom — empty string means unset).

- **GIVEN** the validator
- **WHEN** it receives `""`, `"operator"`, `"Operator"`, `"done"`
- **THEN** the first two are valid and the last two return the closed-set message listing `operator`

#### R6: The option is read into `WindowInfo.Owner` from the list-windows format
`windowFormat` SHALL include `#{@rk_win_owner}` inserted immediately after `#{@rk_win_flair}`, and `parseWindows` SHALL parse it with the closed-set idiom (a value outside `validate.OwnerValues` reads as `""`) into `WindowInfo.Owner string json:"owner,omitempty"`. The strict note field and the two retired dual-read fallback fields shift by one; the legacy free-text note tail MUST remain last and its rejoin index MUST move with it. All test line builders in `tmux_test.go` (`windowLine*`) and every other test constructing list-windows lines MUST be updated so existing tests keep passing at the new indices.

- **GIVEN** a list-windows line with `operator` in the owner field and a legacy note containing tabs in the tail
- **WHEN** `parseWindows` runs
- **THEN** `Owner == "operator"`, and the legacy note is rejoined intact (tail-last invariant holds)

- **GIVEN** a line with `bogus` in the owner field
- **WHEN** `parseWindows` runs
- **THEN** `Owner == ""`

#### R7: `/options` accepts `@rk_win_owner`; snapshots round-trip it
`api/windows.go` SHALL add `optKeyOwner = tmux.OwnerOption` to the allowlist, validate it with `validate.ValidateOwnerValue`, and treat an empty string as unset (the marker/role/flair/note contract). `internal/snapshot` SHALL add `WindowSnapshot.Owner string json:"owner,omitempty"`, capture it from `WindowInfo.Owner`, and restore it via `add(tmux.OwnerOption, win.Owner)` beside marker/flair/role/note. No new route.

- **GIVEN** `POST /api/windows/@7/options` with `{"options":{"@rk_win_owner":"operator"}}`
- **WHEN** handled
- **THEN** 200 and the window carries the option; a body with `"@rk_win_owner":"done"` is 400 with the closed-set message; `""` unsets

- **GIVEN** a snapshot of a window with `Owner: "operator"`
- **WHEN** restored
- **THEN** the restored window's `@rk_win_owner` is `operator`

### Frontend: done trail on the `opr` register

#### R8: `getOperatorParts` renders `done · operator-touched` for owner-only windows; monitored wins
`getOperatorParts(win, operator, nowSeconds)` in `sidebar/registers.ts` SHALL keep its existing behavior when `win.monitored === true`. When `win.monitored !== true` and `win.owner === "operator"` it SHALL return `{ head: "done · operator-touched" }` with no `facets`, regardless of `operator` (no tick age). It SHALL return `null` otherwise. `types.ts` `WindowInfo` SHALL gain `owner?: "operator"`.

- **GIVEN** `{ monitored: true, monitoredStage: "apply", owner: "operator" }`
- **WHEN** resolved
- **THEN** head starts with `watched · apply` (owner ignored)

- **GIVEN** `{ owner: "operator" }` with `operator = { stale: true, lastTickAt: 100 }`
- **WHEN** resolved
- **THEN** `{ head: "done · operator-touched" }` exactly — no facets, no tick segment

- **GIVEN** `{}`
- **WHEN** resolved
- **THEN** `null`

#### R9: The flyout card and PANE panel show the done line; the row is unchanged
`row-flyout-card.tsx`'s `hasBody` gate SHALL include `win.owner === "operator"`, and its `opr` `RegisterLine` SHALL render the done head through the existing element with `stale` false (the resolver returns no stale-relevant head, and the card MUST NOT dim the done line when `operator.stale` is true). The PANE panel (`sidebar/status-panel.tsx`) consumes the same resolver and needs no separate branch, but its test SHALL cover the done head. `window-row.tsx` MUST NOT change: the `watched` prop stays gated on `win.monitored === true`, and `StatusDot`'s label gains no clause.

- **GIVEN** a window with only `owner: "operator"` (no change, PR, note, or watchlist join)
- **WHEN** the flyout card renders
- **THEN** the body block renders with `row-flyout-opr` reading `done · operator-touched`, no facets line, `data-stale` absent, and no `status-dot-watched-bar` on its row

### Docs and skill bundle

#### R10: The skill bundle documents the verbs and is synced
`docs/site/skill.md` § Sidebar signals SHALL be rewritten around `rk tab color|mark|note|flair [@N] <v> | --off` (the option-by-option bullets become verb-by-verb bullets naming the accepted sets; the raw `tmux set-option -w @rk_win_<name>` form stays as a one-line "rk absent" fallback). The `rk tab` bullet in the command list and the `rk tab` bullet under § Output & exit-code contracts SHALL mention the setters (set prints the stored datum, `--off` prints nothing). `owner` is documented as an operator-facing verb, not an agent signal. `scripts/sync-skill.sh` SHALL be run so `app/backend/cmd/rk/skill/skill.md` is byte-identical. `README.md`'s `rk tab` row SHALL mention the signal setters.

- **GIVEN** the edited `docs/site/skill.md`
- **WHEN** `scripts/sync-skill.sh` runs
- **THEN** `diff docs/site/skill.md app/backend/cmd/rk/skill/skill.md` is empty

#### R11: Help-dump and toolkit standards hold
`rk help-dump` MUST include the five new leaves under `tab` (the tree is walked programmatically, so this follows from registration); any snapshot/pin test in `help_dump_test.go` touching the tab subtree MUST be updated. The verbs MUST satisfy the toolkit `principles` standard (stdout data / stderr diagnostics; exit 0/1/2; idempotent `--off`) — verified by reading `shll standards principles` when `shll` is on PATH.

- **GIVEN** the built binary
- **WHEN** `rk help-dump` runs
- **THEN** the `tab` node lists `mark`, `note`, `color`, `flair`, `owner` alongside the existing members

### Non-Goals

- No row-level glyph for done; the watched underbar keeps exactly two states (live / stale).
- No marker value for operator ownership; no window-name mutation; no derivation of "done" from fab's `branch_map`.
- No new HTTP routes or palette entries; `rk tab` does not write `@rk_win_role`.
- No change to `NormalizeMarker`, `MigrateLegacyOptions`, or the `[8fjh]` note-extension surfaces.
- The fab-kit adoption of `rk tab owner` (retiring `»`/`›`) is a separate cross-repo follow-up.
- `%N` pane ids are NOT added to the tab address grammar in this change (fab resolves pane → window itself).

### Design Decisions

#### Operator ownership is a pushed option, not a marker value or a name prefix
**Decision**: `@rk_win_owner=operator`, written once by the operator at enrollment and never cleared on removal, carries the "operator-touched" residue; the live "tracked" state stays derived from the watchlist join.
**Why**: Constitution X — derivation wins for the live state, which the `monitored:` map already provides; the residual fact is not derivable after fab removes the entry, and Constitution IV places per-entity state in `@rk_*` options. The marker well is human-owned (status never reads or writes it) and window names are user identity.
**Rejected**: a marker value (`status-signals.md` DD: well human-owned); the `»`/`›` name prefix (collides with rename, fix-tab-name, auto-naming; lost on user rename); deriving done from `branch_map` (keyed by change/branch, not pane; fab-owned schema read for display only).
*Introduced by*: 260910-hzih-tab-setter-verbs-owner-option

#### Done trail is register-only; the row is untouched
**Decision**: an owner-only window shows `done · operator-touched` on the flyout card / PANE panel `opr` register and nothing on the row.
**Why**: the underbar's two states (live / stale) stay legible on a 1px bar; the › trail's value is "which windows did the operator touch", a card-level fact; the row keeps mirroring the status pyramid's overlays only.
**Rejected**: a dotted underbar variant (a third state on a 1px bar, colliding visually with stale's dashed form); no done rendering at all (the user asked for the trail).
*Introduced by*: 260910-hzih-tab-setter-verbs-owner-option

#### One validator table, two writers
**Decision**: the CLI verbs validate through the same `internal/validate` functions the `/options` handler uses; the note rule moves into `validate.ValidateNoteText` so neither writer carries a private copy.
**Why**: the `layoutspec` precedent — a sibling copy of a closed set drifts; the API's private `windowNoteMaxLen` would have become exactly that copy.
**Rejected**: importing the `api` package's constant from `cmd/rk` (wrong dependency direction); re-declaring the bound in the CLI.
*Introduced by*: 260910-hzih-tab-setter-verbs-owner-option

## Tasks

### Phase 1: Setup

- [x] T001 Add `OwnerOption = "@rk_win_owner"` to `app/backend/internal/tmux/tmux.go` beside `FlairOption`; add `ownerTokens`/`OwnerValues`/`ValidateOwnerValue` to `app/backend/internal/validate/validate.go` (the role idiom) with unit tests in `validate_test.go` <!-- R5 -->
- [x] T002 [P] Add `validate.ValidateNoteText(text) (trimmed, errMsg)` to `app/backend/internal/validate/validate.go` (trim; >120 chars ⇒ `note exceeds 120 characters`; control rune ⇒ `note cannot contain control characters`; empty after trim is NOT an error here — callers decide) with unit tests; switch `app/backend/api/windows.go` `optKeyNote` validation to call it and delete the private `windowNoteMaxLen` + inline loop, keeping `windows_test.go` green <!-- R3 -->

### Phase 2: Core Implementation

- [x] T003 Read the option in `app/backend/internal/tmux/tmux.go`: insert `#{@rk_win_owner}` into `windowFormat` right after the flair field; parse into `WindowInfo.Owner` (`json:"owner,omitempty"`, closed-set parse — unknown ⇒ `""`); shift the note / retired-url / retired-lens indices and the legacy-tail rejoin index by one; update the `parseWindows` doc comment field list <!-- R6 -->
- [x] T004 Update every list-windows line builder and fixture at the new indices — `app/backend/internal/tmux/tmux_test.go` (`windowLine*` helpers incl. `windowLineNote`, `windowLineNoteDualRead`, `windowLineLegacyURL`), `webtabs_test.go`, and any other test in `app/backend/internal/` or `app/backend/api/` that hand-builds a list-windows line — and add `TestParseWindowsOwner` (valid token, unknown token ⇒ empty, legacy tail still rejoined) <!-- R6 -->
- [x] T005 [P] Add `optKeyOwner = tmux.OwnerOption` to the `/options` allowlist in `app/backend/api/windows.go` with `validate.ValidateOwnerValue` validation and empty-clears handling in `buildWindowOptionOps`; extend `windows_test.go` (set, 400 on `done`, unset via `""`) <!-- R7 -->
- [x] T006 [P] Snapshot round-trip: add `Owner` to `WindowSnapshot` in `app/backend/internal/snapshot/snapshot.go` (captured from `WindowInfo.Owner`) and `add(tmux.OwnerOption, win.Owner)` in `restore.go`; extend the snapshot/restore tests <!-- R7 -->
- [x] T007 Add the shared setter helper in `app/backend/cmd/rk/tab_signal.go`: positional arg resolution per R1 (`--off` flag, address/value split, `--off`+value ⇒ `usageError`), validator call (invalid ⇒ `usageError` wrapping the validator message), `tabSetWindowOptionsFn` write (`Value: &v` or `nil`), `sink.Dataf` datum on set only, then `tabWakeFn`. Keep it generic over `(option, validate func(string) (stored string, errMsg string))` so `color` can normalize and `note` can stamp <!-- R1 --> <!-- R2 --> <!-- R4 -->
- [x] T008 Add `app/backend/cmd/rk/tab_mark.go`, `tab_flair.go`, `tab_owner.go` — thin cobra commands over T007 with `Use: "<verb> [@N] <value> | --off"`, layered `Long` naming the accepted set (marker: `manual|auto|blocked` × `:1|:2|:3`, bare mode = stage 1; flair: the fifteen tokens; owner: `operator`), `Args: cobra.RangeArgs(0, 2)`; register in `tab.go`'s `init` and list them in the parent `Long` <!-- R1 --> <!-- R2 --> <!-- R4 -->
- [x] T009 Add `app/backend/cmd/rk/tab_color.go` over T007 with `validate.ValidateColorValue` + `NormalizeColorValue` (stored/printed = normalized) and a `Long` describing index / family / blend forms; register in `tab.go` <!-- R2 -->
- [x] T010 Add `app/backend/cmd/rk/tab_note.go` over T007: `-` reads all of stdin; `validate.ValidateNoteText`; trimmed-empty ⇒ `usageError("note text is empty — use --off to clear")`; stamp `fmt.Sprintf("%d:%s", time.Now().Unix(), trimmed)` (clock injectable via a package-level `tabNowFn` for tests); register in `tab.go` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Go tests for the five verbs in `app/backend/cmd/rk/tab_signal_test.go` using the `tab_test.go` seams (`tabSetWindowOptionsFn`, `tabWakeFn`, own-tab env): per verb set writes the right op + prints the datum; `--off` writes a nil-value op + prints nothing + exits 0; invalid value exits 2 (`ExitCodeUsage`) with the validator message and no write and no wake; `--off` with a value exits 2; `mark pipe` rejected; `color " 01 + 3 "` ⇒ `1+3`; `note` epoch shape, 121-char rejection, control-rune rejection, `-` stdin, whitespace-only ⇒ exit 2; wake recorded only on success <!-- R1 --> <!-- R2 --> <!-- R3 --> <!-- R4 -->
- [x] T012 [P] Frontend: add `owner?: "operator"` to `WindowInfo` in `app/frontend/src/types.ts`; extend `getOperatorParts` in `app/frontend/src/components/sidebar/registers.ts` with the owner-only branch (`{ head: "done · operator-touched" }`, no facets, monitored wins); update its doc comment; add cases to `registers.test.ts` (owner-only with stale/lastTickAt operator ⇒ exact head and no facets; monitored+owner ⇒ watched head; neither ⇒ null) <!-- R8 -->
- [x] T013 Frontend: extend the `hasBody` gate in `app/frontend/src/components/sidebar/row-flyout-card.tsx` with `win.owner === "operator"`, and make the `opr` `RegisterLine`/head span not apply stale styling when the head is the done head (stale only applies to the watched head); add `row-flyout-card.test.tsx` cases (owner-only window renders the body with `row-flyout-opr` = `done · operator-touched`, no `row-flyout-opr-facets`, no `data-stale` even with `operator.stale: true`) and a `status-panel` test for the same head; assert `window-row` passes no `watched` for an owner-only window <!-- R9 -->
- [x] T014 Verify `rk help-dump` lists the five verbs under `tab` and update any pin in `app/backend/cmd/rk/help_dump_test.go` if it enumerates the tab subtree; run `just test-backend` and `cd app/frontend && npx tsc --noEmit && pnpm exec vitest run src/components/sidebar` (or `just test-frontend`) <!-- R11 -->

### Phase 4: Polish

- [x] T015 Rewrite `docs/site/skill.md` § Sidebar signals around the verbs (verb bullets with accepted sets + the one-line raw `set-option` fallback), update the `rk tab` command-list bullet and the § Output & exit-code contracts `rk tab` bullet, mention the setters in `README.md`'s `rk tab` row, then run `scripts/sync-skill.sh` and confirm `diff docs/site/skill.md app/backend/cmd/rk/skill/skill.md` is empty; read `shll standards principles` (when `shll` is on PATH) and confirm the verbs conform <!-- R10 --> <!-- R11 -->

## Execution Order

- T001 blocks T003, T005, T006, T008 (they import `OwnerOption` / `ValidateOwnerValue`)
- T002 blocks T010 (shared note validator)
- T003 blocks T004
- T007 blocks T008, T009, T010; T008–T010 block T011
- T012 blocks T013
- T014 and T015 run last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk tab mark|note|color|flair|owner` exist with the `[@N] <value> | --off` shape and positional resolution as specified
- [x] A-002 R2: each verb validates through `internal/validate` (no CLI-local token list); `mark` rejects retired flat tokens; `color` stores/prints the normalized value
- [x] A-003 R3: `note` trims, enforces 120 chars / no control runes via `validate.ValidateNoteText`, treats trimmed-empty as a usage error naming `--off`, reads `-` from stdin, and stores `<epoch>:<text>`
- [x] A-004 R4: set prints one datum via `sink.Dataf`; `--off` prints nothing; wake fires after output on success only; parent `Long` lists the five verbs
- [x] A-005 R5: `tmux.OwnerOption`, `validate.OwnerValues`, `validate.ValidateOwnerValue` exist with the role idiom
- [x] A-006 R6: `WindowInfo.Owner` is read from `windowFormat` after flair with closed-set parsing; the legacy note tail is still last and rejoined
- [x] A-007 R7: `/options` accepts `@rk_win_owner` (validated, empty clears); snapshots capture and restore it
- [x] A-008 R8: `getOperatorParts` returns `{ head: "done · operator-touched" }` for owner-only windows, keeps watched behavior when monitored, null otherwise; `WindowInfo.owner` typed
- [x] A-009 R9: flyout card body renders for owner-only windows with the done head and no stale dimming; PANE panel shows the same; `window-row.tsx` unchanged
- [x] A-010 R10: `docs/site/skill.md` documents the verbs, README row updated, and `app/backend/cmd/rk/skill/skill.md` is byte-identical after sync
- [x] A-011 R11: `rk help-dump` lists the five verbs under `tab`; help-dump tests pass

### Behavioral Correctness

- [x] A-012 R2: `rk tab mark pipe` exits 2 with the closed-set message and performs no write
- [x] A-013 R3: the `/options` note path behaves exactly as before after switching to `validate.ValidateNoteText` (existing `windows_test.go` cases pass unchanged)
- [x] A-014 R6: every pre-existing `parseWindows` test passes at the shifted indices (no field mis-assignment)

### Scenario Coverage

- [x] A-015 R1: tests cover own-tab set, addressed set, `--off` (including already-unset), and `--off`+value usage error
- [x] A-016 R4: tests assert exactly one wake per successful mutation and none on rejection
- [x] A-017 R8: `registers.test.ts` covers owner-only (with a stale, ticking operator), monitored+owner precedence, and neither
- [x] A-018 R9: `row-flyout-card.test.tsx` covers the owner-only body/`opr` line with `data-stale` absent under `operator.stale: true`

### Edge Cases & Error Handling

- [x] A-019 R3: 121-character note and a note with an embedded tab/newline are rejected (exit 2); `-` with multi-line stdin is rejected the same way
- [x] A-020 R1: `-L <server>` without an explicit address remains a usage error on the new verbs (inherited from `resolveTabWindow`)
- [x] A-021 R6: an unknown `@rk_win_owner` value (e.g. `bogus`) reads as unset and never reaches the frontend payload

### Code Quality

- [x] A-022 Pattern consistency: new verb files follow `tab_code.go` (cobra `Use`/`Short`/`Long`, `SilenceUsage`, `usageArgs` wrap at the add site, `tabContext` + `tabCmdTimeout`, `newSink(cmd).Dataf`)
- [x] A-023 No unnecessary duplication: one shared setter helper; no CLI-side copies of validator tables; the note bound exists once in `validate`
- [x] A-024 Subprocess safety: all tmux interaction goes through `internal/tmux` (`SetWindowOptions`), argv slices with timeouts — no shell strings
- [x] A-025 Tests accompany every added/changed behavior (Go `_test.go` alongside; Vitest colocated)
- [x] A-026 Comment discipline: comments state constraints/contracts only — no narration, no change IDs or PR numbers
- [x] A-027 Type narrowing over assertions in the frontend changes (no `as` casts introduced)

### Security

- [x] A-028 R2: every value that reaches `tmux set-option` passed a closed-set or normalizing validator (Constitution I); no raw user string is written except the validated, control-rune-free note text

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one redundancy it created (`api/windows.go`'s private `windowNoteMaxLen` constant and inline control-rune loop) was deleted in-diff, replaced by the shared `validate.ValidateNoteText` / `validate.NoteTextMaxLength`. The fab-side `»`/`›` window-name mutation this option supersedes lives in fab-kit (cross-repo follow-up, tracked separately), not in this repository.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Owner field inserted after flair in `windowFormat`; legacy tail stays last | Intake decision 10; the tail-last invariant is documented in the tmux-sessions registry | S:70 R:80 A:90 D:80 |
| 2 | Confident | Verb files are one per verb plus one shared `tab_signal.go` helper | Family idiom (one file per verb) plus the duplication anti-pattern | S:65 R:90 A:85 D:75 |
| 3 | Confident | `ValidateNoteText` returns the trimmed text and leaves the empty-after-trim decision to callers | The API treats empty as unset, the CLI as a usage error — one validator must serve both | S:60 R:90 A:85 D:75 |
| 4 | Confident | Note epoch clock is injectable via a package-level `tabNowFn` seam | The family already uses package-level `*Fn` seams for tests | S:55 R:95 A:85 D:80 |
| 5 | Certain | `%N` pane ids are not added to the address grammar | Intake scoped it out; fab resolves pane → window itself | S:85 R:90 A:90 D:90 |
| 6 | Confident | The done head is never dimmed by `operator.stale` | Stale describes the live loop; an owner-only row has no loop relation (intake § 3) | S:70 R:90 A:85 D:80 |

6 assumptions (2 certain, 4 confident, 0 tentative).
