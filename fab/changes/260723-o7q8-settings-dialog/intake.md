# Intake: Settings Dialog

**Change**: 260723-o7q8-settings-dialog
**Created**: 2026-07-23

## Origin

> Conversational (`/fab-discuss` session preceding `/fab-new`). User: "I am thinking of adding a settings page… candidates… Host color… SSH Host Name… where should these persist?" Refined over three exchanges into: a VS Code-style settings **dialog** (not a routed page), mounted at `AppLayout`, with a confirmed setting inventory and persistence scoping.

Key decisions from the conversation:

- **Dialog, not page** — user: "Yes, this is setting dialogue (like VSCode)." Keeps constitution Principle IV ("no settings pages") intact; no amendment needed.
- **Mount at `AppLayout`, not AppShell** — AppShell is server-scoped (assumes non-null `currentServer` throughout `app.tsx`); `AppLayout` is the true every-page layer (persistent TopBar mounts there; `/board/$name` already renders inside it). Boards get the dialog for free. The broader "migrate global chrome to AppLayout" work (Sidebar, create/kill dialogs, palette) is **separate scope**, captured as main-worktree backlog item `[239r]`.
- **Host-scoped settings (in `~/.rk/settings.yaml`)**: instance/host accent color (picker), SSH host, theme pair, instance display name override. User: "Host scoped: yes to 1, 2, 3, 5."
- **Device-scoped (localStorage)**: terminal font size only. User: "Device scoped: Yes to 6." Per-server colors and preferred-editor were explicitly *not* selected for the dialog.
- **Theme pair gets a second surface** — user: "Theme pair doesn't move into the dialog. It gets a second surface there." The top-bar theme selector stays.
- **SSH host is a single free-form field** used verbatim (alias or `user@host`), not split username/hostname fields — preserves the PR #443 alias contract in `open-in-app.ts`. Precedence: settings value wins, `RK_SSH_HOST` env is the fallback. (User: "Agreed on your notes.")
- **Scope split visible in the dialog** — "This host" vs "This device" sections, so a device-local value not syncing across devices reads as designed, not broken.

## Why

1. **Pain point**: run-kit's user preferences are scattered across ad-hoc surfaces (HOST-panel accent picker, top-bar theme selector, top-bar font control) and, for the SSH host, a server-side env var (`RK_SSH_HOST`) that cannot be changed from the UI at all. There is no single place to see or edit "how this instance is configured."
2. **Consequence of not fixing**: every new host-scoped preference (instance display name is already wanted) forces either another bespoke in-context control or another env var requiring shell access + restart. The SSH host in particular is a first-run papercut: editor deeplinks are degraded until someone SSHes in to set an env var.
3. **Why this approach**: a dialog (not a route) satisfies Principle IV verbatim and Principle V (keyboard-first, palette-launched). Mounting at `AppLayout` makes it available on every page — including `/board/$name`, which does not render AppShell — with the dialog, its state, and its logic existing exactly once. Persistence reuses the proven `~/.rk/settings.yaml` + `/api/settings/*` layer already serving theme/instance-color/server-colors/board-order; localStorage remains only for genuinely device-scoped ergonomics.

## What Changes

### 1. Settings dialog shell (frontend)

New `SettingsDialog` component, rendered **once** in `AppLayout` (`app.tsx`), following the existing dialog patterns (create/kill dialogs). Open/close state lives in a new small `SettingsDialogContext` provided at the `AppLayout` level so any descendant (palette actions, sidebar gear) can call `openSettings()`.

Dialog layout has two labeled sections making the persistence scope visible:

- **This host** — instance display name, SSH host, instance accent color, theme pair
- **This device** — terminal font size

All controls follow keyboard-first conventions (focus trap, Escape closes, tab order). Existing hover/animation vocabulary applies (CRT glint on buttons, etc. per `context.md`).

### 2. Triggers

