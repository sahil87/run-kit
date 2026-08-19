# Intake: Host-Switcher Dropdown Per-Row Disconnect & Rename

**Change**: 260817-pfvt-host-dropdown-disconnect-rename
**Created**: 2026-08-17

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a synthesized, user-confirmed description:

> Host-switcher dropdown per-row Disconnect and Rename actions (desktop shell). The desktop shell's titlebar host-switcher dropdown (`app/frontend/src/components/shell-titlebar-strip.tsx`, the SPA-drawn menu over the `runkitShell.servers` IPC bridge) lets the user list/switch/add/reorder hosts but offers no way to remove a host or rename it. Each host row gets exactly TWO hover-revealed icon affordances: a **disconnect** icon (user explicitly framed the action as "disconnect", not delete/remove) and an **edit** (rename) icon. Disconnect reuses the existing main-side `confirmAndRemoveHost` flow; rename is an inline edit in the dropdown row (the window-heading rename precedent). New additive, capability-gated IPC channels follow the exact `servers:reorder` template (change 1i7j): `servers:remove` and `servers:rename`.

Key user-confirmed decisions (verbatim from the dispatch): the two-icon row treatment, the "Disconnect" verb for icon/tooltip, reuse of the one `confirmAndRemoveHost` path, inline rename with no dialog anywhere, keyboard reachability (Delete/Backspace = disconnect, F2-or-equivalent = rename) via the existing capture-phase handler, the `servers:reorder`-template IPC + capability-pair shape, the `setHostLastPath`-shaped `setHostName` store mutator, menu rebuild on rename commit, and the explicit reversal of the recorded "no rename affordance" design decision.

## Why

1. **The pain point**: The SPA dropdown is the shell's primary host-management surface (list, switch, add, reorder all live there), yet removing a host requires leaving it for the native menu bar (`Hosts → Remove "<name>"…` → `confirmAndRemoveHost`, `app/desktop/src/main.ts:593`), and renaming a host is impossible anywhere — the rename chain was deliberately removed in change `260731-5blj` (recorded in `docs/memory/run-kit/desktop-shell.md` § Design Decisions → "Names auto-derive at add-time; there is no rename affordance"). Duplicate host entries are common — `addHost` never dedupes, and shared origins share auto-derived names — so users can neither clean up stale/duplicate registrations nor disambiguate same-named entries from the dropdown. The dropdown's own row anatomy admits the problem: it renders a dimmed origin per row *because* "host display names are not unique."

2. **The consequence of not fixing it**: Removal stays mouse-plus-menu-bar-only (violating the spirit of Constitution V — every user-facing action keyboard-reachable — for a surface whose whole premise is keyboard-first host switching), and renaming stays remove-and-re-add, which mints a fresh `randomUUID` and drops that host's remembered `lastPath` route. Duplicate/ambiguous entries accumulate.

3. **Why this approach**: The `260731-5blj` decision rejected rename because Electron has no native text-input dialog and the chain (menu item + privileged channel + welcome-page mode + store mutator) was heavy for a cosmetic string. The SPA dropdown did not exist then. It now does, and it is a cheap inline-edit surface: the SPA already owns an inline-rename precedent (the window heading — click to edit, Enter/blur commits, Escape cancels; there is no rename dialog in the product), and the additive capability-gated bridge pattern (`servers:add` in 4bqi, `servers:reorder` in 1i7j) makes the IPC surface small, sender-gated, and backwards-degradable. Disconnect adds no new removal logic at all — it routes into the one existing `confirmAndRemoveHost` path, so the native confirm dialog, view destruction, menu rebuild, and active-host fallback stay single-sourced.

## What Changes

### 1. Store mutator: `setHostName` (`app/desktop/src/hosts.ts`)

New id-keyed mutator following the `setHostLastPath` shape exactly — load → membership guard (unknown id is a no-op that writes nothing) → patch → atomic `saveHosts`, with a short-circuit on the unchanged value:

