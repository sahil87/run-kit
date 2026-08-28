---
description: "Component conventions, dialogs (session name prompt, window-at-folder, spawn-agent, server kill confirm with the protected fork, server adopt confirm, tabbed settings with the registry-driven All-settings table, shell host add/edit form, width variants), clipboard utility, e2e host-global filesystem state, the Zustand window store, and optimistic UI + mutation feedback."
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
- **Shared `Dialog` component** (`app/frontend/src/components/dialog.tsx`) — reusable modal with title, backdrop, close-on-click, and an optional `size` width variant (§ Settings Dialog → Dialog width variant). Used for create, kill, **session**-rename, and settings dialogs. Window rename is the centered `WindowHeading`'s inline edit, not a dialog (§ Window Heading). (260724-6j1v)

### Clipboard Utility

`app/frontend/src/lib/clipboard.ts` — shared `copyToClipboard(text: string): Promise<boolean>` function. Primary path uses `navigator.clipboard.writeText()`; fallback uses `document.execCommand('copy')` for non-secure contexts (HTTP). All callers (terminal copy, Pane panel row copy) import from this module (§ Steady-state version surfaces for the boolean success signal).

CWD display (line 1) uses `shortenPath()` to shorten the active pane's `cwd` (falls back to `worktreePath`):
- Home substitution: `/home/<user>/…` → `~/…`, `/Users/<user>/…` → `~/…`, `/root/…` → `~/…` (exact home dir → `~`). Handles Linux and macOS conventions.
- Truncation: if the path (after home substitution) has more than 2 non-empty segments, it is truncated to `…/<second-to-last>/<last>`. Paths with ≤ 2 segments are not truncated.
- Examples: `/home/sahil/code/org/repo/src` → `…/repo/src`; `/home/sahil/code/org` → `~/code/org`; `/var/log/nginx` → `…/log/nginx`.
- The `title` attribute on the CWD element always contains the original unmodified `activePaneCwd` — hover to see the full path.

### E2E host-global filesystem state (`~/.config/run-kit/config.yaml` snapshot/restore)

`scripts/test-e2e.sh` isolates the **tmux server** (a per-worktree derived socket family, `rk-test-e2e-<token>-*`), the **ports** (a derived per-worktree triple in 3400–3699), and **`$XDG_STATE_HOME`** (a per-run temp dir), but NOT `$HOME` — so any e2e that exercises a feature persisting under `$HOME` (settings, VAPID keys, push subscriptions) POSTs against the **developer's REAL host file**. `board-list-reorder.spec.ts` therefore snapshots the developer's `~/.config/run-kit/config.yaml` and restores it around the suite so a curated board order (or any other setting) is never clobbered by test residue:

- **`beforeAll`** raw-byte-reads `config.yaml` (`readFileSync(path, "utf8")`). Absent detection is **ENOENT-only**: a `code === "ENOENT"` read error means "no file to restore" (afterAll then deletes any residue); ANY other read error (EACCES/EIO — the file EXISTS but couldn't be snapshotted) is **rethrown**, so afterAll never `rmSync`-deletes real settings on a failed snapshot.
- **`afterAll`** (always runs, even on test failure) restores VERBATIM: write the original bytes back if the file existed, else `rmSync({ force: true })` to delete residue — a byte-identical round-trip. Teardown errors are swallowed so they never mask a test failure.

This is the general pattern for **any** host-global filesystem state an e2e touches: explicit save/restore in the spec, because the harness scopes tmux, ports, and `$XDG_STATE_HOME` but not `$HOME`. The spec file's header intent comment documents the save/restore (per the constitution's Test Intent Comments rule).

## Session Name Prompt

`app/frontend/src/components/session-name-prompt.tsx` — the save-as-style prompt behind the `Session: Create` palette action and the `create-session` chord (which resolves through the same palette body): a single name input on the shared `Dialog` shell (`size="sm"`), pre-filled with the auto-derived session name and select-all'd so Enter accepts the default and typing replaces it. Live `toSafeSessionName` conversion, `finalizeSafeName` at submit, inline collision hint blocking submit, empty-submit no-op; Escape/backdrop close via the shell's focus trap. It is the one session-creation surface with a name field — path picking is the window-level dialog's job (below) — and submits through the existing `executeCreateSessionInstant` optimistic path in `app.tsx` (its open state folds into `dialogOpenRef`). Behavior contract: [routes-and-shell](/run-kit/ui/routes-and-shell.md) § Prompted Creation. (260823-qe3n)

## Window At-Folder Dialog

`app/frontend/src/components/create-session-dialog.tsx` (the filename does not reflect its window-only scope) — the window-only dialog behind the palette's `Tab: Create at Folder` action: pick a starting directory, confirm, and an **unnamed** window is created there via `createWindow(server, session, undefined, cwd)` (tmux auto-names it to the folder basename; no optimistic ghost). Props: `session` (required), `sessions` (quick-picks source), `defaultPath?` (pre-fills the path input), `onClose`. Title: "Create tab at folder". Two sections: (260823-fe74)

