# Plan: Desktop shell terminal links open externally

**Change**: 260730-e9lz-shell-terminal-links-external
**Intake**: `intake.md`

## Requirements

### Frontend: WebLinksAddon explicit handler

#### R1: WebLinksAddon carries an explicit window.open handler
`app/frontend/src/components/terminal-client.tsx` MUST construct `WebLinksAddon` with an explicit activation handler that calls `window.open(uri, "_blank", "noopener,noreferrer")` — matching the codebase's universal `window.open` idiom (`app.tsx:2040`, `app.tsx:2103`, `board-page.tsx:673`). The handler-less default (which opens `about:blank` then assigns `location.href`) MUST NOT remain.

- **GIVEN** a terminal rendering a URL in its output
- **WHEN** the user clicks the link region
- **THEN** the addon handler calls `window.open(uri, "_blank", "noopener,noreferrer")` with the real URI
- **AND** in the desktop shell, `setWindowOpenHandler` therefore receives the real URL instead of `about:blank`

### Desktop Shell: all-external window-open policy

#### R2: All new-window intents open externally
`app/desktop/src/main.ts` `setWindowOpenHandler` MUST be collapsed to: http(s) URL → `shell.openExternal(url)`, everything else → nothing; the return is always `{ action: "deny" }`. The registered-origin in-window `contents.loadURL(url)` branch MUST be removed (it hijacks the current page rather than opening a new surface, and no code depends on it). The http(s)-only gate before `shell.openExternal` MUST be preserved (arbitrary schemes like `file:`/`smb:` to `openExternal` are a known injection vector — Constitution I).

- **GIVEN** the shell showing a registered rk server
- **WHEN** a page requests a new window for any http(s) URL — including a registered-origin URL
- **THEN** the URL opens in the system browser via `shell.openExternal` and the window-open is denied
- **GIVEN** a new-window intent for a non-http(s) URL (`about:blank`, `file:///…`, `smb://…`)
- **WHEN** `setWindowOpenHandler` runs
- **THEN** nothing is opened and the intent is denied

#### R3: Policy decision is a pure, electron-free, node:test-covered function
The window-open policy decision MUST live in a small electron-free module beside `servers.ts` (new `app/desktop/src/window-open.ts`) as an exported pure function `windowOpenAction(url: string): "open-external" | "deny"`, consumed by `main.ts`. It MUST be covered by a colocated `node --test` suite (`window-open.test.ts`) over compiled output, per the package convention (`servers.ts`/`servers.test.ts`): `main.ts` imports `electron` at module top and cannot be imported under `node --test`.

- **GIVEN** the compiled `dist/window-open.test.js`
- **WHEN** `pnpm run test` runs in `app/desktop`
- **THEN** the suite asserts: `https://…` → `"open-external"`, `http://…` → `"open-external"`, `about:blank` → `"deny"`, `file:///…` → `"deny"`, `smb://…` → `"deny"`, and a registered-origin-shaped http URL → `"open-external"` (proving the in-window branch is gone — the function takes no origin set at all)

#### R4: Navigation guard unchanged; no dead code
The `will-navigate`/`will-redirect` guard (`main.ts` `guardNavigation` / `isAllowedNavigation`) MUST remain behaviorally unchanged — it carries in-window SPA navigation on registered origins and blocks server-issued redirect escapes; only new-window intents change. `originOf` and `registeredOrigins` MUST remain in use by `isAllowedNavigation` (no dead code may result from removing the in-window branch).

- **GIVEN** an in-window navigation or server-issued redirect to a non-registered origin
- **WHEN** `will-navigate`/`will-redirect` fires
- **THEN** the navigation is prevented and an http(s) target is handed to the system browser, exactly as before

### Non-Goals

- No new Playwright e2e — xterm renders links on a canvas; link-region clicks are not reliably automatable, and the changed behavior is a `window.open` call fully verifiable at unit level.
- No dependency changes — `@xterm/addon-web-links` stays at `^0.12.0`; app/desktop stays at exactly three devDependencies.
- No backend, API, or route changes.

### Design Decisions