```ts
export function setHostName(dir: string, id: string, name: string): HostList {
  const list = loadHosts(dir);
  const trimmed = name.trim();
  const entry = list.hosts.find((h) => h.id === id);
  if (!entry || trimmed === "" || entry.name === trimmed) return list;
  const next: HostList = {
    ...list,
    hosts: list.hosts.map((h) => (h.id === id ? { ...h, name: trimmed } : h)),
  };
  saveHosts(dir, next);
  return next;
}
```

Name validation follows the `addHost` convention (trim in the store). An empty/whitespace-only name is a **no-op that keeps the current name** (nothing written) rather than a rejection — the store's no-op convention; the SPA treats an empty commit as cancel (§4). No schema change: `name` is already a required v1 field; entries stay keyed on the immutable `id` (names are not unique and never key anything).

### 2. IPC channels: `servers:remove` + `servers:rename` (`app/desktop/src/main.ts`)

Two new additive channels following the `servers:reorder` handler template verbatim (gate → structural payload narrowing → store call → menu rebuild → `{ ok: true }`), both gated by the existing `isHostsSender` (registered host origins + welcome page, via `isAllowedNavigation`):

- **`servers:remove`** — payload: the host id **string** (the `servers:switch` payload shape). Non-string → `{ ok: false, error: "Invalid request" }`. Otherwise `await confirmAndRemoveHost(id)` — the same one path the native `Hosts → Remove` item calls: native confirm dialog with Cancel as default (`defaultId: 1, cancelId: 1`), entry removed from hosts.json, that host's `WebContentsView` destroyed, `rebuildMenu()`, and when the removed host was active, `showActive` falls back to the first remaining host or welcome. Unknown id (early return inside `confirmAndRemoveHost`) and user-cancel both resolve `{ ok: true }` — cancel is a successful no-op, matching the reorder handler's unknown-id-is-ok convention. No new removal logic is written; the handler is a gate + narrow + call.
- **`servers:rename`** — payload: structurally validated `{ id, name }` (both strings; anything else → `"Invalid request"`), via a `parseRenamePayload` sibling of `parseReorderPayload`. Calls `setHostName(userDataDir(), id, name)` then `rebuildMenu()` unconditionally — host names appear in the native Hosts menu radio items and in the `Remove "<name>"…` labels, so a committed rename must re-derive them (the reorder precedent: unknown-id no-op still `{ ok: true }`, the rebuild harmless).

The frozen SPA contract is preserved: `servers:*` channel names and the `servers` group/envelope keep their server naming (desktop-shell memory § Design Decisions → The SPA bridge boundary keeps its server naming); the new channels are additive members of that same namespace.

### 3. Preload invokers (`app/desktop/src/preload.ts`)

The `servers` group gains two thin invokers alongside `list`/`switch`/`add`/`reorder`:

```ts
remove: (id: string): Promise<unknown> => ipcRenderer.invoke("servers:remove", id),
rename: (id: string, name: string): Promise<unknown> =>
  ipcRenderer.invoke("servers:rename", { id, name }),
```

### 4. SPA capability pairs (`app/frontend/src/lib/shell.ts`)

Two additive, independently narrowed capability pairs following the `canReorderShellHosts`/`reorderShellHosts` pattern verbatim (separate `is…Bridge` narrowing extending `ShellServersBridge`, so the base group stays usable on shells that lack the invoker; never throws; resolves `false` in a plain browser, on an older shell, or on a rejected/denied/malformed response):

- `canRemoveShellHost(): boolean` / `removeShellHost(id: string): Promise<boolean>`
- `canRenameShellHost(): boolean` / `renameShellHost(id: string, name: string): Promise<boolean>`

Older shells without the invokers render plain rows with no new affordances — the exact degradation contract the add/reorder capabilities established.

### 5. Dropdown row affordances (`app/frontend/src/components/shell-titlebar-strip.tsx`, possibly `app/frontend/src/lib/shell-strip.ts`)

Each host row gains **exactly two hover-revealed icon affordances** at the trailing edge, joining the existing hover drag grip's reserved zone (the current `pr-6` reservation widens to fit grip + two icons without disturbing the marker/name/origin/waiting/hint columns):

