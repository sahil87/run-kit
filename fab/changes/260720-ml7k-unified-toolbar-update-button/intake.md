# Intake: Unified Toolbar Update Button

**Change**: 260720-ml7k-unified-toolbar-update-button
**Created**: 2026-07-20

## Origin

Conversational — `/fab-new` invoked after a design discussion that first produced the shipped predecessor change `260720-n2ai-shll-check-updates-delegation-palette-checks` (PR #418, merged and released). The button was explicitly scoped OUT of that change and deferred to this one. Raw input:

> Unified toolbar update button — one button combining "Update Now" and a check-again affordance, hidden in the toolbar overflow dropdown by default, promoted+highlighted into the toolbar when a notable update is pending, demoting naturally when the verdict clears; placement derived from verdict state, never imperatively moved. Builds on the shipped n2ai verdict surface (POST /api/updates/check, per-tool updateAvailable/notable flags, useUpdateCheck hook).

User's original sketch from the design discussion (verbatim intent): *"One button saying [Update Now | ⟳]. By default it's hidden in the toolbar dropdown. The user can retry update checks — that runs 'Check for updates'. If update found, the button is highlighted and moved to the toolbar. Clicking on it runs the update and then the button demotes to within the dropdown."* Two refinements were proposed and accepted into the framing: (1) placement is **derived from verdict state**, never imperatively moved — "demotes after update" is just "verdict cleared"; (2) the resting (dropdown) form shows the version + a check affordance rather than a blind "Update Now" label, and the affordance is "check again", not "retry" (nothing failed).

## Why

1. **The pain point**: after n2ai, the deliberate check exists only as two palette commands. There is no mouse-visible / discoverable check affordance in the chrome — a user who doesn't know the palette commands cannot ask "is anything updatable right now?". Meanwhile the update surfaces are split: the in-bar `UpdateChip` (promoted, when a notable update is pending) and the overflow menu's version-row update surface are two renderings that already share click behavior via `useUpdateClick`, but the resting state (no pending update) offers nothing actionable at all — just a static version row.
2. **If we don't do it**: the on-demand check stays palette-only (undiscoverable to mouse-first and new users), and the chrome keeps a dead-end resting state — a version row you can read but not act on.
3. **Why this approach**: the "unified button" is not a new widget bolted alongside the chip — it is the **completion of the existing chip architecture**. Today's chip IS the promoted state; today's overflow version row IS the resting slot. The change adds the missing check-again affordance to the resting row and lets the existing verdict-derived rendering do the promote/demote. No imperative movement logic, no new state machine — placement falls out of `showChip`/verdict state exactly as it does today.

## What Changes

All frontend. No backend work — `POST /api/updates/check`, the per-tool `updateAvailable`/`notable` verdict flags, and the SSE payload shipped in n2ai.

### 1. Resting state — check affordance on the overflow menu version row

`app/frontend/src/components/top-bar-overflow-menu.tsx` (version row, ~line 227 area): the row currently shows the running version, plus an update surface only when a qualifying undismissed update is pending AND the chip is overflowed. Add a **check-again affordance** (⟳ glyph button, accessible label "Check for updates") rendered whenever no update surface is showing:

- Click runs the **plain notable check** — `runUpdateCheck(false)` from the existing `useUpdateCheck` hook (`app/frontend/src/hooks/use-update-check.ts:33`) — per the user's explicit spec ("that runs 'Check for updates'"). The incl.-patches variant stays palette-only.
- While the check is in flight the glyph shows a spinner/disabled state (single-flight — repeat clicks are no-ops until the response lands).
- Results report via the check flow's existing toast (`composeCheckToast`); a failed check raises the existing error toast. No new reporting surface.
- If the check finds a notable update, the shared verdict updates → `showChip` flips → the chip **promotes into the bar by derivation** (or, when overflowed, the menu row swaps to its update surface). Nothing imperative: the same rendering rules that place the chip today do all the movement.
- The affordance is **dev-sentinel gated** (hidden when `version === "dev"`), consistent with the palette check entries — a dev daemon never checks.

### 2. Promoted state — today's UpdateChip, unchanged in essence

`app/frontend/src/components/top-bar.tsx` — `UpdateChip` (:2222), registered in the L3 cluster via `barRender` (:595). The promoted state IS the unified button's highlighted form:

- Renders in-bar when `showChip` (notable pending + not dev + not dismissed) and space allows; overflows into the menu's update surface otherwise (existing behavior, including the chevron attention state).
- Click runs the existing one-click update via `useUpdateClick` (`app/frontend/src/hooks/use-update-click.ts`) — scoped update of the matched tools, `updating…` state, completion via daemon-restart reload or the post-remediation verdict-key change. Unchanged.
- **Demotion is derivation**: after the update completes the verdict clears → `showChip` false → the chip leaves the bar and the menu row reverts to version + ⟳. This is the user's "button demotes to within the dropdown" with zero new mechanism.
- The promoted form stays **single-action** (no ⟳ segment in-bar): a re-check is redundant when a fresh verdict is already showing, and the L3 cluster's width budget is tight (its width feeds the overflow measurement, top-bar.tsx:681).

### 3. Explicitly unchanged

- Dismissal semantics: `dismissUpdate` still silences the ambient chip only (demotes it to the menu's update surface); the palette `run-kit: Dismiss Update Notice` entry stays. A dismissed pending update shows the menu update surface, not the ⟳ (the update surface is the stronger affordance).
- The two palette check commands, `run-kit: Update Now`, and `run-kit: Restart Daemon` — untouched.
- The chip stays **notable-policy-driven**: no "quiet dot" third state for `update_available && !notable` in this change (patch-only findings remain toast-only, per n2ai). The signal is available if a later change wants it.
- Backend: nothing.

### Design notes — rejected alternatives (from the design discussion)

- **Split button `[Update Now | ⟳]` rendered even at rest**: rejected — a blind "Update Now" label when nothing is pending invites a no-op/blind force click and communicates poorly. Resting = version + check affordance; "Update Now" appears only when there is something to update.
- **"Retry" naming**: rejected — nothing failed; it's "check again" (⟳, "Check for updates" tooltip/aria).
- **Imperative promote/demote (moving the element on events)**: rejected — placement is derived from verdict state; the demotion machinery (reload on daemon restart, verdict-key change for siblings-only updates) already exists in `useUpdateClick`.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update chip / on-demand check sections — the resting version row gains the dev-gated check-again affordance (plain notable check, single-flight, toast reporting); promoted/resting placement documented as verdict-derived; promoted form stays single-action.

## Impact

- **Frontend**:
  - `app/frontend/src/components/top-bar-overflow-menu.tsx` — version-row check affordance (render conditions, spinner state, dev gate, aria label).
  - `app/frontend/src/components/top-bar.tsx` — at most minor wiring around the `UpdateChip` registration/overflow interplay; chip behavior itself unchanged.
  - `app/frontend/src/hooks/use-update-check.ts` — may need to expose an in-flight `checking` boolean for the spinner/single-flight state (currently returns only `runUpdateCheck`).
  - Unit tests: `top-bar-overflow-menu` tests for the new affordance (render conditions, click → check call, dev gate, in-flight state); hook test for `checking` if added.
- **Docs/specs**: none beyond memory (no API change).
- **Tests**: Vitest unit coverage as above. Playwright e2e is likely infeasible for the check flow itself (the e2e server runs the `dev` sentinel, which hides the affordance by design — same posture as n2ai); if any spec IS added/modified, its sibling `.spec.md` companion must be updated in the same commit (constitution).
- **Change type**: feat.

## Open Questions

- None — the button's behavior was specified by the user in the design discussion; residual details are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The unified button = completion of the existing chip architecture: promoted state is today's in-bar `UpdateChip`, resting state is the overflow menu's version row; placement derived from verdict state, never imperatively moved | User's own invocation text states the derived-placement rule; discussed and accepted | S:95 R:80 A:95 D:95 |
| 2 | Certain | The resting check affordance runs the PLAIN notable check (`runUpdateCheck(false)`); incl.-patches stays palette-only | User's words: "the user can retry update checks — that runs 'Check for updates'" | S:95 R:85 A:95 D:90 |
| 3 | Certain | Promoted-button click runs the existing one-click update (`useUpdateClick`), and demotion happens when the verdict clears (reload or key change) | User's sketch + the n2ai-shipped completion machinery | S:90 R:80 A:95 D:90 |
| 4 | Confident | Resting form shows version + ⟳ "Check for updates" — never a blind "Update Now" label at rest | Refinement proposed in discussion, user did not object; avoids no-op blind clicks | S:70 R:90 A:85 D:80 |
| 5 | Confident | Promoted form stays single-action (no ⟳ segment in-bar) | Re-check is redundant with a fresh verdict showing; L3 width budget feeds overflow measurement (top-bar.tsx:681); trivially reversible | S:55 R:85 A:75 D:60 |
| 6 | Confident | Check affordance reuses `useUpdateCheck` + toast reporting verbatim (success summary, error toast on failure); no new reporting surface | The hook/toast shipped in n2ai for exactly this flow; anti-drift reuse per code-quality | S:70 R:90 A:90 D:85 |
| 7 | Confident | Dismissal semantics unchanged; a dismissed pending update shows the menu's update surface rather than the ⟳ | Dismissal was settled in n2ai as chip-only silencing; update surface is the stronger affordance when pending | S:60 R:85 A:80 D:70 |
| 8 | Confident | No quiet-dot third state (`update_available && !notable`) in this change — chip stays notable-driven | Explicitly deferred in the n2ai discussion ("if you later want it, the signal is sitting right there") | S:65 R:90 A:85 D:80 |
| 9 | Confident | The ⟳ affordance is dev-sentinel gated (hidden on `version === "dev"`) | Consistency with the palette check entries' gating shipped in n2ai; a dev daemon never checks | S:70 R:90 A:90 D:85 |
| 10 | Confident | `useUpdateCheck` gains an exposed in-flight `checking` boolean for the spinner/single-flight state | The hook currently returns only `runUpdateCheck`; smallest seam for the required UI state; additive and reversible | S:55 R:90 A:85 D:75 |
| 11 | Confident | No Playwright e2e for the check flow (dev-sentinel hides the affordance on the e2e server); Vitest unit coverage instead | Same verified posture as n2ai (its review accepted this rationale); code-quality's e2e clause is "where possible" | S:60 R:85 A:80 D:75 |

11 assumptions (3 certain, 8 confident, 0 tentative, 0 unresolved).
