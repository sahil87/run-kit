# Intake: Navbar Open-in-App Button

**Change**: 260722-6d0f-navbar-open-in-app
**Created**: 2026-07-22

## Origin

> navbar Open button — open current worktree/pane folder in an app: server-side exec via wt open when local, client-side ssh-remote deeplinks (vscode/cursor/windsurf) when remote

Conversational — created via `/fab-new` after a `/fab-discuss` design session (2026-07-22). The user showed Conductor's "Open" split-button (VS Code icon + chevron) and asked how run-kit, as a sometimes-remotely-accessed web app, could offer the same. The discussion settled the architecture split between the `wt` CLI and run-kit; the companion wt-side work was filed as wt backlog item `[qj66]` (`wt open --list --json` machine surface) in `~/code/sahil87/wt`.

Key decisions reached in discussion:

1. **Two execution contexts, two mechanisms**: server-side exec via `wt open` when the browser is on the host; client-side URL-scheme deeplinks when remote (the only power a web page has over the client machine).
2. **Deeplink templates live in run-kit's frontend ONLY** — explicitly decided by the user. Host-side detection is a wrong/inverted signal for deeplinks (e.g. Windsurf installed on the client but not the host), so `wt` carries no URL-scheme knowledge; the templates are a static TS const.
3. **wt owns host-app detection + launch** (constitution III, wrap don't reinvent): run-kit wraps the new `wt open --list --json` for the registry and the existing `wt open <path> -a <app>` for launch.

## Why

**Problem**: run-kit surfaces sessions, panes, and worktrees, but jumping from a pane to that folder in an editor means leaving the dashboard, finding a terminal, and running `wt open` by hand. Conductor demonstrates how low-friction this should be: one navbar button. The remote case is worse — today there is *no* path from "looking at a pane on my laptop" to "that folder open in my local editor."

**If we don't build it**: the dashboard stays a viewer rather than a launcher; the most common next action after inspecting a session (open the code) remains manual, and the remote workflow requires manually reconstructing an `ssh-remote` URI or SSHing in.

**Why this approach**: the browser cannot exec on the client and cannot detect client installs — deeplinks (specifically the `vscode-remote/ssh-remote+{host}{path}` form used by Coder/Codespaces) are the only remote mechanism that opens a host folder in a client-local editor. On the host side, `wt open` already does app detection and launch; wrapping it avoids reimplementing either (constitution III) and keeps one app registry across the toolkit.

## What Changes

### Backend: `GET /api/open-apps`

New read endpoint returning the host-detected app registry for the server-exec dropdown section.

- Wraps `wt open --list --json` (wt backlog `[qj66]` — JSON array of `{id, label, kind}`, `kind: editor|terminal|file-manager`).
- **Fail-silent degradation** (toolkit discipline): `wt` absent (`command -v` fails), older than the `--list` flag, or erroring → respond `200` with `[]`, never an error. The frontend hides the "on host" section when the list is empty.
- Executed via `exec.CommandContext` with timeout (constitution I / Process Execution).

### Backend: `POST /api/open`

New mutating endpoint (POST per constitution IX) launching an app on the host.

- Body: `{ "path": "<abs path>", "app": "<app id>" }`.
- **Validation before exec** (constitution I): `path` MUST match a currently-derived pane cwd or a known worktree path (server-side derivation per constitution X — never trust the client's path); `app` MUST be an id present in the current `wt open --list --json` output. Reject anything else with 4xx; nothing user-supplied reaches exec unchecked.
- Launch: `wt open <path> -a <app>` via `exec.CommandContext` with timeout (this non-interactive path exists in wt today).

### Config: `RK_SSH_HOST`

New optional env var (`.env` / `.env.local`, loaded in `internal/config`): the SSH host alias remote clients use to reach this host. Exposed to the frontend (alongside however existing config reaches it; if no config endpoint exists, add the field to the smallest existing bootstrap surface rather than a new route). Unset ⇒ the deeplink section is hidden entirely — every template needs `{host}`.

### Frontend: Open split-button (top bar, Terminal route)

Conductor-style split-button in the top bar's right-side button cluster, v1 on the Terminal route only (the folder is the active pane's cwd, already derived server-side and available to the client).

- **Static deeplink template table** — a plain TS const, no API, no detection:
  ```ts
  const DEEPLINK_APPS = [
    { id: "vscode",   label: "VS Code",  url: (host, path) => `vscode://vscode-remote/ssh-remote+${host}${path}` },
    { id: "cursor",   label: "Cursor",   url: (host, path) => `cursor://vscode-remote/ssh-remote+${host}${path}` },
    { id: "windsurf", label: "Windsurf", url: (host, path) => `windsurf://vscode-remote/ssh-remote+${host}${path}` },
  ]
  ```
- **Local/remote branch**: `location.hostname` ∈ {`localhost`, `127.0.0.1`, `[::1]`} → show the server-exec section fed by `GET /api/open-apps`; otherwise show the deeplink section (all templates unconditionally — client installs are unknowable; a dead scheme no-ops on click) plus the server-exec section as an explicitly labeled "on host" escape hatch.
- Deeplink activation is a plain user-gesture navigation (`window.location.href = url`) — the browser shows its own "Open <app>?" confirm; no popup/anchor tricks needed.
- Section visibility: deeplink section hidden when `RK_SSH_HOST` unset; host section hidden when the registry is empty.
- Split-button behavior: primary click re-runs the last-used target (persisted to localStorage, mirroring the `runkit-terminal-font-size` preference pattern); chevron opens the full menu. No stored preference yet ⇒ primary click opens the menu.

### Frontend: command palette + keyboard

Every new action keyboard-reachable (constitution V): register palette entries (e.g. `Open: <app label>` per available target) alongside the button. New shortcuts documented in the palette registration (code-review rule).

## Affected Memory

- `run-kit/ui-patterns.md`: (modify) top-bar right-cluster gains the Open split-button; split-button + localStorage-preference pattern
- `run-kit/architecture.md`: (modify) new `/api/open-apps` + `/api/open` endpoints; wt CLI wrapper surface; RK_SSH_HOST config

## Impact

- **Backend**: new `app/backend/api/open.go` (+ `open_test.go`); new wt wrapper in `internal/` (sibling to `internal/tmux/`, `internal/fab/` — constitution III wrappers live here); `internal/config/config.go` (RK_SSH_HOST).
- **Frontend**: `src/components/top-bar.tsx` (right cluster), new `open-button` component (+ unit test), `src/components/command-palette.tsx` registration, `src/api/client.ts` (two endpoints), deeplink const module.
- **Tests**: Go handler tests (validation paths, fail-silent registry); Vitest for the button/menu branch logic; Playwright e2e for the button's presence/menu (+ mandatory sibling `.spec.md` per constitution — and note existing e2e specs assert top-bar chrome details, so check `tests/e2e` for affected assertions before changing the cluster).
- **Dependency**: the registry endpoint depends on wt `[qj66]` (`--list --json`) which does not exist yet. The fail-silent contract makes the run-kit side buildable and shippable first: deeplinks + `POST /api/open` validation work today; the host dropdown lights up when wt ships the flag.
- **Docs**: constitution IV check — no new route, a top-bar control on an existing page; minimal-surface compliant.

## Open Questions

- Should the Open button later appear on server/board routes (folder = session cwd / repo root), or stay Terminal-only? (v1: Terminal-only.)
- Mobile/coarse-pointer treatment: editor deeplinks are effectively dead on phones — hide the button, or show it uncurated? (v1 leans show-as-is; revisit with usage.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Deeplink templates are a static frontend const in run-kit only; wt carries zero URL-scheme knowledge | Explicitly decided by user in discussion (Windsurf-on-client-not-host argument) | S:95 R:85 A:95 D:95 |
| 2 | Certain | `POST /api/open` for launch, `GET /api/open-apps` for the registry | Constitution IX mandates POST-only mutations | S:90 R:90 A:100 D:100 |
| 3 | Certain | Host launch and detection go through `wt open` (never a parallel `open -a` implementation) | Constitution III wrap-don't-reinvent; wt is the toolkit's canonical launcher | S:85 R:80 A:95 D:90 |
| 4 | Confident | Registry via new `wt open --list --json` (wt `[qj66]`); absent/old wt degrades fail-silent to `[]` | Discussed; mirrors toolkit fail-silent discipline; run-kit ships independent of wt sequencing | S:80 R:70 A:80 D:80 |
| 5 | Confident | v1 deeplink set is VS Code + Cursor + Windsurf via shared `vscode-remote/ssh-remote+{host}{path}` grammar; JetBrains Gateway excluded | User's request names exactly these three; Gateway has a divergent grammar, easy to add later | S:75 R:90 A:80 D:75 |
| 6 | Confident | `RK_SSH_HOST` env var gates the deeplink section (unset ⇒ hidden) | Discussed; env-var config per constitution VII; run-kit cannot know the client's SSH alias | S:70 R:85 A:85 D:75 |
| 7 | Confident | Local/remote detection = `location.hostname` localhost-check; remote view keeps a labeled "on host" escape hatch | Heuristic proposed and accepted in discussion; trivially revisable | S:65 R:85 A:75 D:65 |
| 8 | Confident | Placement: top-bar right cluster, Terminal route only in v1 (path = active pane cwd) | Cluster placement discussed; route scoping inferred — only Terminal has an unambiguous folder; listed in Open Questions for later routes | S:50 R:80 A:55 D:45 |
| 9 | Confident | SSH reachability from remote clients is the user's environment concern; feature stays dark (section hidden) when RK_SSH_HOST unset, so a tunnel-only setup loses nothing | Raised in discussion, unanswered — but unset-gating makes the assumption safe | S:45 R:90 A:60 D:70 |
| 10 | Confident | tmux-`$EDITOR` fallback ("open in a new tmux window") excluded from v1 scope | User's request enumerates exactly two mechanisms; fallback was advisory | S:60 R:90 A:70 D:60 |
| 11 | Confident | Split-button primary = last-used app from localStorage (else opens menu); chevron = full menu | Not discussed; mirrors Conductor UX and the existing localStorage preference pattern; pure UI, cheap to change | S:35 R:80 A:50 D:35 |

11 assumptions (3 certain, 8 confident, 0 tentative, 0 unresolved).
