# Intake: Sidebar Current-Session Derived Expand

**Change**: 260822-o0cz-sidebar-current-session-derived-expand
**Created**: 2026-08-22

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a live conversation that reached a concrete decision. Synthesized description:

> Title direction: sidebar current-session derived expand (auto-expand the current tab's session group).
>
> Cmd+Up/Down tab navigation (`window-prev`/`window-next`, and likewise `session-prev`/`session-next`) steps over the flattened all-sessions window list (`app/frontend/src/lib/window-cycle.ts`) with no awareness of sidebar collapse state — intentionally, so collapsed sessions stay reachable. But when navigation lands in a session whose sidebar group is collapsed, the selected window row is not in the DOM: no highlight, no autoscroll, no orientation. The sidebar currently refuses to auto-expand by explicit design. The user has now decided the rule should be: **the session containing the current tab always renders expanded.**
>
> Agreed implementation: a **derived render-time override**, not a persistence mutation — at both collapse read sites, treat a session as collapsed only when it has a collapsed exception AND it is not the current route's session. The persisted exceptions map (`runkit-session-collapsed`, exceptions-only semantics per change `260807-kddk`) is untouched.

## Why

1. **The pain point**: keyboard tab navigation (`window-prev`/`window-next` ⌘↑/⌘↓, `session-prev`/`session-next` ⇧⌘↑/⇧⌘↓) deliberately walks the flattened all-sessions window list regardless of sidebar collapse state (`260822-ju2p`) — collapsed sessions stay reachable. When navigation lands inside a collapsed session group, the selected window row is not in the DOM: no selection highlight, no autoscroll, no visual orientation. The user is "somewhere" with the sidebar giving no clue where.
2. **If not changed**: every cross-session cycle through a collapsed group is disorienting — the sidebar shows nothing selected, and the deferred-scroll ref stays armed but never completes. The keyboard-first navigation model (Constitution V) is undermined exactly where it crosses collapsed groups.
3. **Why this approach**: the old rule was explicit — the selection-autoscroll effect comment at `app/frontend/src/components/sidebar/index.tsx:1188-1190` says "A collapsed group keeps the row out of the DOM: no scroll, no auto-expand (expanding would fight the user's explicit collapse)". The user has now reversed that decision with a rule that avoids the fight entirely: a **derived render-time override** means the persisted collapse preference is never mutated — the group renders expanded only *while current* and auto-recollapses on navigate-away, so the user's stored exceptions are never bulldozed. This matches the codebase's derive-over-store convention (sidebar session-order override; the transient present-auto-expand override in `app/frontend/src/lib/present-auto-expand.ts`).

**Rejected alternative** (from the conversation): expand-on-entry that *clears* the persisted exception when navigation lands in a collapsed session — rejected because cycling through sessions would permanently bulldoze the user's collapse preferences.

This is a deliberate UX-rule change (a reversal of a documented design decision), not a defect in shipped intent — the old behavior worked exactly as designed.

## What Changes

### 1. Derived collapse override at both read sites

`app/frontend/src/components/sidebar/index.tsx` has exactly two reads of the `collapsed` exceptions map (verified — the only `collapsed[` sites):

- **`:2366`** — inside `ServerGroupInner`'s `rowSlice`/`rowSignature` `useMemo` (feeds the roving/visible-rows machinery, i.e. `getVisibleRows` and keyboard tree nav): `const isCollapsed = collapsed[sessionRowKey] ?? false;`
- **`:2832`** — inside `ServerGroupInner`'s render body (drives `SessionRow`'s `isCollapsed` prop, hence whether window rows paint and the chevron/aria-expanded state): `const isCollapsed = collapsed[`${server}:${session.name}`] ?? false;`

Both become:

```ts
const isCollapsed = (collapsed[sessionRowKey] ?? false) && session.name !== currentSessionName;
```

i.e. a session is treated as collapsed only when it has a collapsed exception AND it is not the current route's session. The current-session key is `${server}:${currentSession}` for the current server + route session; inside `ServerGroupInner` this is already available as the `currentSessionName` prop, which the parent passes server-scoped at `index.tsx:1731` (`currentSessionName={srvInfo.name === currentServer ? currentSession : null}`) — so a plain `session.name !== currentSessionName` comparison is equivalent (null for non-current servers means no override there; session names cannot equal null).

**Both read sites MUST agree** — the `:2366` site feeds keyboard roving while `:2832` feeds rendering; if they diverge, arrow-key roving and the painted rows disagree. The `rowSlice` memo's dependency array (`index.tsx:2389`) MUST gain `currentSessionName` so the visible-row slice and its `rowSignature` recompute when the current session changes (the signature change is also what bumps `rowsVersion` and lets the armed deferred scroll complete).

### 2. What is deliberately NOT changed

- **The persisted exceptions map is untouched.** `runkit-session-collapsed` (`SESSION_COLLAPSED_STORAGE_KEY`) keeps its exceptions-only semantics from `260807-kddk`. No write path changes: `toggleSession` (`index.tsx:~890-906`) keeps operating on the RAW `collapsedRef.current` map — writing an exception when absent, deleting it when present.
- **The deferred-scroll machinery needs no changes.** `pendingScrollKeyRef` arms on selection change and retries on `rowsVersion` bumps; once the current session's group renders expanded (a visible-row SET change), the armed scroll completes on its own.
- **Navigation code is untouched.** `lib/window-cycle.ts` resolvers, `app.tsx` memos, keybindings — no changes.

