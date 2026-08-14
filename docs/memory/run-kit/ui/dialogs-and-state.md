---
description: "Component conventions, dialogs (create session, spawn-agent, settings, width variants), clipboard utility, e2e host-global filesystem state, the Zustand window store, and optimistic UI + mutation feedback."
type: memory
---
# run-kit UI — Dialogs & Client State

## Component Conventions

- **All components are client-side** — pure React SPA, no Server Components. Data fetched via typed API client (`app/frontend/src/api/client.ts`) and SSE context
- **No loading spinners** — SSE keeps data fresh, the view renders with whatever data is available
- **Data fetching via context** — `SessionProvider` at layout level owns the `EventSource` connection and provides session data via `useSessions()` hook
- **SSE via `useSessions` hook** — thin wrapper over `SessionProvider` context. Single `EventSource` at layout level. SSE handler diffs incoming `e.data` JSON string against a `useRef<string>` before parsing — if identical, skips `setSessions()` entirely (eliminates ~90% of redundant re-renders). When data has changed, `setSessions()` is wrapped in `startTransition()` to keep user input responsive. Auto-reconnects via `EventSource` built-in. Server-side SSE uses a module-level goroutine hub that deduplicates polling across browser tabs
- **ChromeProvider context** (`app/frontend/src/contexts/chrome-context.tsx`) — split into state/dispatch contexts. Three hooks: `useChromeState()` (state only), `useChromeDispatch()` (dispatch only), `useChrome()` (convenience alias for both). Components that only read state (e.g., `AppShell`) use `useChromeState()` to avoid subscribing to dispatch identity changes. Manages current session:window selection, sidebar open/collapsed state, drawer state (mobile), `isConnected`, `fixedWidth`, and `terminalFontSize` (the effective global terminal font preference — see § Terminal Font Size). Chrome derives content from the selection — no slot injection
- **SessionProvider context** (`app/frontend/src/contexts/session-context.tsx`) — layout-level provider owning the single `EventSource`. Session data consumed via `useSessions()` hook. Connection status forwarded to ChromeProvider internally.
- **Shared `Dialog` component** (`app/frontend/src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click, and an optional `size` width variant (§ Settings Dialog → Dialog width variant). Used for create, kill, **session**-rename, and settings dialogs. Window rename is the centered `WindowHeading`'s inline edit, not a dialog (§ Window Heading). (`260703-5ilm`, `260724-6j1v`)

### Clipboard Utility

`app/frontend/src/lib/clipboard.ts` — shared `copyToClipboard(text: string): Promise<boolean>` function. Primary path uses `navigator.clipboard.writeText()`; fallback uses `document.execCommand('copy')` for non-secure contexts (HTTP). All callers (terminal copy, Pane panel row copy) import from this module (§ Steady-state version surfaces for the boolean success signal).

CWD display (line 1) uses `shortenPath()` to shorten the active pane's `cwd` (falls back to `worktreePath`):
- Home substitution: `/home/<user>/…` → `~/…`, `/Users/<user>/…` → `~/…`, `/root/…` → `~/…` (exact home dir → `~`). Handles Linux and macOS conventions.
- Truncation: if the path (after home substitution) has more than 2 non-empty segments, it is truncated to `…/<second-to-last>/<last>`. Paths with ≤ 2 segments are not truncated.
- Examples: `/home/sahil/code/org/repo/src` → `…/repo/src`; `/home/sahil/code/org` → `~/code/org`; `/var/log/nginx` → `…/log/nginx`.
- The `title` attribute on the CWD element always contains the original unmodified `activePaneCwd` — hover to see the full path.

### E2E host-global filesystem state (`~/.rk/settings.yaml` snapshot/restore)

`scripts/test-e2e.sh` isolates the **tmux server** (dedicated `-L rk-test-e2e` socket) and the **port**, but NOT `$HOME` — so any e2e that exercises a feature persisting to `~/.rk/` (settings, VAPID keys, push subscriptions) POSTs against the **developer's REAL host file**. `board-list-reorder.spec.ts` therefore snapshots the developer's `~/.rk/settings.yaml` and restores it around the suite so a curated board order (or any other setting) is never clobbered by test residue:

- **`beforeAll`** raw-byte-reads `settings.yaml` (`readFileSync(path, "utf8")`). Absent detection is **ENOENT-only**: a `code === "ENOENT"` read error means "no file to restore" (afterAll then deletes any residue); ANY other read error (EACCES/EIO — the file EXISTS but couldn't be snapshotted) is **rethrown**, so afterAll never `rmSync`-deletes real settings on a failed snapshot.
- **`afterAll`** (always runs, even on test failure) restores VERBATIM: write the original bytes back if the file existed, else `rmSync({ force: true })` to delete residue — a byte-identical round-trip. Teardown errors are swallowed so they never mask a test failure.

This is the general pattern for **any** host-global filesystem state an e2e touches: explicit save/restore in the spec, because the harness scopes tmux+port but not the filesystem. The companion `.spec.md` documents the save/restore in its Shared setup section (constitution Test Companion Docs).

## Create Session Dialog

The "Create session" dialog (command palette `Session: Create at Folder` / `Window: Create at Folder` actions) has three sections:

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`). Tappable list items with 44px min height for mobile. Selecting fills path + auto-derives session name.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

