# Intake: `rk tab` signal setter verbs + `@rk_win_owner`

**Change**: 260910-hzih-tab-setter-verbs-owner-option
**Created**: 2026-09-10

## Origin

Backlog item `[hzih]` (2026-09-10, tagged "fab-kit operator follow-up"), created via `/fab-new hzih`
in an interactive session. Raw backlog text:

> rk tab mark / rk tab note setter verbs for the @rk_win_marker / @rk_win_color / @rk_win_note /
> @rk_win_flair window options, plus a 'tracked by operator' rendering. The frontend already renders
> these (app/frontend/src/marker.tsx, window-marker-gutter.spec.ts) but the only setter is raw
> `tmux set-option -w @rk_win_<name> <value>` (rk skill § Sidebar signals), so fab's operator marks
> tracked windows by renaming them with a » prefix and › on completion via
> `fab pane window-name ensure-prefix|replace-prefix` (fab-operator.md §4 Enrollment/Removal). Add:
> `rk tab mark [@N] <manual|auto|blocked>[:1-3] | --off`, `rk tab note [@N] <text>` (stamps the
> epoch), `rk tab color [@N] <v>`, all validating the closed sets the renderer accepts; plus a marker
> value or an @rk_win_owner=operator option the sidebar shows as tracked/done so the » / › name
> mutation can be retired. Overlaps [8fjh] tab-note extensions (operator writes a one-line note per
> tab) — that item's operator-fold is this verb's first consumer.

**Gap analysis surfaced at intake** (and confirmed with the user):

1. The "tracked by operator" rendering **already shipped** in `260910-0536-watched-underbar-opr-register`
   (same day): `internal/sessions.FetchSessions` joins the fab operator state file's `monitored:` map
   onto windows by pane id (`WindowInfo.Monitored*`), the sidebar `StatusDot` paints the additive
   **watched underbar** for `win.monitored === true`, and the flyout card / PANE panel carry the L4
   `opr` register (`watched · <stage> · tick <age> ago`). No tmux option is needed for the *active*
   tracked state — Constitution X: derivation wins when a fact is available both ways.
2. The "marker value" route for operator ownership is **ruled out** by that change's recorded design
   decision: the marker well is human-declared mode × stage and status never reads from or writes
   to it (`status-signals.md` § Design Decisions, rejected "marker-well texture (human-owned well)").
3. What is missing for the » / › retirement is only the › **done / operator-touched trail**. The user
   chose **"Owner option, card-only"**: add `@rk_win_owner=operator` + `rk tab owner`, fab writes it at
   enrollment and never clears it; the row keeps the existing underbar for monitored windows; a window
   with owner set but no longer monitored shows `done · operator-touched` on the `opr` register with
   **no new row glyph**.

The setter verbs themselves (`mark` / `note` / `color` / `flair`, any tab, `--off` clears) were never
in question and are the core of the change.

## Why

**The pain.** Every `@rk_win_*` signal the dashboard renders — marker, color, note, flair — has a
validated write path only through the HTTP `/options` endpoint, which requires a running `rk serve`.
From a shell (an agent inside a pane, the fab operator, a test script) the only setter is the raw
`tmux set-option -w @rk_win_<name> <value>` documented in `rk skill` § Sidebar signals. Raw writes
bypass the closed-set validators (`validate.MarkerValues` / `FlairValues` / `ValidateColorValue` / the
note's 120-char + no-control-char rule), so an agent can store `@rk_win_marker=pipe` (a retired flat
token) or a 400-char note, and the reader silently drops or truncates it. Agents also have to remember
the `<epoch>:<text>` note schema and stamp `$(date +%s)` themselves. The `rk tab` family already owns
layout / web / code-root writes with exactly the shape these need (resolve address → validate → one
`set-option` → print the datum → SSE wake), but stops short of the four signal options.

