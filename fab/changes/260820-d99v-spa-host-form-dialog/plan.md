# Plan: SPA Host Form Dialog

**Change**: 260820-d99v-spa-host-form-dialog
**Intake**: `intake.md`

## Requirements

### Frontend: Shared HostFormDialog component

#### R1: One shared Add/Edit host dialog component
The Edit Host dialog currently inlined in `app/frontend/src/components/shell-titlebar-strip.tsx` (state at ~lines 305–376, JSX at ~885–938) SHALL be extracted into a shared `app/frontend/src/components/host-form-dialog.tsx` component with two modes (`add` | `edit`, a discriminated prop union — no `as` casts). Both modes SHALL render the same field contract: Name (optional) above URL, same labels, same validation copy (`Enter a full http(s) URL, e.g. http://host:3000`), same error slot, same Cancel/primary-action button row, on the shared `Dialog` shell inside a `z-[60]` wrapper (the existing menu-stacking treatment).

- **GIVEN** the titlebar-strip host menu is open
- **WHEN** the user opens Edit (pencil / F2) on a row or Add (`+ Add Host…` footer, on a capable shell)
- **THEN** the same `HostFormDialog` component renders, differing only in mode-driven behavior (prefill, submit path, primary-button label)

#### R2: Edit mode preserves today's behavior exactly
Edit mode SHALL preserve the current Edit Host semantics byte-for-byte: prefilled name/origin from the row; save commits only the changed halves, diffed against the dialog's own prefill first and then the live row (an untouched URL field is never parsed, so a malformed stored URL cannot block a name-only save); name rides `servers:rename` with the optimistic local row update; URL rides the additive `servers:set-url`, with the URL field `disabled` plus the "URL editing needs a newer desktop app." note when the shell lacks `setUrl`; local URL validation (full http(s), reduced to origin) renders the inline error and keeps the dialog open; Enter in either field saves; failure paths keep both existing toasts (`Shell host rename failed` / `Shell host URL update failed`); close/cancel/save refocus the originating row; no connectivity ping on save.

- **GIVEN** a host row with a malformed stored URL and a shell carrying `rename` but not `setUrl`
- **WHEN** the user edits only the name and saves
- **THEN** the rename commits (optimistic update + `servers:rename`) without the URL ever being parsed, and focus returns to the row

#### R3: Add mode — ping-gated persist with welcome-flow parity
Add mode SHALL render an empty form and, on submit, first locally validate the URL (same full-http(s) check and error copy as edit mode), then call the new `servers:add-direct` invoker with the trimmed name (possibly empty) and the reduced origin. The main process pings before persisting (R5), so a ping/validation failure returned by the invoker SHALL render inline in the dialog's existing error slot and keep the dialog open for correction; while the invoke is in flight the form SHALL be busy (fields + submit disabled — the ping can take up to 5s). A blank Name auto-derives from the ping's returned hostname main-side — the welcome add form's exact behavior. On success the dialog closes (the shell has already switched the window to the new host's view).

- **GIVEN** the add dialog with a URL whose host does not answer `/api/health`
- **WHEN** the user submits
- **THEN** the invoker resolves `{ ok: false, error }`, the error renders inline in the dialog, nothing was persisted, and the dialog stays open
- **AND** submitting a healthy URL with a blank Name persists a host named by the health ping's `hostname` and switches to it

### Desktop shell: `servers:add-direct` invoker

#### R4: Preload exposes the additive `addDirect` invoker
`app/desktop/src/preload.ts` SHALL add `addDirect: (name, url) => ipcRenderer.invoke("servers:add-direct", { name, url })` to the `servers` group — additive like `setUrl`/`removeConfirmed`, so older SPAs never call it and newer SPAs feature-detect it.

- **GIVEN** a new shell with an older SPA
- **WHEN** the SPA drives the host menu
- **THEN** the extra invoker is inert (nothing calls it) and every existing channel behaves unchanged

