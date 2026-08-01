# Plan: Fix Stale Welcome Drag Region Killing the Titlebar Host Switcher

**Change**: 260801-5k2m-fix-stale-welcome-drag-region
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Welcome Underlay Drag Region

#### R1: Exported no-drag blank-underlay URL constant
`app/desktop/src/strip.ts` MUST export a `BLANK_UNDERLAY_URL` constant — a `data:text/html`
URL whose document carries an element styled `-webkit-app-region:no-drag` — with a doc
comment explaining that it exists to clear the welcome page's stale draggable region
(a document with no app-region styles, like `about:blank`, never emits a
draggable-regions update, so Chromium keeps the welcome page's 28px drag band cached
on the base webContents). The constant SHALL live in `strip.ts` (the electron-free
titlebar-strip pure-logic module) so `strip.test.ts` covers it under plain `node --test`.

- **GIVEN** the compiled `dist/strip.js` module
- **WHEN** `BLANK_UNDERLAY_URL` is imported
- **THEN** it is a string starting with `data:text/html`
- **AND** it contains `-webkit-app-region:no-drag`

#### R2: `blankWelcomeUnderlay` loads the no-drag document instead of `about:blank`
`blankWelcomeUnderlay` in `app/desktop/src/main.ts` MUST load `BLANK_UNDERLAY_URL`
instead of `"about:blank"`. The welcome-page gate
(`win.webContents.getURL().startsWith(WELCOME_URL)` before loading) MUST stay unchanged.
The function's doc comment — and the nearby Host-views banner comment that references
`about:blank` — MUST be updated to name the new URL and why (`about:blank` leaves the
stale drag band cached; a main-initiated `loadURL` still bypasses the `will-navigate`
guard, so the `data:` URL needs no allowlist entry). No navigation-allowlist or other
security-surface change SHALL be made.

- **GIVEN** a window whose own webContents currently shows the welcome page
- **WHEN** `attachHostView` attaches a host view and calls `blankWelcomeUnderlay`
- **THEN** the window's webContents loads `BLANK_UNDERLAY_URL` (not `about:blank`)
- **AND** the loaded document forces Chromium to emit a draggable-regions update that
  replaces the welcome page's cached full-width drag band with a no-drag region

#### R3: node:test contract coverage
`app/desktop/src/strip.test.ts` MUST pin the constant's contract with node:test cases
mirroring the module's other constant tests: the URL is a `data:text/html` URL and
carries `-webkit-app-region:no-drag`. The desktop package's own gates
(`pnpm run compile`, then `pnpm run test`) MUST pass.

- **GIVEN** the desktop package compiled via `pnpm run compile`
- **WHEN** `pnpm run test` (node --test over dist) runs
- **THEN** the new contract tests pass alongside the existing suite

#### R4: Live manual verification (human acceptance step)
The fix cannot be e2e-tested — the bug lives in Electron window compositing, outside
the web test harness's reach — so a live manual verification on macOS is the acceptance
evidence, executed by the user (recorded later in the PR body). This plan SHALL prepare
the verification instructions (see `## Notes`); the apply stage MUST NOT attempt to
launch the Electron app or any GUI.

- **GIVEN** a registered host and the shipped fix
- **WHEN** the user runs the repro (strip dropdown → `+ Add Host…` → Cancel) and the
  predicted second path (actually adding a host)
- **THEN** the host-switcher dropdown stays clickable after both welcome→host
  transitions, the strip band outside the trigger stays draggable, and the welcome page
  itself remains draggable when shown again

### Non-Goals

- No Playwright/e2e coverage — Electron window compositing is outside the web harness by design (desktop package is node --test only).
- No IPC, store, frontend, or backend changes; no navigation-allowlist edit (main-initiated `loadURL` bypasses `will-navigate` unchanged).

### Design Decisions

#### The blank underlay carries an explicit no-drag region
**Decision**: Replace `blankWelcomeUnderlay`'s `about:blank` load with `BLANK_UNDERLAY_URL`, a `data:text/html` document whose body is styled `-webkit-app-region:no-drag` (with a viewport-height layout box so Chromium's region collection sees a non-empty annotated region).
**Why**: Chromium only emits draggable-region updates for documents that have app-region elements — `about:blank` has none, so the welcome page's full-width 28px drag band stays cached on the base webContents and swallows every click on the SPA strip's host-switcher island (no-drag exclusions subtract only within their own webContents). `blankWelcomeUnderlay` is the one seam every welcome→host transition flows through (cancel, add-and-switch, local-daemon connect), so one change covers all paths.
**Rejected**: `executeJavaScript` on the welcome page to flip its strip to no-drag before blanking — more moving parts and ordering-sensitive for the same effect. Renderer-side patching in the SPA — the SPA cannot punch through another webContents' cached region.
*Introduced by*: 260801-5k2m-fix-stale-welcome-drag-region