**The consequence for fab.** Because rk offers no ownership signal, fab-operator marks the windows it
tracks by **renaming them**: `»` prefixed at enrollment, swapped for `›` at removal
(`fab pane window-name ensure-prefix|replace-prefix`). Window names are user-owned identity (inline
rename, `fix-tab-name`, folder auto-naming) — the prefix collides with every one of those writers,
is lost on a user rename mid-monitoring, and encodes a relation in a channel the status pyramid says
must be an overlay. rk now derives "watched" for real; fab keeps the rename only because rk has no
verb for the residual "this window was operator-touched" fact and no CLI it can call.

**If we don't fix it.** Agents keep writing unvalidated options, the skill bundle keeps teaching raw
`set-option` for a family that has a CLI, and fab keeps mutating names — a fourth writer fighting the
window-name channel forever. The `[8fjh]` operator note-writing fold has no setter to consume.

**Why this approach.** Extend the existing `rk tab` family rather than add a new command: the address
grammar, `-L/--server`, own-tab resolution, the `tabSetWindowOptionsFn` write seam, exit-code
convention, and the `tabWakeFn` SSE wake are all in place; each new verb is a thin validated write.
Reuse the `internal/validate` closed sets so CLI and API cannot drift (one table, two writers — the
`layoutspec` precedent). For ownership, a **new closed-set option** `@rk_win_owner` rather than a
marker value (human-owned well) or a window-name prefix (identity channel): it is per-entity state,
which Constitution IV places in `@rk_*` tmux options; it survives user renames; it is the one fact the
watchlist join cannot derive after fab removes the entry.

## What Changes

### 1. Five setter verbs on `rk tab`

All five share one shape. `[@N]` is the full tab address grammar (`@N`, `=session:window`, omitted =
caller's own tab via `$TMUX_PANE`); `-L/--server` is the family's persistent flag (requires an explicit
address). Each verb is a **mutating** verb: after printing its datum it fires the fail-silent
`tabWakeFn` SSE-hub wake (never before, never on failure).

```
rk tab mark  [@N] <manual|auto|blocked>[:1|:2|:3] | --off     → prints the stored token
rk tab note  [@N] <text> | -                      | --off     → prints "<epoch>:<text>"
rk tab color [@N] <value>                         | --off     → prints the normalized value
rk tab flair [@N] <name>                          | --off     → prints the stored token
rk tab owner [@N] operator                        | --off     → prints "operator"
```

**Argument shape** (cobra `RangeArgs(0, 2)`, wrapped by `usageArgs` at the add site so count
violations exit 2):

| Form | Meaning |
|------|---------|
| `<value>` | own tab, set |
| `@N <value>` | addressed tab, set |
| `--off` | own tab, unset |
| `@N --off` | addressed tab, unset |
| `--off <value>` / `@N <value> --off` | usage error, exit 2 (`--off takes no value`) |

Two positional args ⇒ the first is the address. One positional arg ⇒ it is the address when `--off`
is set, else the value. This is deterministic, so `note` text is never sniffed for address-likeness.

**Set** writes one `tmux.WindowOptionOp{Key, Value: &v}` through `tabSetWindowOptionsFn`; **`--off`**
writes `{Key, Value: nil}` (an unset) and prints nothing (the `web rm`/`select` idiom). `--off` on an
already-unset option is a no-op success (idempotent — toolkit principle 5). Stdout is one datum via
`sink.Dataf` (survives `--quiet`); diagnostics ride stderr.

**Validation — the closed sets are the `internal/validate` tables, never a CLI copy:**

| Verb | Option | Rule | Stored / printed value |
|------|--------|------|------------------------|
| `mark` | `@rk_win_marker` (`tmux.MarkerOption`) | `validate.ValidateMarkerValue` — one of the twelve `<mode>[:<stage>]` tokens. Retired flat tokens (`pipe`, `hatch`, …) are **rejected** with the closed-set message: `NormalizeMarker` is the read-side compat map, and a writer must not mint legacy values | the accepted token verbatim (`auto`, `auto:2`) — API parity, `rk tab show` reads back the same string |
| `note` | `@rk_win_note` (`tmux.NoteOption`) | trim; reject `> 120` chars and any control rune; a value that trims to empty is a usage error (`use --off to clear`). `-` reads all of stdin (then the same rule — an embedded newline is a control char and is rejected). The rule moves from the `api` package's private `windowNoteMaxLen` + inline loop into a shared `validate.ValidateNoteText(text) (trimmed string, errMsg string)` consumed by both the `/options` handler and this verb | `fmt.Sprintf("%d:%s", time.Now().Unix(), trimmed)` — the CLI owns its clock exactly as the API handler does |
| `color` | `@rk_win_color` (`tmux.ColorOption`) | `validate.ValidateColorValue` (index `0`–`15`, family name, `a+b` blend) then `validate.NormalizeColorValue` | the normalized form (`"01"` → `1`, `" 1 + 3 "` → `1+3`, `slate` → `slate`) |
| `flair` | `@rk_win_flair` (`tmux.FlairOption`) | `validate.ValidateFlairValue` (the fifteen `flairTokens`) | the token verbatim |
| `owner` | `@rk_win_owner` (new `tmux.OwnerOption`) | new `validate.ValidateOwnerValue` over `ownerTokens = []string{"operator"}` (the `roleTokens` idiom) | `operator` |

Invalid values are **usage-class (exit 2)** — the same class as a malformed layout in `rk tab layout`;
tmux failures / not-in-tmux / pane vanished are operational (exit 1). Help text for each verb names
the accepted set in its `Long` (layered help, principle 3) — the marker set as `manual|auto|blocked`
`× :1|:2|:3` with "bare mode = stage 1", the flair set enumerated, color as "ANSI index 0–15, a palette
family name, or a blend a+b".

File layout follows the family: one file per verb (`tab_mark.go`, `tab_note.go`, `tab_color.go`,
`tab_flair.go`, `tab_owner.go`) registered in `tab.go`'s `init` (so the `usageArgs` wrap loop covers
them) and listed in the parent's `Long` subcommand table. Because `mark`/`flair`/`owner` are the same
closed-set setter differing only in option + validator, a small shared helper (e.g.
`runTabOptionSet(cmd, args, option, validateFn, offFlag)`) is expected — three near-identical `RunE`
bodies would trip the duplication anti-pattern.

