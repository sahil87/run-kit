# Intake: tmux Option Dual-Read for Externally-Written Keys

**Change**: 260828-5jlp-tmux-option-dual-read-external-keys
**Created**: 2026-08-28

## Origin

> Change 3 from fab/plans/sahil/26-08-28-tmux-option-scope-naming.md: run-kit dual-read rename for the 4 externally-written tmux options (ephemeral, protected, agent_state, chat) plus rk agent setup hook generation bump (feature). Read that plan files Change 3 section in full before drafting the intake.

Mode: `/fab-draft`, one-shot description pointing at a rollout plan, with two clarifying questions
asked and answered before generation. This is **Change 3 of 4** in
`fab/plans/sahil/26-08-28-tmux-option-scope-naming.md` (the `@rk_<scope>_<name>` rollout). The
rule of record is `fab/project/context.md` § Conventions: every tmux user option sits in the
`@rk_` namespace and carries its scope in its name; keys written by anything outside the `rk`
binary are **dual-read for a release** before the old name is dropped.

Two plan premises were checked against the tree at `67f4a553` and found not to hold as written;
the user resolved both:

1. **fab-kit blind-window** — fab-kit reads only `@rk_agent_state`
   (`~/code/sahil87/fab-kit/src/go/fab/internal/pane/pane.go:25`,
   `cmd/fab/pane_map.go:360`) until plan Change 4 ships. Switching `rk agent hook` to write
   only the new name would blind fab's pane map (the migration copies old→new, never new→old).
   **User decision: dual-write both names for now**, and keep a written ledger of the
   deprecated pieces to remove after a few releases ("after a week of updates").
2. **Hook generation bump** — the current third-generation hook text
   (`agentStateHookCommand`, `cmd/rk/agent_setup.go:120`) is
   `/bin/sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<rkPath>" agent hook --agent claude <state> 2>/dev/null || true'`
   — it names no option; the write lives in the binary (`cmd/rk/agent_hook.go:430`,
   `writeAgentStateImpl`). Only retired first-generation inline one-liners still contain
   `@rk_agent_state`. A text bump would be a no-op forcing every user to re-run
   `rk agent setup`. **User decision: add an `agent hooks` `rk doctor` row; no hook-text
   change and no generation bump.**