## Tasks

### Phase 1: Setup

- [x] T001 Install desktop package deps if `app/desktop/node_modules` is absent (`cd app/desktop && pnpm install`) so the compile/test gates can run <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 Add the exported `BLANK_UNDERLAY_URL` constant to `app/desktop/src/strip.ts` with a doc comment explaining the stale-drag-region mechanism (about:blank emits no regions update) <!-- R1 -->
- [x] T003 In `app/desktop/src/main.ts`, make `blankWelcomeUnderlay` load `BLANK_UNDERLAY_URL` (import from `./strip`), update its doc comment and the Host-views banner comment that references `about:blank` — keeping the will-navigate-bypass/no-allowlist note accurate <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Add node:test cases to `app/desktop/src/strip.test.ts` pinning the constant's contract (`data:text/html` URL, carries `-webkit-app-region:no-drag`; the data: URL also never matches the fallback-strip injection predicate) <!-- R3 -->
- [x] T005 Run the desktop package gates from `app/desktop`: `pnpm run compile` then `pnpm run test`; fix any failures <!-- R3 -->

### Phase 4: Polish

- [x] T006 [manual — deferred to user] Prepare the live macOS verification instructions (recorded in `## Notes` below for the PR body). Checked off as *prepared*; execution is a human acceptance step performed by the user on a real shell run, never by the apply agent <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `BLANK_UNDERLAY_URL` is exported from `app/desktop/src/strip.ts`, is a `data:text/html` URL carrying `-webkit-app-region:no-drag`, and its doc comment explains why `about:blank` was insufficient
- [x] A-002 R2: `blankWelcomeUnderlay` loads `BLANK_UNDERLAY_URL`; no `about:blank` load remains in the underlay path; the function and Host-views comments name the new URL and why

### Behavioral Correctness

- [x] A-003 R2: The welcome-page gate (`getURL().startsWith(WELCOME_URL)`) is unchanged, and no navigation-allowlist or other security-surface change was made (main-initiated `loadURL` bypasses `will-navigate` as before)

### Scenario Coverage

- [x] A-004 R3: `strip.test.ts` pins the constant's contract and `pnpm run compile` + `pnpm run test` pass in `app/desktop` (desktop package gates only — the change touches no frontend/backend code)

### Edge Cases & Error Handling

- [x] A-005 R1: The no-drag element owns a non-zero layout box (viewport-height), so Chromium's annotated-region collection cannot skip it and the regions update always fires

### Code Quality

- [x] A-006 Pattern consistency: the new constant/tests match `strip.ts`/`strip.test.ts` register (doc-comment density, constant grouping, test sectioning)
- [x] A-007 No unnecessary duplication: the constant is defined once in `strip.ts` and imported by `main.ts`; no second copy of the URL string anywhere

### Manual Verification (human acceptance)

- [x] A-008 R4: The manual verification instructions are prepared (in `## Notes`) for the PR body; live execution is deferred to the user — the apply agent launched no GUI

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Manual verification instructions (for the PR body — execute on macOS, deferred to user)

1. **Repro discriminator (pre-fix, optional)**: registered host → strip dropdown → `+ Add Host…` → Cancel → press-and-drag on the host name in the strip. The window moving under the drag confirms the stale-drag-region mechanism. If the window does NOT move, stop and re-diagnose — the fix is premised on this mechanism (intake What Changes §2).
2. **Cancel path (post-fix)**: strip dropdown → `+ Add Host…` → Cancel → the host-switcher dropdown must open on click.
3. **Add path (post-fix)**: first-run or menu `Hosts → Add Host…` → actually add a host → the dropdown must work immediately.
4. **Drag regions intact**: the strip band *outside* the trigger stays draggable; the welcome page itself remains draggable when shown again (welcome reloads fresh via `loadFile` and re-declares its own band).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Finalize the data URL as `<body style="min-height:100vh;margin:0;-webkit-app-region:no-drag">` — adding a viewport-height layout box (and dropping the default body margin) beyond the intake's sketch | Intake explicitly left exact content "to be finalized during apply"; Chromium collects annotated regions from layout boxes, and a zero-height body risks producing an empty/skipped region that never triggers the update — a sized box makes the regions update unconditional. Contract-test assertions (`data:text/html`, `-webkit-app-region:no-drag`) hold unchanged | S:70 R:85 A:70 D:70 |
| 2 | Certain | The manual-verification task (T006) is checked off as *prepared* (instructions recorded in `## Notes` for the PR body), with live execution deferred to the user | Dictated by the intake (§2 + Assumption 4: manual verification is the acceptance evidence, recorded in the PR body); the apply agent must not launch the Electron app | S:85 R:90 A:90 D:85 |

2 assumptions (1 certain, 1 confident, 0 tentative).