Tests (Go, `tab_test.go` seams — `tabSetWindowOptionsFn` / `tabWakeFn` / the own-tab resolver): per
verb — set writes the right op and prints the datum, `--off` writes a nil op and prints nothing, an
invalid value exits 2 with the closed-set message and writes nothing, the wake fires after a
successful set/unset and not on failure; `note` — epoch stamp shape, trim, 120-char and control-char
rejections, `-` stdin; `mark` — a retired flat token is rejected.

### 2. `@rk_win_owner` — the operator-ownership option

A new window-scoped (`-w`) user option in the `@rk_win_*` namespace (naming rule per
`fab/project/context.md`; registry row in `tmux-sessions.md` § Server-Scoped User Options).

- **Value set**: closed — `""` (unset) | `operator`. Extensible later by appending a token; nothing
  else is reserved now.
- **Semantics**: "an operator has taken responsibility for this window at least once". The intended
  writer is fab-operator at **enrollment** (`rk tab owner <addr> operator`), and fab **never clears
  it** at removal — the persisted value is the › trail. `--off` exists for a human (or a future fab
  policy) to clear it explicitly.
- **Read path**: `internal/tmux` `windowFormat` gains `#{@rk_win_owner}` and `parseWindows` a
  closed-set parse (unknown → `""`, the Marker idiom) into `WindowInfo.Owner string json:"owner,omitempty"`.
  Field placement: inserted **after `@rk_win_flair`** so the closed-set fields stay grouped, shifting
  the strict note field and the two retired dual-read fallbacks by one; the legacy free-text note
  tail stays LAST (its rejoin index moves with it). `windowLineMarker`/test line builders and the
  registry table's field numbers update accordingly.
- **API**: the `/options` partial-merge allowlist (`api/windows.go`) gains `optKeyOwner =
  tmux.OwnerOption` with `validate.ValidateOwnerValue`; empty string ⇒ unset (the
  marker/role/flair/note contract). No new route (Constitution IV/IX) — the CLI is the intended
  writer; the API key exists so the option is not a CLI-only orphan and so snapshot/restore and
  future UI actions have the same seam.