1. **Quick picks ("Recent:")** — Deduplicated project root paths from existing tmux sessions (window 0's `pane_current_path`), shown in the dropdown while the input is empty. Tappable list items with 44px min height for mobile. Selecting fills the path.

2. **Path input with autocomplete** — Text input that calls `GET /api/directories?prefix=...` with ~300ms debounce. Results appear as a dropdown below the input. Selecting a result fills the path and triggers a new autocomplete for children. Hidden directories (`.`-prefixed) are excluded from results.

An empty path is allowed — `cwd` is omitted and the window opens at the backend default. There is no name field: window naming is tmux's folder auto-naming (§ [routes-and-shell](/run-kit/ui/routes-and-shell.md) § Unnamed `+ New Window`).

## Spawn-Agent Dialog

`app/frontend/src/components/spawn-agent-dialog.tsx` — a compact `Dialog` (create-session-dialog styling: `text-xs` field labels, disabled-submit styling) surfacing `rk riff` as a one-action web spawn. It is the frontend of the web-UI agent-spawn flow; the backend is `POST /api/riff` (see [architecture](/run-kit/architecture.md) § API Layer and the engine in [rk-riff](/run-kit/rk-riff.md)). **Title** carries the target session: `Spawn agent in {session}` (substring-compatible with the e2e's `getByRole("dialog", { name: "Spawn agent" })`, which does case-insensitive substring matching).

**Fields — in order Task → Preset → Where → Worktree → Agent**:

1. **Task** — free text, optional, autofocused; empty spawns a blank agent session.
2. **Preset** — a dropdown fetched on open (see preflight below), shown **only when the repo defines presets** (`presets.length > 0`); each option renders `name — layout (N panes)`.
3. **Where** — a `role="radiogroup"` with two options: **new worktree** (default, `where="worktree"`) and **this checkout** (`where="checkout"`, roots the window in the existing checkout — no worktree created). State is the typed `RiffWhere = "worktree" | "checkout"` union (no `as` casts).
4. **Worktree** — a text input, blank by default, placeholder `auto-named (e.g. swift-fox)`; **hidden when `where === "checkout"`** (it has no meaning there). Converts **live** via `toSafeWorktreeName` as the user types (§ Live Safe-Name Conversion) — spaces → `_`, `/` → `_`, a leading `-` dropped (matching `ValidateWorktreeName`), hyphens kept. Blank = wt auto-names; a typed name rides `worktreeName` through to `wt create --worktree-name`. No pre-filled suggestion; the placeholder is the honest fallback (§ Design Decisions → The worktree field carries no pre-filled name).
5. **Agent** — a tier dropdown populated from the preflight's `tiers` (built-ins ∪ the repo's `agent.tiers`, `default` first), defaulting to the `DEFAULT_TIER = "default"` constant. Displays tier **names only** (no model IDs — brittle to parse out of command strings). **FAB-GATED**: the field renders **only when `tiers.length > 0`**. The backend fab-gates the presets response (`tiers: []` for a non-fab repo — see [architecture](/run-kit/architecture.md) § API Layer `/api/riff/presets`), so an empty list HIDES the field entirely — no label, no hint text, no disabled control — because in a non-fab repo every tier resolves to the same `DefaultLauncher` (inert noise). When hidden, `tier` is omitted from the spawn body (see § Defaults). Non-fab-repo hiding does NOT enumerate system agents (claude/codex/gemini) — tiers remain fab's abstraction (constitution §III). (gsmu)

**Enter submits from any field** (`handleKeyDown` wired on all inputs incl. the radios and both selects). **Preflight fetch** (`getRiffPresets(server, session)`) is **best-effort**, with two branches: (gsmu)

- **Success** — sets `presets` and mirrors the response `tiers` **verbatim** (`setTiers(data.tiers)`). A fab project returns a populated list (field shown); a non-fab repo returns `[]` (field hidden). This verbatim mirror is what makes the frontend gate follow the backend gate.
- **Failure** (e.g. non-repo cwd, network error) — leaves the preset dropdown hidden and **keeps the Agent dropdown at the built-in `[DEFAULT_TIER]` fallback (field SHOWN)**. On a rejected fetch the repo's fab-ness is UNKNOWN, so the conservative status quo is to show the inert default rather than hide it — still allowing a task-only spawn.

A `cancelled` ref guards the async setState; a `mountedRef` guards the submit path against a stale setState after the dialog closes.

**Defaults omit unset fields**: `spawnRiff` omits each field when unset/default — `where` when `"worktree"`, `worktreeName` when blank (and always in checkout mode — the client drops it since the backend rejects the pairing), `tier` when `"default"` — so leaving the fields untouched sends a two-field body. The submit also drops `tier` entirely when the Agent Tier field is hidden (`tier: tiers.length > 0 ? tier : undefined`): a non-fab repo never sends an inert tier, matching the gate. The `tiers` array is a submit dependency of the `handleSubmit` `useCallback`. (gsmu)

**Submit → in-flight → outcome**: on submit it sets a `busy` flag (disables all fields + the button, guarding double-submit) and shows an **indeterminate** busy pipeline label — `LogoSpinner` + "Spawning: worktree → window → agent…" — with **no per-step progression**, because the synchronous endpoint emits no per-step events. On success it closes and calls `onSpawned(windowId)` (wired to `app.tsx`'s `navigateToWindow`, inheriting the window-switch slide transition). **Falsy-windowId guard**: the backend `windowId` is best-effort (`""` when its `display-message` window-id resolve fails), so the dialog only navigates when `res.windowId` is truthy — otherwise it closes without navigating and lets the SSE stream surface the new sidebar row (navigating with an empty id would land on a junk `/$server/@` URL). A `400`/`500` renders its message in-dialog (`text-signal-red`; nothing was created on a `400`) and keeps the dialog open for correction.

**Entry points — THREE** (the first two are terminal-route only, the third is the sidebar). The two terminal-route entries open the dialog for the CURRENT window's session; the sidebar entry targets ANY listed session on ANY server (cross-server spawn): (gsmu)

1. **Cmd+K `Agent: Spawn`** — a `PaletteAction` in `app.tsx`'s `agentSpawnActions` block (folded into `paletteActions`), gated on `sessionName` (mirrors `Window: Create`). Passes the CURRENT `{server, sessionName}` (`onSelect: () => handleOpenSpawnAgent(server, sessionName)`; `server` added to the memo deps). Constitution V palette parity; the shortcut/registration is documented at the registration site per `code-review.md` ("New keyboard shortcuts must be documented in the command palette registration").
2. **`+ New Agent`** — the window-switcher dropdown's `secondaryAction` beside `+ New Window` (see § Breadcrumb Dropdowns). Threaded via an optional `onSpawnAgent?(session)` on the top-bar slot context (`top-bar-slot-context.tsx`) → `TopBar` prop → `BreadcrumbDropdown.secondaryAction`; absent (e.g. before `AppShell` registers, or off-terminal routes) → the dropdown renders no `+ New Agent`. The one-arg slot signature is kept via a thin `handleSlotSpawnAgent = (sess) => handleOpenSpawnAgent(server, sess)` binding the CURRENT server (this entry is not cross-server).
3. **Sidebar session-row bot button (gsmu)** — a per-row 🤖 button in the session-row trailing icon cluster (see § Sidebar → session-row icon cluster). It passes the ROW's explicit `{server, session}`, so it works from any route the sidebar is mounted on (Host / tmux Server / Terminal — NOT the board-route sidebar, which passes no handler) and targets any server → **cross-server spawn**. Wired `app.tsx` → `<Sidebar onSpawnAgent={handleOpenSpawnAgent} />`.

All three entry points call `AppShell`'s `handleOpenSpawnAgent(server, session)`, which sets the explicit target state `spawnAgentTarget: {server, session} | null`. The dialog renders iff `spawnAgentTarget != null` and is lazy-imported + `Suspense`-wrapped (like `CreateSessionDialog`), receiving `server={spawnAgentTarget.server}` and `session={spawnAgentTarget.session}` (an explicit target, not the current server from `useSessionContext`). `spawnAgentTarget != null` is folded into `dialogOpenRef` so the active-window effect treats it like every other open dialog. (gsmu)

**Cross-server nav on success** (gsmu): `onSpawned(windowId)` branches on whether the target IS the current route server. Same-server → reuse `navigateToWindow` (inherits the window-switch slide transition). Cross-server → `navigate({ to: "/$server/$window", params: { server: target, window: windowId } })` (+ close the mobile sidebar), mirroring `handleSidebarSelectWindow`. The falsy-`windowId` guard is preserved on both branches. The branch itself lives in the **shared `navigateToSpawnedWindow(srv, windowId)`** helper in `app.tsx`, which the row-flyout fork also calls (§ Row-hover register flyout card → Fork navigation on success) — one routing rule for every riff-shaped result, so the two call sites cannot drift.

## Server Kill Dialog

The single create-server + kill-server implementation (`app/frontend/src/components/server-dialogs.tsx`, mounted once in `AppLayout` via `server-dialogs-context`) forks the kill confirm on the target's `protected` payload flag — read from the already-fetched `ctx.servers` list (`?? false`, no new fetch; the flag derives from the `@rk_protected` tmux server option, see [tmux-sessions](/run-kit/tmux-sessions.md)). Kills are reachable from the palette's server actions ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md)) and the server-tile surfaces. Both forks navigate away when the killed server is the current one. (260824-xaw2-protected-server-class)