### 3. Resulting behaviors (agreed in conversation)

- A session you ⌘↓ *through* expands only while it is current and auto-recollapses when you navigate away — its exception entry never left the map.
- Collapsing the current session via its chevron stays meaningful: it writes the exception, which takes effect the moment the session stops being current. It visually stays expanded while current — acceptable and consistent with the rule. (The chevron reflects the derived state, so on the current session it reads "Collapse"; a second click deletes the just-written exception via the raw-map toggle — two clicks return to the original persisted state, standard toggle semantics.)
- Sessions on non-current servers and the board route (`currentServer === null` → `currentSessionName` null everywhere) are unaffected: exceptions apply normally.

### 4. Comment and test updates

- **Comment** `app/frontend/src/components/sidebar/index.tsx:1188-1190` — the "no scroll, no auto-expand (expanding would fight the user's explicit collapse)" paragraph documents the reversed decision and MUST be rewritten to describe the new rule: the current session renders expanded via the derived override, so an armed scroll into the current session's group completes once the rows paint; only non-current collapsed groups still defer.
- **Unit test** `app/frontend/src/components/sidebar/index.test.tsx:2564` ("collapsed group: no scroll, no auto-expand; the deferred scroll fires on expand") asserts the old behavior and MUST be updated: selecting a window whose session is current now renders the group expanded and completes the scroll. Keep coverage for the still-true half — a collapsed NON-current session stays collapsed and defers the scroll — and add coverage for auto-recollapse on navigate-away (exception intact) and for the roving slice agreeing with the render (both read sites).
- **E2E check performed**: `app/frontend/tests/e2e/sidebar-multiselect.spec.ts:164` collapses sessions on the *server* route (`gotoServerReady` — no current session), so it is unaffected by the override. No existing e2e asserts the no-auto-expand rule. A new e2e for navigate-into-collapsed-session → group expands is desirable per code-quality ("UI changes SHOULD include Playwright e2e tests where possible") but unit coverage in `index.test.tsx` proves the DOM behavior; plan may scope e2e as optional.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) The selection-autoscroll section (line ~179) states "it does NOT auto-expand the group (rejected: fighting the user's explicit collapse)" — this documents the reversed decision and must be rewritten to the new derived-override rule. The session-collapse-persistence section (~line 165) and its Design Decision (~line 680) stay true (the map semantics are untouched) but should note the current-session render-time exemption; add a Design Decision entry for derive-over-store vs the rejected exception-clearing alternative.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — two one-line read-site changes + one memo dep + one comment rewrite. No new state, no new props (`currentSessionName` already threaded into `ServerGroupInner`).
- `app/frontend/src/components/sidebar/index.test.tsx` — rewrite one test, add derived-override/auto-recollapse/roving-agreement coverage.
- `docs/memory/run-kit/ui/sidebar.md` — hydrate the reversed decision.
- No backend, API, routing, keybinding, or localStorage-schema changes. No e2e changes required (one optional addition).

## Open Questions

- None — the conversation settled the rule, the mechanism, the exact predicate, and the rejected alternative.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Derived render-time override, not a persistence mutation: `isCollapsed = (collapsed[key] ?? false) && key !== currentSessionKey` at both read sites; `runkit-session-collapsed` map untouched | Discussed — user chose this verbatim over the exception-clearing alternative; matches the codebase derive-over-store convention | S:95 R:85 A:90 D:90 |
| 2 | Certain | Current session auto-recollapses on navigate-away (exception never left the map); chevron-collapse of the current session writes the exception and takes effect when the session stops being current | Discussed — consequences explicitly agreed in conversation | S:90 R:85 A:90 D:90 |
| 3 | Certain | Update the `index.tsx:1188-1190` comment and the `index.test.tsx:2564` no-auto-expand test; deferred-scroll machinery (`pendingScrollKeyRef`/`rowsVersion`) unchanged | Discussed — named in the conversation; verified in code that these are the only sites asserting the old rule | S:90 R:90 A:95 D:90 |
| 4 | Confident | Implement the override via the existing `currentSessionName` prop inside `ServerGroupInner` (`session.name !== currentSessionName`; parent already passes it server-scoped at `:1731`), adding `currentSessionName` to the `rowSlice` memo deps at `:2389` | Codebase gives a clear answer — the prop is already threaded; the dep addition is a mechanical necessity for roving/render agreement | S:75 R:85 A:90 D:85 |
| 5 | Confident | `toggleSession` keeps raw-map semantics (second chevron click on the current session deletes the just-written exception — two clicks idempotent); no write-path change | Second-click nuance not explicitly discussed; existing raw toggle already behaves this way and preserves reversibility — one obvious default, easily changed | S:55 R:80 A:75 D:65 |
| 6 | Confident | Test scope: unit coverage in `index.test.tsx` (override, auto-recollapse, non-current session stays collapsed, roving agreement); new Playwright e2e optional — existing `sidebar-multiselect` collapse e2e verified unaffected (server route, no current session) | code-quality SHOULD-level e2e guidance vs jsdom sufficiency for DOM-presence assertions; plan decides final scope | S:60 R:90 A:80 D:70 |
| 7 | Confident | Change type `feat` — a deliberate UX-rule change reversing a documented design decision, not a defect in shipped intent | Taxonomy: shipped behavior worked as designed; the rule itself changed | S:70 R:90 A:80 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
