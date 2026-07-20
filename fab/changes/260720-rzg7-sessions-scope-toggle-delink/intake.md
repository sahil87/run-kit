# Intake: Sessions-Pane Scope Toggle — Delink from SERVER Pane Expansion

**Change**: 260720-rzg7-sessions-scope-toggle-delink
**Created**: 2026-07-20

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a synthesized change description sourced from a live user conversation. All numbered decisions below were confirmed explicitly by the user in that conversation; the code claims were verified against the working tree during intake.

> Title direction: Sessions-pane scope toggle — delink from SERVER pane expansion. Whether the sidebar's SESSIONS pane shows only the current server's sessions or all servers' session groups is currently coupled to the SERVER panel's expansion state. Make scope its own explicit state (localStorage `runkit-panel-sessions-scope` = `all | current`, default `all`, no migration), flip the SERVER panel to default-open, add a scope toggle chip at the right edge of the SESSIONS header plus a command palette entry, remove the "Select a server above" hint (current-scope with no resolvable server falls back to showing all servers), and delete all `serverPaneOpen` usage from the sidebar.

## Why

1. **The pain point**: the one-server-vs-all-servers display of the SESSIONS pane is an invisible side effect of expanding/collapsing the SERVER panel. Users expanding the SERVER panel (to see server tiles) unexpectedly lose the multi-server session tree; collapsing it to reclaim vertical space unexpectedly widens the session list to every server. Two unrelated concerns — "do I want to see server tiles?" and "which servers' sessions do I want listed?" — share one bit of state.
2. **If we don't fix it**: the SERVER panel can never default open (decision 2) without permanently filtering the session list, and users have no way to filter the session list without also paying the vertical cost of the tile grid. The coupling also forces the awkward "Select a server above to see its sessions." dead-end on board routes.
3. **Why this approach**: an explicit, persisted scope state with a visible header toggle is the minimal decoupling — a header button, not a settings page (Constitution IV), keyboard-reachable via a command palette entry (Constitution V). A migration from the old coupled state was explicitly declined by the user (the old bit encodes panel visibility, not scope intent — carrying it over would guess wrong as often as right). The rejected alternative for the no-current-server case was keeping the hint with reworded text; the user chose falling back to showing all servers, which is never a dead-end.

## What Changes

### Current behavior (verified in code)

`serverPaneOpen` is read from localStorage key `runkit-panel-server` at `app/frontend/src/components/sidebar/index.tsx:124`:

```tsx
const [serverPaneOpen] = useLocalStorageBoolean("runkit-panel-server", false);
```

It has exactly three uses in that file:

1. `index.tsx:1126` — when true, `visibleServers` filters to `currentServer` only; when false, all servers render as groups:
   ```tsx
   const visibleServers = serverPaneOpen
     ? servers.filter((s) => s.name === currentServer)
     : servers;
   ```
2. `index.tsx:1133` — when true and the filter yields no server (board route where `currentServer === null`, or stale/deleted route param), a hint renders instead of the list:
   ```tsx
   if (serverPaneOpen && visibleServers.length === 0) {
     return <div ...>Select a server above to see its sessions.</div>;
   }
   ```
3. `index.tsx:1159` — when true, the single visible group is force-opened; when false, per-server collapse state applies (localStorage `runkit-panel-sessions-{server}`, default open for `currentServer` via `readServerOpen`):
   ```tsx
   isOpen={serverPaneOpen ? true : readServerOpen(srvInfo.name)}
   ```

The SERVER panel itself is `ServerPanel` (`app/frontend/src/components/sidebar/server-panel.tsx`), a `CollapsiblePanel` with `storageKey="runkit-panel-server"` and `defaultOpen={false}` (line 126).

### 1. New explicit scope state (user decision 1)

- New persisted state: localStorage key **`runkit-panel-sessions-scope`**, values **`all | current`**, default **`all`**.
- **No migration** from the old `runkit-panel-server` coupling (explicitly declined by the user). The old key remains solely the SERVER panel's own collapse state.
- Any unrecognized stored value is treated as `all`.
- The state lives in the Sidebar (`index.tsx`) via a localStorage-backed hook so the header chip, the session list, and the palette entry observe the same value reactively — the same sibling-subscriber pattern `useLocalStorageBoolean` provides today (`app/frontend/src/hooks/use-local-storage-boolean.ts`). That hook is boolean-typed, so the implementation adds a string/enum-typed sibling (or generic) rather than encoding the scope as a boolean.

### 2. SERVER panel defaults open; expansion fully decoupled (user decision 2)