- **Non-protected target** — the plain two-button confirm ("Kill server <name> and all its sessions? This cannot be undone."), zero drift from the shared confirm path.
- **Protected target** (`ProtectedKillDialog`, title "Kill protected server?") — three behaviors:
  - **Typed-name force unlock** — an auto-focused text input (`placeholder="Type <name> to unlock force kill"`, `aria-label="Type the server name to unlock force kill"`); the destructive **Force kill** button stays disabled until the typed value EXACTLY equals the server name, Enter submits only on match, Escape cancels via the Dialog's focus trap. Keyboard-first per Constitution V.
  - **Blast-radius copy** — red (`text-signal-red`) copy derived live from client-held session data (`ctx.sessionsByServer`, no endpoint): for `rk-daemon`, "kills the dashboard, N running job(s), code-server, M remote tunnel(s)" composed from the `rk-jobs` active-window count, `rk-code-server` presence, and the `rk-remotes` window count (each fragment omitted when zero/absent); for other protected servers, "kills N session(s), M window(s)".
  - **Daemon Restart primary** — for `rk-daemon` only, a "Restart run-kit" primary button wired to `ctx.restartNow()` (the SessionContext restart path → `POST /api/restart`, failure toasts); non-daemon protected targets get no Restart primary — Cancel is the safe default.
- **Force kill path** — Force kill calls `killServer(name, true)`; the client's `force` arg rides `POST /api/servers/kill` as `{name, force}`, and the killServer optimistic action passes it through (`useOptimisticAction<[string, boolean]>`). Without `force` the backend refuses protected targets with `409 {"error", "protected": true}` — see [architecture](/run-kit/architecture.md) § API Layer.

## Server Adopt Dialog

The same `server-dialogs.tsx` layout-mounted home carries the **adopt confirm** (`Dialog title="Adopt server into run-kit?"`, opened via the `requestAdoptServer` context trigger beside `requestKillServer` — `server-dialogs-context`), the web entry for converting an external server to rk-managed ([tmux-sessions](/run-kit/tmux-sessions.md) § `@rk_srv_managed`). Reachable from the palette's external-only `Server: Adopt <name> into run-kit` entries ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md)). The copy states the semi-irreversibility plainly — run-kit's tmux config is applied now, and the user's own config returns only on server restart — under **neutral** (not danger-red) styling: adopt is a config mutation, not a destruction, so it forks nothing off the kill dialog's danger idiom and carries no optimistic killed-mark analog. Confirm calls `adoptServer(name)` (`POST /api/servers/adopt`) then `ctx.refreshServers()` — the backend wakes the SSE hub on success, so the repaint rides the stream and the refresh is belt-and-braces; failures toast. (260826-lv87-external-server-provenance-adopt)