Update at `60afc45d`: plan Changes 1 (#752 `ca14545f`) and 2 (#753 `60afc45d`) have since merged and this
branch is rebased onto them — `internal/tmux/legacy_options.go` now holds the migration table; see
§ Migration table below.

## Why

**Problem.** tmux format expansion resolves `#{@foo}` by walking pane → window → session →
global, so a user option set at an outer scope leaks into every inner-scope read and the
inner-scope clear removes nothing. The fix (plan § Diagnosis) is to encode scope in the name:
`@rk_<scope>_<name>`. Four of the 22 options are written by things **other than the `rk`
binary** and cannot simply be renamed in one commit:

| Current | Target | Scope | Who writes it besides rk |
|---|---|---|---|
| `@rk_ephemeral` | `@rk_srv_ephemeral` | server (`-s`) | `scripts/test-e2e.sh:91`, Playwright `tests/e2e/_tmux.ts:104`, agents by convention (`set-option -s @rk_ephemeral 1`) |
| `@rk_protected` | `@rk_srv_protected` | server (`-s`) | any creator by convention; `tests/e2e/protected-kill-confirm.spec.ts:22` |
| `@rk_agent_state` | `@rk_pane_agent_state` | pane (`-p`) | `rk agent hook` on every machine with hooks installed (any rk version); first-gen inline hooks; **read by fab-kit**; `tests/e2e/sort-windows.spec.ts:64,71` |
| `@rk_chat` | `@rk_pane_chat` | pane (`-p`) | `rk agent hook` (same fires); `tests/e2e/right-panel.spec.ts:259` |

**Consequence of not doing it.** The scope-naming invariant stays half-applied: Change 2 renames
the 15 rk-private keys, but four keys keep the un-prefixed form forever because a hard rename
would (a) break every machine whose installed `rk` still writes the old pane names, (b) break
fab-kit's operator pane map, and (c) silently orphan e2e servers from the reaper's ephemeral
sweep. The registry would document two naming schemes indefinitely.

**Why this approach.** Dual-read + dual-write + copy-forward migration is the only shape that
lets the new names go live without a flag day across two repos and N operator machines. The
server keys (`ephemeral`, `protected`) have no cross-repo reader and are written by rk-owned
scripts, so they migrate fully (copy + unset old) like the rk-private keys. The pane keys are
written by every installed `rk` binary and read by fab-kit, so they get the widest window:
readers accept both, `rk agent hook` writes both, the migration only copies forward (never
unsets old), and a doctor row makes the remaining stragglers visible. Removal is explicitly a
follow-up gated on Change 4 having shipped.

## What Changes

### Migration infrastructure already present (Changes 1 + 2 landed)

`internal/tmux/legacy_options.go` (from #752/#753) provides everything this change extends:
`legacyOption{Old, New string; Scope optionScope}` rows in the `legacyOptions` table;
`sweepLegacyTargets` → `moveLegacyAt` (right scope: copy when New unset, then unset Old) /
`purgeLegacyAt` (wrong scope: unset only); `MigrateLegacyOptionsOnce` (in-memory once-guard, called
from `managedconf.go:205` RefreshSweep, `api/tmux_config.go:52` reload, `api/terminals_ws.go:411`
WS-attach, `api/servers.go:326` adopt, `cmd/rk/mux_adopt.go`); `CountLegacyOptions` feeding the
`rk doctor` `legacy option names` row (`doctor.go:184-238`). Tests in `legacy_options_test.go` use a
real `-L` test socket (`legacyTmuxDo` / `legacyHeld` helpers). Change 2 also set the dual-read
precedent for a format-string field: `` appends the new field and keeps the legacy
`#{@rk_note}` field LAST (`tmux.go:1210`), new wins.

This change adds a **`CopyOnly bool`** field to `legacyOption`. `moveLegacyAt` skips the trailing
`unsetOptionAt(Old)` when `row.CopyOnly` (copy still happens when New is unset; a row with both
held issues nothing). `purgeLegacyAt` is unchanged — wrong-scope strays are still removed.
`CountLegacyOptions` MUST NOT count a `CopyOnly` row held at its right scope (that is the sanctioned
state for the deprecation window), but still counts it at a wrong scope; otherwise the doctor row
reports every instrumented server dirty forever.

### `internal/tmux` — constants and dual-read

New constants alongside the existing ones (`tmux.go:55,67,410,429`); the old names become
`Legacy*` constants that stay exported for the deprecation window:

```go
const EphemeralOption       = "@rk_srv_ephemeral"   // was "@rk_ephemeral"
const LegacyEphemeralOption = "@rk_ephemeral"
const ProtectedOption       = "@rk_srv_protected"   // was "@rk_protected"
const LegacyProtectedOption = "@rk_protected"
const AgentStateOption       = "@rk_pane_agent_state" // was "@rk_agent_state"
const LegacyAgentStateOption = "@rk_agent_state"
const ChatOption       = "@rk_pane_chat"   // was "@rk_chat"
const LegacyChatOption = "@rk_chat"
```

Readers accept both names, **new wins when both are set**, reads stay tmux-derived with no
cache (Constitution II):

- `IsEphemeralServer` / `IsProtectedServer` (`tmux.go:3041,3076`): read new via
  `show-option -sv`; if unset (the existing `invalid option`/`unknown option` taxonomy), read
  old the same way. Truthy = non-empty trimmed value of whichever resolved. `IsServerGone`
  and wrapped-error semantics unchanged. `tmux.EphemeralServers` / `enumerateMarkedServers`
  (`reaper.go`) inherit this through the predicates — no change there.
- `paneFormat` (`tmux.go:1166`) grows from 9 to **11 fields**: append
  `#{@rk_pane_agent_state}` and `#{@rk_pane_chat}` **after** `#{alternate_on}` (appending
  keeps fields 0–8 stable for every existing parser index). `parsePanes` resolves
  `agentStateRaw = field9 if non-empty else field6`, `chatRaw = field10 if non-empty else
  field7`, then feeds the existing `parseAgentState` / `parseChatRef` + pid-liveness
  reconcile unchanged. Update the field-count comment block (`tmux.go:879-901,1094-1097`).
- `PaneFactsCtx` (`pane_target.go:111-112`): the `display-message` format becomes
  `#{pane_current_path}\t#{pane_current_command}\t#{@rk_agent_state}\t#{@rk_pane_agent_state}`;
  `parsePaneFacts` prefers the 4th field when non-empty. `PaneAgentState` inherits it.
- Any other raw `#{@rk_agent_state}` / `#{@rk_chat}` format literal or `show-option -pv`
  read in `internal/` or `cmd/rk/` (`grep -rn '@rk_agent_state\|@rk_chat' app/backend
  --include='*.go'` — the hits at `mux_await.go`, `mux_send.go`, `mux_process.go`,
  `mux_kill.go`, `mux_panes.go`, `mux_capture.go` go through `PaneAgentState`/`PaneFactsCtx`
  or the sessions path; confirm none reads the option directly, fix any that does).

### Writers rk owns

- **Server keys switch to new names now** (no dual-write — no external reader, and the
  migration below unsets old):
  - `MarkServerEphemeral` (`tmux.go:3061`), `MarkServerProtected` / `UnmarkServerProtected`
    (`tmux.go:3096,3106`) write/unset `@rk_srv_*`. `UnmarkServerProtected` MUST also unset
    the legacy name (a demote must not leave the old mark arming the guard through the
    fallback read).
  - `scripts/test-e2e.sh:91` → `set-option -s @rk_srv_ephemeral 1`.
  - `app/frontend/tests/e2e/_tmux.ts:104` → `@rk_srv_ephemeral`.
  - `tests/e2e/protected-kill-confirm.spec.ts:22` → `@rk_srv_protected` (and its `.spec.md`).
  - Help text / Long strings that interpolate `tmux.EphemeralOption` / `tmux.ProtectedOption`
    (`cmd/rk/reaper.go:75,108`, `mux_new.go:57`) pick up the new names automatically; the
    literal `@rk_ephemeral` in `cmd/rk/doctor.go:161` and `api/servers.go:247` become the
    constant. Toolkit-standards check applies (Constitution § Toolkit Standards) because
    `rk mux new --ephemeral` help and `docs/site/skill/mux.md:15,18` name the option.
- **Pane keys dual-write** (user decision): `writeAgentStateImpl` (`agent_hook.go:427-436`)
  and `writeChatImpl` (`agent_hook.go:452-460`) each issue **one** `tmux` exec that sets both
  names — `set-option -pt <pane> @rk_pane_agent_state <v> ; set-option -pt <pane>
  @rk_agent_state <v>` as discrete argv elements with a literal `;` separator (tmux command
  chaining; no shell, Constitution I). Same value, same `-S <socket>` derivation from
  `tmux.OriginalTMUX`, same never-fail contract and `agentHookCmdTimeout`. The
  `writeAgentStateFn` / `writeChatFn` test seams keep their signatures; unit tests assert the
  argv carries both option names once each.
- **No hook text change.** `agentStateHookCommand`, the three `rkHookMarker*` constants, and
  `isRkEntry` are untouched. `rkHookMarker = tmux.AgentStateOption` (`agent_setup.go:61`)
  MUST be repointed to `tmux.LegacyAgentStateOption` — its job is to recognise first-gen
  one-liners, which inline the OLD name; leaving it bound to the renamed constant would stop
  `rk agent setup` from stripping/uninstalling gen-1 entries.
- **Test writers** that seed pane options directly switch to the new names:
  `tests/e2e/sort-windows.spec.ts:64,71` (`@rk_pane_agent_state`),
  `tests/e2e/right-panel.spec.ts:259` (`@rk_pane_chat`); companion `.spec.md` files updated.

### Migration table rows

Add four rows to `MigrateLegacyOptions`:

| old | new | scope flag | copyOnly |
|---|---|---|---|
| `@rk_ephemeral` | `@rk_srv_ephemeral` | `scopeServer` | false |
| `@rk_protected` | `@rk_srv_protected` | `scopeServer` | false |
| `@rk_agent_state` | `@rk_pane_agent_state` | `scopePane` | **true** |
| `@rk_chat` | `@rk_pane_chat` | `scopePane` | **true** |

`copyOnly = true` means: copy old → new when new is unset, **never unset old**. The daemon
cannot see which rk version writes hooks on other machines, and fab-kit still reads the old
name; the wrong-scope unset rule still applies (an `@rk_agent_state` found at window/session/
server scope is unset — those can only be strays). Server rows migrate normally (copy, then
unset old). Second run is a no-op.

### `rk doctor` — new `agent hooks` row

New check in `cmd/rk/doctor.go` following `tmuxGuardShimCheck`'s shape
(`doctorCheck{Name, OK, Note, Hint, failLabel}`, injected `home`, pure over file content, unit
tested with fixture JSON):

- For each agent in `agentRegistry(home)` (v1: Claude Code, `~/.claude/settings.json`): read
  the settings file; if absent or it carries no rk entries → `OK`, Note
  `not installed (optional — install with \`rk agent setup\`)`.
- Classify each rk-owned hook command (reuse `isRkEntry`'s three markers): gen-1 = contains
  `@rk_agent_state` inline; gen-2 = ` agent-hook `; gen-3 = ` agent hook `.
- **FAIL** (`failLabel: "agent hooks"`) when any gen-1 or gen-2 entry exists: Hint
  `N stale hook entr(y|ies) in <path> (generation <g>) — they write legacy option names; re-run \`rk agent setup\` to replace them`.
- **FAIL** when a gen-3 entry's embedded rk path (the first double-quoted token after `; `)
  is not an existing regular executable — the same dangling-binary class the shim check
  catches — Hint names the path and says re-run `rk agent setup`.
- Otherwise `OK`, Note `installed (generation 3, <agent>); writes @rk_pane_agent_state + @rk_agent_state`.
- The legacy-name server-count row belongs to Change 1 (`legacy option names`); this change
  adds only the `agent hooks` row.

### Docs

- `docs/specs/agent-state.md` (cross-repo contract with fab-kit): title and § The Option name
  both keys; add a **Naming / Deprecation window** subsection stating: canonical name is
  `@rk_pane_agent_state` (`@rk_pane_chat`); `rk agent hook` writes both names; readers prefer
  new and fall back to old; fab-kit must read new-then-old (plan Change 4); the old write and
  old read are removed together in a follow-up no sooner than one release after Change 4
  ships and `rk doctor` shows no stale hooks. Mirror in § Chat Session Identity.
- Memory (hydrate targets, listed below): registry rows in `tmux-sessions.md` renamed with a
  **Legacy name** column and the four migration rows; `agent-state.md`, `agent-messaging.md`,
  `test-sockets.md`, `layout-snapshots.md`, `daemon-lifecycle.md` (doctor row), `chat.md`
  option-name mentions.
- `docs/site/skill/mux.md`, `docs/site/skill.md`, `docs/site/status-dot.md` mentions →
  new names (toolkit-standards pass).

### Deprecation ledger (carry into plan.md verbatim, and into memory)

Everything below is temporary and removed by the plan's "Follow-up — remove legacy reads"
change, **no sooner than one release after fab-kit Change 4 ships** and the operator's fleet
shows `rk doctor` `agent hooks` OK everywhere for about a week of updates:

1. `Legacy*Option` constants (`internal/tmux/tmux.go`).
2. Old-name fallback reads: `IsEphemeralServer`/`IsProtectedServer` second `show-option`;
   `paneFormat` fields 6–7 (`#{@rk_agent_state}`, `#{@rk_chat}`) and the field9/field6,
   field10/field7 preference in `parsePanes`; `PaneFactsCtx`'s 3rd field.
3. Dual-write second `set-option` in `writeAgentStateImpl` / `writeChatImpl`.
4. `copyOnly` semantics on the two pane rows → rows become unset-only for one further release,
   then deleted.
5. `rkHookMarker` (gen-1 recogniser) — already scheduled by the agent-setup indirection change;
   removal date now tied to this ledger.
6. Doctor `agent hooks` row's gen-1/gen-2 classification (the row itself stays; its FAIL
   branches for generations < 3 can go once nothing reports them).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) registry rows for the four keys → new names + Legacy
  column; `MigrateLegacyOptions` four rows with the `copyOnly` pane rule
- `run-kit/agent-state`: (modify) option name `@rk_pane_agent_state` / `@rk_pane_chat`,
  dual-write in `rk agent hook`, dual-read in `paneFormat`/`PaneFactsCtx`, `rkHookMarker`
  repoint, deprecation ledger
- `run-kit/agent-messaging`: (modify) `@rk_agent_state` mentions in the send/await gate prose
- `run-kit/test-sockets`: (modify) e2e creation sites mark `@rk_srv_ephemeral`; reap sweep
  reads both
- `run-kit/layout-snapshots`: (modify) snapshotter ephemeral predicate name
- `run-kit/daemon-lifecycle`: (modify) new `rk doctor` `agent hooks` row
- `run-kit/chat`: (modify) `@rk_pane_chat` naming
- `run-kit/ui/status-signals`, `run-kit/ui/chat-view`: (modify) option-name mentions only

## Impact

- **Backend Go**: `internal/tmux/tmux.go` (constants, `paneFormat`, `parsePanes`,
  `IsEphemeralServer`, `IsProtectedServer`, `Mark*`/`Unmark*`), `internal/tmux/pane_target.go`,
  `internal/tmux/reaper.go` (comments), `internal/tmux/legacy_options.go` (+ `_test.go` — `CopyOnly` rows), `cmd/rk/agent_hook.go` (dual-write), `cmd/rk/agent_setup.go`
  (`rkHookMarker` repoint), `cmd/rk/doctor.go` (+ `doctor_test.go`), `cmd/rk/doctor.go:161`,
  `api/servers.go:247` literals. 8 `_test.go` files reference the literals and need re-pointing;
  new units: dual-read precedence (new-only / old-only / both-set / neither) for both pane
  fields and both server predicates; dual-write argv; migration copy-only vs full rows on a
  real test socket; doctor fixtures for gen-1/2/3, dangling path, absent file.
- **Frontend**: no API payload change (`ephemeral`/`protected`/`agentState`/`chat*` fields
  unchanged). 11 `.ts`/`.tsx` files mention the literals — mostly comments/test names; the
  three e2e writers above plus `_tmux.ts` change behaviour; their `.spec.md` companions
  update in the same commit.
- **Scripts**: `scripts/test-e2e.sh:91`.
- **Cross-repo**: fab-kit unaffected at runtime because of dual-write; Change 4 adds its
  new-then-old read. fab-kit docs need an `rk` version floor (the release carrying this change).
- **Operator runtime**: after upgrade, the daemon's first managed-conf sweep copies pane
  options forward on every managed server; `rk doctor` gains one row. No session restarts,
  no `rk agent setup` re-run required.
- **Sequencing**: PR ships after or alongside Change 1 (rebase onto whichever lands first; the
  only overlap is the migration table). Change 2 (rk-private rename) is independent.

## Open Questions

- None blocking. Whether the e2e suite should run against a server pre-seeded with the legacy
  pane/server names to exercise the sweep (plan § Sequencing note) is left to apply — a Go
  unit on a test socket covers the migration; an e2e seeding step is optional.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pane keys (`@rk_agent_state`, `@rk_chat`) are dual-written by `rk agent hook`; removal deferred to the follow-up with a written ledger | Asked — user chose dual-write and asked for the deprecation ledger | S:95 R:85 A:90 D:95 |
| 2 | Certain | Doctor gains an `agent hooks` row classifying installed hook generations; no hook-text change, no generation bump | Asked — user chose "doctor row, no text bump"; gen-3 text names no option | S:95 R:90 A:90 D:95 |
| 3 | Certain | Target names are `@rk_srv_ephemeral`, `@rk_srv_protected`, `@rk_pane_agent_state`, `@rk_pane_chat` | Plan § Target map + context.md rule | S:100 R:80 A:100 D:100 |
| 4 | Certain | Reads stay tmux-derived, no cache; new wins when both set | Plan Change 3 text; Constitution II | S:95 R:90 A:95 D:95 |
| 5 | Certain | Server keys switch writers to new names now and migrate fully (copy + unset old) | Plan text; no external reader for server keys | S:90 R:80 A:90 D:90 |
| 6 | Certain | Extend the existing `legacyOptions` table (Changes 1+2 landed at #752/#753) with a `CopyOnly` field and four rows; `CountLegacyOptions` skips right-scope CopyOnly rows | Verified in tree at 60afc45d | S:90 R:85 A:95 D:90 |
| 7 | Confident | Dual-write uses one tmux exec with `;`-chained `set-option` commands (argv elements, no shell) | Constitution I; halves hook-fire subprocess cost vs two execs; tmux supports `;` chaining | S:60 R:90 A:80 D:70 |
| 8 | Confident | `paneFormat` appends the two new fields (fields 9–10) rather than replacing 6–7 | Keeps every existing index stable; removal in follow-up drops 6–7 then | S:65 R:85 A:85 D:75 |
| 9 | Certain | `rkHookMarker` is repointed to `LegacyAgentStateOption` | Its purpose is recognising gen-1 inline one-liners, which carry the old literal | S:75 R:90 A:90 D:85 |
| 10 | Certain | `UnmarkServerProtected` also unsets the legacy name | A demote that leaves the old mark would re-arm the guard through the fallback read | S:70 R:90 A:85 D:80 |
| 11 | Confident | Migration pane rows are copy-only via a `copyOnly bool` row field; wrong-scope unset still applies | Plan text ("only copy-forward, never unset old"); field name is this intake's choice | S:80 R:85 A:80 D:70 |
| 12 | Confident | Doctor also FAILs on a gen-3 hook whose embedded rk path is missing/non-executable | Mirrors `tmuxGuardShimCheck`'s dangling-target rule; same brew-rename failure class | S:55 R:90 A:80 D:70 |
| 13 | Certain | The existing `legacy option names` doctor row is kept, with CopyOnly right-scope holds excluded from its count | Row landed in #752; counting sanctioned dual-state would make it permanently dirty | S:70 R:90 A:80 D:75 |
| 14 | Confident | Follow-up removal window = one release after fab-kit Change 4 ships AND ~a week of `rk doctor` clean on the fleet | User said "after a few releases (after a week of updates)"; exact gate is a judgment call recorded in the ledger, not enforced by code | S:55 R:95 A:60 D:55 |
| 15 | Confident | e2e pre-seeding with legacy names is optional; Go unit on a test socket is the required migration coverage | Plan's sequencing note suggests it; cost/benefit left to apply | S:50 R:90 A:65 D:55 |

15 assumptions (9 certain, 6 confident, 0 tentative, 0 unresolved).
