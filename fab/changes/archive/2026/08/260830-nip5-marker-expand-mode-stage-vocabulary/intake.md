# Intake: Marker rework phase 1 — expand: accept the `mode:stage` vocabulary

**Change**: 260830-nip5-marker-expand-mode-stage-vocabulary
**Created**: 2026-08-30

## Origin

Picked up from the split plan committed in #768. The user invoked `/fab-new` with:

> Marker rework phase 1 -- expand: accept the mode:stage vocabulary. Full scope, known traps,
> acceptance criteria, and gates are written out in
> `fab/plans/sahil/26-08-30-marker-rework-split.md` under "Phase 1 -- Expand: accept the
> mode:stage vocabulary" -- read that section for the intake. One question this phase answers:
> does every stored value survive? Purely additive/invisible change: validator accepts both
> vocabularies, NormalizeMarker lands as a pure exported+tested function (not wired into
> parseWindows/layout.go yet), marker.tsx ships only the parse/format half. Copy source is
> PR #767 (`git fetch origin refs/pull/767/head:pr767`) but read the traps section before
> trusting the copy. Gates are backend go test + frontend tsc/vitest only -- no Playwright,
> no `just build`.

One-shot invocation against a settled written plan. The design is **not** under revision here —
`docs/wiki/marker-3x3-studies.html` is the canonical authority and the split plan
(`fab/plans/sahil/26-08-30-marker-rework-split.md` § "Phase 1") is the scope authority. This
intake reproduces that section verbatim in substance, and adds three findings verified against
the current tree and against PR #767 that the plan does not state (see § What Changes → traps).