#### R5: Main-side handler — validate, ping, persist, switch
`app/desktop/src/main.ts` SHALL register a `servers:add-direct` handler gated on `isHostsSender` (the same allowlist as every `servers:*` channel), reusing the existing `parseAddPayload` for the `{ name, url }` payload (non-conforming → `"Invalid request"`). It SHALL run `normalizeOrigin` (a rejection returns that structured error), then `pingServer(origin)` (the same probe `welcome:test-host` uses — failure returns the ping's `{ ok: false, error }` and persists nothing), then `addHost(userDataDir(), name, origin)` with `name = trimmed payload name, else the ping's hostname` (addHost's own empty-name rule falls back to the origin — the welcome chain's exact tail), and finish through `switchToHost(result.host.id)` — persist + set-active + attach view + rebuild menu, one behavior for "adding a host" everywhere.

- **GIVEN** a page loaded from a registered host origin
- **WHEN** it invokes `servers:add-direct` with a healthy URL
- **THEN** the host is validated, pinged, persisted, and switched to — identical semantics to the welcome page's test-host → add-host chain
- **AND** a sender outside the allowlist gets `{ ok: false, error: "Not allowed" }` and no state change

### Frontend: bridge narrowing and strip wiring

#### R6: `shell.ts` capability pair with a structured result
`app/frontend/src/lib/shell.ts` SHALL add `canAddShellHostDirect()` and `addShellHostDirect(name, url)` following the sibling additive-invoker pattern (separate structural narrowing; the group stays usable without it). Unlike the boolean siblings, `addShellHostDirect` SHALL resolve a structured `{ ok: true } | { ok: false; error: string }` so the dialog can render the main-side ping error inline — a plain browser, an older shell, a malformed response, and a rejected invoke all resolve `{ ok: false }` with a generic error; it never throws.

- **GIVEN** a plain browser or an older shell without `addDirect`
- **WHEN** `addShellHostDirect` is called
- **THEN** it resolves `{ ok: false, error }` without throwing, and `canAddShellHostDirect()` is `false`

#### R7: Strip wiring — capability-forked footer, shared edit path
In `shell-titlebar-strip.tsx`: the menu's `+ Add Host…` footer SHALL open `HostFormDialog` in add mode when `canAddShellHostDirect()` is true, and otherwise keep today's `addShellHost()` welcome-page swap; the footer renders when either invoker is present (unchanged gate widened to the union). The Edit pencil / F2 path SHALL open the shared component in edit mode (behavior unchanged per R2). The add dialog joins the existing menu-scoped dialog conventions: rendered inside the container (backdrop clicks never trip outside-click close), lifted `z-[60]`, counted in `dialogOpen` (key handling suspends while up), and cleared when the menu closes.

- **GIVEN** a shell carrying `addDirect`
- **WHEN** the user clicks `+ Add Host…`
- **THEN** the add-mode dialog opens in place — no page swap
- **AND** on a shell without `addDirect` the same footer performs today's `servers:add` page swap

#### R8: Version-skew matrix stays green
The change SHALL be additive on both sides: new SPA + old shell → footer falls back to the page swap and edit behaves as today; old SPA + new shell → the new channel is never invoked and all existing channels are untouched. The native `Hosts → Add Host…` menu item is NOT changed — it keeps opening the welcome page in add mode.

- **GIVEN** any pairing of {new, old} SPA × {new, old} shell
- **WHEN** the host menu's add and edit affordances are used
- **THEN** every pairing has a working add path and an unchanged edit path, with no silently dropped action

### Non-Goals

- No welcome-page changes (260820-sywl-welcome-host-hub owns restyle + host list + parity copy).
- No removal of `servers:add` / the welcome add mode — it remains the bootstrap and old-shell fallback.
- No change to the native `Hosts → Add Host…` menu item (reverse IPC from main into the SPA is out of scope).

### Design Decisions

#### add-direct persists AND switches
**Decision**: `servers:add-direct` ends in `switchToHost` — persist + set active + attach the new host's view, exactly like `welcome:add-host`.
**Why**: One consistent "adding a host" behavior everywhere; the welcome flow already set the precedent, and the shared `switchToHost` seam keeps the paths from diverging.
**Rejected**: persist-without-switch (a second behavior for the same intent; the intake's decision point resolved to parity).
*Introduced by*: 260820-d99v-spa-host-form-dialog

#### The ping lives main-side inside add-direct, not as a separate SPA test call
**Decision**: The dialog makes ONE invoke; main runs `pingServer` → `addHost` → `switchToHost` atomically and returns the ping's structured error on failure.
**Why**: The renderer stays sandboxed (no cross-origin fetch — the `welcome:test-host` rationale), and a single channel cannot land in a half-state (pinged but not persisted, or persisted unpinged).
**Rejected**: exposing a separate `servers:test-host` to the SPA and composing test→add in the dialog (two channels, a TOCTOU window between them, and more bridge surface for no user-visible gain).
*Introduced by*: 260820-d99v-spa-host-form-dialog

## Tasks

### Phase 1: Desktop shell invoker

- [x] T001 Add the `servers:add-direct` IPC handler in `app/desktop/src/main.ts`: `isHostsSender` gate, `parseAddPayload`, `normalizeOrigin`, `pingServer`, name fallback to the ping hostname, `addHost`, `switchToHost`; structured error returns at each stage <!-- R5 -->
- [x] T002 [P] Add the `addDirect` invoker to the `servers` group in `app/desktop/src/preload.ts` (and its doc comment inventory) <!-- R4 -->

### Phase 2: Frontend bridge

- [x] T003 Add `ShellServersAddDirectBridge` narrowing, `canAddShellHostDirect()`, and `addShellHostDirect(name, url): Promise<{ok: true} | {ok: false; error: string}>` to `app/frontend/src/lib/shell.ts`; cover present/absent/malformed/denied shapes in `app/frontend/src/lib/shell.test.ts` <!-- R6 -->

### Phase 3: Shared dialog component + strip wiring

- [x] T004 Create `app/frontend/src/components/host-form-dialog.tsx`: extract the Edit Host dialog (fields, validation, diff-against-prefill save, Enter-to-submit, error slot, button row, `z-[60]` wrapper) into a mode-discriminated shared component; edit mode preserves R2 behavior exactly (optimistic rename and refetch/refocus stay caller-driven via props) <!-- R1 -->
- [x] T005 Implement add mode in `host-form-dialog.tsx`: empty form, local URL validation with the shared copy, busy state during the invoke, `addShellHostDirect` submit, inline ping-error rendering, close-on-success <!-- R3 -->
- [x] T006 Wire `shell-titlebar-strip.tsx`: replace the inlined edit dialog with `HostFormDialog` (edit mode); fork the `+ Add Host…` footer on `canAddShellHostDirect()` (dialog vs today's page swap; footer gate = either capability); fold the add dialog into `dialogOpen`, menu-close cleanup, and container-scoped rendering <!-- R7 --> <!-- rework: saveEdit re-implements the URL→origin reduction that host-form-dialog.tsx's reduceOrigin owns — export the reducer from the dialog module and call it here (duplicated-logic must-fix) -->
- [x] T007 Tests: new `app/frontend/src/components/host-form-dialog.test.tsx` (both modes — edit save-diff/disabled-URL/error paths, add validation/busy/inline-error/success); update `app/frontend/src/components/shell-titlebar-strip.test.tsx` for the footer fork (with/without `addDirect`) while keeping the existing edit-flow assertions green against the shared component <!-- R1, R3, R7, R8 --> <!-- rework: shell-titlebar-strip.test.tsx:539 addDirect spy inferred Promise<{ok: boolean}> makes the {ok:false, error} mock an excess-property tsc error — widen the spy signature (tsc-gate must-fix) -->

### Phase 4: Verification

- [x] T008 Run the gates: `cd app/desktop && pnpm compile && node --test "dist/**/*.test.js"`; `cd app/frontend && npx tsc --noEmit`; scoped vitest for `shell.test.ts`, `host-form-dialog.test.tsx`, `shell-titlebar-strip.test.tsx` <!-- R8 --> <!-- rework: re-run after the two fixes — tsc gate was red at review -->

## Execution Order

- T001/T002 are independent of the frontend phases; T003 blocks T005 (the invoker wrapper is add mode's submit path); T004 blocks T005 and T006; T007 follows T006.

## Acceptance

### Functional Completeness

- [x] A-001 R1: One `host-form-dialog.tsx` component renders both the add and edit surfaces; no second host-form dialog markup remains inlined in `shell-titlebar-strip.tsx`
- [x] A-002 R4: The preload `servers` group carries `addDirect`, invoking `servers:add-direct` with `{ name, url }`
- [x] A-003 R5: The `servers:add-direct` handler validates (gate, payload, origin), pings, persists with the hostname-fallback name, and switches — and returns each failure as a structured `{ ok: false, error }` with nothing persisted
- [x] A-004 R6: `canAddShellHostDirect`/`addShellHostDirect` exist with the structured result contract and never throw
- [x] A-005 R7: The footer opens the add dialog on capable shells and keeps the page swap otherwise; Edit pencil/F2 route through the shared component

### Behavioral Correctness

- [x] A-006 R2: Edit mode's save-diff semantics, optimistic rename, setUrl gating/note, error copy, toasts, and row refocus are unchanged from the pre-extraction behavior
- [x] A-007 R3: Add mode blocks on a local URL-validation failure and renders a main-side ping failure inline while keeping the dialog open; a blank name yields a hostname-derived (or origin-fallback) host name

### Scenario Coverage

- [x] A-008 R3: A test covers the add-mode failure path (invoker resolves `{ ok: false, error }` → inline error, dialog stays open) and the success path (dialog closes)
- [x] A-009 R8: Tests cover the version-skew fork: footer without `addDirect` performs the page swap; footer with it opens the dialog

### Edge Cases & Error Handling

- [x] A-010 R2: A name-only edit on a row with a malformed stored URL commits without parsing the URL
- [x] A-011 R5: A non-allowlisted sender, a malformed payload, and a non-http(s) URL each return the correct structured error without a store write or ping

### Code Quality

- [x] A-012 Pattern consistency: the new bridge pair follows the sibling additive-invoker pattern (structural narrowing, never-throws), and the dialog follows the shared `Dialog` + menu-scoped dialog conventions
- [x] A-013 No unnecessary duplication: `parseAddPayload`, `normalizeOrigin`, `pingServer`, `addHost`, and `switchToHost` are reused — no re-implemented validation or switch tail
- [x] A-014 Type narrowing over assertions: the mode union and all bridge results are narrowed with guards, no `as` casts

### Security

- [x] A-015 R5: `servers:add-direct` is sender-gated on the shared navigation allowlist and structurally validates its payload before any use (Constitution I posture on the Node side)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The inlined Edit Host dialog markup in `shell-titlebar-strip.tsx` was already removed by this change itself; `servers:add` and the welcome add mode are deliberately retained as the bootstrap and old-shell fallback per the plan's Non-Goals.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The add dialog opens in place with the menu, joining the existing menu-scoped dialog conventions (container-rendered, `z-[60]`, `dialogOpen` suspension, cleared on menu close) rather than closing the menu first | The confirm/edit dialogs set this exact pattern in the same component; on success the shell swaps the view anyway | S:70 R:85 A:85 D:80 |
| 2 | Confident | `addShellHostDirect` breaks the sibling boolean-wrapper convention with a structured `{ok, error}` result | The intake explicitly requires inline ping errors in the dialog; a boolean cannot carry the message | S:80 R:80 A:85 D:85 |
| 3 | Confident | Name auto-derivation happens main-side inside the handler (trimmed payload name, else ping hostname, else addHost's origin fallback) | Mirrors the welcome chain where the hostname is only known after the ping, which runs main-side | S:70 R:80 A:85 D:80 |
| 4 | Confident | `hosts.ts` needs no change — `addHost`, `hostInfos`, and the store already cover add-direct | Feature detection is bridge-presence-based (like `setUrl`), not projection-based; the intake's Impact list included hosts.ts speculatively | S:60 R:85 A:85 D:75 |
| 5 | Certain | Busy state disables the whole form during the invoke | The ping can take up to 5s (HEALTH_TIMEOUT_MS); the spawn-agent dialog sets the in-flight convention | S:80 R:90 A:90 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
