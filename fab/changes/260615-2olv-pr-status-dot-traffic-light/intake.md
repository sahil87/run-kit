# Intake: Multi-color PR status dot in the sidebar window row (PR traffic-light)

**Change**: 260615-2olv-pr-status-dot-traffic-light
**Created**: 2026-06-15

## Origin

This change was synthesized from a live design conversation (one-shot dispatch via `/fab-proceed`). It builds directly on top of two already-shipped predecessors — consume their work, do not redo it:

- `260610-596o-pr-status-sidebar` — built the `prstatus` collector (`prstatus.go`) and the six PR fields on `WindowInfo`.
- `260613-o20f-sidebar-triage-signal` — added the original single red triage dot to the sidebar window row and promoted `isFailish` from module-private to `export` in `pr-status-line.tsx`.

> Today the sidebar window row (`app/frontend/src/components/sidebar/window-row.tsx:284`) shows a SINGLE red dot for change-bound windows whose PR needs attention, gated on `win.fabChange && win.prNumber && isFailish(win)`, where `isFailish` (`pr-status-line.tsx:29`) = `prChecks === "fail" || prReview === "changes_requested"`. The dot only signals trouble; the absence of a dot is ambiguous (no PR? draft? healthy?).
>
> This change generalizes that single red dot into a 5-state colored status dot ("PR traffic-light"), reusing PR fields ALREADY transmitted on `WindowInfo` (`prState`, `prChecks`, `prReview`, `prIsDraft`, `prNumber`, `fabChange`) and ALREADY attached by the SSE hub (`api/sse.go:354 attachPRStatus`). No backend change, no new SSE field, no new `gh` call — pure frontend presentation over existing data.
>
> Core semantic decision: **green means HEALTH, not merge-readiness.** A draft with passing checks is *healthy*, just not flipped to ready, so "draft = green" is coherent. The green label must therefore be "checks passing" / "healthy", NOT "ready to merge".