## Settings Dialog

A tabbed settings **dialog** (not a routed page — constitution §IV keeps "no settings pages") gathers the instance's scattered preferences into one keyboard-first surface: `app/frontend/src/components/settings-dialog.tsx` on the shared `Dialog` shell (focus trap, `role="dialog"`, Escape closes) at its fixed-height `size="xl"` variant (§ Dialog width variant). Four tabs, in rail order (the `SETTINGS_TABS` array is the single source of that order): three curated topic tabs first (each reusing the existing control components — the second-surface rule), then the **All settings** registry-driven everything-table last — the advanced escape hatch sits after the curated presentation (260824-xf6p-all-settings-tab-last):

| Tab | Controls |
|-----|----------|
| **General** | Instance display name, SSH host, Auto-name tabs (`auto_name`) (all **This host**); notifications (**This device**) |
| **Appearance** | Theme pair, instance accent color (**This host**); terminal font size (**This device**) |
| **Shortcuts** | The registry-driven shortcuts/rebinding surface — `app/frontend/src/components/settings-shortcuts-panel.tsx`, `data-testid="settings-shortcuts-panel"`, THE single shortcuts surface ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § Shortcuts panel) |
| **All settings** | Every `ui: true` config.yaml key as a registry-generated row (search, category headers, typed controls, modified dot, restart badge, escape-hatch footer — § All-settings tab below) |

**One `role="tablist"` markup, one breakpoint** — at `min-[480px]:` and up the tab list is a vertical left rail beside the active panel (accent-tinted active tab, `bg-accent/15`); below 480px the SAME element restyles into a horizontal scrollable strip under the dialog title — the dialog's single `min-[480px]:` breakpoint, no second code path. **Roving tabindex**: the active tab is the list's one Tab stop (`tabIndex={active ? 0 : -1}`), arrow keys (both axes, both layouts) move focus and activate on focus, Tab leaves the list into the panel. The `role="tabpanel"` container owns the scroll (`flex-1 overflow-y-auto` inside the fixed-height `xl` panel), so the rail never jumps between the short General tab and the tall Shortcuts tab. The Shortcuts panel additionally mounts ONLY while its tab is active (mount == visible), which gates its per-open data plumbing — the riff-presets fetch, the macro add-flow's palette targets, the tmux keybindings fetch — exactly on panel visibility (a board/host route keeps the CUSTOM rows read/rebind/delete-only).

**Mounted once at `AppLayout`, not `AppShell`** — `AppShell` is server-scoped (assumes a non-null `currentServer` throughout `app.tsx`), while `AppLayout` is the true every-page layer (the persistent `RootTopBar` mounts there; `/board/$name` renders inside it without `AppShell`). So the dialog, its state, and its logic exist exactly once and it is available on every route including boards. `SettingsDialog` is lazy-imported and rendered inside a `SettingsDialogProvider` at the `AppLayout` level; the body (`SettingsDialogBody`) mounts only while open, so the per-open registry fetch runs on mount with no reopen-staleness bookkeeping.

**`SettingsDialogContext` (`contexts/settings-dialog-context.tsx`)** — a deliberately small open/close context `{ isOpen, activeTab, setActiveTab, openSettings, closeSettings }` provided at `AppLayout` so any descendant (palette actions, sidebar gear, chevron menu rows) targets the one dialog while it renders once. `SettingsTab = "general" | "appearance" | "all" | "shortcuts"`; `openSettings(tab?)` semantics: a call WITH a tab opens (if closed) and activates that tab; a tab-less call opens on **General** when closed and is a **tab-preserving no-op** when already open — no last-visited-tab persistence, a tab-less reopen always lands General. Instance data (display name, accent) lives in its own contexts, not here.

**Scope groups live inside the topic tabs** — the persistence-scope labeling is load-bearing UX (a device-local value not syncing across devices reads as designed, not broken), so the two `ScopeHeading` groups render INSIDE each of General and Appearance (both mix scopes, per the table above):

- **This host** ("stored on this instance, shared by every device") — persisted to `~/.config/run-kit/config.yaml`.
- **This device** ("stored in this browser only") — browser-local ergonomics (the Web Push subscription is per-browser, so the scope is semantically exact).

**Desktop preference-pane layout, one responsive code path** (260724-6j1v):

