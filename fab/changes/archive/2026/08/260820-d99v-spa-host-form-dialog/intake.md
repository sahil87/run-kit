# Intake: SPA Host Form Dialog

**Change**: 260820-d99v-spa-host-form-dialog
**Created**: 2026-08-20

## Origin

Conversational (`/fab-discuss` session on the desktop-shell host switcher UX). User raised:

> Issue 1: Why completely different design language between the two [Add Host and Edit Host dialogs]
> Issue 2: Why even have two different dialog boxes for these — can edit / add be the same components?

Analysis: Add Host is the Electron shell's welcome page (`app/desktop/src/welcome/`, standalone hand-styled dark-only HTML — the strip's `+ Add Host…` does a full page swap to `welcome?mode=add`); Edit Host is a themed React dialog inside the SPA (`shell-titlebar-strip.tsx`). The welcome page cannot be deleted (it is the zero-hosts / all-hosts-down bootstrap surface, and on win32 the only path to host #1), so full unification is impossible — but the user accepted the two-surface model with the requirement that both follow **the same design language and a consistent form contract**. This change delivers the SPA half: a shared Add/Edit dialog so the everyday add flow stops page-swapping. The welcome-page half is 260820-sywl-welcome-host-hub.

## Why

1. **Pain point**: adding a host while fully connected kicks the user out of the SPA into a full-page context switch (`welcome?mode=add`) for what is a two-field form — and that form looks nothing like the themed Edit Host dialog, though both edit the same entity with the same fields.
2. **If unfixed**: the most common add path (user already connected, adding a second host) stays jarring, and the Add/Edit inconsistency reads as two different products.
3. **Approach**: one shared `HostFormDialog` React component in add/edit modes, plus a new capability-gated shell invoker `servers:add-direct` that performs ping + persist over IPC. Older shells without the invoker keep today's page-swap path — the strip's established capability-degradation idiom.

## What Changes

### 1. Shared `HostFormDialog` component (SPA)

Extract the Edit Host dialog currently inlined in `app/frontend/src/components/shell-titlebar-strip.tsx` (state at lines ~243–321, JSX near the confirm dialog) into a shared component following the project dialog conventions (see `run-kit/ui/dialogs-and-state` memory), with two modes:

- **Fields (both modes)**: Name (optional) + URL — same labels, same validation copy (`Enter a full http(s) URL, e.g. http://host:3000`), same layout.
- **Edit mode** (existing behavior preserved): prefilled from the row; name saves via `servers:rename`; URL via additive `servers:set-url` (URL field enabled only when the shell exposes `setUrl` — existing gating). No connectivity ping on save (a temporarily-down host must stay editable).
- **Add mode** (new): empty form; on submit, calls the new `servers:add-direct` invoker which pings the URL first (the welcome flow's `welcome:test-host` semantics) and persists on success; a blank Name auto-derives from the ping's returned hostname — byte-for-byte the welcome add form's behavior. Ping/validation errors render inline in the dialog (same error slot as edit mode).

### 2. New shell invoker `servers:add-direct` (desktop)

In `app/desktop/src` (preload bridge + main): a `servers` group invoker that accepts `(name, url)`, reuses the existing main-side test-host + add-host path (`welcome:test-host` / `welcome:add-host` handlers in `main.ts` / `hosts.ts` — same validation, same persist, same set-active-and-switch tail), and returns structured success/error so the dialog can render ping failures inline. Additive and capability-projected like `setUrl`/`removeConfirmed` — the SPA feature-detects it.

Decision point: whether add-direct switches to the new host on success. The welcome add flow persists + sets active; the dialog SHOULD match (persist + switch) for consistency — one behavior for "adding a host" everywhere.

### 3. Strip wiring

- The strip menu's `+ Add Host…` footer opens `HostFormDialog` in add mode **when `servers:add-direct` exists**; otherwise it keeps today's `servers:add` welcome-page swap. The footer renders if either invoker is present.
- The Edit pencil / F2 path switches to the shared component (behavior unchanged).
- The native `Hosts → Add Host…` menu item is NOT changed in this change — it keeps opening the welcome page in add mode (main-process code opening an SPA dialog would need reverse IPC into the page; out of scope).

### Non-goals

- No welcome-page changes (260820-sywl-welcome-host-hub owns restyle + host list + parity copy).
- No removal of `servers:add` / the welcome add mode — it remains the bootstrap and old-shell fallback.

## Affected Memory

- `run-kit/ui/top-bar`: (modify) strip host menu — Add Host opens the shared dialog when `servers:add-direct` exists; Edit uses the same component
- `run-kit/ui/dialogs-and-state`: (modify) new shared HostFormDialog (add/edit modes, field contract)
- `run-kit/desktop-shell`: (modify) `servers:add-direct` invoker — ping + persist + switch, capability projection

## Impact

- `app/frontend/src/components/shell-titlebar-strip.tsx` + new `host-form-dialog.tsx` (+ tests)
- `app/frontend/src/lib/shell.ts` — bridge narrowing for the new invoker
- `app/desktop/src/preload.ts`, `main.ts`, `hosts.ts` (+ node-test siblings) — invoker + capability projection
- Version-skew matrix to keep green: new SPA + old shell (footer falls back to page swap), old SPA + new shell (invoker unused)

## Open Questions

- (none — surface split, form contract, and fallback behavior were decided in the discussion)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One shared HostFormDialog with add/edit modes; fields Name (optional) + URL with identical validation copy | Discussed — the user's explicit consistency requirement | S:95 R:85 A:90 D:90 |
| 2 | Certain | New additive capability-gated invoker `servers:add-direct` (ping + persist); old shells keep the welcome page swap | Discussed — option 2 accepted; matches the strip's established degradation idiom | S:90 R:80 A:90 D:85 |
| 3 | Confident | Add mode pings + auto-derives blank name from hostname; edit mode keeps no-ping saves | Parity with the welcome add flow on add; editing a down host must not be blocked — inferred, not explicitly discussed | S:65 R:80 A:85 D:75 |
| 4 | Confident | add-direct persists AND switches to the new host (welcome-flow parity) | One consistent "add" behavior everywhere; easily flipped if unwanted | S:60 R:85 A:80 D:70 |
| 5 | Confident | Native `Hosts → Add Host…` menu item unchanged (still welcome page) | Reverse IPC from main into the SPA is out of scope; menu-bar adds are rare; revisitable | S:55 R:85 A:80 D:70 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