3. **Session name** — Auto-derived from the last segment of the selected path (e.g., `~/code/sahil87/run-kit` yields `run_kit`). Editable — auto-derivation is a convenience, not a lock. The typed name field converts **live** as the user types via `toSafeSessionName` (§ Live Safe-Name Conversion) — a typed space appears as `_`. When the name field is left empty at submit time, the name is derived from the path automatically via `deriveNameFromPath()`. The Create button is enabled when either a name or a path is provided.

On submit, the dialog calls `createSession(server, name, cwd)` (the typed name run through `finalizeSafeName` first — trailing `_` trimmed, § Live Safe-Name Conversion) which sends `POST /api/sessions?server={server}` with `{ name, cwd }`. If the name field is empty but a path is set, the name is derived from the path's last segment via `deriveNameFromPath` (the session transform: hyphens→underscores, spaces and colons/periods and the forbidden set → underscores). Collision with existing session names is checked on the finalized/derived name and shows an error. The `cwd` field is omitted when no path is selected, so a name-only create still works. Accessible from the command palette's folder-prompted creation actions (§ Folder-Prompted Creation).

## Spawn-Agent Dialog

`app/frontend/src/components/spawn-agent-dialog.tsx` — a compact `Dialog` (create-session-dialog styling: `text-xs` field labels, disabled-submit styling) surfacing `rk riff` as a one-action web spawn. It is the frontend of the web-UI agent-spawn flow; the backend is `POST /api/riff` (see [architecture](/run-kit/architecture.md) § API Layer and the engine in [rk-riff](/run-kit/rk-riff.md)). **Title** carries the target session: `Spawn agent in {session}` (substring-compatible with the e2e's `getByRole("dialog", { name: "Spawn agent" })`, which does case-insensitive substring matching).

**Fields — in order Task → Preset → Where → Worktree → Agent**:

1. **Task** — free text, optional, autofocused; empty spawns a blank agent session.
2. **Preset** — a dropdown fetched on open (see preflight below), shown **only when the repo defines presets** (`presets.length > 0`); each option renders `name — layout (N panes)`.
3. **Where** — a `role="radiogroup"` with two options: **new worktree** (default, `where="worktree"`) and **this checkout** (`where="checkout"`, roots the window in the existing checkout — no worktree created). State is the typed `RiffWhere = "worktree" | "checkout"` union (no `as` casts).
4. **Worktree** — a text input, blank by default, placeholder `auto-named (e.g. swift-fox)`; **hidden when `where === "checkout"`** (it has no meaning there). Converts **live** via `toSafeWorktreeName` as the user types (§ Live Safe-Name Conversion) — spaces → `_`, `/` → `_`, a leading `-` dropped (matching `ValidateWorktreeName`), hyphens kept. Blank = wt auto-names; a typed name rides `worktreeName` through to `wt create --worktree-name`. No pre-filled suggestion; the placeholder is the honest fallback (§ Design Decisions → The worktree field carries no pre-filled name).
5. **Agent** — a tier dropdown populated from the preflight's `tiers` (built-ins ∪ the repo's `agent.tiers`, `default` first), defaulting to the `DEFAULT_TIER = "default"` constant. Displays tier **names only** (no model IDs — brittle to parse out of command strings). **FAB-GATED**: the field renders **only when `tiers.length > 0`**. The backend fab-gates the presets response (`tiers: []` for a non-fab repo — see [architecture](/run-kit/architecture.md) § API Layer `/api/riff/presets`), so an empty list HIDES the field entirely — no label, no hint text, no disabled control — because in a non-fab repo every tier resolves to the same `DefaultLauncher` (inert noise). When hidden, `tier` is omitted from the spawn body (see § Defaults). Non-fab-repo hiding does NOT enumerate system agents (claude/codex/gemini) — tiers remain fab's abstraction (constitution §III). (`gsmu`)

**Enter submits from any field** (`handleKeyDown` wired on all inputs incl. the radios and both selects). **Preflight fetch** (`getRiffPresets(server, session)`) is **best-effort**, with two branches: (`gsmu`)

- **Success** — sets `presets` and mirrors the response `tiers` **verbatim** (`setTiers(data.tiers)`). A fab project returns a populated list (field shown); a non-fab repo returns `[]` (field hidden). This verbatim mirror is what makes the frontend gate follow the backend gate.
- **Failure** (e.g. non-repo cwd, network error) — leaves the preset dropdown hidden and **keeps the Agent dropdown at the built-in `[DEFAULT_TIER]` fallback (field SHOWN)**. On a rejected fetch the repo's fab-ness is UNKNOWN, so the conservative status quo is to show the inert default rather than hide it — still allowing a task-only spawn.

A `cancelled` ref guards the async setState; a `mountedRef` guards the submit path against a stale setState after the dialog closes.

**Defaults omit unset fields**: `spawnRiff` omits each field when unset/default — `where` when `"worktree"`, `worktreeName` when blank (and always in checkout mode — the client drops it since the backend rejects the pairing), `tier` when `"default"` — so leaving the fields untouched sends a two-field body. The submit also drops `tier` entirely when the Agent Tier field is hidden (`tier: tiers.length > 0 ? tier : undefined`): a non-fab repo never sends an inert tier, matching the gate. The `tiers` array is a submit dependency of the `handleSubmit` `useCallback`. (`gsmu`)