**Prior art**: PR [#767](https://github.com/sahil87/run-kit/pull/767) implements all three phases
in one change and is **not to be merged** — it is the parts bin. Its head is durable via
`git fetch origin refs/pull/767/head:pr767` (fetched during intake; `790120eb`). The post-mortem
that motivated the split is `docs/findings/marker-rework-review-cycles.md`: ten review cycles
against a budget of three, and two user-visible interaction defects survived a fully green
pipeline, because a storage migration, a visual rework, a new interaction component and a docs
move shared one pass/fail verdict.

## Why

**The problem.** The marker vocabulary and the renderer that draws it are genuinely coupled: the
stored token set cannot be narrowed to the new `mode:stage` model without simultaneously changing
what draws it, and doing both in one change is exactly what produced #767's unreviewable diff. A
live server or a stored layout snapshot must never hold a token its own validator rejects, at any
point in the migration.

**The consequence of not splitting.** #767 proved it: reviewer attention never landed where the
risk was (six of seven real defects were in the interaction pad — ~30% of the diff), and five of
ten cycles were burned on an unscoped comment-hygiene acceptance rule.

**Why expand-first over a flag day.** Expand → migrate → contract is the standard shape for a
value-vocabulary migration under a closed-set validator. Phase 1 *widens* the accepted set and
lands the new model with tests as its only consumer; phase 2 flips the read path and narrows the
set in the same change that teaches the UI to draw it; phase 3 adds the interaction on top of a
settled data model. Each phase answers exactly one question. This one's is: **does every stored
value survive?**

**Why this phase is safe to sit indefinitely.** It renders nothing differently, changes no API
shape, and adds no UI file. It is shippable on its own and reversible by reverting one commit.

## What Changes

### Backend — `app/backend/internal/validate/validate.go`

`markerTokens` becomes the **union** of both vocabularies, with the new set listed **first** (slice
order is the presentation order in the derived error message):

```go
markerTokens = []string{
    "manual", "manual:1", "manual:2", "manual:3",
    "auto", "auto:1", "auto:2", "auto:3",
    "blocked", "blocked:1", "blocked:2", "blocked:3",
    "pipe", "dotted", "dashed", "solid", "double", "thick", "hatch", "block",
}
```

Twenty tokens. `""` still means unset and is implied by `closedSet`. Nothing else in the file
changes structurally — `MarkerValues`, `ValidateMarkerValue`, `closedSet` and `validateClosedSet`
all derive from this one slice, so the membership map and the error copy cannot drift.

The doc comments on `MarkerValues` and `ValidateMarkerValue` must be rewritten to describe the
transitional union: the `<mode>[:<stage>]` schema (mode ∈ manual/auto/blocked = the categorical
SHAPE axis; stage ∈ 1/2/3 = the ordinal axis; a bare mode means stage 1) **plus** the eight legacy
flat tokens accepted for the duration of the migration.

### Backend — `app/backend/internal/tmux/tmux.go`

Add `legacyMarkerValues` and `NormalizeMarker` as a **pure exported function with tests**, copied
from #767 (`git show pr767:app/backend/internal/tmux/tmux.go`, lines ~168–194):

```go
var legacyMarkerValues = map[string]string{
	"pipe": "manual:1", "dotted": "manual:1", "dashed": "manual:1", "solid": "manual:1",
	"double": "manual:2", "thick": "manual:3",
	"hatch": "blocked:2", "block": "blocked:3",
}

func NormalizeMarker(raw string) string {
	if v, ok := legacyMarkerValues[raw]; ok {
		return v
	}
	if validate.MarkerValues[raw] {
		return raw
	}
	return ""
}
```

Also update the `MarkerOption` doc comment to name the `<mode>[:<stage>]` schema.

**Do NOT wire it into `parseWindows` (`tmux.go` ~line 1225) or `layout.go` (field 27), and do NOT
touch `snapshot/restore.go`.** That is phase 2. In this phase the function's only consumer is its
own table test. `parseWindows` keeps its existing `validate.MarkerValues[m]` closed-set drop —
which now, by the union, passes new-vocabulary tokens through to the frontend untouched.

### Backend — `app/backend/api/operator.go` (**scope addition — not in the plan's phase-1 list**)

`operator.go:450` carries the marker vocabulary as a **literal** inside the `color-tabs` operator
prompt:

```
  tmux set-option -t @N '@rk_win_marker' '<value>'   (pipe dotted dashed solid double thick hatch block)
```

`api/operator_test.go` (`TestRenderColorTabs`, ~lines 887 and 908–936) parses the parenthesized run
after that anchor and asserts set-equality with `closedSetTokens(validate.MarkerValues)` — an
explicit drift guard. **Widening `markerTokens` therefore fails `go test ./api` unless this literal
widens in the same change.** The plan assigns `operator.go` to phase 2; it is wrong on the timing,
because the invariant is inside phase 1's own gate.

Resolution: widen the literal to all twenty tokens in `markerTokens` order (new first), and update
the corresponding substring assertion in `operator_test.go`. Do **not** relax the invariant test —
it is the mechanism that keeps the prompt honest, and phase 2 narrows both back to twelve. The
`strings.Fields` parser handles `manual:1`-style tokens without change (no whitespace in a token).

### Backend — `app/backend/api/windows.go` (comment only)

The `optKeyMarker` arm of `validateWindowOption` (~line 537) comments the accepted set as
"one of dotted/solid/double" — already stale on main, and describing behaviour this change alters.
Refresh it to name the `<mode>[:<stage>]` schema plus the transitional legacy tokens. Comment-only;
no logic change. This is a *touched-line* edit, in scope under the hygiene rule below.

### Frontend — `app/frontend/src/marker.tsx` *(new)*

Copy the **parse/format half only** from `git show pr767:app/frontend/src/marker.tsx`:

- `MARKER_MODES` (`["manual", "auto", "blocked"] as const`) + the `MarkerMode` type
- `MARKER_STAGES` (`[1, 2, 3] as const`) + the `MarkerStage` type
- `MARKER_STAGE_GLOSS` (`{ 1: "early", 2: "mid", 3: "done" }`)
- the `Marker` type (`{ mode: MarkerMode; stage: MarkerStage }`)
- `parseMarker(value: string | null | undefined): Marker | null`
- `formatMarker(marker: Marker): string`
- the file-private `isMarkerMode` / `isMarkerStage` guards
- the file-header comment describing the two axes and the storage schema

**Explicitly NOT copied in this phase** (they arrive in phase 2 alongside their first consumer):
`MARKER_INK`, `MARKER_STAGE_WIDTHS`, `MARKER_CHEVRON_*`, `markerFillStyle`, `MarkerChevrons`, and
the `import type { CSSProperties }` they need. The file keeps the `.tsx` extension even though its
phase-1 content contains no JSX — the plan names that path, phase 2 adds the JSX component, and the
frontend has no ESLint config that would object.

`parseMarker` semantics, verbatim from #767 and to be preserved: `null`/`undefined`/`""`/
whitespace-only → `null`; more than one `:` → `null`; unknown mode → `null`; bare mode → stage 1;
non-numeric or out-of-range stage → `null`; never throws. `formatMarker` always emits the explicit
`<mode>:<stage>` form, so `parseMarker ∘ formatMarker` is the identity.

### Tests

- **`app/backend/internal/validate/validate_test.go`** — `TestValidateMarkerValue`: extend `valid`
  to all twenty tokens plus `""`; keep the existing `invalid` list (case variants, whitespace-padded
  tokens, flair tokens — the axes stay independent closed sets) and add the malformed new-vocabulary
  forms the closed set must still reject: `"manual:0"`, `"manual:4"`, `"manual:"`, `"manual:1:2"`,
  `"MANUAL"`, `" manual "`, `"auto:01"`, `"mode:stage"`.
- **`app/backend/internal/tmux/tmux_test.go`** — a table test for `NormalizeMarker` (same file as the
  existing `parseWindows` marker cases, matching #767's placement): all eight legacy tokens map
  forward per the table; all twelve new tokens pass through unchanged; `""` → `""`; unknown
  (`"wavy"`, `"Manual"`, `" manual:1 "`, `"manual:4"`) → `""`; **and an assertion that
  `NormalizeMarker` never returns a legacy token for any input** — see the pass-through trap below.
- **`app/backend/api/operator_test.go`** — update the `color-tabs` prompt substring assertion to the
  widened literal. The set-equality invariant needs no edit; it derives from `validate.MarkerValues`.
- **`app/frontend/src/marker.test.ts`** *(new — must be written fresh)* — round-trip
  `parseMarker(formatMarker(m))` deep-equals `m` for all nine mode×stage pairs; bare mode → stage 1
  for all three modes; `null` for `null`/`undefined`/`""`/`"  "`/`"manual:0"`/`"manual:4"`/
  `"manual:"`/`"manual:1:2"`/`"solid"` (a legacy token is not a parseable marker)/`"MANUAL"`;
  `" manual "` → `{manual, 1}` (`parseMarker` trims, unlike the backend validator);
  `"auto:01"` → `{auto, 1}` (`/^\d+$/` accepts the leading zero and `Number` coerces it) —
  **the frontend parser is deliberately more permissive than the backend closed set; assert both
  behaviours rather than assuming symmetry**; never throws on arbitrary input;
  `MARKER_STAGE_GLOSS` covers every stage.

### Known traps

Each is a verified finding against the current tree or PR #767, not a suggestion.

1. **The reviewer will flag the new API as having zero production call sites.** It did on #767
   cycle 1. Phase 1 deliberately lands the migration's first half with tests as its only consumer;
   **phase 2 is the named production consumer** (`NormalizeMarker` wires into `parseWindows`,
   `layout.go` field 27 and `snapshot/restore.go`; `marker.tsx` gains `markerFillStyle` /
   `MarkerChevrons` and `window-row.tsx` consumes them). This is a recorded design decision, not a
   finding.
2. **`app/frontend/src/marker.test.ts` does not exist in #767 — there is nothing to copy.** #767's
   diffstat carries `app/frontend/src/marker.tsx` (124 lines) with no companion test; the module was
   exercised only indirectly through `window-row.test.tsx`. Write the test fresh against the
   semantics listed above.
3. **`NormalizeMarker`'s pass-through arm consults the *union* during phase 1.** In #767 that arm
   guards against the narrowed twelve-token set; here `validate.MarkerValues` also contains the
   eight legacy tokens, so the arm would return a legacy token unchanged — *if it were ever reached
   with one*. It is not: the `legacyMarkerValues` table lookup runs first and shadows all eight.
   Copy the function verbatim (phase 2 then needs zero edits to it) and **pin the reasoning with a
   test** asserting no input ever yields a legacy token.
4. **`api/operator_test.go`'s prompt-vocabulary invariant makes `operator.go` a phase-1 file**, not a
   phase-2 one — see § Backend — `app/backend/api/operator.go` above.
5. **Comment hygiene is scoped to the diff.** The acceptance rule is *"no plan/change IDs
   (`R#`/`T###`/`A-###`) or removed-feature narration in comments **this change adds or modifies**"*
   — never a repo-wide rule. The repo's own convention is to cite change IDs in memory and in some
   comments; an unscoped rule makes every review re-litigate untouched files, and cost #767 five of
   its ten cycles. Do not rewrite comments outside this change's own lines.
6. **Run the provenance sweep in apply, before writing the result** — not in review:
   `grep -rnE '\((hwtr|[a-z0-9]{4})\)|\b(R[0-9]{1,2}|T0[0-9]{2}|A-[0-9]{3})\b' <touched files incl. tests>`
   and clear every hit. Workers mirror plan IDs into comments by habit; the sweep must cover the test
   files, not just `src/`.
7. **Do not re-run the full gate set for a comment fix** — re-run only what the edit touches.
8. **A 3-cycle exhaustion stop is a design signal**: stop and re-plan the phase rather than
   hand-driving it.

### Explicitly out of scope

`app/frontend/src/themes.ts` `MARKER_STATES` and `markerStripeStyle` stay exactly as they are; no
`--color-marker-ink` token; `swatch-popover.tsx` and every file under
`app/frontend/src/components/` are untouched; the row renders exactly as it does today; no
`parseWindows` / `layout.go` / `snapshot/restore.go` wiring; no e2e spec changes; no `legacy_options.go`
row (that table maps option *names*; this is a same-name *value* remap, which is why it lives at the
parse seam).

## Affected Memory

- `run-kit/architecture.md`: (modify) § `@rk_win_marker` window user option and the
  `internal/validate` closed-set validator row — both currently document `MarkerValues` as the
  five/eight-token flat set with the old error copy. Record the transitional union, the
  `<mode>[:<stage>]` schema, and `tmux.NormalizeMarker` as a landed-but-unwired pure function.
- `run-kit/tmux-sessions.md`: (modify) the `@rk_win_marker` row of the option inventory table
  (§ line ~339) — accepted values become the union; note that values grow additively during the
  migration and that the read path is unchanged in this phase.
- `run-kit/api-and-sockets.md`: (modify) the `POST /api/windows/{windowId}/options` entry's
  `@rk_win_marker` validation clause (currently `""`/`dotted`/`dashed`/`solid`/`double`/`thick`).
- `run-kit/operator-actuation.md`: (modify) the `color-tabs` prompt's `@rk_win_marker` accent
  vocabulary and the prompt-vocabulary drift-guard invariant.
- `run-kit/ui/visual-design.md`: (modify) note the new `app/frontend/src/marker.tsx` parse/format
  module and its relationship to the still-shipping `themes.ts` `MARKER_STATES`/`markerStripeStyle`
  pair — two vocabularies coexist until phase 2 retires the old one.

## Impact

**Backend** (`app/backend`): `internal/validate/validate.go` + `validate_test.go`,
`internal/tmux/tmux.go` + `tmux_test.go`, `api/operator.go` + `operator_test.go`,
`api/windows.go` (comment only). Six files plus one comment touch — smaller than the plan's "~13
backend files" estimate, which was read off #767's full three-phase diff.

**Frontend** (`app/frontend`): one new module `src/marker.tsx`, one new test `src/marker.test.ts`.
No file under `src/components/` is touched — `git diff --stat` proving that is an acceptance item.

**API surface**: unchanged in shape. `POST /api/windows/{id}/options` newly *accepts* the twelve
`mode:stage` tokens where it previously 400'd them; every previously accepted value keeps working.
No endpoint, field, or socket payload changes.

**Behavioural blast radius**: none visible. A window that somehow carries `manual:2` after this
change is served through to the frontend (the union widens `parseWindows`' closed-set drop), where
`markerStripeStyle` returns `undefined` for an unknown token and the row renders no stripe — the
same as an unset marker. Nothing writes those tokens yet: no UI path, and the operator prompt's
widened list is a suggestion to a human/agent operator, not an automatic write.

**Dependencies**: none added. `NormalizeMarker` and `legacyMarkerValues` are unreferenced by
production code in this phase; Go compiles an exported function with no call sites without
complaint, and the repo runs no Go linter in this change's gate.

**Gates** (from the plan — deliberately reduced; a cycle here should cost ~1 minute, not ~9):

```sh
cd app/backend  && go test ./...
cd app/frontend && npx tsc --noEmit && npx vitest run src/marker.test.ts
```

**No Playwright. No `just build`.** If a backend edit lands outside `internal/validate`,
`internal/tmux` or `api`, re-scope rather than widening the gate set.

## Open Questions

None. The design is settled by `docs/wiki/marker-3x3-studies.html`, the scope by the split plan's
phase-1 section, and the gates by the plan. The plan's two open questions (OQ-1 — how markers are set
on a coarse pointer; OQ-2 — whether tooling ever writes `auto`) are recorded there as affecting
phase 3 only, and nothing in this phase depends on either.

The one deviation from the plan's stated file list — `api/operator.go` moving from phase 2 into
phase 1 — is forced by a drift-guard test inside phase 1's own gate, verified in the source, and is
recorded as a decision below rather than raised as a question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `api/operator.go`'s `color-tabs` prompt literal and its `operator_test.go` substring assertion widen to the twenty-token union **in this phase**, despite the plan listing `operator.go` under phase 2 | Verified in source: `operator_test.go` asserts `promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)`, so widening `markerTokens` fails `go test ./api` — which is phase 1's own gate. Relaxing the invariant instead would delete the drift guard that keeps the prompt honest; phase 2 narrows both back to twelve | S:90 R:85 A:95 D:85 |
| 2 | Certain | `markerTokens` lists the twelve new tokens first, then the eight legacy ones | The plan states "Error copy lists the new set first"; slice order is the derived error message's presentation order, and the new vocabulary is the one a 400 should teach | S:85 R:90 A:90 D:90 |
| 3 | Certain | `marker.tsx` ships `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`, `Marker`, `parseMarker`, `formatMarker` and the two private guards — and omits `MARKER_INK`, `MARKER_STAGE_WIDTHS`, the `MARKER_CHEVRON_*` geometry, `markerFillStyle` and `MarkerChevrons` | The plan's "ship only the parse/format half in this phase; the fill/chevron renderers come with phase 2 alongside their first consumer" enumerates exactly this split; the omitted symbols are all renderer-side and have no phase-1 consumer | S:80 R:85 A:85 D:80 |
| 4 | Certain | `app/frontend/src/marker.test.ts` is written fresh, not copied | Verified: #767's diffstat contains `src/marker.tsx` but no `src/marker.test.ts` — the module was covered only indirectly through `window-row.test.tsx`, which phase 1 does not touch | S:95 R:90 A:95 D:90 |
| 5 | Certain | `NormalizeMarker` is copied from #767 verbatim, union-set pass-through arm included, and pinned with a test asserting no input ever returns a legacy token | The `legacyMarkerValues` table lookup runs first and shadows all eight legacy tokens, so union membership is unreachable for them and behaviour matches phase 2's narrowed set exactly. Copying verbatim means phase 2 needs zero edits to this function; the test converts the reasoning into a check | S:80 R:85 A:90 D:85 |
| 6 | Certain | `NormalizeMarker` is NOT wired into `parseWindows`, `layout.go` field 27, or `snapshot/restore.go`; the existing `parseWindows` closed-set drop stays | Stated twice in the plan (scope bullet and § Explicitly out of scope) and is the whole point of expand-first — the read path flips in phase 2, so phase 1 leaves every existing `parseWindows` marker test green untouched | S:95 R:85 A:90 D:95 |
| 7 | Certain | `validate_test.go`'s `invalid` list gains malformed new-vocabulary forms (`manual:0`, `manual:4`, `manual:`, `manual:1:2`, `MANUAL`, ` manual `, `auto:01`, `mode:stage`) | A closed set accepts only the twenty literal tokens; the existing test's stated contract is case-sensitive and whitespace-intolerant, so the new-vocabulary near-misses belong in the same list to pin that the union did not become a pattern match | S:80 R:90 A:90 D:85 |
| 8 | Confident | The `NormalizeMarker` table test lives in `internal/tmux/tmux_test.go` rather than a new `marker_test.go` | Matches #767's placement (its `tmux_test.go` hunk is where the marker cases already live) and the package's existing file layout (`tmux_test.go` / `layout_test.go` / `legacy_options_test.go` split by source file, not by symbol) | S:60 R:95 A:80 D:75 |
| 9 | Certain | `api/windows.go`'s stale `optKeyMarker` comment ("one of dotted/solid/double") is refreshed to name the `<mode>[:<stage>]` schema plus the transitional legacy tokens | It comments the exact validator arm whose accepted set this change widens, so it is a touched-line edit and in scope under the diff-scoped hygiene rule — leaving it would ship a comment this change made newly wrong | S:65 R:95 A:80 D:75 |
| 10 | Certain | The new module keeps the `.tsx` extension despite containing no JSX in phase 1 | The plan names `app/frontend/src/marker.tsx`; phase 2 adds the `MarkerChevrons` component to the same file, so `.ts` now would force a rename then. Verified the frontend ships no ESLint config that would flag a JSX-free `.tsx`, and `tsc`/`vitest` accept it | S:70 R:95 A:85 D:75 |
| 11 | Confident | Affected memory is the five files listed above; `run-kit/ui/sidebar.md` is **not** included | sidebar.md documents the marker's row plumbing and the Label-picker write seam, none of which this phase touches; the new parse/format module's home is visual-design.md, which already owns the frontend marker vocabulary | S:65 R:85 A:80 D:70 |
| 12 | Certain | Gates are exactly the plan's reduced set (`go test ./...`, `tsc --noEmit`, `vitest run src/marker.test.ts`) — no Playwright, no `just build` | The plan sets them explicitly and justifies the reduction (a phase-1 cycle should cost ~1 minute); nothing in this phase touches a rendered surface, so no e2e spec's behaviour can change. `git diff --stat` touching no `src/components/` file is the acceptance item that keeps that honest | S:85 R:75 A:85 D:80 |

12 assumptions (10 certain, 2 confident, 0 tentative, 0 unresolved).