- **Command palette**: a "Settings: Open" action registered in **both** palettes — AppShell's palette (server routes) and `board-page.tsx`'s `boardRouteActions`. Each registration is a one-liner calling the context's `openSettings()`; the dialog itself is never duplicated (this is the two-line concession to the board-twin problem until `[239r]` lands).
- **Sidebar gear**: a gear affordance in the shared Sidebar footer (the Sidebar renders on server routes AND boards, so this works everywhere). Per the tier-1 tooltip system (PR #445, `components/tip.tsx`), the gear is named via a `Tip` label — never a native `title=` attribute — with its `aria-label` retained; the same rule applies to any icon-only control inside the dialog.
- **No dedicated keyboard shortcut in v1** — `Cmd+,` is reserved by macOS browsers for browser settings; the palette is the primary keyboard path.

### 3. Host-scoped settings — backend (`internal/settings`, `api/settings.go`)

Two new keys in `~/.rk/settings.yaml`, following the existing scalar-key pattern (`instance_color`):

```yaml
ssh_host: "devbox"          # verbatim SSH destination — alias or user@host; empty = unset
instance_name: "my-box"     # display name override; empty = derive from os.Hostname()
```

- Serialize only when non-empty (byte-identical output for files that never set them — same rule as `instance_color`).
- New per-key endpoints following the `instance-color` pattern, POST-only mutation per constitution Principle IX:
  - `GET /api/settings/ssh-host` → `{"sshHost": "..." | null}`; `POST /api/settings/ssh-host` ← `{"sshHost": "..." | null}` (null clears)
  - `GET /api/settings/instance-name` → `{"name": "..." | null}`; `POST /api/settings/instance-name` ← `{"name": "..." | null}` (null clears)
- Validation: `ssh_host` and `instance_name` are trimmed; reject values containing whitespace/control characters for `ssh_host` (it is spliced into `vscode://vscode-remote/ssh-remote+{host}` URLs); length-cap both (e.g. 253 chars, hostname max).

### 4. SSH host precedence (`internal/config`, `api/health.go`)

`/api/health` continues to be the frontend's source for `sshHost`, but resolution becomes **settings-first, env fallback**:

1. `settings.yaml` `ssh_host` non-empty → use it
2. else `RK_SSH_HOST` env → use it
3. else omit (frontend derives `${sshUser}@${hostname}` for remote clients, unchanged)

The frontend consumption path (`open-in-app.ts` `resolveDeeplinkHost` — verbatim, never `user@`-prefixed) is **unchanged**. A UI edit takes effect on the next health poll without restart; the env var keeps working for headless provisioning.

### 5. Instance display name consumers (frontend)

When `instance_name` is set, **display surfaces** prefer it over the health-reported hostname:

- browser tab title (`use-browser-title.ts`)
- HOST panel hostname line (`sidebar/host-panel.tsx`)
- host overview page heading (`host-overview-page.tsx`)

Two surfaces deliberately keep using the **real hostname**:

- the instance-accent hash fallback (`instance-accent.ts`) — renaming the instance must not silently change its color <!-- assumed: accent hash stays keyed on real hostname for color stability; the alternative (hash follows display name) is defensible but changes color on rename -->
- SSH deeplink derivation (`open-in-app.ts`) — deeplinks need the real reachable hostname, not a vanity label

`/api/health` gains an optional `instanceName` field (present only when set), mirroring how `sshHost` is carried.

### 6. Second-surface controls (reuse, not rebuild)

- **Instance accent color**: reuse the existing HOST-panel accent picker component/model — ANSI-index / two-hue-blend descriptors ("4", "1+3") via existing `GET/POST /api/settings/instance-color` and `validate.NormalizeColorValue`. **Not** a free RGB picker — the color model is descriptor-based end-to-end (tmux/theme derivation depends on it).
- **Theme pair**: reuse the existing theme selector wiring (`/api/settings/theme`, partial-merge POST). Top-bar selector stays; the dialog is additive.
- **Terminal font size**: reuse the `ChromeContext.terminalFontSize` control (localStorage `runkit-terminal-font-size`); presented under "This device".

### 7. Tests

- Vitest unit tests for `SettingsDialog`, `SettingsDialogContext`, and the new client functions in `src/api/client.ts`.
- Go tests for the new settings keys (parse/serialize round-trip incl. empty-value omission), the two new endpoints, and the health `sshHost` precedence (settings > env > absent).
- Playwright e2e: open via palette on a server route AND on `/board/$name`, open via sidebar gear, edit + persist a host-scoped value, verify the This-host/This-device section split renders. Sibling `.spec.md` companion doc required (constitution § Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) settings dialog — AppLayout mount, SettingsDialogContext, palette/gear triggers, This-host/This-device scope split, second-surface rule for theme/color/font controls
- `run-kit/architecture`: (modify) new `settings.yaml` keys (`ssh_host`, `instance_name`), per-key endpoints, health `sshHost` settings-first precedence, optional `instanceName` in health payload

## Impact

- **Frontend**: `app.tsx` (AppLayout mount + provider), new `components/settings-dialog.tsx` + `contexts/settings-dialog-context.tsx`, palette action registration in `app.tsx` (AppShell palette) and `components/board/board-page.tsx` (`boardRouteActions`), Sidebar footer gear, `api/client.ts` additions, `hooks/use-browser-title.ts`, `components/sidebar/host-panel.tsx`, `components/host-overview-page.tsx`.
- **Backend**: `internal/settings/settings.go` (+tests), `api/settings.go` (+tests), `api/health.go` (+tests), `api/router.go` (route registration), `internal/config/config.go` (unchanged contract, doc comment update).
- **No new routes, no database, no new env vars.** Existing consumers of `RK_SSH_HOST` keep working (fallback).
- **E2E surface**: existing top-bar/sidebar Playwright specs assert chrome details — the sidebar-footer gear addition must be checked against `tests/e2e` assertions.

## Open Questions

- None — all major decisions were resolved in the preceding discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Settings dialog (VS Code-style), not a routed page | Discussed — user chose explicitly; honors constitution Principle IV | S:95 R:70 A:90 D:95 |
| 2 | Certain | Mount at `AppLayout` with `SettingsDialogContext`; AppShell stays server-scoped; boards covered via AppLayout | Discussed — user endorsed after AppShell-on-boards was ruled out; broader chrome migration split to backlog `[239r]` | S:90 R:75 A:90 D:90 |
| 3 | Certain | Host-scoped inventory: instance color, SSH host, theme pair, instance display name | Discussed — user enumerated "yes to 1, 2, 3, 5" | S:100 R:70 A:90 D:95 |
| 4 | Certain | Device-scoped: terminal font size only (v1), in localStorage; This-host/This-device sections make the split visible | Discussed — user confirmed item 6 and the visible-scope-split note | S:90 R:85 A:85 D:85 |
| 5 | Certain | Theme pair is a second surface; top-bar selector stays | Discussed — user stated verbatim | S:95 R:90 A:90 D:95 |
| 6 | Certain | Per-server colors excluded from the dialog | Discussed — user selected a subset that omits them; they stay in-context | S:90 R:85 A:85 D:90 |
| 7 | Certain | SSH host is one free-form verbatim field (alias or `user@host`), no username split | Discussed + grounded in `open-in-app.ts` verbatim-alias contract (PR #443) | S:85 R:75 A:90 D:80 |
| 8 | Confident | Precedence: `settings.yaml` `ssh_host` wins, `RK_SSH_HOST` env is fallback | Discussed at proposal level ("Agreed on your notes"); UI-edit-wins avoids silent override confusion | S:80 R:70 A:80 D:75 |
| 9 | Confident | Keys `ssh_host`/`instance_name`; per-key GET/POST endpoints mirroring `instance-color`; POST-only mutation | Inferred from existing settings-layer pattern + constitution Principle IX | S:55 R:80 A:90 D:85 |
| 10 | Confident | `/api/health` carries effective `sshHost` (settings-first) and optional `instanceName`; frontend deeplink flow unchanged | Health is the existing transport for both facts; keeps one consumer path | S:55 R:75 A:80 D:75 |
| 11 | Tentative | Display name overrides browser title, HOST panel, host-overview heading; accent hash and SSH deeplink derivation keep the real hostname | Surfaces inferred from hostname consumers in code; accent-hash choice is genuinely two-way (stability chosen over follow-the-name) | S:35 R:70 A:45 D:35 |
| 12 | Confident | Dialog color picker reuses the HOST-panel accent picker + descriptor model (ANSI/blend), not a free RGB picker | Color model is descriptor-based end-to-end (`NormalizeColorValue`, tmux/theme derivation); RGB would break it | S:70 R:80 A:85 D:80 |
| 13 | Confident | No dedicated keyboard shortcut in v1 (`Cmd+,` is browser-reserved); palette + gear are the triggers | Not discussed; palette-primary follows Principle V; easily added later | S:60 R:90 A:75 D:70 |
| 14 | Certain | New Playwright e2e spec ships with sibling `.spec.md`; dialog tested on server route and board route | Constitution mandates companion docs; board coverage is the point of the AppLayout mount | S:80 R:90 A:100 D:95 |

14 assumptions (8 certain, 5 confident, 1 tentative, 0 unresolved).