**Submit → in-flight → outcome**: on submit it sets a `busy` flag (disables all fields + the button, guarding double-submit) and shows an **indeterminate** busy pipeline label — `LogoSpinner` + "Spawning: worktree → window → agent…" — with **no per-step progression**, because the synchronous endpoint emits no per-step events. On success it closes and calls `onSpawned(windowId)` (wired to `app.tsx`'s `navigateToWindow`, inheriting the window-switch slide transition). **Falsy-windowId guard**: the backend `windowId` is best-effort (`""` when its `display-message` window-id resolve fails), so the dialog only navigates when `res.windowId` is truthy — otherwise it closes without navigating and lets the SSE stream surface the new sidebar row (navigating with an empty id would land on a junk `/$server/@` URL). A `400`/`500` renders its message in-dialog (`text-signal-red`; nothing was created on a `400`) and keeps the dialog open for correction.

**Entry points — THREE** (the first two are terminal-route only, the third is the sidebar). The two terminal-route entries open the dialog for the CURRENT window's session; the sidebar entry targets ANY listed session on ANY server (cross-server spawn): (`gsmu`)

1. **Cmd+K `Agent: Spawn`** — a `PaletteAction` in `app.tsx`'s `agentSpawnActions` block (folded into `paletteActions`), gated on `sessionName` (mirrors `Window: Create`). Passes the CURRENT `{server, sessionName}` (`onSelect: () => handleOpenSpawnAgent(server, sessionName)`; `server` added to the memo deps). Constitution V palette parity; the shortcut/registration is documented at the registration site per `code-review.md` ("New keyboard shortcuts must be documented in the command palette registration").
2. **`+ New Agent`** — the window-switcher dropdown's `secondaryAction` beside `+ New Window` (see § Breadcrumb Dropdowns). Threaded via an optional `onSpawnAgent?(session)` on the top-bar slot context (`top-bar-slot-context.tsx`) → `TopBar` prop → `BreadcrumbDropdown.secondaryAction`; absent (e.g. before `AppShell` registers, or off-terminal routes) → the dropdown renders no `+ New Agent`. The one-arg slot signature is kept via a thin `handleSlotSpawnAgent = (sess) => handleOpenSpawnAgent(server, sess)` binding the CURRENT server (this entry is not cross-server).
3. **Sidebar session-row bot button (`gsmu`)** — a per-row 🤖 button in the session-row trailing icon cluster (see § Sidebar → session-row icon cluster). It passes the ROW's explicit `{server, session}`, so it works from any route the sidebar is mounted on (Host / tmux Server / Terminal — NOT the board-route sidebar, which passes no handler) and targets any server → **cross-server spawn**. Wired `app.tsx` → `<Sidebar onSpawnAgent={handleOpenSpawnAgent} />`.

All three entry points call `AppShell`'s `handleOpenSpawnAgent(server, session)`, which sets the explicit target state `spawnAgentTarget: {server, session} | null`. The dialog renders iff `spawnAgentTarget != null` and is lazy-imported + `Suspense`-wrapped (like `CreateSessionDialog`), receiving `server={spawnAgentTarget.server}` and `session={spawnAgentTarget.session}` (an explicit target, not the current server from `useSessionContext`). `spawnAgentTarget != null` is folded into `dialogOpenRef` so the active-window effect treats it like every other open dialog. (`gsmu`)

**Cross-server nav on success** (`gsmu`): `onSpawned(windowId)` branches on whether the target IS the current route server. Same-server → reuse `navigateToWindow` (inherits the window-switch slide transition). Cross-server → `navigate({ to: "/$server/$window", params: { server: target, window: windowId } })` (+ close the mobile sidebar), mirroring `handleSidebarSelectWindow`. The falsy-`windowId` guard is preserved on both branches. The branch itself lives in the **shared `navigateToSpawnedWindow(srv, windowId)`** helper in `app.tsx`, which the row-flyout fork also calls (§ Row-hover register flyout card → Fork navigation on success) — one routing rule for every riff-shaped result, so the two call sites cannot drift.

## Settings Dialog

A VS Code-style settings **dialog** (not a routed page — constitution §IV keeps "no settings pages") gathers the instance's scattered preferences into one keyboard-first surface: `app/frontend/src/components/settings-dialog.tsx` on the shared `Dialog` shell (focus trap, `role="dialog"`, Escape closes) at its wide `size="lg"` variant. It is the single edit surface for the host-scoped settings (SSH host, instance display name) and for **notifications**, alongside second surfaces for controls that also live in-context (theme pair, instance accent color, terminal font size).

**Mounted once at `AppLayout`, not `AppShell`** — `AppShell` is server-scoped (assumes a non-null `currentServer` throughout `app.tsx`), while `AppLayout` is the true every-page layer (the persistent `RootTopBar` mounts there; `/board/$name` renders inside it without `AppShell`). So the dialog, its state, and its logic exist exactly once and it is available on every route including boards. `SettingsDialog` is lazy-imported and rendered inside a `SettingsDialogProvider` at the `AppLayout` level; the body (`SettingsDialogBody`) mounts only while open, so the per-open SSH-host fetch runs on mount with no reopen-staleness bookkeeping.

**`SettingsDialogContext` (`contexts/settings-dialog-context.tsx`)** — a deliberately small open/close context `{ isOpen, openSettings, closeSettings }` provided at `AppLayout` so any descendant (palette actions, sidebar gear) calls `openSettings()` while the dialog renders once. Instance data (display name, accent) lives in its own contexts, not here.

**Two labeled sections make the persistence scope visible** (a device-local value not syncing across devices reads as designed, not broken):

- **This host** ("stored on this instance, shared by every device") — persisted to `~/.rk/settings.yaml`: **instance display name**, **SSH host**, **instance accent color**, **theme pair**.
- **This device** ("stored in this browser only") — browser-local ergonomics: **terminal font size** and **notifications** (the Web Push subscription is per-browser, so the scope is semantically exact).

**Desktop preference-pane layout, one responsive code path** (`260724-6j1v`):

- **Wide dialog** — `size="lg"` on the shared `Dialog` (`max-w-2xl`, ≈672px) instead of the phone-card `max-w-sm` every other dialog keeps (§ Dialog width variant below).
- **`PreferenceRow`** — each setting is a `grid grid-cols-1 min-[480px]:grid-cols-[190px_1fr] gap-x-6 gap-y-1.5 py-2.5 items-start` row: label column left (the label plus an optional small `text-text-secondary` **sublabel** hint underneath), control column right, so every control's left edge lands on ONE vertical rule. `htmlFor` renders the label as a real `<label>` bound to the row's input; rows whose control carries its own labeled elements (theme selects, steppers) pass none. Hairline separators come from `divide-y divide-border/40` on the wrapping section.
- **`ScopeHeading`** — each scope heading is a full-width underlined rule (`border-b border-border`): the uppercase scope name left, the storage hint right-aligned on the SAME baseline.
- **Input cap** — text inputs stop at `max-w-[320px]` so they don't stretch edge to edge.
- **Responsive collapse, no second dialog** — the `min-[480px]:` variant is the ONLY breakpoint: below 480px the same markup falls back to `grid-cols-1`, stacking label above control (the phone layout). One code path, no mobile fork.
- **Scroll path** — the `Dialog` panel carries `max-h-[calc(100vh-2rem)] overflow-y-auto` and the backdrop container `p-4` (both sizes), so a tall pane scrolls inside a short viewport instead of clipping content off-screen unreachably.

**Controls reuse existing models, never rebuilt** (the second-surface rule):

- **Instance display name** — a `TextSetting` (Enter/blur commits, Escape cancels the edit only; a second Escape closes the dialog — the window-rename vocabulary) reading `useInstanceName().instanceName`, committing via the context's optimistic `setInstanceName` (empty clears). Placeholder is the real hostname.
- **SSH host** — a single free-form `TextSetting` used verbatim (alias or `user@host`, never split into username/hostname fields — preserves the `open-in-app.ts` verbatim-alias contract). It reads the stored **setting** via `getSSHHost()` (NOT the effective health value, which may be an env fallback), commits via `setSSHHost` (empty clears), and surfaces a backend `400` as an inline `role="alert"` error without clobbering the stored value.
- **Instance accent color** (`AccentColorControl`) — reuses the HOST-panel `SwatchPopover` (color-only) + `useInstanceAccent().setColor` descriptor model ("4" / "1+3"; NOT a free RGB picker — the color model is descriptor-based end-to-end, see § Instance Accent). A pick POSTs and repaints the top-bar stripe without reload; the popover's Clear row clears.
- **Theme pair** (`ThemePairControl`) — a second surface reusing `useTheme()`/`useThemeActions()` (`/api/settings/theme` partial-merge POST): a System/Light/Dark mode control plus preferred dark-theme and light-theme `<select>`s.
- **Terminal font size** (`TerminalFontControl`, under This device) — the shared `ChromeContext.terminalFontSize` control: a `[−] {size}px [+]` stepper + Reset wired to `increaseTerminalFont`/`decreaseTerminalFont`/`resetTerminalFont` (localStorage `runkit-terminal-font-size`, clamped by `TERMINAL_FONT_BOUNDS`). No new persistence (see § Terminal Font Size).
- **Notifications** (`NotificationsControl`, under This device, sublabel "Web Push to this browser") — the Web Push opt-in surface in chrome, backed by the same `usePushSubscription()` `{state, enable, sendTest}` the palette actions use, so the two surfaces cannot drift (§ Notifications (Web Push opt-in)). Contents: a status line (a 1.5px `role="status"` dot + `Subscribed on this device` / `Blocked in browser settings` / `Not subscribed`), an **Enable notifications** button whenever `!subscribed` (so it stays offered under `denied`, where re-allowing is a browser-settings action), a **Send test notification** button `disabled` until subscribed (Tip: "Send a local test notification" / "Enable notifications first"), the denied re-allow note, and a "Setup & troubleshooting guide ↗" link over the shared `NOTIFICATIONS_HELP_URL` in a new tab. **No Disable/unsubscribe action** — `lib/push.ts` has no unsubscribe path. When `state === "unsupported"` (insecure context / no service worker) the row **stays present** and renders a short "Not supported in this browser" note with no action buttons — a settings pane explains absence rather than vanishing (§ Design Decisions → The settings Notifications row explains an unsupported browser). (`260724-6j1v`)

### Dialog width variant (`size` on `components/dialog.tsx`)

`Dialog` takes an optional `size?: "sm" | "lg"` defaulting to `"sm"`: `sm` → `max-w-sm` (the phone-card width every other dialog uses — spawn, kill, create-session, board kill confirm, …), `lg` → `max-w-2xl` (≈672px), the settings dialog's desktop preference-pane width and its only consumer. Every other call site passes no `size` and renders at `max-w-sm`. Both variants also carry the panel scroll path (`max-h-[calc(100vh-2rem)] overflow-y-auto` on the panel, `p-4` on the backdrop container — the `calc` offset matches that padding so the panel never touches the viewport edge), which is safe for `sm` dialogs and is what keeps a tall pane reachable in a short viewport. Asserted in `dialog.test.tsx` (default vs `lg` max-width, and the scroll classes on both). (`260724-6j1v`)

**Triggers — a registry chord, a palette action in the layout-level global group, and a top-bar gear chip** (all three reach the same `useSettingsDialog().openSettings`):

- **The `settings-open` chord** — ⌘, in the macOS desktop shell, ⇧⌘, in a mac browser, ⇧Ctrl+, on Windows/Linux (§ Keyboard Shortcuts → The default binding set). It is a registry builtin like every other app chord, so it is rebindable per device and its combo surfaces automatically in the shortcuts overlay, the palette hint, and the gear's tooltip chip. **Both route shells wire the handler** — `keybindingHandlers` in `app.tsx` and `boardKeyHandlers` in `board-page.tsx` (§ Dispatch seams). The unshifted ⌘, cannot be the *browser* default because it is the browser's own Preferences accelerator (claimed data, § Claimed keys). (`260801-mqim`)
- **Command palette** — a `Settings: Open` action among the layout-level global groups (`use-global-palette-actions.ts`, § Single palette mount + palette-actions slot), a one-liner calling `openSettings()`. Its id is the `settings-open` **registry actionId**, so palette entry and chord share one identity and `withShortcutHints` decorates the entry for free. The dialog itself mounts once in `AppLayout` (§ Design Decisions → Settings dialog mounts at `AppLayout`, not `AppShell`; → One palette mount in AppLayout, routes register via the slot).
- **Top-bar gear chip** — `SettingsGearButton` in `top-bar.tsx` (`GearIcon` from `sidebar/icons.tsx`), the L3-tail fit candidate in the right cluster on ALL four modes, sitting immediately before the exempt overflow chevron (the right-rail toggle stays outermost), consuming `useSettingsDialog()`; under width pressure it degrades to the chevron menu's App-section "Settings" row (`SettingsMenuRow`) (§ Right cluster → Settings gear). Per the tier-1 tooltip system (§ Tier-1 `Tip`), the gear is named via a `Tip label="Settings"` carrying the **host-effective `settings-open` chord** in its `kbd` slot, omitted when unbound/disabled — with an `aria-label="Open settings"` retained and never a native `title=`. The same Tip-not-title rule applies to icon-only controls inside the dialog (the accent-picker button, the font steppers). (`260812-d1at`)

**Instance display name has THREE display consumers, delivered via a root context** — see § Instance Display Name below.

## Zustand Window Store

Window optimistic state is managed by a Zustand store at `app/frontend/src/store/window-store.ts`. This is the single source of truth for what windows are visible and what their display names are during the period between a user action and its SSE confirmation.

**Store location**: `app/frontend/src/store/window-store.ts`

**Store shape:**

```ts
// Flat entry type (not WindowInfo & {...} — stores only the fields needed for display)
type WindowEntry = {
  session: string;
  windowId: string;
  index: number;
  name: string;
  pendingName?: string;    // non-undefined = optimistic rename, pending SSE confirmation
  killed: boolean;         // true = optimistically hidden, pending SSE confirmation
};

type GhostWindow = {
  optimisticId: string;    // client-generated unique key for React rendering / rollback
  session: string;
  name: string;
  createdAt: number;
  snapshotWindowIds: Set<string>; // windowIds present in session at creation time
};

type WindowStore = {
  entries: ReadonlyMap<string, WindowEntry>;  // keyed by windowId (@N)
  ghosts: GhostWindow[];
  // actions (the only ways to mutate window state):
  setWindowsForSession(session, incoming): void;
  addGhostWindow(session, name, currentWindowIds?: Iterable<string>): string;  // returns optimisticId
  removeGhost(optimisticId): void;
  killWindow(session, windowId): void;
  restoreWindow(session, windowId): void;
  renameWindow(session, windowId, newName): void;
  clearRename(session, windowId): void;
  clearSession(session): void;
};
```

**Key identifier**: `windowId` is the tmux `@N` value (e.g., `"@3"`). It is globally unique per tmux server, assigned at window creation, and never renumbered. It is used as the store key — not the mutable numeric index.

**`MergedWindow` type**: defined in and exported from `app/frontend/src/store/window-store.ts`. Includes `windowId: string` as a required non-optional field.

**Action surface (minimal by design)**:

| Action | Effect |
|--------|--------|
| `setWindowsForSession(session, incoming)` | SSE reconciliation — merges by `windowId`, preserves `killed`/`pendingName`, removes absent windows, reconciles ghosts |
| `addGhostWindow(session, name, currentWindowIds?)` | Creates a ghost entry; returns `optimisticId` for rollback |
| `removeGhost(optimisticId)` | Removes a ghost by ID (API failure rollback) |
| `killWindow(session, windowId)` | Sets `killed: true` |
| `restoreWindow(session, windowId)` | Sets `killed: false` (API failure rollback or always-settled cleanup) |
| `renameWindow(session, windowId, newName)` | Sets `pendingName` |
| `clearRename(session, windowId)` | Clears `pendingName` (settled or rollback) |
| `swapWindowOrder(session, srcIndex, dstIndex)` | Swaps index values of two entries (optimistic reorder); no-op if either missing |
| `clearSession(session)` | Removes all windows and ghosts for the session |

**SSE sync**: `AppShell` (in `app.tsx`) calls `setWindowsForSession(s.name, s.windows)` for each session in a `useEffect` on `rawSessions`. This keeps the store in sync with the SSE ground truth.

**Ghost reconciliation**: When `setWindowsForSession` is called, it computes `newIds = incomingIds − priorKnownIds`. For each ghost (oldest first) whose `snapshotWindowIds` does not contain any element of `newIds`, the ghost is removed.

**useMergedSessions**: `useMergedSessions` in `optimistic-context.tsx` derives window data from the Zustand store rather than from raw `session.windows`. For each session: filters `killed: true` entries, applies `pendingName ?? name` for display, sorts by `index`, then appends ghosts.

**Consumers use the store via `useWindowStore()` hook**:
```ts
const { killWindow, restoreWindow, renameWindow, clearRename, swapWindowOrder } = useWindowStore();
```

**Session/server state** (ghost sessions, ghost servers, session kill/rename) remains in `OptimisticContext` — these use name-based keys and are not subject to index-collision bugs.

## Optimistic UI & Mutation Feedback

All mutating API calls use the `useOptimisticAction` hook (`app/frontend/src/hooks/use-optimistic-action.ts`) which provides `{ execute, isPending }`. The hook calls `onOptimistic` synchronously before the async API call, tracks `isPending`, and calls `onRollback`/`onError` on failure and `onSettled` on success. An unmount guard (`mountedRef`) prevents state-after-unmount warnings.

**Callback contract** — four optional result callbacks with distinct mount-safety guarantees:

| Callback | Called on | Mount guard | Use for |
|----------|-----------|-------------|---------|
| `onAlwaysSettled` | success | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onAlwaysRollback` | failure | none — always fires | Root-level context cleanup (e.g., `unmarkKilled`) |
| `onSettled` | success | behind `mountedRef` | Local component state updates |
| `onRollback` | failure | behind `mountedRef` | Local component state updates |

`onAlwaysSettled`/`onAlwaysRollback` MUST be safe to call after the initiating component unmounts — i.e., they may only interact with root-level stores/contexts like `OptimisticContext` or the Zustand window store (both always available for the lifetime of the app). Using local component state or `setState` in these callbacks will cause state-after-unmount warnings. Use `onSettled`/`onRollback` for anything that touches local component state.

`onError` is also behind the `mountedRef` guard (safe to call `addToast` — `ToastProvider` is root-level, but error display is only meaningful when the user can see it).

**Three feedback patterns:**

1. **Ghost entries** (CRUD operations): Creating a session/window/server immediately inserts a ghost entry with `opacity-50 animate-pulse` styling. SSE reconciliation auto-clears ghosts when real data arrives. Failure removes the ghost and shows an error toast. Kill operations immediately hide the entry; failure restores it. Rename operations immediately update the displayed name; failure reverts. **Window** ghost/kill/rename state is managed by the Zustand window store (`app/frontend/src/store/window-store.ts`); **session and server** ghost/kill/rename state remains in `OptimisticProvider` context (`app/frontend/src/contexts/optimistic-context.tsx`). Both feed into `useMergedSessions(realSessions, currentServer)` which filters session-level overlays by `currentServer` (so cross-server ghosts/kills/renames don't leak — see "Server Capture Convention" below) and merges with SSE data.

2. **Button loading states** (fire-and-forget): Split pane and close pane top-bar buttons show a spinner SVG (`animate-spin`) and `disabled` attribute during `isPending`. Command palette equivalents use the same hook for error toast feedback (palette closes, so spinner not visible).

3. **Inline progress** (async data): File upload shows an "Uploading..." badge in the terminal area. Directory autocomplete shows a spinner in the path input trailing slot. Server list refresh shows a spinner on the dropdown trigger.

**Error toast system**: `ToastProvider` + `Toast` component (`app/frontend/src/components/toast.tsx`). Fixed bottom-right, auto-dismiss after 4 seconds, stacked vertically. Error variant has `var(--color-ansi-1)` (red) left accent border; info variant uses `var(--color-ansi-4)` (blue). Theme-aware via CSS custom properties. Despite the "error" name it is the general toast surface (the `info` variant carries success/neutral messages). `addToast(message, variant?, action?)` takes an optional THIRD positional `action?: { label, onSelect }` (`260718-gxrq`) rendered as a keyboard-focusable `<button>` inside the toast body — selecting it dismisses the toast then runs `onSelect`; the third parameter is optional, so two-arg call sites stay valid. Used for the post-pin "Pinned to <board>" + "View board" toast (§ Post-pin success feedback + toast optional action).

**Type guard**: `isGhostWindow(win)` exported from `optimistic-context.tsx` — narrows `WindowInfo | MergedWindow` to `MergedWindow & { optimistic: true }`. Used in the sidebar and the `SessionTiles` density view instead of `as` casts. `MergedWindow` type is defined in and exported from `app/frontend/src/store/window-store.ts`; it includes `windowId: string` as a required non-optional field.

### Window Kill: Zustand Store Handles Kill Cleanup

Window kill state is tracked in the Zustand window store by `windowId` (the immutable tmux `@N` identifier), not by mutable index.

**Kill flow** (`useOptimisticAction` pattern):
- `onOptimistic`: calls `windowStore.killWindow(session, windowId)` — sets `killed: true` in the store
- `onAlwaysRollback` (API failure): calls `windowStore.restoreWindow(session, windowId)` — clears `killed`
- `onAlwaysSettled` (API success): calls `windowStore.restoreWindow(session, windowId)` — clears `killed` (SSE absence will remove the entry once tmux confirms)

When the next SSE update arrives without the `windowId`, `setWindowsForSession` removes the entry from the store entirely — regardless of whether `killed` is set. No explicit `confirmKill` action is needed.

**Three `useOptimisticAction` instances** use this pattern:

| Instance | File | Kill path |
|----------|------|-----------|
| `executeKillWindow` | `app/frontend/src/components/sidebar.tsx` | Ctrl+Click direct kill |
| `executeKillFromDialog` | `app/frontend/src/components/sidebar.tsx` | Confirmation dialog kill |
| `executeKillWindow` | `app/frontend/src/hooks/use-dialog-state.ts` | Command palette kill |

**Session kills are unaffected**: Session names are stable across kills (tmux never renumbers sessions). Session kill/restore remain in `OptimisticContext`.

### Cross-Session Move: Compound Optimistic Update

The `executeMoveToSession` hook in `sidebar/index.tsx` combines two store actions (`killWindow` + `addGhostWindow`) for a single optimistic update. This is the only `useOptimisticAction` instance that performs a compound optimistic mutation (hiding in one session while inserting a ghost in another). The ref-based `lastMoveToSessionRef` stores `{ srcSession, windowId, optimisticId }` so `onAlwaysRollback` can reverse both operations even after the component navigates away.

### Server Capture Convention (Optimistic Actions)

The `server` argument that scopes a mutation to a tmux server is **always captured at user-event time**, never read from an ambient module-level global, never frozen at component mount. This is enforced both by the API client signature (every server-scoped function takes `server: string` as its first arg — see `tmux-sessions.md` → "Frontend Server Routing Contract") and by the React handler shape on every call site.

#### The two compliant capture shapes

**Shape A — explicit capture inside `useCallback`**: read `server` from `useSessionContext()` at component scope, list it in the callback's deps array, and pass it as the first argument to the action when the user-event handler fires:

```tsx
const { server } = useSessionContext();
const handleRenameSession = useCallback(() => {
  if (!renameSessionName.trim() || !sessionName) return;
  executeRenameSession(server, sessionName, renameSessionName.trim());
  setShowRenameSessionDialog(false);
}, [renameSessionName, sessionName, server, executeRenameSession]);
```

**Shape B — `server` threaded through the `useOptimisticAction` argument tuple**: extend the tuple's first slot to `string` and forward it inside `action`. This is the standard shape for hooks like `executeRenameSession`, `executeKillFromDialog`, `executeMoveToSession`, etc.:

```tsx
const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
  action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
  onOptimistic: (srv, oldName, newName) => {
    lastRenameSessionRef.current = { server: srv, name: oldName };
    markRenamed("session", srv, oldName, newName);
  },
  onRollback: () => {
    const last = lastRenameSessionRef.current;
    if (last) unmarkRenamed(last.server, last.name);
  },
  ...
});
```

**Refs that bridge async callbacks** (e.g., `lastKillSessionRef`, `lastRenameSessionRef`, `killDialogServerRef`) snapshot `{ server, name }` together inside `onOptimistic`, so `onAlwaysRollback`/`onAlwaysSettled` can target the originating server even if the user has switched servers by the time the API resolves. Snapshotting the name without the server is a bug — rollback would invalidate the wrong server's overlay.

#### Optimistic overlays carry `server` (session-level)

`OptimisticContext` (`app/frontend/src/contexts/optimistic-context.tsx`) stores session-level entries with their originating `server` and filters by `(server, name)` at render time. The discriminated-union types reflect this:

```ts
type GhostEntry =
  | { optimisticId: string; type: "session"; name: string; server: string }
  | { optimisticId: string; type: "server"; name: string };

