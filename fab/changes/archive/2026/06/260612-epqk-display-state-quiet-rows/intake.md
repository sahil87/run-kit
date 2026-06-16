# Intake: Consume fab pane map display_state; quiet parked sidebar rows; harden hover-icon cluster

**Change**: 260612-epqk-display-state-quiet-rows
**Created**: 2026-06-12

## Origin

> Consume fab pane map `display_state`; quiet parked sidebar rows; harden hover-icon cluster.

One-shot autonomous `/fab-new` dispatched by the `/fab-proceed` orchestrator. The input was a complete, pre-agreed design from a long prior discussion with the user — all decision points below were explicitly settled there (each marked "agreed"). Change type: feat. This intake reproduces the agreed decisions verbatim; no design latitude remains beyond minor implementation mechanics, which are graded in the Assumptions table.

## Why

**Surface problem — names truncate to nothing.** Sidebar window rows render `win.fabStage` as raw text in the right cluster (`app/frontend/src/components/sidebar/window-row.tsx:224-228`, `text-xs`). At the default 220px sidebar width, a `review-pr` row's right cluster (`review-pr` 9ch ≈ 64.8px + gap + duration ≈ 21.6px) plus the row's constant overhead (8px always-reserved left border, `pl-2`, `pr-[68px]` hover-icon reservation, `ml-3` indent, activity dot, gaps, ~6px scrollbar) leaves approximately **0px** for the window name. Verified arithmetic: Monaspace mono ≈ 7.2px/char at `text-xs`, 8.4px/char at `text-sm`.

**Deeper data problem — the rows lie about activity.** Most `review-pr` rows are finished changes parked indefinitely. fab-kit's `DisplayStage` falls back to "last done stage", so a fully-shipped change displays `review-pr` until archived — previously indistinguishable from an actively-worked review-pr because `fab pane map --json` discarded the state axis. fab-kit 2.1.7 (PR #394, change `260612-dkn3-pane-map-display-state`) added a nullable `display_state` field (values: `active`/`ready`/`done`/`failed`/`pending`/`skipped`; JSON `null` when unresolved) to pane map rows. run-kit's pinned `fab_version` is now 2.1.7 (`fab/project/config.yaml`, commit f5d52fe "New fab-kit version"), so the field is available but unconsumed. Verified live: parked changes emit `display_state` `"done"`; an actively-worked review-pr emits `"active"`; an intake awaiting the human emits `"ready"`.

**Why this approach over alternatives.** Suppressing the stage text for parked rows uses ground truth from fab-kit, explicitly chosen over the earlier-considered `agentState` heuristic (rejected — heuristic, not authoritative). Stage-name abbreviation (2-char codes), stage→color mapping, and attention/alert treatment for `failed`/`ready` were all considered and rejected for this change (the latter is a possible follow-up). If we do nothing, every parked change permanently consumes the row's entire name budget to display stale information.

**Secondary hazard — invisible click targets.** Independent of the data path, the three absolutely-positioned hover icons (pin / color swatch / kill) in `window-row.tsx:237-279` are `opacity-0` at rest on fine pointers but REMAIN click targets — a stray click near the row's right edge can hit the invisible kill button, and keyboard focus can land on an invisible control. Same component, hardened in the same change.

## What Changes

### 1. Backend: parse `display_state` from `fab pane map --json`

`app/backend/internal/sessions/sessions.go` — extend `paneMapEntry` (struct at lines 68-80, which already carries `Stage *string`):

```go
type paneMapEntry struct {
	// ... existing fields ...
	Stage        *string `json:"stage"`
	DisplayState *string `json:"display_state"` // new: active/ready/done/failed/pending/skipped; null when unresolved
	// ... existing fields ...
}
```

In the enrichment join (lines ~438-445, where `entry.Stage` already maps to `FabStage`):

```go
sd.windows[j].FabStage = derefStr(entry.Stage)
sd.windows[j].FabDisplayState = derefStr(entry.DisplayState) // new — empty string when null/absent
```

`app/backend/internal/tmux/tmux.go` — thread onto `WindowInfo` (next to `FabStage` at ~line 221):

