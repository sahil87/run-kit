# Intake: Automatic Safe-Name Conversion at Naming Entry Points

**Change**: 260722-ln4n-auto-safe-name-conversion
**Created**: 2026-07-22

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a synthesized user-conversation description. The user explicitly confirmed the six design decisions recorded below during that discussion; no questions were asked at intake time (deferred-Unresolved contract — none were needed, see `## Assumptions`).

> Feature: automatic conversion of user-typed names to safe/canonical forms across all naming entry points (sessions, windows, servers). When a user types "My problem" while creating or renaming a session/window, run-kit today either passes it through (spaces are legal in the backend's `ValidateName`) or rejects it with an error (server names). The user wants automatic conversion instead: "My problem" → "My_problem", applied live at input time, per-name-kind charset, with the backend tightened so the charset is a real contract.

## Why

1. **The pain point**: run-kit's name validation is inconsistent and leaky. `ValidateName` (sessions + windows, `app/backend/internal/validate/validate.go`) rejects shell metacharacters, colons, and periods — but **allows spaces**. A session literally named `My problem` gets created, and then bites three downstream consumers: tmux CLI targeting (space-splitting in ad-hoc commands), session-group naming, and the `/$server/$window` URL routes. Server names take the opposite posture — strict `^[a-zA-Z0-9_-]+$` — so a typed space there produces a hard rejection error instead. Neither experience is what the user wants: typing a natural name should *just work*, converted to the safe form.

2. **The consequence of not fixing**: users keep creating spacey sessions that misbehave in routing and tmux targeting, or keep hitting opaque validation errors on server creation. The existing `toTmuxSafeName()` conversion helps only path-derived name *suggestions* — anything the user actually types in a name field is sent as-is (rename flows do only `trim()`), so the one place conversion exists doesn't cover the primary input path.

3. **Why this approach**: automatic, *live*, per-kind conversion at every naming entry point (frontend), plus a *tightened* reject-only backend. Conversion in the UI gives the "it just works" experience and WYSIWYG (the user watches "My problem" become "My_problem" as they type, so the optimistic-update name is identical to the committed name). The backend stays reject-only — per constitution §I it is the security boundary, and silently rewriting names server-side would desynchronize the client's view of what got created — but it tightens (`ValidateName` rejects spaces on NEW names) so the charset is the real contract, not just UI steering. Alternatives rejected in discussion: backend-side conversion (breaks WYSIWYG and optimistic naming), submit-time silent conversion (user commits a name they never saw), and keeping reject-only frontend errors (the current server-name UX, explicitly what the user wants to move away from).

## What Changes

### 1. Shared frontend name-transform module — `app/frontend/src/lib/names.ts` (new)

Promote `toTmuxSafeName()` out of `app/frontend/src/components/create-session-dialog.tsx:24` into a new shared module `app/frontend/src/lib/names.ts` (the established home for shared pure logic — see `src/lib/*.ts` + colocated `*.test.ts` pattern). One canonical transform per name kind:

- **`toSafeSessionName(raw)`** — the current `toTmuxSafeName` rule *plus spaces*: converts spaces, hyphens, colons, periods, and every char in the backend forbidden set (`; & | ` + backtick + `$ ( ) { } [ ] < > ! # * ?` + control chars `\n \r \t`) to `_`; collapses `_` runs; preserves case ("My problem" → "My_problem", not "my_problem"); caps at 128 chars (backend `MaxNameLength`). The hyphen→`_` rule is **session-specific** — it exists to avoid collisions with session-group naming.
- **`toSafeWindowName(raw)`** — same rule but **keeps hyphens** (user-confirmed divergence): window names like `riff-foo` use hyphens legitimately, and the group-collision rationale doesn't apply to windows.
- **`toSafeServerName(raw)`** — stricter: anything outside `[a-zA-Z0-9_-]` converts to `_` (matches backend `ValidateServerName`'s `^[a-zA-Z0-9_-]+$`); collapses `_` runs; caps at 64 chars (`MaxServerNameLength`).
- **`toSafeWorktreeName(raw)`** — the window rule plus `ValidateWorktreeName`'s extra constraints: `/` converts to `_`, no leading hyphen (a leading `-` is dropped/converted), spaces already convert via the base rule.

`deriveNameFromPath()` (path-derived suggestions) keeps its current behavior, now calling the session transform from the shared module. Existing behavior of converting unsafe chars **to `_`** (not stripping them) is retained for the whole forbidden set, so consecutive converted chars collapse to one `_` — matching the existing `toTmuxSafeName` shape.

Each transform is a pure function with Vitest coverage in `app/frontend/src/lib/names.test.ts`.

### 2. Live in-input conversion at every naming entry point

The transform is applied **in the input's `onChange`, as the user types** — press space, an underscore appears. Not silently at submit: the user sees exactly the name that will exist, and the optimistic-update name (the window-rename store stamps the typed name before the API responds) is identical to the committed name. Verified entry-point inventory (all currently do raw `setState` / `trim()`-only):

| Surface | File | Transform |
|---------|------|-----------|
| Create-session dialog typed-name field (session mode) | `src/components/create-session-dialog.tsx` (`setName`) | session |
| Create-window mode of the same dialog | same file, `mode === "window"` | window |
| Session rename dialog | input at `src/app.tsx` (~line 2795), state in `src/hooks/use-dialog-state.ts` | session |
| Sidebar inline session rename | `src/components/sidebar/index.tsx` (`editingSessionName`) | session |
| Top-bar `WindowHeading` inline rename (also serves the palette's "Window: Rename" via CustomEvent — `top-bar.tsx:1471`, registered at `app.tsx:1783`) | `src/components/top-bar.tsx` (input ~line 1512) | window |
| Sidebar inline window rename (commits via shared `use-window-rename.ts`) | `src/components/sidebar/index.tsx` (`editingName`) | window |
| Server-name input | `src/components/host-overview-page.tsx` (input ~line 473 → `createServer`) | server |
| Riff/spawn dialog worktree-name field | `src/components/spawn-agent-dialog.tsx` (~line 232) | worktree |

Live-typing edge handling: pure charset conversion is 1:1 (caret position is stable); the length-changing pieces are handled so the transform never fights the user mid-word — leading unsafe chars are dropped as typed (a space pressed in an empty field produces nothing), `_` runs collapse live, and a *trailing* `_` remains visible while typing and is trimmed at commit/submit (the one minimal deviation from strict WYSIWYG, since trimming it live would make "My " + "p" become "Myp").
<!-- assumed: trailing-underscore handling — keep it visible during typing, trim at commit; trimming live would delete the separator the user just typed and break mid-word entry -->

### 3. Backend: `ValidateName` tightens for NEW names; existing-name lookups stay permissive

Backend remains **reject-only** (no server-side conversion — constitution §I, validation before subprocess, backend is the security boundary), but the charset tightens so it is the real contract:

- Add a tightened new-name rule (working shape: `ValidateNewName(name, label)` layering "no spaces" over `ValidateName`; exact factoring decided at plan time) and apply it at every call site where the value names a **to-be-created or to-be-renamed-to** entity: session create (`api/sessions.go:31`), session rename new-name (`api/sessions.go:73`), window create name (`api/windows.go:40`), window rename name (`api/windows.go:175`).
- **Current/old-name lookups stay on the permissive `ValidateName`** — sessions/windows created outside run-kit (raw `tmux rename-session`) can still carry spaces, and rename/kill/upload targeting an existing spacey name must keep working: `api/sessions.go:60,88,166,188`, `api/windows.go:19`, `api/windows.go:330` (move `TargetSession` — an existing session), `api/upload.go:23`, `api/riff.go:224`. `api/riff.go:123` (`body.Session`) is classified new-vs-existing at plan time from the handler's semantics.
- `ValidateServerName` is already strict — unchanged. `ValidateWorktreeName` already rejects spaces — unchanged (its own space rule becomes redundant if rebased on the tightened rule; keep it explicit either way).
- Backend **keeps allowing hyphens in session names**: internal sessions (`_rk-pin-*`, `rk-test-e2e`, group names) rely on hyphens; the session hyphen→`_` rule is UI-only steering, deliberately NOT a backend rejection.
- Go table tests in `app/backend/internal/validate/validate_test.go` for the tightened/added validator (space rejection, boundary cases, existing-name permissiveness), plus handler-level coverage where api tests exist.

### 4. Tests and companion docs

- **Vitest**: `names.test.ts` table-style cases per transform ("My problem" → "My_problem", hyphen divergence session vs window, case preservation, collapse/trim, length caps, forbidden-set conversion); component-level input-behavior tests where the surfaces already have colocated tests.
- **Go**: table tests for the new/tightened validators.
- **Playwright**: existing e2e specs assert on chrome rename flows (`tests/e2e/window-heading.spec.ts` — click-to-rename heading, inline input commit; also rename touchpoints in `sidebar-keyboard-nav`, `sidebar-window-sync`, `new-window-unnamed`, `sync-latency`, `echo-latency`). Grep/verify these against the new live-conversion behavior; extend `window-heading.spec.ts` (or add a sibling spec) with a typed-space → underscore live-conversion assertion. Per constitution **Test Companion Docs**, any `.spec.ts` change ships with its sibling `.spec.md` update in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — naming entry points now apply live per-kind safe-name conversion (shared `src/lib/names.ts` transforms; WYSIWYG typing behavior across create/rename dialogs, inline renames, server input, worktree field)
- `run-kit/tmux-sessions`: (modify) — session/window name charset contract: tightened new-name validation (no spaces), permissive existing-name lookups, session-vs-window hyphen divergence
- `run-kit/architecture`: (modify) — validate package: new-name vs existing-name rule split in the REST API layer

## Impact

- **Backend**: `app/backend/internal/validate/validate.go` (+ `validate_test.go`); call-site updates in `app/backend/api/sessions.go`, `app/backend/api/windows.go`, `app/backend/api/riff.go` (classification only), `app/backend/api/upload.go` (stays permissive — verify only).
- **Frontend**: new `app/frontend/src/lib/names.ts` + `names.test.ts`; `src/components/create-session-dialog.tsx` (transform promotion + typed-field wiring); `src/app.tsx` (session-rename dialog input, palette registration untouched); `src/hooks/use-dialog-state.ts` (rename state seam if conversion lives there); `src/components/sidebar/index.tsx` (two inline renames); `src/components/top-bar.tsx` (WindowHeading input); `src/components/host-overview-page.tsx` (server input); `src/components/spawn-agent-dialog.tsx` (worktree field). `src/hooks/use-window-rename.ts` unchanged in contract (callers own name hygiene per its doc comment) but its callers now pass converted names.
- **E2E**: `app/frontend/tests/e2e/window-heading.spec.ts` (+ `.spec.md`) and any rename-adjacent spec whose assertions the live conversion touches.
- **No API surface change**: same endpoints, same request shapes; only accepted-charset semantics tighten for new names. No routes added (constitution §IV). Uniform POST unchanged (§IX).
- **Compatibility caveat (user-accepted)**: pre-existing spacey names created outside run-kit remain operable (lookups permissive) but can no longer be the *target* of a run-kit create/rename.

## Open Questions

- None — all high-blast-radius decisions were explicitly confirmed in the originating discussion; remaining sub-decisions are graded in `## Assumptions` (no Unresolved rows were deferred).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | One canonical transform per name kind in one shared frontend module (`src/lib/names.ts`), promoting `toTmuxSafeName` out of `create-session-dialog.tsx` | Explicit user decision 1; `src/lib/` is the established shared-pure-logic home | S:90 R:85 A:95 D:95 |
| 2 | Certain | Windows keep hyphens; sessions convert hyphens→`_` | Explicit user decision 2; hyphen rule is session-group-specific, `riff-*` windows use hyphens legitimately | S:95 R:80 A:90 D:95 |
| 3 | Certain | Preserve case ("My problem" → "My_problem", not lowercased) | Explicit user decision 3 | S:95 R:90 A:95 D:100 |
| 4 | Certain | Convert live in the input as the user types, not silently at submit | Explicit user decision 4; keeps optimistic-update name identical to committed name | S:90 R:70 A:90 D:90 |
| 5 | Certain | Apply at every naming entry point (create dialog both modes, session rename dialog + sidebar inline, window inline renames incl. palette path, server input, worktree field) | Explicit user decision 5; inventory verified against the codebase in this intake | S:85 R:75 A:90 D:90 |
| 6 | Certain | Backend stays reject-only but tightens: NEW names reject spaces; existing-name lookups stay permissive so pre-existing spacey names remain operable | Explicit user decision 6 including the accepted caveat | S:90 R:70 A:85 D:90 |
| 7 | Confident | Unsafe/forbidden chars convert to `_` (then runs collapse) rather than being stripped | Matches existing `toTmuxSafeName` shape; stripping would silently shorten names and lose word boundaries | S:55 R:85 A:75 D:65 |
| 8 | Confident | Backend factoring: keep permissive `ValidateName` for existing-name lookups; add a tightened variant (working name `ValidateNewName`) at create/rename-target call sites | Smallest-diff shape honoring decision 6; exact function name/factoring is plan-time detail | S:60 R:75 A:80 D:70 |
| 9 | Confident | Backend keeps allowing hyphens in session names; session hyphen→`_` is UI-only steering | Internal sessions (`_rk-pin-*`, `rk-test-e2e`, group names) carry hyphens; rejecting them would break run-kit itself | S:55 R:70 A:85 D:75 |
| 10 | Confident | Transforms cap length live at backend maxima (128 session/window, 64 server) | Backend constants are the contract; live cap preserves WYSIWYG at the boundary | S:45 R:85 A:80 D:75 |
| 11 | Confident | Empty-after-conversion input (e.g. only unsafe chars typed) falls through to the existing empty-name submit guards — no new error surface | All surfaces already guard `trim() === ""` before committing | S:50 R:80 A:80 D:75 |
| 12 | Confident | `api/riff.go:123` (`body.Session`) new-vs-existing classification resolved at plan time from handler semantics; worktree-name backend rule (`ValidateWorktreeName`) unchanged | Codebase answers this deterministically; no user preference involved | S:50 R:75 A:75 D:70 |
| 13 | Tentative | Live-typing edges: leading unsafe chars dropped as typed; trailing `_` stays visible while typing and is trimmed at commit (minimal WYSIWYG deviation at the tail) | Trimming the trailing `_` live would delete the just-typed separator and break mid-word entry; commit-trim vs keep-trailing are both defensible — easily revisited | S:35 R:70 A:40 D:35 |

13 assumptions (6 certain, 6 confident, 1 tentative, 0 unresolved).