- **Disconnect icon** — the action verb is **Disconnect** (icon `aria-label` and `Tip` tooltip say "Disconnect", never delete/remove). Click → `removeShellHost(row.id)`; the shell then shows its native confirm dialog (the SPA adds no second confirmation — the main-side dialog with Cancel-default is the safety). `false` resolution → toast `"Shell host disconnect failed"` (the reorder-failure toast precedent) + `fetchServers()`. After a confirmed disconnect of a **background** host, the SPA refetches and the list reconciles in place (the existing open-time refetch + monotonic `listSeqRef` sequence guard); after disconnect of the **ACTIVE** host, the shell navigates (page swap to first remaining host or welcome) — nothing for the SPA to reconcile.
- **Edit (rename) icon** — click enters **inline edit** in that row: the name span is replaced by a text input prefilled with the current name (select-all on focus). **Enter or blur commits, Escape cancels** — the window-heading rename precedent; no dialog anywhere. Commit trims; an empty/whitespace-only or unchanged commit is a cancel (no invoke). A real commit calls `renameShellHost(id, trimmed)`, optimistically updates the local row name, and refetches to reconcile; `false` → toast `"Shell host rename failed"` + refetch. The menu stays open across a rename.
- Both affordances render only when the corresponding capability predicate passes (`canRemoveShellHost()` / `canRenameShellHost()`); on an older shell rows render exactly as today. Reveal is on row hover **and** row focus (keyboard parity for discoverability).

**Structural constraint**: each row is currently a single `<button role="menuitemradio">`; nesting interactive elements (icon buttons, the rename input) inside a button is invalid HTML. The row element must be restructured (e.g. a `role="menuitemradio"` container with a primary activate region plus sibling icon buttons, or absolutely-positioned sibling controls) without breaking: the roving-tabindex/arrow-key cycle (`itemRefs`, `focusedIndex`), reorder drag (row-level `draggable` + `HOST_REORDER_MIME` handlers), the emptied-list guards (`hostCountRef` written in a layout effect, close-on-empty effect), and the Add-Host footer's position as the last roving stop.

### 6. Keyboard bindings (Constitution V)

Both actions reachable on the **focused row while the menu is open**, extended into the existing capture-phase keydown handler (the `handleKey` effect that owns Escape/Arrow/⌥-arrow):

- **Delete or Backspace** on a focused host row → disconnect (invokes `servers:remove`; the native confirm dialog is the guard against accidents). Not bound on the Add-Host footer; ignored on an older shell without the capability (falls through).
- **F2** on a focused host row → enter inline rename (the OS-standard rename key; a single binding as directed).
- **While a row is in edit mode, menu key handling suspends for the editing keys**: Escape exits the edit (not the menu), Enter commits (does not activate/switch the row), arrows move the caret (no roving/reorder), Delete/Backspace edit text. The capture-phase handler bails when the event target is the rename input.

### 7. Tests (per code-quality.md — new behavior MUST include tests)

- **`app/desktop/src/hosts.test.ts`** (electron-free `node --test` over compiled dist): `setHostName` cases mirroring the `setHostLastPath` suite — rename persists and round-trips, unknown id writes nothing, unchanged value writes nothing (no file rewrite), whitespace is trimmed, empty/whitespace-only is a no-op keeping the current name, other fields (`activeId`, `lastPath`, `accentColor`, `remote`) untouched.
- **`app/frontend/src/lib/shell.test.ts`** (Vitest): present/absent/malformed shapes for both new capability pairs (the reorder-pair test pattern).
- **`app/frontend/src/components/shell-titlebar-strip.test.tsx`** (Vitest): icons render gated on the capabilities; older shell renders plain rows (no icons, no bindings); Disconnect click invokes `remove` with the row id; Delete/Backspace on a focused row invokes `remove`; F2 enters edit; Enter commits `rename` with the trimmed value; blur commits; Escape cancels the edit without closing the menu; empty/unchanged commit performs no invoke; failure resolutions surface the toasts and refetch; a remove-shrunk refetch keeps the existing focus/emptied-list guards intact.
- No e2e: `isShell()` is false in Playwright — the strip and its dropdown are vitest-plus-manual-verify territory (established in ui/top-bar memory § Desktop-Shell Titlebar Strip).