```go
FabStage        string `json:"fabStage,omitempty"`
FabDisplayState string `json:"fabDisplayState,omitempty"` // new — empty when null/absent
```

The field flows through the existing `GET /api/sessions` response and SSE session payload unchanged — no new endpoints, no caching, no persistence (request-time pane-map join, constitution §II). The `fab` invocation itself is untouched (`exec.CommandContext` already, constitution §I).

### 2. Frontend type

`app/frontend/src/types.ts` (`WindowInfo`, ~line 57) — next to `fabStage`:

```ts
fabStage?: string;
fabDisplayState?: string; // new: active/ready/done/failed/pending/skipped; absent when fab reports null or omits the field
```

### 3. Window row policy: quiet parked rows

`app/frontend/src/components/sidebar/window-row.tsx` right cluster (lines 223-234) — suppress the stage text when the change is parked. Exact predicate, agreed:

```tsx
{win.fabStage && win.fabDisplayState !== "done" && (
  <span className="text-xs text-text-secondary">
    {win.fabStage}
  </span>
)}
```

- `fabDisplayState === "done"` → render duration only (quiet row). If duration is also absent the right cluster renders empty — acceptable, that is the quiet row working as intended.
- All other states (`active`/`ready`/`failed`/`pending`/`skipped`), unknown future values, or an absent field → today's behavior exactly (stage text shown).
- **Backward/forward compatibility (agreed)**: an older fab binary omits `display_state` → `fabDisplayState` is empty/undefined → stage always shown, byte-identical to current behavior. Unknown future state values also fall through to "show stage".

### 4. Hover-icon cluster hardening (same component, independent of the data path)

The icon container (`window-row.tsx:237`) currently:

```tsx
<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
```

becomes inert at rest, restored on hover/coarse pointers/keyboard focus:

```tsx
<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10 pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto">
```

