# Intake: Session and Window Templates / Quick-Launch

**Change**: 260405-hvqf-session-window-templates
**Created**: 2026-04-06
**Status**: Draft

## Origin

> Session and window templates / quick-launch — Instead of 'new session' leading to a blank terminal, let users define named templates that spin up a session with pre-configured windows and commands. Examples: 'Claude agent on repo X', 'monitoring stack', 'dev environment with 3 windows'. Also support window-level templates within an existing session. Templates should be defined in a simple config format (YAML in run-kit.yaml or a templates/ directory). One click or Cmd+K action to launch a full environment. Discuss: where templates live, what they can configure (name, working directory, initial command, window count), and how they surface in the UI (Cmd+K, sidebar, dedicated launcher).

One-shot input with detailed requirements and concrete examples.

## Why

Currently, creating a new session in run-kit produces a single blank terminal window. Users who regularly work with multi-window setups (e.g., a "dev environment" with editor, server, and logs; a "monitoring stack" with htop, logs, and a dashboard; a "Claude agent on repo X" session) must manually create each window and run each command every time. This is tedious and error-prone — the same sequence of steps repeated daily.

If we don't address this, power users will continue to rely on external shell scripts or tmux session managers (tmuxinator, tmuxp) to bootstrap their environments, bypassing run-kit's session creation flow entirely. This fragments the user experience and means run-kit cannot be the single entry point for terminal orchestration.

Templates solve this by letting users define reusable environment configurations that run-kit can launch in one action — bridging the gap between "blank terminal" and "ready-to-work environment."

## What Changes

### Template Definition Format

Templates are defined in YAML files stored in `~/.rk/templates/` (user-level, gitignored). Each file defines one template:

```yaml
# ~/.rk/templates/dev-environment.yaml
name: Dev Environment
description: 3-window dev setup with editor, server, and tests
windows:
  - name: editor
    path: ~/code/myproject
    command: nvim .
  - name: server
    path: ~/code/myproject
    command: just dev
  - name: tests
    path: ~/code/myproject
    command: just test --watch
```

Template schema:
- `name` (required): Human-readable display name for the template
- `description` (optional): Brief description shown in template selection UI
- `windows` (required): Array of window definitions (at least 1)
  - `name` (optional): Window name (defaults to directory basename if omitted)
  - `path` (required): Working directory for the window (supports `~` expansion)
  - `command` (optional): Initial command to run after window creation (sent via `tmux send-keys`)

The session name is derived from the template file's `name` field, converted to a tmux-safe name using the existing `toTmuxSafeName()` logic. If a session with that name already exists, the user is prompted (or a numeric suffix is added).

### Session-Level Template Launch

Launching a template creates a new tmux session with all defined windows:

1. Create the session with the first window's `path` as the working directory
2. Rename window 0 to the first window's `name`
3. If `command` is specified for window 0, send it via `tmux send-keys`
4. For each subsequent window: create window, set `path`, optionally rename, optionally send `command`

This reuses the existing `CreateSession`, `CreateWindow`, `RenameWindow`, and `SendKeys` tmux operations — no new tmux primitives needed.

### Window-Level Template Launch

Users can also add template-defined windows to an existing session. This is a subset of the full template — it creates the windows within the current session rather than creating a new session. The UI presents this as "Add windows from template" in the command palette.

### Backend API

New endpoints:

- `GET /api/templates` — list all templates (reads `~/.rk/templates/*.yaml`)
- `POST /api/templates/launch` — launch a full session from a template
  - Body: `{ "template": "dev-environment", "sessionName": "optional-override" }`
- `POST /api/sessions/{session}/templates/launch-windows` — add template windows to an existing session
  - Body: `{ "template": "dev-environment" }`

Template discovery reads YAML files from `~/.rk/templates/` at request time (no caching — consistent with the "no database, derive from filesystem" constitution principle). The `~/.rk/` directory already exists for `tmux.conf` and `settings.yaml`.

### Frontend: Command Palette Integration

The command palette (`Cmd+K`) gains new actions:

- **"Session: New from Template"** — opens a template picker sub-view within the command palette (search/filter, arrow-key navigation, Enter to launch). On selection, launches the template and navigates to the first window of the new session.
- **"Window: Add from Template"** (only when a session is active) — same picker, but adds windows to the current session.

Templates also surface in:
- **Dashboard**: A "Templates" section or a template icon on the "New Session" card, offering one-click launch
- **Sidebar**: The session creation flow could offer "from template" as an alternative to the current blank session dialog