### 8. Memory amendments (hydrate stage)

This change **REVERSES** the recorded design decision "Names auto-derive at add-time; there is no rename affordance" (introduced by `260731-5blj`). Rationale for reversal: the SPA dropdown now exists as a cheap inline-edit surface; the alternative that decision rejected was a native dialog Electron lacks — the cost structure it priced no longer holds. Hydrate must amend:

- `docs/memory/run-kit/desktop-shell.md`: that Design Decision (superseded/reversed, with the new rationale), the Host-List Store section's "The store exposes no name mutator" claim, the Bridge section's `servers` group/channel/gate tables (+ the `servers:*` handler paragraph), and the Startup Routing & Welcome Flow paragraph on post-first-run management.
- `docs/memory/run-kit/ui/top-bar.md`: § Desktop-Shell Titlebar Strip — row anatomy, capability list, keyboard behavior, and the test-coverage inventory.

## Affected Memory

- `run-kit/desktop-shell`: (modify) reverse the "no rename affordance" design decision; update Host-List Store (new `setHostName` mutator), the `runkitShell` Bridge surface (`servers:remove`/`servers:rename` channels, preload invokers, gate table), and the remove-flow description (now IPC-reachable)
- `run-kit/ui/top-bar`: (modify) § Desktop-Shell Titlebar Strip — per-row Disconnect/Rename affordances, inline-edit behavior, Delete/Backspace + F2 bindings, capability degradation, test inventory

## Impact

- **`app/desktop/src/hosts.ts`** + **`hosts.test.ts`** — new `setHostName` mutator + suite.
- **`app/desktop/src/main.ts`** — two new `isHostsSender`-gated handlers (`servers:remove`, `servers:rename`) + `parseRenamePayload`; no change to `confirmAndRemoveHost` itself (it gains a second caller).
- **`app/desktop/src/preload.ts`** — two invokers on the `servers` group.
- **`app/frontend/src/lib/shell.ts`** + **`shell.test.ts`** — two capability pairs.
- **`app/frontend/src/components/shell-titlebar-strip.tsx`** + **`shell-titlebar-strip.test.tsx`** — row restructure, two icon affordances, inline edit, keyboard extensions.
- **`app/frontend/src/lib/shell-strip.ts`** (+ test) — only if the row model needs an edit-state or affordance field; expected unchanged (capabilities gate in the component, matching how `canReorder` works today).
- No Go/backend change, no route change, no e2e change. Additive IPC only — older shells and older SPAs degrade to today's exact behavior in both skew directions (old SPA under new shell never calls the new invokers; new SPA under old shell finds no invokers and renders plain rows).
- Invariants preserved: entries key on immutable host id; `servers:*` names + `servers` envelope frozen; every mutator no-ops on unknown id; atomic tmp-then-rename writes; the shell's one-path rules (`confirmAndRemoveHost`, `switchToHost`) keep single callers-converge seams.

## Open Questions