and each of the three hover-revealed `opacity-0` buttons (pin's not-pinned branch, color swatch, kill) additionally gets `focus-visible:opacity-100` so keyboard focus never sits on an invisible control. The agreed design gave the focus reveal as an example (`has-[:focus-visible]:opacity-100 has-[:focus-visible]:pointer-events-auto` on the container); the per-button `focus-visible:opacity-100` is the working realization of the same intent, because a container-level `opacity-100` cannot reveal children that carry their own `opacity-0` (element opacity is independent/multiplicative), while the container-level `has-[:focus-visible]:pointer-events-auto` is kept verbatim. Tailwind v4 supports the `has-[]`/`focus-visible` variants; this is their first use in the codebase — accepted in discussion.

- Effect at rest on fine pointers: clicks in the icon zone fall through to the underlying row-select button instead of hitting an invisible kill/pin/swatch target. Deliberate icon clicks are unaffected — any mouse interaction hovers the row (`group-hover` restores interactivity before the click can land on a now-visible icon).
- Keyboard: the buttons remain tab-focusable (`pointer-events` does not affect keyboard); the focused control reveals itself and the container restores `pointer-events` via `has-[:focus-visible]`.
- **NO geometry change (agreed)**: the `pr-[68px]` reservation, coarse-pointer always-visible icons (`coarse:opacity-100`), and the pin's permanent visibility when `isPinnedToAny` all stay exactly as-is.

### 5. Spec update: `docs/specs/api.md` (mandatory, same change)

Project convention: payload shape changes require the spec edit in the same change. The session payload shape is specced at `docs/specs/api.md` (`fabStage` in the example at ~line 75 and the Window fields table at ~line 92). Add `fabDisplayState` in both places:

- Example JSON (after `"fabStage": "review-pr"`): `"fabDisplayState": "done"`
- Window fields table row:

```markdown
| `fabDisplayState` | `string?` | Pipeline state of the displayed stage from `fab pane map` `display_state` — one of `active`, `ready`, `done`, `failed`, `pending`, `skipped`; omitted when fab reports `null` or the field is absent (fab < 2.1.7) |
```

### 6. Tests (new behavior MUST be covered — code-quality.md)

- **Go** (`app/backend/internal/sessions/sessions_test.go` — extends the existing `paneMapEntry` unmarshal/join coverage at lines ~113, ~287): `display_state` parsing for all three shapes — present with a value (`"done"` → `FabDisplayState: "done"`), explicit JSON `null` (→ empty string after `derefStr`), and absent key (→ empty string). Cover the join mapping `entry.DisplayState` → `WindowInfo.FabDisplayState`.
- **`app/frontend/src/components/sidebar.test.tsx`**: lines 274-276 assert literal stage text on rows (`getAllByText("apply")`). Update/extend for the policy — stage visible when `fabDisplayState !== 'done'` (keep the existing assertion for that branch), hidden when `'done'` (new fixture/assertion; fixtures with `fabStage: "apply"` live at lines 57 and 70).
- **`app/frontend/src/components/sidebar/window-row.test.tsx`** (existing file): unit tests for (a) the suppression predicate — `done` → no stage text, duration still rendered; `active`/`ready`/absent/unknown value → stage shown; and (b) the icon-container hardening — assert the class strings (`pointer-events-none`, `group-hover:pointer-events-auto`, `coarse:pointer-events-auto`, `has-[:focus-visible]:pointer-events-auto` on the container; `focus-visible:opacity-100` on the hover-revealed buttons), since jsdom does not evaluate hover/media-query/`:has()` variants as computed styles.
- No `.spec.ts` files change → no `.spec.md` companion updates triggered (constitution §Test Companion Docs); unit tests are exempt from companions.

### 7. Verification gates (per `fab/project/code-quality.md`)

1. `cd app/backend && go test ./...`
2. `cd app/frontend && npx tsc --noEmit`
3. `just test`

E2E note: run e2e only via `just test-e2e` (never `npx playwright` / `just pw` — port isolation; `RK_PORT=3000` poisons `just pw` in this environment).

### Non-Goals (explicitly rejected for this change)

- Stage-name abbreviation (2-char codes)
- Stage→color mapping
- Attention/alert treatment for `failed`/`ready` states (possible follow-up)
- Any change to the 68px reservation geometry or hover-swap layouts
- Changes to the `dashboard.tsx` fabStage badge (lines ~112-116) or the PANE-panel fab line (`status-panel.tsx:200-201`) — both keep showing the full stage word

### Hydrate-stage spec/memory touchpoints (for the hydrate stage, not apply)

- `docs/specs/design.md` decision #17 ("Sidebar fab status … Omitted for non-fab windows", line ~434) + §Window row (~lines 334-338)
- `docs/memory/run-kit/ui-patterns.md:341` and `:379-383` (WindowRow contract)

## Affected Memory

- `run-kit/ui-patterns`: (modify) WindowRow contract — right-cluster stage policy (suppress stage text when `fabDisplayState === 'done'`, duration-only quiet row, compatibility fallthrough) and hover-icon cluster `pointer-events`/focus-reveal hardening (sections at :341 sidebar component map and :379-383 window-row contract)

## Impact

- **Backend**: `app/backend/internal/sessions/sessions.go` (`paneMapEntry` + enrichment join), `app/backend/internal/tmux/tmux.go` (`WindowInfo`). Additive payload field with `omitempty` — no consumer breakage.
- **Frontend**: `app/frontend/src/types.ts`, `app/frontend/src/components/sidebar/window-row.tsx`, `app/frontend/src/components/sidebar.test.tsx`, `app/frontend/src/components/sidebar/window-row.test.tsx`.
- **Specs**: `docs/specs/api.md` (in-change, mandatory). `docs/specs/design.md` is a hydrate-stage touchpoint.
- **Dependency**: field is populated only by fab ≥ 2.1.7 (run-kit pins 2.1.7 in `fab/project/config.yaml`); older binaries degrade gracefully to current behavior. Note `fetchPaneMap` deliberately runs from a project-free temp dir so the globally-installed fab's schema applies — no per-project version pinning of the field.
- **Constitution conformance**: no DB/caching (request-time join, §II); `exec.CommandContext` already used for the fab invocation (§I); wraps `fab pane map`, doesn't reimplement (§III); no new routes (§IV).
- **Memory domain**: run-kit (ui-patterns).

## Open Questions

None — every decision point was resolved in the prior discussion and is encoded above and in the Assumptions table.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Quiet-row predicate is exactly `fabDisplayState === 'done'` → duration only; all other values (`active`/`ready`/`failed`/`pending`/`skipped`, unknown, absent) keep today's stage text | Agreed verbatim in discussion — ground truth from fab-kit, explicitly chosen over the rejected `agentState` heuristic | S:95 R:90 A:95 D:95 |
| 2 | Certain | Backend shape: `paneMapEntry.DisplayState *string` (`json:"display_state"`) → `WindowInfo.FabDisplayState string` (`json:"fabDisplayState,omitempty"`), empty string when null/absent; frontend `fabDisplayState?: string` next to `fabStage` | Field names, types, tags, and placement given verbatim in the agreed design; mirrors the existing `Stage`→`FabStage` plumbing | S:95 R:85 A:95 D:95 |
| 3 | Certain | Backward/forward compatibility: absent `display_state` (older fab) → empty `fabDisplayState` → behavior byte-identical to today; unknown future values fall through to "show stage" | Agreed verbatim (decision 3 of the discussion) | S:95 R:90 A:95 D:95 |
| 4 | Certain | Scope exclusions: no stage abbreviation, no stage→color mapping, no failed/ready attention treatment, no geometry change (`pr-[68px]`, coarse always-visible icons, pinned-pin visibility), `dashboard.tsx` badge and `status-panel.tsx` fab line untouched | Explicitly rejected/out-of-scope list agreed with the user | S:95 R:90 A:95 D:90 |
| 5 | Certain | `docs/specs/api.md` gains the `fabDisplayState` field (example + Window fields table) in this same change | Project convention mandates the spec edit for payload shape changes; named a MUST in the agreed design | S:95 R:90 A:95 D:95 |
| 6 | Confident | Focus-reveal mechanics: per-button `focus-visible:opacity-100` on the three `opacity-0` icons + container-level `has-[:focus-visible]:pointer-events-auto` (container `has-[:focus-visible]:opacity-100` dropped as a no-op — children's own `opacity-0` would still hide them; element opacity is independent) | The agreed design marked the container classes as an example ("e.g."); this realizes its stated intent — keyboard focus never sits on an invisible, inert control — with working CSS. First codebase use of these Tailwind v4 variants was accepted in discussion | S:80 R:85 A:80 D:70 |
| 7 | Confident | Go coverage extends the existing `paneMapEntry` unmarshal/join tests in `app/backend/internal/sessions/sessions_test.go` (value / null / absent) | Test file and unmarshal precedents already exist at sessions_test.go:113/287; code-quality.md colocates Go tests with the package | S:75 R:90 A:90 D:85 |
| 8 | Confident | Icon-cluster unit tests assert class presence on container/buttons rather than computed styles | jsdom does not evaluate `:hover`/`@media (pointer: coarse)`/`:has()` — class assertions are the established jsdom-level contract for variant-gated styling | S:70 R:90 A:85 D:80 |
| 9 | Confident | `sidebar.test.tsx` keeps `getAllByText("apply")` for the visible branch and adds a `fabDisplayState: "done"` fixture asserting the stage text is absent | The agreed design says "update/extend for the policy (stage visible when !== 'done', hidden when 'done')"; fixtures at lines 57/70 are the natural injection point | S:80 R:90 A:90 D:85 |
| 10 | Confident | No new Playwright e2e specs: the change is data-driven text suppression + pointer-variant CSS, covered at unit level; no `.spec.ts` changes → no `.spec.md` companions | The agreed test list names unit tests only; hover/pointer-events-at-rest semantics are not reliably assertable under Playwright pointer emulation. code-quality.md's e2e clause is SHOULD, not MUST | S:70 R:80 A:75 D:70 |
| 11 | Confident | A quiet row whose duration is also absent renders an empty right cluster — accepted, no placeholder | Direct consequence of "render duration only"; parked (`done`) windows are idle so duration is present in practice (`getWindowDuration` computes from `activityTimestamp`/`agentIdleDuration`) | S:75 R:90 A:85 D:85 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