### Frontend: Template Picker Component

A reusable `TemplatePicker` component (modal, same structure as `CommandPalette` / `ThemeSelector`):
- Search input filters templates by name/description
- Each template row shows: name, description, window count
- Arrow-key navigation, Enter to select, Escape to dismiss
- Can be embedded in the command palette flow or opened standalone

### Template Directory Bootstrapping

`rk init-conf` (which already scaffolds `~/.rk/tmux.conf`) also creates `~/.rk/templates/` if it doesn't exist, with a single example template file commented out or a `README.md` explaining the format.

## Affected Memory

- `run-kit/architecture`: (modify) New `~/.rk/templates/` directory, new API endpoints, template discovery logic in backend
- `run-kit/ui-patterns`: (modify) New TemplatePicker component, command palette actions, dashboard template section
- `run-kit/tmux-sessions`: (modify) Template launch flow uses existing tmux operations in a new sequence

## Impact

- **Backend** (`app/backend/`): New `internal/templates/` package for YAML parsing and template discovery. New API handlers in `api/templates.go`. `TmuxOps` interface unchanged (reuses existing operations).
- **Frontend** (`app/frontend/src/`): New `TemplatePicker` component, new API client functions, command palette action additions, dashboard UI additions.
- **Config** (`~/.rk/`): New `templates/` subdirectory under the existing run-kit config directory.
- **No database impact** — templates are YAML files read at request time.
- **No tmux protocol changes** — all operations use existing `CreateSession`, `CreateWindow`, `RenameWindow`, `SendKeys`.

## Open Questions

- Should templates support a `server` field to target a specific tmux server, or always use the currently active server?
- Should there be a built-in "blank" template (single window, current directory) as the default, or keep the existing blank session flow separate?
- Should template YAML validation happen at read time (with user-facing errors) or silently skip malformed files?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Templates stored in `~/.rk/templates/` as individual YAML files | Constitution VII (convention over configuration) + existing `~/.rk/` directory pattern for tmux.conf and settings.yaml. One file per template is simplest and avoids config file bloat. | S:80 R:85 A:90 D:85 |
| 2 | Certain | Template launch reuses existing tmux operations (CreateSession, CreateWindow, RenameWindow, SendKeys) | Constitution III (wrap, don't reinvent) — no new tmux primitives needed. The existing operations compose cleanly for this use case. | S:85 R:90 A:95 D:90 |
| 3 | Certain | No database or persistent state for templates | Constitution II (no database) — templates are YAML files read from filesystem at request time. | S:90 R:95 A:95 D:95 |
| 4 | Confident | Templates surface primarily through Cmd+K command palette | Constitution V (keyboard-first) — Cmd+K is the primary discovery mechanism. Dashboard and sidebar are secondary surfaces. | S:75 R:80 A:85 D:70 |
| 5 | Confident | Session name derived from template `name` field with tmux-safe conversion | Existing `toTmuxSafeName()` pattern in `create-session-dialog.tsx`. Consistent with current session creation flow. | S:70 R:85 A:80 D:75 |
| 6 | Confident | Template schema: `name`, `description`, `windows[]` with `name`, `path`, `command` | Description provides enough detail. Schema covers the stated examples (dev env, monitoring stack, Claude agent). `path` is required per-window; `command` is optional. | S:75 R:75 A:70 D:65 |
| 7 | Confident | Template picker follows existing modal pattern (CommandPalette / ThemeSelector structure) | UI patterns memory shows consistent modal pattern across the app. Reusing the same structure maintains consistency. | S:70 R:85 A:80 D:80 |
| 8 | Tentative | Templates target the currently active server (no `server` field in template YAML) | The single-active-server model means the user has already selected their server context. Adding a `server` field adds complexity for an edge case. However, some users may want "always launch monitoring on server X." | S:55 R:65 A:55 D:50 |
<!-- assumed: no server field in templates — single-active-server model implies server context is already selected -->
| 9 | Tentative | `rk init-conf` bootstraps `~/.rk/templates/` with an example template | Consistent with existing `init-conf` behavior for tmux.conf. However, the description didn't explicitly mention bootstrapping, and an empty directory with docs might be better than an example file. | S:50 R:80 A:60 D:55 |
<!-- assumed: init-conf bootstraps templates directory — consistent with existing config scaffolding pattern -->

9 assumptions (3 certain, 4 confident, 2 tentative, 0 unresolved). Run /fab-clarify to review.