- Flip `defaultOpen={false}` → `defaultOpen={true}` in `server-panel.tsx` (line 126).
- The SERVER panel's expansion state no longer affects the session list in any way.
- The stale code comment at `index.tsx:118-124` (which documents the coupling and cites the old `server-panel.tsx:107` default) is removed along with the `serverPaneOpen` read.

### 3. Scope toggle in the SESSIONS header (user decisions 3, 7)

- A toggle button at the **right edge of the SESSIONS header, after the current-session name** — the same right-edge position pattern as SERVER's `+` headerAction and the PANE panel's refresh button (`CollapsiblePanel`'s `headerAction` slot).
- The SESSIONS header is a hand-rolled div (`index.tsx:1107-1114`: `TypedLabel "Sessions"` + current session name at `ml-auto`), **not** a `CollapsiblePanel` — the toggle slots into that div; **no refactor to CollapsiblePanel**.
- Visual: a **small text chip that reads clearly at rest showing the active scope** (e.g. ALL / CUR style) — user accepted this recommendation because a filtered list with no visible indicator would look like servers vanished. Exact chip label/glyph rendering is open to designer-level judgment within this constraint (follow the existing header-button idioms: `text-text-secondary hover:text-text-primary`, monospace, keyboard-focusable per Constitution V).

### 4. `current` scope behavior + fallback (user decision 4)

- `current` scope: filter `visibleServers` to `currentServer` only and **force that group open** (`isOpen=true`), exactly as the coupled behavior does today.
- When `currentServer === null` (board route `/board/$name`) **or** the current server is missing from the server list (stale/deleted route param), **fall back to showing all servers**. The "Select a server above to see its sessions." hint is **removed entirely** (rejected alternative: keeping the hint with reworded text).
- `all` scope: all servers render as groups with per-server collapse state (`runkit-panel-sessions-{server}` via `readServerOpen`) — unchanged from today's collapsed-panel behavior.

### 5. Command palette entry (user decision 5)

- A palette action that flips the scope (`all` ⇄ `current`) — Constitution V requires every action be keyboard-reachable and names the palette as the primary discovery mechanism.
- Register it following the existing palette-action composition pattern (action blocks composed into `paletteActions` in `app/frontend/src/app.tsx`, e.g. `agentActions` / `windowSwitchActions`). Label follows the existing `Noun: Verb` idiom (e.g. `Sessions: Show current server only` / `Sessions: Show all servers`, or a single toggle entry — final wording at implementer's judgment).

### 6. Cleanup (user decision 6)

- `serverPaneOpen` usage disappears from `index.tsx` entirely — all three uses (`:1126`, `:1133`, `:1159`) replaced by the new scope state; the `useLocalStorageBoolean("runkit-panel-server", ...)` read at `:124` and its comment block are deleted.
- The hint string and any tests covering it go away.

### 7. Tests (user decision 8)

- **Unit**: `index.test.tsx` currently seeds `localStorage.setItem("runkit-panel-server", "true")` and asserts the coupled filtering, the hint (line 160), and the sibling-subscriber re-render (lines 221-229) — rewrite these around the new scope key/behavior (scope filtering, board-route fallback-to-all, chip toggle, default `all`). `server-panel.test.tsx` updated for `defaultOpen={true}`.
- **E2E**: `app/frontend/tests/e2e/sidebar-server-coupling.spec.ts` (three tests asserting the old coupling: open→narrows, tile-click→switches filtered group, close→restores multi-server tree) is superseded — replace with scope-toggle coverage (toggle narrows/restores, persistence across reload) and update its sibling `sidebar-server-coupling.spec.md` companion in the same change (Constitution: Test Companion Docs). `server-panel-grid.spec.ts` clicks the `Server` header button to *expand* the panel (lines 48, 69, 85, 105, 120) — with `defaultOpen=true` those clicks now collapse it; remove/adjust the expand clicks (and check `top-bar-persistence.spec.ts`, which also queries the server listbox). Affected specs get their `.spec.md` companions updated in the same change.
- Per code-quality.md: new/changed behavior needs test coverage — unit tests for the scope logic; e2e where feasible.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar section — sessions-scope state (`runkit-panel-sessions-scope`), SESSIONS-header scope chip, SERVER panel default-open + decoupling from the session list, hint removal/fallback-to-all, and the new palette entry.

## Impact

- **Primary code**: `app/frontend/src/components/sidebar/index.tsx` (scope state, header chip, filter/force-open/fallback logic, comment cleanup), `app/frontend/src/components/sidebar/server-panel.tsx` (`defaultOpen` flip), `app/frontend/src/app.tsx` (palette action), `app/frontend/src/hooks/` (string-typed localStorage hook sibling).
- **Tests**: `sidebar/index.test.tsx`, `sidebar/server-panel.test.tsx`, `tests/e2e/sidebar-server-coupling.spec.ts` + `.spec.md`, `tests/e2e/server-panel-grid.spec.ts` + `.spec.md` (expand-click inversion), possibly `tests/e2e/top-bar-persistence.spec.ts`.
- **Behavioral default shift**: fresh profiles now see the SERVER panel expanded (56px→its default height) and all servers' session groups (the session-list default is unchanged — collapsed panel already showed all groups). Users who previously kept the panel open lose the implicit current-only filter until they toggle scope to `current` (accepted: no migration).
- **Known pre-existing issue (not caused by this change)**: expanding a non-current server's group has an unfixed attachServer→SSE async race (multi-server-sidebar e2e). `all` scope with expansion exercises it more prominently; this change is not expected to fix it.
- No backend, API, or route changes. No new pages (Constitution IV — a header button, not a settings page).

## Open Questions

- None — all consequential decisions were confirmed explicitly in the originating conversation; no Unresolved decisions were deferred.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope becomes explicit state: localStorage `runkit-panel-sessions-scope` = `all`/`current`, default `all`; no migration from the old coupling | Discussed — user confirmed key, values, default, and explicitly declined migration | S:95 R:85 A:95 D:95 |
| 2 | Certain | SERVER panel `defaultOpen` flips `false` → `true`; its expansion no longer affects the session list at all | Discussed — user decision 2, exact file/line verified (`server-panel.tsx:126`) | S:95 R:90 A:95 D:95 |
| 3 | Certain | Toggle placement: right edge of the hand-rolled SESSIONS header div after the current-session name; no CollapsiblePanel refactor | Discussed — user decision 3, including the explicit no-refactor note | S:90 R:80 A:90 D:90 |
| 4 | Certain | `current` scope filters to `currentServer` + force-opens the group; when `currentServer` is null (board route) or missing, fall back to showing all servers; hint removed entirely | Discussed — user decision 4; rejected alternative (reworded hint) recorded | S:95 R:85 A:90 D:90 |
| 5 | Certain | A command palette entry flips the scope | Discussed — user decision 5; Constitution V mandates keyboard reachability | S:90 R:90 A:95 D:90 |
| 6 | Certain | All three `serverPaneOpen` uses (`index.tsx:1126/:1133/:1159`) plus the `:124` read are replaced by scope state; hint and its tests deleted | Discussed — user decision 6; uses enumerated and verified in code | S:90 R:80 A:90 D:90 |
| 7 | Certain | Toggle renders as a small text chip readable at rest showing the active scope (ALL / CUR style) | Discussed — user accepted the recommendation; a filtered list with no indicator would look like servers vanished | S:80 R:90 A:80 D:80 |
| 8 | Certain | In `all` scope, per-server collapse state (`runkit-panel-sessions-{server}`, `readServerOpen` defaults) carries forward unchanged | Matches today's collapsed-panel branch verbatim (`index.tsx:1159`); no signal to change it | S:75 R:85 A:90 D:85 |
| 9 | Certain | Unrecognized stored scope values are treated as `all` | Only safe default — mirrors the key's own default; trivially reversible | S:60 R:95 A:90 D:85 |
| 10 | Confident | Exact chip label/glyph rendering (e.g. `ALL`/`CUR`) is implementer/designer judgment within the visible-at-rest constraint | User explicitly delegated ("open to designer-level judgment within this constraint"); follows existing header-button idioms | S:65 R:90 A:75 D:60 |
| 11 | Confident | Palette entry registered in `app.tsx`'s `paletteActions` composition following the `Noun: Verb` label idiom; single-toggle vs. two-entry shape at implementer's judgment | Existing pattern (`agentActions`, `windowSwitchActions`) gives a clear home; wording is low-stakes and reversible | S:60 R:90 A:80 D:60 |
| 12 | Confident | Scope state uses a new string/enum-typed localStorage hook sibling of `useLocalStorageBoolean` so chip, list, and palette stay reactive sibling subscribers | Existing hook is boolean-only; the sibling-subscriber pattern is the established mechanism for cross-component localStorage state in this sidebar | S:60 R:85 A:85 D:70 |
| 13 | Confident | `sidebar-server-coupling.spec.ts` + `.spec.md` are rewritten as scope-toggle coverage (not merely deleted); `server-panel-grid.spec.ts` expand-clicks adjusted for default-open | User decision 8 requires e2e coverage of changed behavior; the expand-click inversion at lines 48/69/85/105/120 was verified during intake | S:65 R:85 A:80 D:65 |

13 assumptions (9 certain, 4 confident, 0 tentative, 0 unresolved).