type KilledEntry =
  | { type: "session"; identifier: string; server: string }
  | { type: "server"; identifier: string };

type RenamedEntry = { type: "session"; identifier: string; newName: string; server: string };
```

API surface (session-level entries take `server` first; server-level entries are global):

| Method | Signature | Notes |
|--------|-----------|-------|
| `addGhostSession` | `(server, name) => optimisticId` | Session ghost |
| `addGhostServer` | `(name) => optimisticId` | Server ghost — global, no `server` arg |
| `markKilled("session", server, name)` | overload | Session kill |
| `markKilled("server", name)` | overload | Server kill — global |
| `unmarkKilled("session", server, name)` | overload | Mirror of `markKilled` |
| `unmarkKilled("server", name)` | overload | Mirror of `markKilled` |
| `markRenamed("session", server, name, newName)` | required `server` | |
| `unmarkRenamed(server, name)` | required `server` | |
| `useMergedSessions(real, currentServer)` | filter | Drops session-level overlays whose `server !== currentServer` |

`useMergedSessions` filters ghosts/kills/renames by `currentServer` before applying them. SSE reconciliation only inspects ghosts whose `server === currentServer` so the other server's pending state is left intact when the user switches servers and back.

**Window-store entries are NOT keyed by server** — windows cannot migrate across tmux servers (`MoveWindowToSession` operates within a single server, and there is no cross-server move API). The `windowId` (tmux `@N`) is unique per server, and `setWindowsForSession` is only ever called with data for the active server. Adding `server` to the window-store key would be defensive bookkeeping with no failure mode to defend against.

#### General rule: don't introduce ambient state for request parameters

Any value that scopes an HTTP request to a particular backend resource (server, project, account, tenant) MUST be passed as an explicit argument to the API call, captured at user-event time. Module-level mutable getters, refs read at fetch time, or context reads inside the action callback (rather than the handler) all create the same closure-race shape. If a value travels with a mutation, it travels in the call signature — period.

The regression test in `app/frontend/src/hooks/use-dialog-state.test.tsx` flips `SessionProvider`'s `server` prop between `openRenameSessionDialog("foo")` and `handleRenameSession()` and asserts the API call uses the post-flip server (`server-B`), proving the capture point is the handler invocation, not the dialog open.

## Design Decisions

### Window-switch feedback stays optimistic
**Decision**: window-switch navigation stays optimistic — the heading/URL flip at click (acknowledged intent) and the sidebar highlight stays SSE-derived (confirmation); the slide plays only on confirmed-fast arrival, with a pending mask + failure bounce-back layered on.
**Why**: keeps the terminal rendering immediately while giving each visual state an honest, distinct signal.
**Rejected**: pessimistic navigation (waits for confirmation before flipping); a dimmed overlay.
*Introduced by*: 260715-38kg-window-switch-confirmed-motion

### Settings dialog mounts at `AppLayout`, not `AppShell`
**Decision**: The settings dialog + its `SettingsDialogContext` mount once at `AppLayout` (the persistent every-page layer), not `AppShell`. Instance display-name delivery lives in a separate root-mounted `InstanceNameProvider` (in `RootWrapper` beside `InstanceAccentProvider`), not in `SettingsDialogContext`.
**Why**: `AppShell` is server-scoped (assumes non-null `currentServer` throughout `app.tsx`), so mounting there would leave the dialog unavailable on `/board/$name`, which renders inside `AppLayout` without `AppShell` — and board coverage is the whole point of the every-page mount. Three display surfaces plus the dialog editor need one live-updating `{hostname, instanceName}` state — the exact fetch-once + optimistic-set + multi-surface-repaint shape `InstanceAccentProvider` already established; keeping it out of the chrome-only `SettingsDialogContext` avoids mixing chrome state with instance data and keeps the provider above the `RootTopBar` consumers anyway.
**Rejected**: mounting at `AppShell` (dead on boards); a module-level name cache (no reactivity path for the dialog's live edit); putting the name pair in `SettingsDialogContext` (mixes chrome and instance data).
*Introduced by*: 260723-o7q8-settings-dialog

### Dialog theme controls are self-contained, not the `ThemeSelector` modal
**Decision**: The dialog's theme-pair surface is self-contained — a System/Light/Dark mode control plus two `<select>`s (preferred dark / preferred light) driving the existing `setTheme()` — rather than dispatching the `"theme-selector:open"` event to reuse the top-bar `ThemeSelector`.
**Why**: `ThemeSelector` is mounted only inside `AppShell` (`app.tsx`), so the event has no listener on `/board/$name` — the dialog's core every-page-mount promise. `setTheme(id)` already owns slot updates + the partial-merge POST + localStorage sync, so the dialog reuses that wiring (the intake's second-surface requirement) without the modal. The top-bar selector stays; the dialog is additive.
**Rejected**: moving the `ThemeSelector` mount to `AppLayout` (a behavior change to an unrelated surface, out of scope); live-preview machinery inside the dialog (the selector modal already owns preview UX).
*Introduced by*: 260723-o7q8-settings-dialog

### Window kill state is keyed by `windowId`, not index
**Decision**: Optimistic window-kill state lives in the Zustand window store keyed by the tmux `@N` `windowId` (immutable, never renumbered), not by the window's numeric index.
**Why**: tmux renumbers window indices when a window is killed, so index-keyed kill state suppresses the *next* window that slides into the killed index — an index-collision bug that is invisible until SSE reconciles.
**Rejected**: tracking kill state by numeric index; an explicit `confirmKill` action (SSE absence already removes the entry).

### `server` is captured at user-event time, never read ambiently
**Decision**: Every server-scoped mutation takes `server` as an explicit first argument, captured when the React handler fires (Shape A or Shape B in § Server Capture Convention); refs that bridge async callbacks snapshot `{ server, name }` together.
**Why**: Dereferencing live state at fetch time retargets the request whenever the user switches servers between intent and dispatch — most commonly via Cmd+K's near-instant server switcher between opening a rename dialog and pressing Enter. The optimistic overlay hides the bug until SSE reconciles (~2–5 s later), so it surfaces as random renames/kills landing on the wrong server with a flicker on rollback.
**Rejected**: a module-level closure (`_getServer`) wired to `serverRef.current`; refs read at fetch time; context reads inside the `action` callback rather than the handler; snapshotting a name without its server.

### The spawn-agent busy label is indeterminate
**Decision**: The spawn-agent dialog shows one indeterminate busy label (`LogoSpinner` + "Spawning: worktree → window → agent…") with no per-step progression.
**Why**: The spawn endpoint is synchronous and emits no per-step events, so there is nothing to drive a stepper.
**Rejected**: streaming per-step progress (needs a new SSE/long-poll seam, out of proportion for the feature).

### Ghost reconciliation is set-difference, not count-based
**Decision**: `setWindowsForSession` reconciles ghosts by set difference — `newIds = incomingIds − priorKnownIds`, removing each ghost (oldest first) whose `snapshotWindowIds` contains none of `newIds`.
**Why**: Concurrent creates and deletes in the same SSE tick keep the counts consistent while the identities differ, so identity comparison is the only one that survives them without false positives.
**Rejected**: count-based ghost reconciliation.

### The worktree field carries no pre-filled name
**Decision**: The spawn-agent dialog's Worktree input is blank by default, carrying only the placeholder `auto-named (e.g. swift-fox)`; a blank value lets `wt` auto-name.
**Why**: `wt` exposes no name-suggest seam, so any pre-filled value would have to be generated locally.
**Rejected**: reimplementing `wt`'s name generator in the frontend (constitution §III).
