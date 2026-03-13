# Tasks: xterm Clipboard & Addons

**Change**: 260313-dr60-xterm-clipboard-addons
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Install `@xterm/addon-clipboard` — `cd app/frontend && pnpm add @xterm/addon-clipboard`
- [x] T002 [P] Install `@xterm/addon-webgl` — `cd app/frontend && pnpm add @xterm/addon-webgl`

## Phase 2: Core Implementation

- [x] T003 Add `attachCustomKeyEventHandler` for Cmd+C/Ctrl+C selection-aware copy in `app/frontend/src/components/terminal-client.tsx` — intercept `keydown` events where `(metaKey || ctrlKey) && key === 'c'`, check `terminal.hasSelection()`, copy via `navigator.clipboard.writeText(terminal.getSelection())`, return `false` to suppress SIGINT. Return `true` for all other cases.
- [x] T004 Load `ClipboardAddon` via dynamic import in `init()` after `fitAddon.fit()` in `app/frontend/src/components/terminal-client.tsx` — `const { ClipboardAddon } = await import("@xterm/addon-clipboard"); terminal.loadAddon(new ClipboardAddon());`
- [x] T005 [P] Activate `WebLinksAddon` via dynamic import in `init()` after ClipboardAddon in `app/frontend/src/components/terminal-client.tsx` — `const { WebLinksAddon } = await import("@xterm/addon-web-links"); terminal.loadAddon(new WebLinksAddon());`
- [x] T006 [P] Enable `WebglAddon` via dynamic import in `init()` as last addon in `app/frontend/src/components/terminal-client.tsx` — wrap in try/catch, silent fallback on failure

## Phase 3: Verification

- [x] T007 Run type check — `cd app/frontend && npx tsc --noEmit`
- [x] T008 Run frontend tests — `cd app/frontend && npx vitest run`
- [x] T009 Run production build — `cd app/frontend && npx vite build`

---

## Execution Order

- T001 and T002 are parallel (independent package installs)
- T003, T004 depend on T001 (ClipboardAddon import needs the package)
- T005 has no install dependency (web-links already in package.json)
- T006 depends on T002 (WebglAddon import needs the package)
- T007-T009 depend on all prior tasks