- **Wide fixed-height dialog** — `size="xl"` on the shared `Dialog` (`max-w-4xl`, fixed height, panel `overflow-hidden`) instead of the phone-card `max-w-sm` every other dialog keeps (§ Dialog width variant below).
- **`PreferenceRow`** — each setting is a `grid grid-cols-1 min-[480px]:grid-cols-[190px_1fr] gap-x-6 gap-y-1.5 py-2.5 items-start` row: label column left (the label plus an optional small `text-text-secondary` **sublabel** hint underneath), control column right, so every control's left edge lands on ONE vertical rule. `htmlFor` renders the label as a real `<label>` bound to the row's input; rows whose control carries its own labeled elements (the theme picker, steppers) pass none. Hairline separators come from `divide-y divide-border/40` on the wrapping section.
- **`ScopeHeading`** — each scope heading is a full-width underlined rule (`border-b border-border`): the uppercase scope name left, the storage hint right-aligned on the SAME baseline. The component lives in the shared `text-setting-core.tsx` module (also consumed by the All-settings table's category headers; `settings-dialog.tsx` re-exports it for its historical import sites) — an empty hint renders no right-aligned span.
- **Input cap** — text inputs stop at `max-w-[320px]` so they don't stretch edge to edge.
- **Responsive collapse, no second dialog** — the `min-[480px]:` variant is the ONLY breakpoint: below 480px the row markup falls back to `grid-cols-1`, stacking label above control (the phone layout), and the tablist becomes the horizontal strip. One code path, no mobile fork.
- **Scroll path** — `xl` inverts the shared dialog's panel scroll: the panel is fixed-height with `overflow-hidden` and each tab panel carries its own `overflow-y-auto`; `sm`/`lg` keep the panel-level `max-h-[calc(100vh-2rem)] overflow-y-auto` with the backdrop container `p-4`, so a tall pane scrolls inside a short viewport instead of clipping content off-screen unreachably.

**Controls reuse existing models, never rebuilt** (the second-surface rule):

- **Instance display name** — a `TextSetting` (Enter/blur commits, Escape cancels the edit only; a second Escape closes the dialog — the window-rename vocabulary) reading the registry seam's `settingValue("instance_name")` (live-mirrored from `useInstanceName()`), committing via the seam's `commitSetting("instance_name", …)`, which routes through the context's optimistic `setInstanceName` (empty clears) and mirrors the write into the registry list. Placeholder is the real hostname.
- **SSH host** — a single free-form `TextSetting` used verbatim (alias or `user@host`, never split into username/hostname fields — preserves the `open-in-app.ts` verbatim-alias contract). It reads the stored **setting** through the registry seam (NOT the effective health value, which may be an env fallback), commits via `commitSetting("ssh_host", …)` (empty clears, `invalidateOpenContext()` refreshes the Open control's cached deeplink context on success), and surfaces a backend `400` as an inline `role="alert"` error without clobbering the stored value.
- **Auto-name tabs** (`auto_name`) — a `BoolToggle` under the This-host scope group, sublabel from the registry description, reading and committing through the same registry seam as its All-settings table row (`commitSetting("auto_name", on)` → `postSettings`; the backend rewires the hub tracker live — see [configuration](/run-kit/configuration.md) § Settings HTTP API). `log_level`/`tmux_conf` stay table-only (advanced keys).
- **Instance accent color** (`AccentColorControl`) — reuses the HOST-panel `SwatchPopover` (color-only) + `useInstanceAccent().setColor` descriptor model ("4" / "1+3"; NOT a free RGB picker — the color model is descriptor-based end-to-end, see § Instance Accent). A pick POSTs and repaints the top-bar stripe without reload; the popover's Clear row clears.
- **Theme** (`ThemePairControl`) — a second surface reusing `useTheme()`/`useThemeActions()` (`/api/settings` partial-merge POST): a System/Light/Dark mode control plus the shared `ThemePickerList` core rendered inline (search + grouped DARK/LIGHT list with palette swatches, in a bordered `max-w-[420px]` box) — the same core the top-bar `ThemeSelector` modal renders (§ Visual Design → Theme Selector). The control is `collapsible`: at rest a trigger button names the ACTIVE theme (swatch + name + ▾); clicking it swaps in the focused search field with the list in a popover (`absolute top-full z-50` below the field — the same panel-local elevation pattern as the accent `SwatchPopover`), which closes on commit, Escape, or focus leave; keyboard/commit closes refocus the trigger. Both preferred slots show a check at once (`checkedIds={[themeDark, themeLight]}`); click/Enter commits via `setTheme(id)` (slot + mode update, the list closes, the dialog stays); hover/keyboard nav live-previews with `cancelOnLeave` reverting on pointer/focus leave, and an Escape that just cancelled a preview or closed the list is consumed (`stopPropagation`) so only an idle Escape closes the dialog — the `TextSetting` two-stage-Escape vocabulary.
- **Terminal font size** (`TerminalFontControl`, under This device) — the shared `ChromeContext.terminalFontSize` control: a `[−] {size}px [+]` stepper + Reset wired to `increaseTerminalFont`/`decreaseTerminalFont`/`resetTerminalFont` (localStorage `runkit-terminal-font-size`, clamped by `TERMINAL_FONT_BOUNDS`). No new persistence (see § Terminal Font Size).
- **Notifications** (`NotificationsControl`, under This device, sublabel "Web Push to this browser") — the Web Push opt-in surface in chrome, backed by the same `usePushSubscription()` `{state, enable, sendTest}` the palette actions use, so the two surfaces cannot drift (§ Notifications (Web Push opt-in)). Contents: a status line (a 1.5px `role="status"` dot + `Subscribed on this device` / `Blocked in browser settings` / `Not subscribed`), an **Enable notifications** button whenever `!subscribed` (so it stays offered under `denied`, where re-allowing is a browser-settings action), a **Send test notification** button `disabled` until subscribed (Tip: "Send a local test notification" / "Enable notifications first"), the denied re-allow note, and a "Setup & troubleshooting guide ↗" link over the shared `NOTIFICATIONS_HELP_URL` in a new tab. **No Disable/unsubscribe action** — `lib/push.ts` has no unsubscribe path. When `state === "unsupported"` (insecure context / no service worker) the row **stays present** and renders a short "Not supported in this browser" note with no action buttons — a settings pane explains absence rather than vanishing (§ Design Decisions → The settings Notifications row explains an unsupported browser). (260724-6j1v)

**All-settings tab — the registry-driven everything-table** (`settings-all-panel.tsx`, `data-testid="settings-all-panel"`): the pane half of the two-level model — the curated tabs stay the palatable presentation, this tab exposes every `ui: true` config.yaml key, so a future registry key appears with a typed control, description, category placement, modified indicator, and live/restart badge at zero frontend cost. Browser-local controls (terminal font, notifications) keep their curated homes and never appear here — the table renders registry keys only. Duplication with the curated tabs is deliberate (the VSCode settings-UI/settings.json model) and drift-guarded by the single seam below. (260823-5r41-settings-pane-live-apply)

- **One dialog-level registry seam** (`settings-registry-seam.ts`, `useSettingsRegistry()`): the `SettingsEntry[]` fetch + state hoist to the dialog body — one mount-gated fetch per open — and every settings row in every tab reads/writes through the returned `{ entries, settingValue, commitSetting }`. The read path is ONE derived list: `entriesWithMirrors` overlays the live values of context-backed keys (`theme`/`theme_dark`/`theme_light`/`instance_name`, plus `instance_color` only while the accent context's setting `isExplicit`) onto the fetched entries, so a row's control and its modified dot derive from the same read path and cannot diverge — per-key mirror logic in consumers is forbidden by construction. Writes route by key: context-backed keys POST through their context's setter (`setTheme` — with the enum mode word mapped to the per-mode slot id, `dark` → `themeDark` / `light` → `themeLight` / else `"system"`; `useInstanceAccent().setColor`; `useInstanceName().setInstanceName`); context-less keys (`auto_name`, `ssh_host`, `log_level`, `tmux_conf`) POST via the generic `postSettings` and update the shared list optimistically; a backend `400` rejects `commitSetting` so the row surfaces it inline without clobbering the stored value. Client-side, the generic surface is the exported `SettingsEntry` (gaining `options?: string[]`), `getSettingsEntries()`, and `postSettings()` in `api/client.ts`; the 13 per-key wrappers stay untouched.
- **Search + category headers**: a search field on top runs a substring filter over key, description, and category (the palette haystack precedent); rows render in registry order grouped under title-cased category headers on `ScopeHeading`'s underlined rule, and a header hides when all its rows are filtered out (group `<section>`s key on group identity, not the category name — a filtered run can split a category into two groups).
- **Typed controls per kind, with key overrides**: `bool` → `BoolToggle` (commit-on-flip); `enum` → a closed select over the entry's `options` (an out-of-list effective value — e.g. `theme` holding a named theme id — renders the registry default WITHOUT committing, never a blank select); `string`/`path` → the `TextEntryControl` on the shared text-setting core; `color` → the `SwatchPopover` descriptor control; `map`/`list` (`server_colors`, `server_flairs`, `board_order`) → read-only rows with a current-value summary (entry count / ordered names) and a hint naming their dedicated editing surface (sidebar pickers, board sidebar reorder) plus the escape hatch. Key overrides: `theme_dark`/`theme_light` render as selects over the client theme registry filtered to the slot's category (never free text — the backend validates only non-empty), with the same no-commit fallback-to-default guard; `instance_color` binds the accent context so the top-bar stripe repaints optimistically. `ThemePairControl` stays the Appearance tab's rich theme surface, untouched.
- **Shared text-setting core** (`text-setting-core.tsx`): `useTextSettingDraft(value, commit)` owns the draft/commit/Escape state machine (Enter/blur commit, Escape cancels the edit only, inline `role="alert"` rejection), with `textSettingInputClass` and `TextSettingError` carrying the shared styling/markup — consumed by both the curated `TextSetting` and the table's `TextEntryControl`, so the commit contract is single-sourced.
- **Modified dot + restart badge**: each row's modified-from-default dot compares the seam-read effective value against the registry `default` per kind (`null`-equals-empty for unset scalars, `{}`/`[]` for nested); every `live: false` row (`tmux_conf`, `log_level`) renders a "requires restart" badge driven by the GET payload's `live` flag — no frontend key list. No per-row reset action (the `null`-unset POST and the escape hatch exist). Known residual: the table-side `instance_color` Clear path leaves a stale modified dot until dialog reopen (the Clear drops the accent mirror's `isExplicit` overlay and the row falls back to the fetched entry) — recorded as a follow-up.
- **Escape-hatch footer**: renders the constant path `~/.config/run-kit/config.yaml` (displayable as a constant by the fixed-config-root decision — no API resolves it) with a copy-to-clipboard button (`lib/clipboard.ts`) and a one-line hint that map/list keys and comments are edited there; no open-in-editor mechanism.

### Dialog width variant (`size` on `components/dialog.tsx`)

`Dialog` takes an optional `size?: "sm" | "lg" | "xl"` defaulting to `"sm"`: `sm` → `max-w-sm` (the phone-card width every other dialog uses — spawn, kill, create-session, board kill confirm, …); `lg` → `max-w-2xl` (≈672px) — **consumerless**; `xl` → `max-w-4xl` plus a FIXED panel height (`h-[min(40rem,calc(100vh-2rem))]`) with panel-level `overflow-hidden` and `flex flex-col` — the tabbed settings dialog's variant and its only consumer. `sm`/`lg` carry the panel scroll path (`max-h-[calc(100vh-2rem)] overflow-y-auto` on the panel, `p-4` on the backdrop container — the `calc` offset matches that padding so the panel never touches the viewport edge), which is safe for `sm` dialogs and is what keeps a tall pane reachable in a short viewport; `xl` inverts that so the tab rail never jumps between short and tall panels — each tab panel owns its own internal scroll instead. Asserted in `dialog.test.tsx` (default vs `lg` vs `xl` max-width, the `xl` fixed-height/overflow classes, and the scroll classes on `sm`/`lg`). (260818-bncw-tabbed-settings-dialog)

**Triggers — two registry chords, four palette actions in the layout-level global group, a top-bar gear chip, and two chevron-menu rows** (every one reaches the same `useSettingsDialog()` seam):

- **The `settings-open` chord** — ⌘, on every mac host (browser-reserved in a mac browser, where settings is palette-only), ⇧Ctrl+, on Windows/Linux ([keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) § The default binding set). A **pure opener**: tab-less `openSettings()` — lands General when closed, a tab-preserving no-op when open (re-fire never closes, never yanks the tab). It is a registry builtin like every other app chord, so it is rebindable per device and its combo surfaces automatically in the shortcuts panel, the palette hint, and the gear's tooltip chip. **Both route shells resolve the handler** — `keybindingHandlers` in `app.tsx` and `boardKeyHandlers` in `board-page.tsx` look the layout-global palette entries up by id over the merged list (§ Dispatch seams), so chord and palette can never drift and no per-shell rewiring exists. The unshifted ⌘, resolves `reserved` in a mac browser because it is the browser's own Preferences accelerator (claimed data, § Claimed keys). (260801-mqim)
- **The `shortcuts-overlay` chord** — ⌘/ on mac hosts, ⇧Ctrl+/ on Win/Linux — a **three-state toggle into the Shortcuts tab**: closed → open on Shortcuts; open on Shortcuts → close; open on another tab → switch to Shortcuts (never close). The registry actionIds `settings-open`/`shortcuts-overlay` are unchanged, so stored per-device override diffs in `localStorage["runkit-keybindings"]` keep applying. (260818-bncw-tabbed-settings-dialog)
- **Command palette** — four layout-level global entries (`use-global-palette-actions.ts`, § Single palette mount + palette-actions slot): `Settings: Open` (id `settings-open`, the pure opener), `Settings: Appearance` (id `settings-appearance`, `openSettings("appearance")`), `Settings: All` (id `settings-all`, `openSettings("all")` — the registry-table deep-link), and `Help: Keyboard Shortcuts` (id `shortcuts-overlay` — the Shortcuts-tab toggle and the ONLY Shortcuts entry; one action per intent). Each id doubles as the registry actionId where a binding exists, so `withShortcutHints` decorates the entries for free. The dialog itself mounts once in `AppLayout` (§ Design Decisions → Settings dialog mounts at `AppLayout`, not `AppShell`; → One palette mount in AppLayout, routes register via the slot).
- **Top-bar gear chip** — `SettingsGearButton` in `top-bar.tsx` (`GearIcon` from `sidebar/icons.tsx`), the L3-tail fit candidate in the right cluster on ALL four modes, sitting immediately before the exempt overflow chevron (the right-rail toggle stays outermost), consuming `useSettingsDialog()`; under width pressure it degrades to the chevron menu's App-section "Settings" row (`SettingsMenuRow`) (§ Right cluster → Settings gear). Per the tier-1 tooltip system (§ Tier-1 `Tip`), the gear is named via a `Tip label="Settings"` carrying the **host-effective `settings-open` chord** in its `kbd` slot, omitted when unbound/disabled — with an `aria-label="Open settings"` retained and never a native `title=`. The same Tip-not-title rule applies to icon-only controls inside the dialog (the accent-picker button, the font steppers). (260812-d1at)
- **Chevron menu rows** — the overflow menu's App section carries "Settings" (tab-less, like the gear) and "Keyboard shortcuts", a pure **deep-link** calling `openSettings("shortcuts")` directly on the layout-provided context — re-clicking while open on Shortcuts does not close (only the chord/palette entry carries the toggle semantics).

**Instance display name has THREE display consumers, delivered via a root context** — see § Instance Display Name below.

## Host Form Dialog

`app/frontend/src/components/host-form-dialog.tsx` — the ONE Add/Edit host form of the desktop-shell titlebar strip: a mode-discriminated props union (`mode: "add" | "edit"` — narrowed by check, no `as` casts) on the shared `Dialog` shell inside a `z-[60]` wrapper (the strip's menu-stacking treatment — [top-bar](/run-kit/ui/top-bar.md) § Desktop-Shell Titlebar Strip). Both modes render the same field contract: Name (optional) above URL, same labels, same validation copy (the exported `INVALID_HOST_URL_MESSAGE` — `Enter a full http(s) URL, e.g. http://host:3000`), same inline error slot, same Cancel/primary button row; Enter in either field submits. The exported `reduceOrigin(raw): string | null` (full http(s) URL → origin, `null` when malformed) backs BOTH add mode's local validation and the strip's edit-mode save — one check paired with one copy constant.

- **Edit mode** is a pure rendering extraction: the caller owns the save semantics — prefill (`initialName`/`initialUrl`), the diff-against-prefill-then-live-row commit, `servers:rename` / `servers:set-url`, the optimistic row update, and the row refocus — and its `onSubmit` answers with the inline error to show (the dialog stays open) or `null` once the save proceeds (the caller unmounts). `urlEnabled: false` (a shell without `setUrl`) disables the URL field with a "URL editing needs a newer desktop app." note. No connectivity ping on save — a temporarily-down host stays editable.
- **Add mode** owns its submit: local URL validation first (the shared check + copy), then ONE `addShellHostDirect(name.trim(), origin)` invoke ([desktop-shell](/run-kit/desktop-shell.md) § `window.runkitShell` Bridge) — the main process pings before persisting, so a returned `{ ok: false, error }` renders inline in the same error slot and keeps the dialog open for correction. While the invoke is in flight the form is `busy` (fields + submit disabled — the ping can take up to 5s; the spawn-agent in-flight convention). A blank Name auto-derives from the ping's returned hostname main-side. Success fires `onSuccess` — the shell has already switched the window to the new host, so the caller just closes the dialog.

The strip is the only consumer (the edit pencil / F2 path in edit mode, the `+ Add Host…` footer fork in add mode), rendering both modes inside the switcher container (backdrop clicks never trip the menu's outside-click close) and counting them in its `dialogOpen` key-suspension union. Covered by the colocated `host-form-dialog.test.tsx` (both modes — edit save-diff / disabled-URL / inline-error paths; add validation, busy, inline main-side failure, and success) plus the strip suite's footer-fork tests. (260820-d99v-spa-host-form-dialog)

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

4. **Field-overlay state** (single-writer route state): the terminal route's surface layout rides a `pendingLayout { key, value }` overlay in `app.tsx` — the ONE field case that is NOT a Zustand-store ghost/kill/rename row. `applyLayout` sets it before POSTing `@rk_win_layout`; the rendered layout is `effectiveLayout({ ...window, layout: pendingLayout.value })` while `key` matches the current route, and it clears when the SSE payload's `layout` equals the pending value, on POST rejection (revert to the payload value; the failure surfaces through the mutation-feedback path), or on a route change. The overlay lives in `app.tsx` state, not the window store: the layout has exactly one writer surface (the terminal route) and one consumer, and the store's optimistic machinery is ghost-row shaped, not field-override shaped. Degradation still applies to the pending value, so tiles reorder immediately and never flicker back when the tick confirms. (iip5)

3. **Inline progress** (async data): File upload shows an "Uploading..." badge in the terminal area. Directory autocomplete shows a spinner in the path input trailing slot. Server list refresh shows a spinner on the dropdown trigger.

**Error toast system**: `ToastProvider` + `Toast` component (`app/frontend/src/components/toast.tsx`). Fixed bottom-right, auto-dismiss after 4 seconds, stacked vertically. Error variant has `var(--color-ansi-1)` (red) left accent border; info variant uses `var(--color-ansi-4)` (blue). Theme-aware via CSS custom properties. Despite the "error" name it is the general toast surface (the `info` variant carries success/neutral messages). `addToast(message, variant?, action?)` takes an optional THIRD positional `action?: { label, onSelect }` (260718-gxrq) rendered as a keyboard-focusable `<button>` inside the toast body — selecting it dismisses the toast then runs `onSelect`; the third parameter is optional, so two-arg call sites stay valid. Used for the post-pin "Pinned to <board>" + "View board" toast (§ Post-pin success feedback + toast optional action).

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

### Dialog theme control embeds the shared picker core, never dispatches the modal
**Decision**: The dialog's theme surface renders the shared `ThemePickerList` core inline (mode buttons above it, `setTheme()` wiring underneath), rather than dispatching the `"theme-selector:open"` event to reuse the top-bar `ThemeSelector` modal. Checkmark placement is a core prop (`checkedIds`): the dialog checks both preferred slots at once, the modal checks only its open-time active theme.
**Why**: `ThemeSelector` is mounted only inside `AppShell` (`app.tsx`), so the event has no listener on `/board/$name` — the dialog's core every-page-mount promise — and dispatching it would stack a modal on a modal (both `z-50`, Escape-handler interference). The shared core keeps the two surfaces drift-proof while `setTheme(id)` keeps owning slot updates + the partial-merge POST + localStorage sync. The dual-slot check preserves the one thing per-mode controls showed that a single active check would lose; the modal's contract stays unchanged.
**Rejected**: dispatching `theme-selector:open` from the dialog (dead on boards, modal-on-modal stacking); moving the `ThemeSelector` mount to `AppLayout` (a behavior change to an unrelated surface); two plain `<select>`s per mode (no search, swatches, or preview — the picker core provides all three with the same wiring); dual checks in the modal too (an unrequested modal behavior change).
*Introduced by*: 260819-qkow-settings-inline-theme-picker

### Tab state lives in SettingsDialogContext
**Decision**: `activeTab` + `openSettings(tab?)` live in `SettingsDialogContext`, not in dialog-local state.
**Why**: The deep-link writers (global palette entry bodies, the chevron menu row) live outside the dialog body; context state lets them target a tab without prop drilling or a CustomEvent side channel, and the context is already the dialog's open/close seam.
**Rejected**: dialog-local tab state + a CustomEvent carrying the tab (a second event seam alongside the context that already owns open/close); a router search param (Constitution IV — settings are not a route).
*Introduced by*: 260818-bncw-tabbed-settings-dialog

### Chord semantics stay per-binding: toggle for shortcuts, pure opener for settings-open
**Decision**: `shortcuts-overlay` keeps its documented TOGGLE behavior, refined for tabs (closed→open on Shortcuts; open-on-Shortcuts→close; open-elsewhere→switch to Shortcuts). `settings-open` stays a pure opener (re-fire = no-op, never closes, never yanks the tab).
**Why**: Each binding preserves its established semantics — settings-open is open-only per the macOS ⌘, convention (260801-mqim); the overlay chord toggles — so muscle memory survives the consolidation. Switch-not-close on the third state: a user pressing "show me shortcuts" while looking at Appearance wants shortcuts, not a closed dialog.
**Rejected**: making both toggles (contradicts the settings-open decision); close-on-any-tab for the shortcuts chord (punishes the switch intent).
*Introduced by*: 260818-bncw-tabbed-settings-dialog

### Two-level model: curated tabs + everything-table
**Decision**: keep General/Appearance/Shortcuts curated and add an All-settings registry table tab; six keys deliberately appear in both presentations over one dialog-level state seam.
**Why**: the VSCode settings-UI/settings.json model the user chose — palatable curated controls plus an exposes-everything surface that future registry keys join for free; one state seam makes duplication drift-proof.
**Rejected**: replacing General/Appearance with the flat list (loses the curated UX); a yaml view (browser never sees file bytes — a client-side rendering is a second serializer that drifts and drops comments; serving/writing raw bytes is forbidden backend surface; the omit-when-default file is near-empty so the table strictly dominates).
*Introduced by*: 260823-5r41-settings-pane-live-apply

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