- **Snapshot**: `snapshot.WindowSnapshot.Owner string json:"owner,omitempty"` captured; `restore.go`'s
  option re-stamp adds `add(tmux.OwnerOption, win.Owner)` beside marker/flair/role/note.
- **`rk tab show`** needs no change (prefix-filtered dump).
- **Spec note**: `docs/specs/ui-state.md` OQ2 reserved the name `@rk_win_owner` for the never-shipped
  *companion* concept ("which window does this companion belong to"). This change takes the name for
  operator ownership; a revived companion feature needs another name (e.g. `@rk_win_parent`). The
  inventory row + this resolution are proposed to the spec at hydrate (spec is human-curated).

### 3. Done trail — `opr` register only

Frontend (`app/frontend/src/`):

- `types.ts` `WindowInfo` gains `owner?: "operator"` (absent on older backends).
- `sidebar/registers.ts` `getOperatorParts(win, operator, nowSeconds)`:
  - **unchanged** when `win.monitored === true` (`watched · <stage> · tick <age> ago` + facets);
    **monitored wins over owner** — a re-enrolled window reads as watched again;
  - **new branch**: `!win.monitored && win.owner === "operator"` → `{ head: "done · operator-touched" }`,
    no facets, no tick age (there is no live loop relation), stale styling **not** applied (stale is
    the live loop's overdue tick; a done row has no loop);
  - still `null` otherwise.
- Row flyout card (`row-flyout-card.tsx`): the `hasBody` gate grows to
  `fabParts || prSegments || win.note || win.monitored || win.owner === "operator"`; the `opr`
  `RegisterLine` renders the new head through the existing element (same `testid`s, `stale` false).
- PANE panel register view (`status-panel.tsx` `WindowContent`) consumes the same resolver, so the
  `opr` line shows `done · operator-touched` there too — no separate code path.
- **Row: no change.** `window-row.tsx` still passes `watched` only for `win.monitored === true`; the
  underbar keeps exactly two states (live / stale). The `StatusDot` `aria-label` gains no clause for
  done (the label mirrors the row, and the row shows nothing).

Tests: `registers.test.ts` — done branch, monitored-wins precedence, null when neither;
`row-flyout-card.test.tsx` — body renders for an owner-only window and the `opr` line text;
the PANE panel test for the same head. An e2e assertion may ride an existing flyout/operator spec if
one already drives the watchlist fixture; not required.

### 4. Docs and the skill bundle

- `docs/site/skill.md` § Sidebar signals is rewritten around the verbs — `rk tab color|mark|note|flair
  [@N] <v> | --off` — with the raw `tmux set-option -w @rk_win_<name>` form kept as the "rk absent"
  fallback (one line); the `rk tab` bullet in the command list and the § Output & exit-code contracts
  `rk tab` bullet gain the new verbs (set prints the stored datum; `--off` prints nothing). Run
  `scripts/sync-skill.sh` so `app/backend/cmd/rk/skill/skill.md` stays byte-identical (the `rk skill`
  emit contract). `rk skill` mentions `owner` only as an operator-facing verb, not an agent signal.
- Toolkit standards check at apply (Constitution § Toolkit Standards): `shll standards principles`
  (stdout data / exit codes / idempotent `--off`), `help-dump` (the tree grows five leaves; snapshot
  tests in `help_dump_test.go` if any pin the tab subtree), `skill` (bundle structure),
  `readme-extraction` (README / `docs/site` command reference if `rk tab` verbs are enumerated there).
- `docs/specs/ui-state.md` § `rk tab` — The CLI Surface: the five verbs join the block; § Option
  Inventory gains the `@rk_win_owner` row and OQ2's note. Proposed at hydrate.
- **fab-kit follow-up (out of scope here)**: `fab-operator.md` §4 Enrollment swaps
  `fab pane window-name ensure-prefix <pane> »` for `rk tab owner <addr> operator` (gated on
  `rk tab owner --help` succeeding — probed capability, principle 7; fallback to the prefix when rk
  is absent or old) and §4 Removal drops the `»`→`›` swap. Tracked as a new backlog item / fab-kit
  change, not here.

### 5. Non-goals

- No row-level glyph for done (user decision); no change to the watched underbar.
- No marker value, no window-name mutation, no derivation of "done" from fab's `branch_map`.
- No new HTTP routes, no palette entries (marker pad, label popover, and the Set-note prompt already
  cover the UI side; `owner` has no UI control — it is a display-only line).
- No change to `NormalizeMarker` / legacy read compat, `MigrateLegacyOptions`, or the `[8fjh]`
  note-extension surfaces (that item's operator fold becomes this verb's first consumer later).
- `rk tab` does not learn to write `@rk_win_role` (that is `rk role`, with its move-into-`_rk-operator`
  side effects).

## Affected Memory

- `run-kit/architecture`: (modify) the `tab` family row — members `mark`/`note`/`color`/`flair`/`owner`, the shared arg shape, exit classes, `--off`, per-verb datum
- `run-kit/tmux-sessions`: (modify) § Server-Scoped User Options — new `@rk_win_owner` row; `@rk_win_marker`/`@rk_win_color`/`@rk_win_flair`/`@rk_win_note` rows gain the `rk tab` writer; list-windows field indices shift after the owner insertion; the note rule's move into `validate`
- `run-kit/api-and-sockets`: (modify) `/options` allowlist gains `@rk_win_owner` (+ validator, empty-clears)
- `run-kit/layout-snapshots`: (modify) capture set gains `owner`
- `run-kit/ui/status-signals`: (modify) `getOperatorParts` done branch + monitored-wins precedence; flyout `hasBody` gate; PANE panel `opr` line; a Design Decisions entry recording "done trail is register-only, row untouched"
- `run-kit/ui/sidebar`: (modify) flyout card body gate; explicit statement that the watched underbar stays monitored-only

## Impact

**Backend (Go)** — `app/backend/cmd/rk/`: `tab.go` (registration + `Long`), new `tab_mark.go`,
`tab_note.go`, `tab_color.go`, `tab_flair.go`, `tab_owner.go` (+ tests). `internal/validate/validate.go`:
`ownerTokens`/`OwnerValues`/`ValidateOwnerValue`, `ValidateNoteText`. `internal/tmux/tmux.go`:
`OwnerOption`, `WindowInfo.Owner`, `windowFormat` + `parseWindows` field, test line builders.
`api/windows.go`: `optKeyOwner`, note validation delegates to `validate`. `internal/snapshot/`
`snapshot.go` + `restore.go`: `Owner`. Existing tests touching field indices (`tmux_test.go`
`windowLineMarker`, `webtabs_test.go`, snapshot integration tests) update.

**Frontend (TS)** — `src/types.ts`, `src/components/sidebar/registers.ts` (+ test),
`src/components/sidebar/row-flyout-card.tsx` (+ test), `src/components/status-panel.tsx` (+ test).

**Docs** — `docs/site/skill.md` → `scripts/sync-skill.sh` → `app/backend/cmd/rk/skill/skill.md`;
`docs/specs/ui-state.md` (proposed at hydrate); README/docs/site command reference per the
`readme-extraction` standard if it enumerates `rk tab` verbs.

**Verification gates** (code-quality.md): `just test-backend`, `cd app/frontend && npx tsc --noEmit`,
`just test-frontend`; e2e only if a spec is added/changed. Fresh worktree: `pnpm install
--frozen-lockfile` in `app/frontend` first.

**Cross-repo** — fab-kit adopts `rk tab owner` in a follow-up; until then fab keeps the » / › rename
and both signals coexist harmlessly (the name prefix is invisible to rk's ownership logic).

## Open Questions

- Should fab clear `@rk_win_owner` on a *user-initiated* stop (as opposed to completion), so a
  deliberately abandoned window does not read `done`? fab-side policy for the follow-up; rk's `--off`
  supports either answer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is five `rk tab` setter verbs — `mark`, `note`, `color`, `flair`, `owner` — on any tab via the existing address grammar, `--off` to clear | Backlog text names mark/note/color and all four options; user confirmed the verbs are in scope regardless of the ownership decision | S:90 R:85 A:90 D:90 |
| 2 | Certain | "Tracked" stays the derived `monitored` join + existing watched underbar; no marker value carries operator ownership | Shipped in 0536 the same day; its recorded DD keeps the marker well human-owned; Constitution X — derivation wins | S:85 R:80 A:95 D:90 |
| 3 | Certain | Done trail = `@rk_win_owner=operator`, rendered only on the flyout/PANE `opr` register as `done · operator-touched`; no row glyph; monitored wins over owner | User chose "Owner option, card-only" at intake | S:90 R:85 A:85 D:90 |
| 4 | Confident | `@rk_win_owner` is a closed set `{operator}`, written by fab at enrollment and never cleared on removal; rides the `/options` allowlist and layout snapshots; unknown values read as unset | Backlog proposes the name/value; write-once is what makes it the › trail; allowlist + snapshot follow every other `@rk_win_*` closed-set option | S:75 R:70 A:80 D:75 |
| 5 | Certain | Validation reuses `internal/validate` tables; the CLI rejects retired flat marker tokens; the note rule (120 chars, no control runes) moves into `validate.ValidateNoteText` shared by API and CLI | One table, two writers (the `layoutspec` precedent); `NormalizeMarker` is read-side compat, not a write vocabulary; duplicating the note bound would be the anti-pattern | S:70 R:85 A:90 D:80 |
| 6 | Certain | Output/exit contract: set prints the stored datum (token verbatim, normalized color, `<epoch>:<text>`), `--off` prints nothing; invalid value exit 2, tmux failure exit 1; SSE wake after output on success only | Mirrors `tab layout` (prints resulting value, bad layout = 2) and `web rm` (silent), and the family's wake rule | S:70 R:90 A:90 D:80 |
| 7 | Confident | `flair` is included even though the backlog's verb list omits it | The item opens by naming all four options; same shape as `mark`; leaving one out would keep raw `set-option` alive for it | S:65 R:90 A:80 D:75 |
| 8 | Certain | Clearing is the `--off` flag on every verb, not a positional `clear` token | `note` takes free text, so a positional `clear` is ambiguous; one idiom across the five verbs | S:80 R:90 A:85 D:85 |
| 9 | Confident | `note` takes exactly one text argument (quote it) or `-` for stdin; multiple words are not joined | Joining would make address detection heuristic; `-` mirrors `rk mux send` | S:45 R:85 A:70 D:50 |
| 10 | Confident | `@rk_win_owner` is read in `windowFormat` immediately after `@rk_win_flair`, shifting the note and retired fields by one; the legacy note tail stays last | Keeps closed-set fields grouped; the tail-last invariant is the only hard constraint | S:60 R:80 A:85 D:70 |
| 11 | Certain | The fab-kit side (swap `»`/`›` for `rk tab owner`, probe `rk tab owner --help`) is a separate follow-up, not part of this change | Cross-repo; toolkit principle 7 (probe advertised flags); this repo cannot ship it | S:85 R:90 A:90 D:90 |
| 12 | Certain | No new palette entries or routes | Marker pad, label popover, Set-note prompt already exist; `owner` is display-only; Constitution IV/V/IX | S:70 R:85 A:85 D:80 |
| 13 | Certain | Skill bundle § Sidebar signals is rewritten to the verbs and synced via `scripts/sync-skill.sh`; ui-state spec updates are proposed at hydrate; standards `principles`/`help-dump`/`skill`/`readme-extraction` are checked at apply | Constitution § Toolkit Standards; the bundle is the documented setter surface agents read | S:75 R:90 A:85 D:85 |
| 14 | Certain | Row `aria-label` and `StatusDot` are untouched; only `getOperatorParts` and the two card/panel body gates change | The label mirrors the row, and the row shows nothing new (decision 3) | S:70 R:90 A:85 D:80 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
