# Intake: Hover Card — Change Only

**Change**: 260817-kabi-hover-card-change-only
**Created**: 2026-08-17

## Origin

Conversational, over three rounds of live testing against a real sidebar.

The user first asked how to reorganise the card's six-line register block. Three layouts were worked up and measured; they picked the middle one (reorder plus two labelled groups), which shipped as PR #645. Testing it live, they came back twice more, each time cutting further:

> There's this info: `right now / out claude — idle 1h since last output / agt idle / checked 29s ago` … I do not want to show this info.

> No, your proposed contains `right now / out claude — idle 1h`. I don't need that above info as well.

> For the case Agent, waiting — I want nothing. For Change + PR, I don't want `RIGHT NOW / out active · claude / agt idle 232h`.

Then, against the drawn result:

> this makes sense

The three cuts collapse into a single rule: **the hover card shows the change and its PR, and nothing else.**

**PR #645 was closed unmerged** at the user's direction ("this is new, discard the one we have, not needed"), so `main` never carried the two-band layout. This change starts from `main` at `1936df6a` and is not a follow-up to #645 — it replaces it. Several of #645's ideas are re-derived here because they are independently correct, but none of its code is inherited.

## Why

### The card repeats the row

Before the card opens, the sidebar row already shows four things: the window name, the status dot (idle / active / waiting, or the fab stage), the PR glyph (open, merged, closed, failing), and the colour label.

Against that baseline the card's first three body lines are mostly restatement:

| Card line | What it adds over the row |
|---|---|
| `PR-ready — active` | nothing — it is the dot's own `aria-label`, rendered as text |
| `out claude — idle 1h since last output` | the command name and an exact duration |
| `agt idle 12m` | an exact duration |
| `agt idle` | nothing — the dot already says idle |

A panel opened *for more detail* should not lead with three lines the row already carried. And the two facts that are genuinely new — the command name and the precise elapsed time — are not worth opening a panel for on their own.

### The lines that do earn their place get cut off

The card is 320&nbsp;px wide, which at its 12&nbsp;px monospace is about **42 characters**.

- `getFabLine` composes `<id> <slug> · <stage>[ · <state>]`. A real window gives `fkad hover-card-register-bands · hydrate · active` — **53 characters**, so it truncates at `hydra…`. The tokens lost are the stage and the display state; the token kept is the slug, which is already on the row. The priority is backwards.
- `getPrSegments` appends up to four independent facts with no ceiling. The widest reachable state is `#540 · open (draft) · checks pending · review: changes requested` — **68 characters** in a 42-character space.

So the card spends its width on repetition and truncates the two registers that carry information the row cannot.

### Two lines can contradict each other

`dotLabel` describes the local fab journey; the `pr` register describes GitHub. A window can therefore read `PR-ready — active` directly above `pr #540 · merged`. Both are correct and nothing on screen says they measure different things.

### Freshness has no owner

`checked 12s ago` is the age of the PR poll, but it renders unprefixed at the bottom of the block and is not gated on the PR register — a window with `prFetchedAt` and no `prNumber` shows a "checked" line describing nothing.

### Consequence of not fixing

This is the app's one status-detail surface, and on coarse pointers it is the only place the change and PR facts appear at all. Today its most valuable fields are the ones guaranteed to be truncated, sitting under three lines that repeat the row.

## What Changes

### 1. Structured resolvers alongside the joined strings (`registers.ts`)

`registers.ts` is consumed by **two** surfaces — this card and the bottom PANE panel (`status-panel.tsx`). Its module doc commits to "ONE source, no drift".

Add parts-returning resolvers for the two registers the card still renders, and keep the existing string functions as formatters over them so their output is **byte-identical**:

```ts
export type FabParts = { id: string; slug: string; stage: string; displayState?: string };
export type PrParts  = { identity: PrSegment[]; health: PrSegment[] };

export function getFabParts(win: WindowInfo): FabParts | null { … }
export function getPrParts(win: WindowInfo): PrParts | null { … }   // null unless win.prNumber

/** Unchanged output — the PANE panel keeps using these. */
export function getFabLine(win: WindowInfo): string | null { … }
export function getPrSegments(win: WindowInfo): PrSegment[] | null { … }
```

`getOutputLine` and `getAgentLine` are **not** touched — the card stops calling them, the PANE panel keeps them exactly as they are.