Key decisions reached in the discussion (encoded below as Certain/Confident assumptions):
1. The precedence order of the five states (first match wins) — `merged → fail → pending → healthy → neutral`.
2. `green = health` semantics (rejecting the strict `pass && approved && !draft` readiness framing).
3. A dot renders for EVERY change-bound PR window (rejecting today's fail-only behavior); `neutral` is a dim/hollow dot.
4. `merged` is TRANSIENT, not persisted (Constitution II).
5. `closed`-unmerged → `neutral` (not red, not purple).
6. Cross-surface alignment: `status-panel.tsx` draft coloring must follow the same health logic so all three PR surfaces tell ONE color story.
7. "Yellow = merge conflicts" REJECTED for v1 (data not fetched, `mergeable` is laggy); yellow reserved for `pending`.

## Why

**Problem (pain point).** The current single red dot is a one-bit signal: it only fires for trouble (`isFailish`). The *absence* of a dot is overloaded and ambiguous — it could mean "no PR", "draft", "checks still running", or "healthy & passing". An operator glancing across the sidebar tree cannot distinguish "this window has a healthy PR" from "this window has no PR at all", so the dot only answers "is something on fire?" and nothing else.

**Consequence of not fixing.** The sidebar tree is the at-a-glance triage surface (the Pane panel holds full detail). Without per-state color, the operator must select each change-bound window and read its Pane panel `pr` row to learn the PR's health — defeating the purpose of an at-a-glance signal and pushing PR-state awareness into a per-window drill-down.

**Why this approach over alternatives.** All five states are already derivable from data already on `WindowInfo` and already joined by the SSE hub — so a richer signal costs zero backend work and zero new network/`gh` calls (Constitution IV, minimal surface). The change generalizes the existing `isFailish` predicate rather than inventing a parallel one, reuses the exact color vocabulary already established in `status-panel.tsx:74-90` (no new hex), and keeps the dot in its existing location. It is pure presentation in leaf components, fully reversible.

Two framings were considered for green and the user explicitly chose **health over readiness** — this reframing is load-bearing: it is the single decision that makes "draft = green" coherent and lets all three PR surfaces converge on one color story.

## What Changes

This is a **frontend-only** change. No backend change, no new SSE field, no new `gh` call or GraphQL query change, no new route, no new component. It reuses existing color tokens and the existing dot location. Tests are ~60% of the change (explicitly acknowledged) — the existing single-red-dot assertions are rewritten into per-state assertions.

### 1. `pr-status-line.tsx` — new precedence function + maps (colocated with `isFailish`)

Add an exported `PrDotState` type, a `prDotState()` precedence function, and two `Record` maps (color + accessible-name). Colocate with `isFailish` — `prDotState` generalizes it and reuses it as the `fail` branch, so the row and the Pane panel keep a single source of truth.

```ts
export type PrDotState = "merged" | "fail" | "pending" | "healthy" | "neutral";

export function prDotState(win: WindowInfo): PrDotState {
  if (win.prState === "merged") return "merged";        // closed is NOT here — flows to neutral
  if (isFailish(win)) return "fail";                    // prChecks==="fail" || prReview==="changes_requested"
  if (win.prChecks === "pending") return "pending";
  if (win.prChecks === "pass") return "healthy";        // draft or not — passing checks = green
  return "neutral";                                      // closed, no CI, awaiting first signal, drafts w/o checks yet
}
```

**Precedence rationale (first match wins — the order IS the whole design):**

1. **`merged` FIRST** — a terminal/landed PR; its historical checks/review are noise. Mirrors `status-panel.tsx` suppressing checks/review once `!open`. NOTE: this state is **TRANSIENT by design** — the prstatus collector (`prstatus.go`) keeps merged PRs only while they sit in the top-100 most-recently-updated window and rebuilds the snapshot wholesale each cycle; an older merge ages out, its fields reset to `""`, and the dot falls through to `neutral`. This is correct under Constitution II (no persistence): purple means "just landed", not a permanent badge. Do NOT attempt to persist merged state.
2. **`fail` BEFORE `healthy`** — an approved PR with a freshly-pushed failing commit MUST read red, never green. Red beats green, always. This branch IS today's `isFailish`.
3. **`pending`** — checks still running.
4. **`healthy`** — checks pass (draft included). Green = healthy, so no draft contradiction. There is deliberately **NO** `&& review === "approved"` requirement — green is purely about checks being healthy; requiring approval would exclude drafts, which we explicitly want green.
5. **`neutral`** — open with no decisive signal yet, OR closed-unmerged (abandoned window — DECIDED: closed → neutral, not red, not purple), OR an aged-out merge. Renders as a hollow/dim dot.

**Color map** (matches the EXISTING vocabulary already in `status-panel.tsx:74-90` — this change invents no colors):

```ts
const PR_DOT_COLOR: Record<PrDotState, string> = {
  merged:  "text-purple-400",
  fail:    "text-red-400",
  pending: "text-yellow-400",
  healthy: "text-accent-green",   // the established theme token (themes.ts:52), NOT raw text-green-400
  neutral: "text-text-secondary", // hollow/dim — always rendered for an open PR
};
```

**Accessible-name map** (color cannot be the only channel — colorblind users + Constitution V keyboard-first). The dot always renders for a change-bound PR window, so even `neutral` needs a label:

```ts
const PR_DOT_LABEL: Record<PrDotState, string> = {
  merged:  "PR merged",
  fail:    "PR needs attention — checks failing or changes requested",
  pending: "PR checks running",
  healthy: "PR checks passing",   // deliberately NOT "ready to merge" — health, not readiness
  neutral: "PR open",
};
```

### 2. `window-row.tsx` — replace the single-red-dot ternary (~line 284)

Replace today's `win.fabChange && win.prNumber && isFailish(win)` block (which renders a dot ONLY for the fail case) with a dot driven by `prDotState`. **The gate stays `win.fabChange && win.prNumber`** — but the result is now ALWAYS a dot (one of the 5 colors), with the per-state color from `PR_DOT_COLOR` and `aria-label` + `title` from `PR_DOT_LABEL`.

**Dot-for-every-open-PR (DECIDED).** Unlike today, the dot renders for EVERY change-bound window with a PR. `neutral` renders as a dim/hollow dot (`text-text-secondary`) — distinguishing "has a PR, no news" (hollow dot) from "no PR" (no dot at all). Today the glyph is a solid `●` (U+25CF) in `text-red-400`; the four "live" states keep the solid glyph in their token, while `neutral` renders hollow/dim.

**Caveat to eyeball during verify (NOT a blocking decision).** The existing ACTIVITY dot (`window-row.tsx:251`, filled = active / hollow = idle) sits at the LEFT of the name; the PR dot is in the RIGHT cluster (`window-row.tsx:276`) — they are on opposite ends, so a neutral hollow PR dot next to a hollow activity dot is acceptable, but worth a visual check. The exact hollow-ring rendering technique (border + transparent fill via `currentColor`, as the activity dot does at lines 254-257, vs. a solid dim glyph) is a **presentation nuance for the apply stage**, not a blocking decision.

### 3. `status-panel.tsx` — align draft coloring to health semantics (lines 99-122)

`status-panel.tsx`'s `getPrSegments` (lines 102-122) currently forces a DRAFT PR's state-color to `text-text-secondary` (line 108: `color: win.prIsDraft ? "text-text-secondary" : PR_STATE_COLORS[win.prState]`), with the rationale comment at lines 99-100 ("A draft PR keeps the neutral token for its state — draft is 'not ready', not a healthy green"). Under the new "green = health" semantics this is now INCONSISTENT with the dot.

This change MUST:
- Drop the `win.prIsDraft ? "text-text-secondary"` override so a draft's state-color follows `PR_STATE_COLORS["open"]` (= `text-accent-green`).
- Update the lines 99-100 comment to the "health, not readiness" framing.

All three PR surfaces (the sidebar dot, the `status-panel` segments, and `PrStatusLine`) must tell ONE color story.

### 4. TESTS (~60% of the change)

Rewrite the existing single-red-dot assertions into per-state assertions:

- **`window-row.test.tsx:259-325`** — currently asserts on the single `aria-label="PR needs attention"` string for the fail-only case. Rewrite into per-state assertions:
  - `merged` → purple (`text-purple-400`), label "PR merged"
  - `fail` → red (`text-red-400`), label "PR needs attention — checks failing or changes requested"
  - `pending` → yellow (`text-yellow-400`), label "PR checks running"
  - `healthy` → green (`text-accent-green`), label "PR checks passing" — **including a draft case** (`prIsDraft: true, prChecks: "pass"` → green)
  - `neutral` → hollow/secondary (`text-text-secondary`), label "PR open" (e.g. open PR with no checks signal yet, or closed-unmerged)
  - the no-PR / non-change-bound case → NO dot at all (gate unchanged)
- **`pr-status-line.test.tsx`** — add `prDotState` precedence unit tests, especially the precedence-defining cases: `fail`-beats-`healthy` (approved + freshly-failing checks → `fail`), `merged`-first (merged with historical fail → `merged`), `closed` → `neutral`, `draft` (`prChecks === "pass"`) → `healthy`.
- **`status-panel.test.tsx:459,514`** — already assert `pending` → yellow and `merged` → purple. ADD a draft → green assertion, and update any existing draft → secondary assertion to draft → green.

Per Constitution **Test Companion Docs (`.spec.md`)**, unit tests (`*.test.tsx`) are EXEMPT from the `.spec.md` companion requirement — that requirement is for Playwright `*.spec.ts` only. This change touches no `*.spec.ts`, so no `.spec.md` is created or updated.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update § Window rows item 3 ("PR-fail triage glyph", line 412) — it currently documents a single red `●` shown only when `isFailish(win)`. Generalize to the 5-state `prDotState` traffic-light (merged/fail/pending/healthy/neutral), the dot-for-every-open-PR behavior, the per-state color tokens, the per-state accessible names, and the "green = health, not readiness" semantic. Update § PR Status to record that `status-panel.tsx`'s `getPrSegments` no longer forces draft → secondary (draft state-color now follows the health logic), so all three PR surfaces share one color story. Reference the new exported `prDotState` / `PrDotState` / `PR_DOT_COLOR` / `PR_DOT_LABEL` in `pr-status-line.tsx` (colocated with `isFailish`).

## Impact

- **Code touched** (all frontend, `app/frontend/src/`):
  - `components/pr-status-line.tsx` — add exported `PrDotState` type, `prDotState()` function, `PR_DOT_COLOR` + `PR_DOT_LABEL` maps. Colocated with `isFailish`.
  - `components/sidebar/window-row.tsx` (~line 284) — replace the single-red-dot ternary with the `prDotState`-driven always-rendered dot.
  - `components/sidebar/status-panel.tsx` (lines 99-122) — drop the draft-secondary override + update the comment.
- **Tests touched**: `pr-status-line.test.tsx`, `sidebar/window-row.test.tsx`, `sidebar/status-panel.test.tsx`.
- **NOT touched** (explicit non-goals): no backend Go change; `prstatus.go` / `api/sse.go` unchanged; no new SSE field; no new `gh` call or GraphQL query field (`mergeable`/`mergeStateStatus` deliberately NOT fetched); no new route; no new component; no new color token (`text-accent-green`, `text-purple-400`, `text-red-400`, `text-yellow-400`, `text-text-secondary` all pre-exist).
- **Dependencies / data flow**: consumes the existing six `WindowInfo` PR fields (`types.ts:67-74`) joined by `attachPRStatus` (`api/sse.go:354`); no new producer.
- **Constitution alignment**: II (no persistence — merged is transient, never persisted); IV (minimal surface — reuses tokens + existing dot location, no new pages/routes/components); V (keyboard-first / a11y — every color carries a distinct accessible name via `PR_DOT_LABEL`).
- **Risk: LOW** — pure presentation in leaf components, no data-flow change, fully reversible (`git revert`).

**Rejected alternatives (from the design discussion):**
- *"Yellow = merge conflicts"* — REJECTED for v1. The current GraphQL query (`prstatus.go:201`) does NOT fetch `mergeable`/`mergeStateStatus`, so conflicts would need a new query field, and `mergeable` is notoriously laggy (often `UNKNOWN` right after a push). Yellow is reserved for `pending` (checks running) — which IS in the data and is reliable. If conflicts are wanted later, give them their OWN color (e.g. orange), not overload yellow.
- *"Green = ready to merge (strict: pass && approved && !draft)"* — REJECTED in favor of "green = healthy". The strict-readiness framing made draft = green incoherent; the user explicitly chose health semantics so drafts show green.
- *Suppressing the neutral dot (today's behavior)* — REJECTED; the user wants every open PR to show a dot.
- *Persisting merged state* — REJECTED (Constitution II).

## Open Questions

None — the design was fully synthesized from the discussion. The only deliberately-deferred presentation nuance (hollow-ring rendering technique for the neutral dot: border + transparent fill vs. solid dim glyph) is explicitly an apply-stage detail, not a blocking decision, and is recorded as a Tentative assumption below rather than an open question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Five states with first-match-wins precedence `merged → fail → pending → healthy → neutral`, exactly as the `prDotState` body specifies | Verbatim from the design discussion; the order is the whole design and is fully specified incl. each branch's rationale | S:98 R:80 A:90 D:95 |
| 2 | Certain | `green = health, not merge-readiness`; green label is "checks passing"/"healthy", never "ready to merge"; no `&& review==="approved"` requirement so drafts show green | Explicit user choice in the discussion (health over readiness); load-bearing reframing that makes draft=green coherent | S:98 R:75 A:88 D:92 |
| 3 | Certain | Color map reuses the exact existing tokens from `status-panel.tsx:74-90` (purple-400/red-400/yellow-400/accent-green/text-secondary); no new hex; `text-accent-green` is the theme token at `themes.ts:52` | Specified verbatim; verified against source — `accent-green` exists in `themes.ts`, the four other tokens are the established PR vocabulary | S:98 R:85 A:95 D:95 |
| 4 | Certain | Dot renders for EVERY change-bound PR window (gate stays `fabChange && prNumber`); `neutral` is a dim/hollow dot, distinguishing "has a PR, no news" from "no PR" | Explicit DECIDED in the discussion; rejects today's fail-only behavior | S:95 R:80 A:88 D:90 |
| 5 | Certain | `merged` is TRANSIENT (ages out of the top-100 snapshot to neutral), never persisted — Constitution II | Stated as DECIDED with Constitution II rationale; aligns with the no-database principle verified in constitution.md | S:95 R:85 A:98 D:95 |
| 6 | Certain | `closed`-unmerged → `neutral` (not red, not purple) | Explicit DECIDED in the discussion (abandoned window reads neutral) | S:95 R:85 A:90 D:95 |
| 7 | Certain | Every state carries a distinct accessible name via `PR_DOT_LABEL` (`aria-label` + `title`), incl. `neutral` ("PR open") — Constitution V + colorblind a11y | Labels specified verbatim; Constitution V (keyboard-first/a11y) makes color-only signaling non-compliant; mirrors the existing dot's aria-label+title pattern | S:98 R:85 A:95 D:92 |
| 8 | Certain | `status-panel.tsx` `getPrSegments` drops the `prIsDraft ? "text-text-secondary"` override (line 108) so draft state-color follows `PR_STATE_COLORS["open"]` = green; update the lines 99-100 comment to the health framing | Explicit DECIDED ("same meaning of color dots across all surfaces"); verified line 108 against source — the override is exactly as described | S:95 R:80 A:90 D:90 |
| 9 | Certain | Tests are rewritten into per-state assertions across the three test files (merged/fail/pending/healthy incl. draft/neutral + no-PR; `prDotState` precedence incl. fail-beats-healthy, merged-first, closed→neutral, draft→healthy; status-panel draft→green); unit `*.test.tsx` are `.spec.md`-EXEMPT | Test changes enumerated in detail with file:line anchors; Constitution Test Companion Docs explicitly exempts unit tests; change touches no `*.spec.ts` | S:95 R:90 A:95 D:90 |
| 10 | Certain | `prDotState` colocated with `isFailish` in `pr-status-line.tsx` and reuses it as the `fail` branch — single source of truth for the fail definition | Specified; matches the existing pattern where `isFailish` was exported precisely so row + Pane panel share one predicate (per ui-patterns memory) | S:95 R:85 A:95 D:95 |
| 11 | Confident | Backend untouched: no new SSE field, no new `gh` call, no GraphQL query change; "yellow = merge conflicts" rejected for v1 (yellow reserved for `pending`) | Explicit non-goal + rejected-alternative; verified the six PR fields already exist on `WindowInfo` and are attached by `attachPRStatus`, so no producer change is needed | S:90 R:80 A:90 D:88 |
| 12 | Tentative | Neutral dot's hollow-ring rendering technique (border + transparent fill via `currentColor`, like the activity dot at lines 254-257) vs. a solid dim glyph in `text-text-secondary` | Explicitly flagged as an apply-stage presentation nuance, NOT a blocking decision; either reads as "dim/hollow"; the activity-dot border technique is the strongest in-repo precedent so apply should prefer it, but final choice is reversible at apply time | S:60 R:90 A:70 D:55 |

12 assumptions (11 certain, 1 confident, 1 tentative, 0 unresolved).
