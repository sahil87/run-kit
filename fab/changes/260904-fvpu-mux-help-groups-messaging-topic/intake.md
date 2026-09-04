# Intake: Mux Help Groups + Messaging Topic Page (Agent-Messaging Part C)

**Change**: 260904-fvpu-mux-help-groups-messaging-topic
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation, executing **Part C (gap 3)** of the agent-messaging
execution plan in `docs/specs/agent-messaging.md` (commit `c36cfbd8`, present on this
branch). Governing spec sections: **Surface and naming — settled** ("Discoverability is a
help problem, not a naming problem") and **Gaps from current state** item 3. Depends on
Part B (`260904-r7uk-await-ready-parked-classification`, PR #835), already cherry-picked
into this worktree as commit `5573ac67`.

> Agent-messaging Part C: discoverability (gap 3). Add rk mux -h command groups —
> messaging (send, await), pane mechanics (capture, kill, process, panes), server ops
> (new, reap, snapshot, init-conf, adopt, guard). Add an rk skill messaging topic page
> teaching the channel matrix from docs/specs/agent-messaging.md (commit c36cfbd8 on
> main) section The channel matrix — and document the parked verdict from Part B
> (260904-r7uk-await-ready-parked-classification, cherry-picked into this worktree
> already, PR #835), covering the readiness standard (state-present / sentinel
> classification / parked) and the scope rule restricting the sentinel to pre-delivery
> panes. See docs/specs/agent-messaging.md section Surface and naming — settled, and
> section Gaps from current state item 3. This run-kit part intrinsically includes: the
> standards audit (shll standards), the help-dump test update for rk mux -h, and the rk
> skill topic-page updates themselves are the deliverable. depends_on Part B (r7uk) —
> already cherry-picked into this branch; rebase against main and drop the cherry-pick
> commit once r7uk merges to main.

## Why

1. **The pain point**: the `rk mux` family grew to twelve members in two tiers, but
   `rk mux -h` presents them as one flat alphabetized "Available Commands" list — the
   messaging pair (`send`/`await`), the substrate read verbs, and the operator/server
   members are indistinguishable at a glance. Separately, the **channel matrix** (which
   channel to use for write / read-screen / read-state / read-results / wait /
   conversation) lives only in `docs/specs/agent-messaging.md` — a repo file an agent on
   another machine never sees. The `rk skill` bundle has verb-reference depth
   (`rk skill mux`) but no concept-level page teaching *which verb answers which need*,
   and Part B's new `parked` readiness verdict has no teaching surface beyond the mux
   page's dense `await` paragraph.

2. **The consequence if unfixed**: the spec's settled position — "Discoverability is a
   help problem, not a naming problem" — was the argument for rejecting an `rk msg`
   family split. If the help problem is then never fixed, the family stays hard to
   discover AND the rename stays rejected: the worst of both. Agents driving other
   agents keep rediscovering the artifact-first read rule and the `--ready`/`--force`
   spawn pairing from scratch, or misuse `capture` scraping where `await` fits.

3. **Why this approach**: the spec fixes the shape — three help groups (*messaging* /
   *pane mechanics* / *server ops*) and a messaging topic page carrying the channel
   matrix. Cobra v1.10.2 (already the vendored version) supports command groups
   natively (`cobra.Group` + per-command `GroupID`), so grouping is declarative — no
   custom help template. The topic-page mechanism (embed + sync + drift-guard) already
   exists with four pages; `messaging` is a fifth row in an established pattern.
   Alternatives rejected by the spec, not reopened here: a new `rk msg` family,
   elevating `send`/`await` to root (cli-layering rule 3's permanent-alias tax).

## What Changes

### 1. `rk mux -h` command groups (`app/backend/cmd/rk/mux.go`)

Register three `cobra.Group`s on `muxCmd` and stamp each subcommand's `GroupID`,
exactly per the spec's grouping:

| Group | Members |
|-------|---------|
| messaging | `send`, `await` |
| pane mechanics | `capture`, `kill`, `process`, `panes` |
| server ops | `new`, `reap`, `snapshot`, `init-conf`, `adopt`, `guard` |

Concretely, in `mux.go`'s `init()`:

```go
muxCmd.AddGroup(
    &cobra.Group{ID: "messaging", Title: "Messaging:"},
    &cobra.Group{ID: "mechanics", Title: "Pane mechanics:"},
    &cobra.Group{ID: "serverops", Title: "Server ops:"},
)
```

with `GroupID` set on each of the twelve members (either at their `cobra.Command`
literals or alongside the `AddCommand` calls in `mux.go` — apply picks the placement
that best matches file ownership; the family aliases at the root, e.g. `reapFamilyCmd`
registered under mux, get their `GroupID` where the shared command is defined).
Cobra renders each group's title as a heading over its members and — with groups
present — would render any ungrouped subcommand under "Additional Commands", so the
plan must assert all twelve members carry a group (no leftover bucket). The hidden
root-level deprecation aliases (`reaper`, `snapshot`, `init-conf`, `tmux-guard`) are
separate root registrations and are untouched. Membership, names, flags, and behavior
of all twelve commands are unchanged — this is help rendering only (spec non-goal:
"No renames of shipped `rk mux` members").

The family comment block atop `mux.go` (which currently narrates "two tiers") and
`muxCmd.Short`/`Long` SHOULD be checked for coherence with the three-group
presentation; update wording only where it now contradicts the rendered help.

### 2. New `rk skill messaging` topic page

New canonical file `docs/site/skill/messaging.md` (static-only, ≤150 lines — the
topic-page bound), teaching:

- **The channel matrix** (from spec § The channel matrix), adapted for an operating
  agent: write → `rk mux send` (plain / `--answer` / `--force` / `--no-enter` /
  `--key` / stdin `-`); read-screen → `rk mux capture` (the only screen truth for
  alt-screen TUIs); read-state → `rk mux await` / `panes` / `process`; read-results →
  **artifact files** the worker is told to write (alt-screen agents have zero
  scrollback, so artifact-first is a consequence, not a preference); wait →
  `rk mux await` (`--until` / `--any` / `--file` / `--ready`) and the composed
  `send --await`; multi-turn cross-provider conversation → the MCP bridge, not
  pane-driving.
- **The readiness standard** (spec § Spawn and trust walls, documenting Part B's
  shipped behavior): the spawn-then-deliver composite (open bare → classify → answer →
  verified deliver); the three-way classification — **state-present** (`ready %N
  (state)`, touch-nothing, preferred), **sentinel classification** (`ready %N (echo)`
  at a live input box), **`parked %N`** (exit 0, screen snippet on stderr — a wall:
  trust dialog, survey, theme picker, login); `booting` never returns — the await
  blocks through boot churn and ends only on `ready`, `parked`, `gone`, or timeout
  (`running`).
- **The scope rule**: the sentinel is typed only into **pre-delivery** panes (no agent
  state, nothing yet delivered); against a live delivered worker, readiness verbs are
  illegal — use `await --until` / `capture`.
- **The judgment split**: classification is mechanical and rk-owned; what a `parked`
  wall wants is the calling agent's judgment, answered with the standard write channel
  (`rk mux send --key Enter`, `--key Down`, …); login/credential walls escalate to a
  human — rk never auto-answers a wall. The documented hook-less pairing stays
  `rk mux await --ready %5 && rk mux send --force %5 '<prompt>'` (branch on the report
  word — `parked` also exits 0).

The page opens with the standard `command -v rk` gate block and cross-links
`rk skill mux` for verb-reference depth (flags, gates, report words, gotchas) rather
than duplicating it — the mux page sits at its 150-line cap and keeps that role.

### 3. Topic-page wiring (established pattern, one new row each)

- `scripts/sync-skill.sh`: add `sync "docs/site/skill/messaging.md" "$DEST_DIR/messaging.md"`.
- `app/backend/cmd/rk/skill.go`: new `//go:embed skill/messaging.md` var +
  `skillTopics["messaging"]` row (the `Topics:` help line and `rk skill topics`
  enumeration derive from the map — no further edit).
- `app/backend/cmd/rk/skill/messaging.md`: the committed synced copy (what a clean
  `go build` embeds).
- Drift-guard test alongside the existing per-topic embed tests
  (`TestSkillDisplayEmbedMatchesCanonical` et al.): a messaging case keeping the embed
  byte-honest against `docs/site/skill/messaging.md`.
- `docs/site/skill.md` (core bundle): add the messaging entry to the topic-index
  lines (the core bundle carries only pointers; the sync copies it too, and its own
  drift-guard covers it).

### 4. Tests + standards audit (intrinsic to CLI-surface parts, per the spec's Execution plan)

- **Help-dump test** (`app/backend/cmd/rk/help_dump_test.go`): the twelve-member
  structural assertion stays valid (grouping changes rendering, not membership); each
  node's `text` (UsageString) now carries group headings — update any assertion that
  expects the flat rendering, and add coverage that the mux node's help text presents
  the three groups. `rk skill`'s help `Topics:` line changes by derivation (new map
  row) — no hand-maintained fixture expected, but verify.
- **Skill tests**: `rk skill messaging` prints the page byte-identically; `rk skill
  topics` includes `messaging`; unknown-topic error message picks it up by derivation.
- **Standards audit** (`shll standards`, constitution § Toolkit Standards): the
  surfaces touched are governed by `help-dump` (tree shape unchanged, text changes —
  emit stays conformant), `skill` (new topic page must meet the bundle standard:
  static-only, stdout-is-data, topic enumeration), `readme-extraction` (a new file in
  the `docs/site/` tree), and `principles`. Audit against the HEAD build and record
  the posture in memory at hydrate (`run-kit/toolkit-standards`).

### 5. Dependency handling (ship-time note)

This branch carries Part B via cherry-pick `5573ac67` (the messaging page documents
`parked`, which only exists with Part B). Once r7uk (PR #835) merges to main, rebase
this branch onto main so the cherry-pick commit drops out before this part's PR is
merged. Do not revert or re-implement any r7uk content here.

## Affected Memory

- `run-kit/agent-messaging`: (modify) the `rk mux` family record gains the three-group
  help presentation and the `rk skill messaging` topic page (channel matrix + readiness
  standard as shipped agent-facing docs)
- `run-kit/toolkit-standards`: (modify) audit posture row — help-dump/skill/
  readme-extraction re-checked over the grouped mux help and the fifth topic page

## Impact

- `app/backend/cmd/rk/mux.go` — groups + GroupIDs (possibly `GroupID` set where shared
  family commands are defined: `reaper.go`/`snapshot.go`/`initconf.go`/`tmux_guard.go`
  equivalents, wherever `reapFamilyCmd`/`snapshotFamilyCmd`/`initConfFamilyCmd`/
  `muxGuardFamilyCmd` live)
- `app/backend/cmd/rk/skill.go` + `app/backend/cmd/rk/skill/messaging.md` (new synced
  copy) + skill/help-dump tests
- `docs/site/skill/messaging.md` (new canonical), `docs/site/skill.md` (topic index),
  `scripts/sync-skill.sh`
- No behavior change to any mux verb; no daemon, API, or frontend impact
- `docs/specs/agent-messaging.md` is NOT edited — it stays the target shape; shipped
  state lands in memory at hydrate

## Open Questions

- None — the spec fixes the grouping, the page's teaching content, and the naming;
  the topic-page mechanism is an established in-repo pattern.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement help grouping with cobra's native command groups (`cobra.Group` + `GroupID`), no custom help template | Cobra v1.10.2 (vendored) supports groups declaratively; a template fork would be maintenance debt for identical output | S:85 R:90 A:95 D:90 |
| 2 | Certain | The topic page is a NEW `messaging` page, not an extension of the `mux` page | User input says "Add an rk skill messaging topic page"; spec names "a messaging topic page"; the mux page sits at its 150-line cap | S:95 R:85 A:95 D:95 |
| 3 | Confident | Group headings render as `Messaging:`, `Pane mechanics:`, `Server ops:` (sentence case + colon, cobra heading idiom) | Spec names the groups in lowercase italics as concepts; exact heading strings are presentation with a few valid casings — trivially reversible | S:70 R:95 A:75 D:65 |
| 4 | Confident | Content split: messaging page teaches concepts (channel matrix, readiness standard, scope rule, judgment split) and cross-links `rk skill mux` for verb-reference depth; no duplication of flag tables | Both pages bound at 150 lines; the mux page already carries verb depth incl. `parked` — duplicating would drift | S:80 R:80 A:80 D:75 |
| 5 | Certain | Wiring follows the established topic-page pattern verbatim: sync-skill.sh row, embed var, skillTopics row, drift-guard test, core-bundle topic-index line | Four existing pages define the pattern; `rk skill topics`/help line derive from the map | S:90 R:90 A:100 D:95 |
| 6 | Certain | Help-dump structural assertions (12 mux members) stay; only text-rendering expectations and new group coverage change in tests | Grouping changes `UsageString` output, not the command tree; verified against help_dump_test.go's membership checks | S:80 R:90 A:90 D:85 |
| 7 | Certain | Ship-time dependency handling: keep cherry-pick `5573ac67` until r7uk (PR #835) merges to main, then rebase onto main so it drops out | User-stated in the invocation; standard cherry-pick-ladder practice in this repo | S:95 R:90 A:90 D:95 |
| 8 | Confident | `docs/specs/agent-messaging.md` is not edited by this change; shipped-state recording happens in memory at hydrate | Specs are pre-implementation target shape (docs/specs/index.md); memory owns what shipped — but a "gap delivered" tick in the spec would also be defensible | S:70 R:90 A:85 D:70 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