None — the dispatch description carries user-confirmed decisions for every major fork; residual choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two hover-revealed row icons — Disconnect + Edit(rename) — with "Disconnect" as the user-facing verb on icon/tooltip | User-confirmed verbatim in the dispatch description | S:95 R:70 A:90 D:95 |
| 2 | Certain | Disconnect routes through the existing `confirmAndRemoveHost` one-path flow (native Cancel-default confirm, store remove, view destroy, menu rebuild, active-host fallback); the new handler adds no removal logic | User-confirmed; the path exists at `main.ts:593` and is single-sourced by design | S:95 R:75 A:95 D:95 |
| 3 | Certain | Rename is inline row edit (Enter/blur commits, Escape cancels), no dialog anywhere | User-confirmed; window-heading rename is the recorded product precedent | S:95 R:70 A:90 D:90 |
| 4 | Certain | IPC: additive `servers:remove` (string id) + `servers:rename` (`{id, name}`), `isHostsSender`-gated, `servers:reorder` template; SPA capability pairs `canRemoveShellHost`/`removeShellHost` + `canRenameShellHost`/`renameShellHost` | User-confirmed; the add/reorder pattern is established twice over in the codebase | S:90 R:60 A:95 D:90 |
| 5 | Certain | Store: `setHostName(dir, id, name)` in the exact `setHostLastPath` shape (membership guard, unchanged short-circuit, atomic save); rename commit rebuilds the native menu | User-confirmed; names appear in Hosts-menu item labels so the rebuild is forced | S:90 R:70 A:95 D:90 |
| 6 | Confident | Keyboard: Delete/Backspace = disconnect, F2 = rename, on the focused row via the existing capture-phase handler; F2 chosen as the "single binding" (OS-standard rename key) | Delete/Backspace user-confirmed; F2 was "F2 (or an equivalent single binding)" — F2 is the front-runner and trivially rebindable | S:80 R:85 A:80 D:65 |
| 7 | Confident | Empty/whitespace-only rename commit cancels (keeps current name, no invoke, nothing written); trim store-side per the `addHost` convention | Explicitly delegated ("decide and record as an assumption"); keep-current matches the store's no-op convention and the inline-edit cancel semantics; rejection-with-error adds surface for no user value | S:60 R:85 A:75 D:70 |
| 8 | Confident | `servers:remove` resolves `{ ok: true }` on user-cancel and on unknown id — cancel is a successful no-op; the SPA refetches either way and the list reconciles | Matches the reorder handler's unknown-id-is-ok convention; the SPA has no use for distinguishing cancel from success | S:55 R:85 A:80 D:65 |
| 9 | Confident | The native `Hosts → Remove "<name>"…` menu item keeps its name and behavior; the "Disconnect" verb is dropdown-only | The dispatch scopes the verb to the dropdown icon/tooltip; renaming the native item is unrequested scope | S:60 R:90 A:75 D:70 |
| 10 | Confident | Row layout: the two icons join the drag grip in a widened trailing hover/focus-revealed cluster; the row's `<button>` is restructured to avoid nested-interactive HTML while preserving roving tabindex, drag reorder, and emptied-list guards | Geometry/structure is apply-level and fully reversible; the constraints are enumerated in What Changes §5 | S:50 R:90 A:60 D:50 |
| 11 | Certain | Failure surfacing follows the reorder precedent: toasts `"Shell host disconnect failed"` / `"Shell host rename failed"` + refetch-to-reconcile | Direct pattern application; the toast + refetch pair already exists in `commitReorder` | S:70 R:90 A:85 D:80 |
| 12 | Confident | Edit-mode key suspension: while the rename input is focused, Escape exits the edit only, Enter commits without activating the row, arrows/Delete/Backspace act on text; the capture handler bails on events targeting the input; menu stays open across a commit | Design fill required by the inline-edit decision colliding with the menu's existing capture-phase bindings; one obvious resolution (the capture handler bails on events targeting the input) | S:55 R:85 A:70 D:60 |
| 13 | Certain | Tests: `node --test` cases for `setHostName` in hosts.test.ts; Vitest coverage for the capability pairs and the strip component behaviors; no e2e (strip invisible to Playwright) | code-quality.md mandates tests for new behavior; the per-module test homes are established | S:85 R:90 A:95 D:95 |
| 14 | Certain | Hydrate amends desktop-shell.md (reversed design decision + store/bridge sections) and ui/top-bar.md (strip section), recording the reversal rationale (SPA dropdown now exists as the cheap inline-edit surface the 5blj decision lacked) | User-confirmed as an explicit constraint of the dispatch | S:90 R:80 A:90 D:90 |

14 assumptions (8 certain, 6 confident, 0 tentative, 0 unresolved).