**The PANE panel must render byte-identically.** That is the acceptance bar, not an aspiration — it is the one way this refactor can fail invisibly.

### 2. The card body becomes change-and-PR only (`row-flyout-card.tsx`)

Remove from `WindowFlyoutContent`:

- the `dotLabel(win, state)` body line (and the now-unused `dotLabel` / `statusDotState` imports — `dotLabel` stays exported and stays the status dot's `aria-label`)
- the `out` register
- the `agt` register

What remains, in order:

```
fab  fkad · review · active
     hover-card-register-bands
pr   #540 · open (draft) ↗
     checks pending · changes requested
     checked 12s ago
```

No group headings — with one group left there is nothing to separate.

### 3. Critical tokens lead; long values continue on an indented line

A new local `ContinuationLine` renders at `pl-[4ch]` in `text-text-secondary` — the same 4-advance column the `out `/`agt `/`fab `/`pr␠␠` prefixes establish.

- `fab` first line is `id · stage · displayState` (22 characters for the example above, comfortably inside 42); the slug follows on a continuation line where truncation costs nothing.
- `pr` first line is the identity — number, state, and the `↗` — and stays a single anchor with its existing `href`, `target`, `rel`, `title`, `aria-label`, segment colours and `stopPropagation`. The health segments move to a continuation line as **plain text**, so the anchor never spans two visual rows.

### 4. Freshness joins the PR block and is gated on it

`FreshnessLine` renders as a further continuation line under `pr`, indented to the same column, and **only when the `pr` register renders**. A `prFetchedAt` with no `prNumber` renders nothing.

### 5. No body at all when there is no change and no PR

When `getFabParts` and `getPrParts` are both null, the card renders its title bar and its action rows with **no body block** — not an empty container, and no heading.

A bare `prUrl` with no `prNumber` does **not** count as content: it renders nothing rather than an "open PR" row with no number. (Today that case produces a lone `pr  open PR ↗`.)

### Worked examples — the full range

Plain shell pane, and an agent window with no change:
```
Window @9 · 1 pane                    ⓘ
────────────────────────────────────────
 Change color…
 Fork conversation    new window, same d…
 Pin to board…                 not pinned
 ✕ Kill window              confirms first
```

Change, no PR:
```
fab  fkad · review · active
     hover-card-register-bands
```

Change + PR, widest state:
```
fab  n927 · review · active
     branch-channel-draft-flag
pr   #540 · open (draft) ↗
     checks pending · changes requested
     checked 12s ago
```

Merged PR — checks and review are already suppressed once a PR is not open:
```
fab  n927 · ship · done
     branch-channel-draft-flag
pr   #540 · merged ↗
     checked 12s ago
```

PR with no fab change:
```
pr   #1 · open ↗
     checks pass · approved
     checked 4m ago
```

### Non-goals

- **The PANE panel.** Its four-register view, its layout and its `260723-fm08` prefix tooltips are all untouched. Only new functions are added beneath it.
- **The status dot and its label.** `dotLabel` keeps its export and its role as the dot's accessible name.
- **Chips or a stage rail.** Considered and rejected — more machinery than the problem warrants once the card is this small.
- **The card's surface, elevation, action rows or tray** — shipped in `260817-nwz9` (PR #643) and untouched here.

### Accepted trade-off

The command name and the exact idle duration leave this surface. On fine pointers the bottom PANE panel still carries them. **On coarse pointers there is no bottom panel**, so a touch device loses that detail entirely. The user accepted this after it was put to them explicitly; the status dot still carries idle / active / waiting on every pointer type, so what is lost is precision, not the state itself.

### Coordination with in-flight work

- **`260810-aqo6-statusdot-compositional-vocabulary`** (intake, ready) reworks what the dot encodes. This change deliberately leans harder on the dot — dropping `out`/`agt` is justified *because* the dot carries that state. If aqo6 narrows the dot's vocabulary, revisit this. The two are aligned in intent but coupled in fact.
- **`260723-fm08-register-label-chip-tooltips`** (apply, active) adds tooltips to the register prefixes in the PANE panel. No overlap — that surface is untouched here.
- **`260817-nwz9`** merged as #643 but its folder is still unarchived in `main`; archiving it is separate housekeeping, committed on its own.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card. The card's body is no longer "the four orthogonal registers" — it is `fab` and `pr` only. Remove the "demoted dot-label body line" description; record the continuation-line rule, the freshness gating, the no-body case, and the parts-vs-formatters split with the byte-identical PANE-panel invariant. Update the Tests paragraph. The § Pane panel section stays as is.
- `run-kit/ui/sidebar`: (modify) only if it describes the card body's contents; verify during hydrate rather than assuming.

`docs/specs/status-pyramid.md` is **not** affected. The L0–L3 model and the register vocabulary are unchanged — this changes which registers one surface chooses to render, not what they mean.

## Impact

**Code** (2 files + tests):

| File | Change |
|---|---|
| `app/frontend/src/components/sidebar/registers.ts` | Add `getFabParts` / `getPrParts` + types; `getFabLine` / `getPrSegments` become formatters over them. `getOutputLine` / `getAgentLine` untouched. |
| `app/frontend/src/components/sidebar/row-flyout-card.tsx` | Remove the label line, `out`, `agt` and their imports; add `ContinuationLine`; recompose `fab` and `pr`; gate freshness; render no body when empty |
| `app/frontend/src/components/sidebar/status-panel.tsx` | **No change** — verify byte-identical rendering |
| `registers.test.ts`, `row-flyout-card.test.tsx` | Parts resolvers, formatter parity, the no-body case, continuation lines, freshness gating, bare-`prUrl` suppression |
| `tests/e2e/row-flyout.spec.ts` (+ `.spec.md`) | The spec asserts on card body text; update both together per the Constitution |

**Surfaces**: the window flyout card on both pointer types. The session and server card tiers pass their own facts content through the shared shell and are unaffected — verify, do not assume.

**No change to**: the Go backend, the API, `WindowInfo`, the status dot, the PANE panel's appearance, or the card's chrome.

**Verification**: `npx tsc --noEmit`; `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test-frontend`; the affected e2e spec only — `cd app/frontend && RK_PORT=3020 pnpm exec playwright test row-flyout` in the foreground. Do **not** run the full e2e suite: it currently fails ~91 unrelated specs because the harness backend returns 502 on board API calls, which has nothing to do with this change. Go is not on this machine's PATH, so `just build`'s Go leg cannot run; use `npx vite build` for a production-build check and do not install a toolchain.

## Open Questions

None. The design was settled across three rounds of live testing, and the one real trade-off (losing command and exact idle time on touch) was put to the user explicitly and accepted.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The card renders `fab` and `pr` only — no `out`, no `agt`, no status-label line | The user cut each of these explicitly across three rounds and confirmed the drawn result | S:95 R:75 A:90 D:95 |
| 2 | Certain | No group headings | Only one group remains; a heading with nothing to separate is chrome | S:85 R:90 A:90 D:90 |
| 3 | Certain | No body block at all when there is no change and no PR | Stated directly for both the plain-shell and agent-waiting cases | S:90 R:85 A:90 D:95 |
| 4 | Confident | `getOutputLine` / `getAgentLine` are left completely untouched | The card simply stops calling them; the PANE panel still does. Editing them would risk a surface this change has no mandate over | S:70 R:85 A:90 D:85 |
| 5 | Confident | Only `fab` and `pr` get parts resolvers | They are the only two the card composes; adding parts forms for the other two would be unused code | S:65 R:85 A:85 D:80 |
| 6 | Confident | Continuation lines indent to `pl-[4ch]`, the existing prefix column | Keeps the monospace grid the card shares with the terminal, and subordinates the continuation to its register | S:60 R:90 A:85 D:80 |
| 7 | Confident | The PR anchor wraps the identity line only; health segments are plain text | Keeps the click target one visual row and predictable | S:60 R:85 A:80 D:75 |
| 8 | Confident | A bare `prUrl` with no `prNumber` renders nothing | It is a link with no information attached; under the new rule it does not earn a line, let alone the card's only body | S:65 R:85 A:80 D:80 |
| 9 | Confident | Losing command and exact idle time on touch is acceptable | Put to the user explicitly and accepted; the dot still carries the state on every pointer type, so precision is lost, not the state | S:70 R:80 A:70 D:75 |
| 10 | Certain | Session and server card tiers are unaffected | They pass their own one-line facts content through the shared shell, not these resolvers — verify rather than assume | S:80 R:80 A:95 D:90 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