#### Single isHttpUrl definition relocated into the policy module
**Decision**: Move `isHttpUrl` from `main.ts` into the new `window-open.ts` module and have `main.ts` import it (used by both `windowOpenAction` internally and `guardNavigation`).
**Why**: The policy function needs the http(s) gate, `guardNavigation` keeps using it, and duplicating a security-relevant predicate across two files invites drift (code-quality anti-pattern: duplicating existing utilities).
**Rejected**: Keeping `isHttpUrl` private in `main.ts` and re-implementing the check inside `windowOpenAction` — two copies of the same injection-vector gate.
*Introduced by*: 260730-e9lz-shell-terminal-links-external

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Replace the handler-less `new WebLinksAddon()` at `app/frontend/src/components/terminal-client.tsx:280` with `new WebLinksAddon((_event, uri) => { window.open(uri, "_blank", "noopener,noreferrer"); })` <!-- R1 -->
- [x] T002 [P] Add a describe block to `app/frontend/src/components/terminal-client.test.tsx` asserting `WebLinksAddon` is constructed **with** a handler function (the existing `vi.fn()` mock at :124 already captures ctor args) and that invoking the captured handler with a URI calls `window.open(uri, "_blank", "noopener,noreferrer")` (spy on `window.open`) <!-- R1 -->
- [x] T003 [P] Create `app/desktop/src/window-open.ts`: electron-free module exporting `isHttpUrl(url: string): boolean` (moved from `main.ts`) and `windowOpenAction(url: string): "open-external" | "deny"` (http(s) → open-external, else deny) <!-- R3 -->
- [x] T004 In `app/desktop/src/main.ts`: import `isHttpUrl`/`windowOpenAction` from `./window-open`, delete the local `isHttpUrl`, collapse `setWindowOpenHandler` to `if (windowOpenAction(url) === "open-external") void shell.openExternal(url); return { action: "deny" };`, and update the surrounding comment (new windows always denied; http(s) → system browser; no in-window branch). `guardNavigation`, `isAllowedNavigation`, `originOf`, `registeredOrigins` stay unchanged <!-- R2, R4 -->
- [x] T005 [P] Create `app/desktop/src/window-open.test.ts` (node:test, per `servers.test.ts` convention): `https://…` → external, `http://…` → external, `about:blank` → deny, `file:///…` → deny, `smb://…` → deny, and a registered-origin-shaped http URL → external <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Run verification gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `cd app/desktop && pnpm run compile && pnpm run test`; fix any failures <!-- R1, R2, R3, R4 -->

## Execution Order

- T003 blocks T004 and T005 (module must exist before main.ts imports it and the suite tests it)
- T001/T002 are independent of T003–T005
- T006 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `terminal-client.tsx` constructs `WebLinksAddon` with an explicit handler calling `window.open(uri, "_blank", "noopener,noreferrer")`; no handler-less construction remains
- [x] A-002 R2: `setWindowOpenHandler` opens http(s) URLs via `shell.openExternal` and always returns `{ action: "deny" }`; no `contents.loadURL` call remains inside it
- [x] A-003 R3: `windowOpenAction` exists as an exported pure function in electron-free `app/desktop/src/window-open.ts` and `main.ts` consumes it

### Behavioral Correctness

- [x] A-004 R2: A registered-origin http URL arriving as a new-window intent opens externally (the in-window branch is gone), proven by the node:test case

### Removal Verification

- [x] A-005 R2: The registered-origin in-window `contents.loadURL(url)` branch is removed with no dead code left behind — `originOf` and `registeredOrigins` remain in use by `isAllowedNavigation`

### Scenario Coverage

- [x] A-006 R1: `terminal-client.test.tsx` asserts the addon is constructed with a handler and that the handler's invocation calls `window.open(uri, "_blank", "noopener,noreferrer")`
- [x] A-007 R3: `window-open.test.ts` covers the full scheme matrix (https/http → external; about:blank, file, smb → deny; registered-origin-shaped http → external) and passes under `pnpm run test`

### Edge Cases & Error Handling

- [x] A-008 R4: `will-navigate`/`will-redirect` guard behavior is unchanged (in-window SPA navigation on registered origins still allowed; blocked http(s) targets still handed to the system browser)

### Code Quality

- [x] A-009 Pattern consistency: the frontend handler matches the codebase's `window.open(url, "_blank", "noopener,noreferrer")` idiom; the desktop module/test mirror the `servers.ts`/`servers.test.ts` electron-free node:test convention
- [x] A-010 No unnecessary duplication: `isHttpUrl` has exactly one definition (in `window-open.ts`), imported by `main.ts`

### Security

- [x] A-011 R2: The http(s)-only gate before `shell.openExternal` is preserved — non-http(s) schemes (`file:`, `smb:`) never reach `openExternal`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the in-window `contents.loadURL` branch this change made redundant was already deleted during apply, and both survivors of that removal (`originOf`, `registeredOrigins` in `app/desktop/src/main.ts:63,72`) remain in use by `isAllowedNavigation` (`main.ts:81-84`), which the change leaves byte-identical. The relocated `isHttpUrl` has exactly one definition (`app/desktop/src/window-open.ts:19`) and two live call sites (`main.ts:336` via `windowOpenAction`, `main.ts:348` directly).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New module named `app/desktop/src/window-open.ts`, exporting `windowOpenAction` plus the relocated `isHttpUrl` (single definition, imported by `main.ts`) | Intake names the function and placement ("beside `servers.ts`") but not the filename; relocating `isHttpUrl` avoids duplicating a security predicate the policy needs | S:70 R:90 A:85 D:75 |
| 2 | Certain | The existing `WebLinksAddon` `vi.fn()` mock needs no reshaping — constructor args are already captured; the test reads `mock.calls[0][0]` | Verified in `terminal-client.test.tsx:124` — `vi.fn()` records call args by default; intake's "extend the mock" is satisfied by assertions alone | S:85 R:95 A:95 D:90 |

2 assumptions (1 certain, 1 confident, 0 tentative).
