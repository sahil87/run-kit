# Intake: Identity Title Bars on Sidebar Row Hover Popups

**Change**: 260815-xb77-row-popup-identity-titlebars
**Created**: 2026-08-15

## Origin

Synthesized from a `/fab-discuss` design session (2026-08-15) with iterated visual mocks, dispatched promptless via `/fab-proceed`. The user observed that the window-row hover flyout's header is the status label ("PR-ready — parked") — **state, not identity** — and wanted a proper semantic title that also teaches the canonical tmux vocabulary for referring to the row. The idea was then extended to session and server rows so all three sidebar row types share one popup grammar.

> Feature: identity title bars on sidebar row hover popups (window flyout + new session/server tips). The window row flyout card gets an identity title line `Window @31 · pane %425 · 2 panes` rendered as an inset title bar (treatment A); the fork/docs icon cluster moves up to ride the bar; the status label demotes to the first body line. The same title-bar grammar extends to two new hover tips: session rows (`Session <full name>` / `$4 · 3 windows · ~/code/sahil87/run-kit`) and server rows (`Server <name>` / `tmux -L default · 6 sessions`).

The approved visual mock is copied into this change folder as **`reference-mock.html`** — it is the **authoritative rendering**: section 1's **treatment A** card for the window flyout, **section 2** for the session tip, **section 3** for the server tip.

Key decisions from the discussion (in order, all user-approved):

1. **Title content = "alt B"**: `Window @31 · pane %425 · 2 panes` — tmux window id (`@N`), the ACTIVE pane's id (`%N`), and pane count. Chosen explicitly over count-only (`Window @31 · 2 panes`) and pane-position (`Window @31 · pane 1/2`) variants, because it teaches the full tmux target vocabulary: `$N` session / `@N` window / `%N` pane are the handles users paste into tmux commands (`send-keys -t %425`). (The user initially proposed "Window %425"; corrected during discussion — `%N` is a PANE id, `@N` is the window id. The title teaches the correct sigils.)
2. **Title treatment = "A · inset title bar"**: a full-bleed darker strip (`bg-inset` token) across the card top, bottom border (`--color-border`), rounded into the card's top corners. The fork-conversation + docs info icon cluster MOVES UP from the status-label line to ride the title bar's right edge. The status label (from `dotLabel`) is demoted to the first body line below the bar. The floating-ui arrow notch, when it lands on the title band, takes the inset fill so it reads as one shape.
3. **Rejected treatments** (mocked and compared side by side — see sections A–D in `reference-mock.html`): **B** hairline divider (too quiet), **C** tmux pane-border flanking rules (rules barely register next to the icon cluster), **D** bracket heading `[ … ]` (borrows the SectionHeading bracket idiom whose meaning is "section heading with hover typed-sweep" — dilutes it).
4. **Chrome consistency over tier-differentiated chrome**: the same title-bar grammar extends to session and server row tips. Popup = title bar (identity) + body (facts) across all three row types. The weight distinction survives in the BODY, not the chrome: session/server bodies are one plain-text line, no icons, no links, no registers.
5. **Session tip**: title `Session <full untruncated name>`; body `$4 · 3 windows · ~/code/sahil87/run-kit` — tmux session id (`$N`), window count, session root path. The full name has standalone value because sidebar session names truncate.
6. **Server tip**: title `Server <name>`; body `tmux -L default · 6 sessions` — the socket flag is the exact CLI handle and is invisible anywhere else in the UI; it is what earns the popup (name alone would restate the row).

## Why

1. **Pain point**: the window flyout card's header is currently the status-dot label (`dotLabel(win, state)` — e.g. "PR-ready — parked"). That is the row's *state*, not its *identity* — a popup with no title. Nothing in the UI teaches the tmux target handles (`@N` window, `%N` pane, `$N` session, `-L <socket>`), even though they are exactly what a user needs to paste into a tmux command (`send-keys -t %425`, `tmux -L default attach`). Sidebar session names truncate with no way to read the full name; the server socket flag appears nowhere.
2. **Consequence of not fixing**: the flyout keeps reading as an anonymous status blob; users keep reverse-engineering tmux targets from `tmux list-windows` in a terminal instead of reading them off the UI they are already hovering; the three sidebar row types keep three inconsistent popup behaviors (tier-2 card / icon-only tips / nothing).
3. **Why this approach**: an inset title bar is real window chrome — identity belongs in chrome, facts in the body. Extending the same grammar to session/server rows gives one learnable popup shape while keeping tier-1 weight for the simpler rows (plain-text body). Alternatives B/C/D were mocked and rejected on visual grounds (see Origin #3). The title data rides payloads the frontend mostly already has, so the change is nearly frontend-only.

## What Changes

### 1. Window flyout card — inset title bar (`app/frontend/src/components/sidebar/row-flyout-card.tsx`)

The tier-2 hover card (serving row hover / keyboard focus / touch dot-tap — one surface, three triggers) gets an identity title bar as its new first element:

- **Title text**: `Window @{windowId} · pane %{activePaneId} · {paneCount} panes` — e.g. `Window @31 · pane %425 · 2 panes`. Data: `win.windowId` (already `@N`-form), the active pane = `win.panes.find(p => p.isActive)` (`paneId` is `%N`-form), count = `win.panes.length`. **No new backend plumbing**: `WindowInfo` (app/frontend/src/types.ts) already carries `windowId` and `panes?: PaneInfo[]` (with `paneId`, `isActive`) on every `/api/sessions` + SSE payload. `panes` is optional in the type — when absent (test fixtures; degraded payloads) the title degrades gracefully by omitting the segments it cannot derive (renders at least `Window @31`).
- **Visual treatment** (mock section 1, option A — authoritative): full-bleed darker strip using the `bg-inset` token, bottom border `--color-border`, top corners rounded to match the card radius. Note the current card container is `px-2 py-1.5` with `gap-1` — "full-bleed" means the bar must escape that padding (negative margins or a restructured card layout; implementation's choice, the rendered result must match the mock).
- **Sigil/label styling per the mock**: the literal words (`Window`, `pane`, `· N panes`) in secondary text; the `@31` / `%425` handles in primary text.
- **Icon cluster moves up**: the fork link (`ForkLink`, gated `chatProvider === "claude"` + optional `onFork` handler) and the docs `InfoIcon` link move from the status-label line to the title bar's right edge — same `ml-auto` cluster idiom, now inside the bar.
- **Status label demotes**: the `dotLabel(win, state)` text becomes the first body line below the bar, keeping its **single-sourcing** with the status dot's aria-label (both keep calling the shared `dotLabel` — no forked copy).
- **Arrow notch**: the `FloatingArrow` currently fills `var(--color-bg-primary)`. When the notch lands on the title band (it pins to the hovered row's vertical center on the card's left edge — for short cards/top rows it can overlap the bar), it takes the inset fill so notch + bar read as one shape (the mock's `notch on-inset` variant). When it lands below the band, it keeps the card-surface fill.
- **Perf contract is a hard constraint** (documented in the file header + memory): all state stays row-local (`useRowFlyout` inside `WindowRow`, never lifted to `Sidebar`), the card body mounts only while open, `useNow` clocks stay leaf-scoped inside the open card. The title bar is static text derived from the already-passed `win` — it must not add clocks, subscriptions, or lifted state.
- Body below the bar is otherwise unchanged: `out`/`agt`/`fab`/`pr` registers, PR link, freshness line.

### 2. Session row tip — NEW surface (`app/frontend/src/components/sidebar/session-row.tsx`)

A hover tip on the session row itself, sharing the title-bar grammar but staying **tier-1 weight**:

- **Title**: `Session code-surface-latch-distill` — the full untruncated session name (`Session` literal in secondary text, name in primary). Standalone value: the row's name renders with `truncate`.
- **Body**: one plain-text line, `$4 · 3 windows · ~/code/sahil87/run-kit` — tmux session id (`$N`), window count, session root path. No icons, no links, no registers, no interactive elements.
- Window count derives from `session.windows.length` (already on `ProjectSession`). Session id and root path need plumbing (see §4).
- The sessions subtree already renders tier-1 `Tip` components (`components/tip.tsx`) — but code inspection shows those are on the row's **icon buttons** (Set session color / Spawn agent / New window / Kill session), not on the row itself, so this is most likely a **new row-level surface**, not an upgrade; verify at plan time whether to build it on `Tip` (extended to accept the title-bar chrome) or as a small shared popup component the window card also uses. Either way it must coexist with the icon `Tip`s inside the sidebar-root `TipGroup` without mixing tier-1/tier-2 warmth (the flyout deliberately keeps its warm window OUT of `TipGroup` — module state in row-flyout-card.tsx).
- Rendering per mock **section 2** (authoritative).

### 3. Server row tip — NEW surface (`app/frontend/src/components/sidebar/server-panel.tsx`)

Same grammar, tier-1 weight:

- **Title**: `Server default` (literal secondary, name primary).
- **Body**: `tmux -L default · 6 sessions` — the socket flag plus session count, one plain-text line, non-interactive.
- **Zero plumbing**: server names ARE socket names (backend `ListServers` enumerates via `ScanSocketDir`, app/backend/internal/tmux/tmux.go:2211), so `tmux -L {name}` composes frontend-side; `sessionCount` already rides `ServerInfo` (app/frontend/src/api/client.ts:713). Show the `-L {name}` flag uniformly for every server, including `default` (as mocked).
- Rendering per mock **section 3** (authoritative).

### 4. Backend plumbing — session id + session root path

Verified: the session list format (app/backend/internal/tmux/tmux.go:713, `ListSessionsDetail`-style format string) does **not** include `#{session_id}` or any path field, and the frontend `ProjectSession` type carries neither. Per Constitution II, derive at request time:

- Add `#{session_id}` (→ `$N`) and the session root path to the tmux list-sessions format, thread through `SessionInfo` → `internal/sessions` → the `/api/sessions` JSON + SSE `sessions` event → `ProjectSession` in app/frontend/src/types.ts. (`#{session_id}` is already fetched elsewhere for group parsing at tmux.go:1056 — same variable, new consumer.)
- **Root-path source** is a plan-time decision: front-runner is tmux's `#{session_path}` (the session working directory); alternatives are the first/active window's pane cwd or an `@rk_*` option (`@rk_present_root` exists for presentations — likely wrong semantics). Display abbreviates `$HOME` to `~` (mock shows `~/code/sahil87/run-kit`).
- New fields are optional on the frontend type (mirror the `windowCount?` fixture-tolerance idiom); the tip omits segments it cannot derive.

### 5. Tests

- Unit tests colocated per convention: title composition + degradation (missing `panes`, missing session id/path), single-sourcing of `dotLabel` between dot aria-label and body line, backend format/parse round-trip for the new session fields.
- Playwright e2e where possible (Constitution / code-quality): hover each row type, assert title-bar text. Any new/modified `*.spec.ts` ships its sibling `*.spec.md` companion in the same commit.
- Existing flyout specs/tests asserting the label-as-header layout (e.g. `row-flyout-card.test.tsx`, `pr-status-sidebar` specs) will need updating to the new structure — tests conform to the spec, not vice versa.

### Not in scope

Coarse-pointer behavior changes (the window card keeps its dot-tap trigger; new tips keep whatever pointer semantics their tier-1 base has), the PANE panel registers, `StatusDot` itself, and board-route sidebar variants beyond whatever the shared components already serve.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) Row-hover register flyout card section — new identity title bar anatomy, icon cluster relocation, dotLabel demotion (single-sourcing preserved), notch-on-inset fill; two-tier tooltip taxonomy gains the shared title-bar grammar across tiers.
- `run-kit/ui/sidebar`: (modify) Row anatomy — session and server rows gain identity hover tips; render-performance constraints note the title bar stays static/row-local.
- `run-kit/tmux-sessions`: (modify) Session enumeration — `#{session_id}` + session root path added to the list format and `/api/sessions` + SSE payload.

## Impact

- **Frontend**: `app/frontend/src/components/sidebar/row-flyout-card.tsx` (title bar, icon relocation, label demotion, notch fill) + `row-flyout-card.test.tsx`; `session-row.tsx` + test (new tip); `server-panel.tsx` + test (new tip); possibly `components/tip.tsx` (title-bar-capable variant) or a new small shared component; `src/types.ts` (`ProjectSession` gains session id + root path fields).
- **Backend**: `app/backend/internal/tmux/tmux.go` (session list format + `SessionInfo` fields + parse), `app/backend/internal/sessions/sessions.go` (JSON shape), matching `_test.go` files.
- **E2E**: `app/frontend/tests/` — flyout/sidebar specs updated or added, with `.spec.md` companions.
- **No new endpoints, no new routes, no database** — extends existing derive-from-tmux payloads (Constitution II, IV).

## Open Questions

- None asked — promptless dispatch. Plan-time verifications (graded below, none blocking): session root-path source (`#{session_path}` vs pane-cwd derivation), and whether the session/server tips extend `Tip` or share a new popup primitive with the window card.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Window title = `Window @N · pane %N · N panes` (window id, ACTIVE pane id, pane count) | Discussed — user chose "alt B" explicitly over count-only and pane-position variants; teaches the full tmux sigil vocabulary | S:95 R:90 A:95 D:95 |
| 2 | Certain | Title treatment = A · inset title bar (`bg-inset` full-bleed strip, `--color-border` bottom border, rounded top corners; notch takes inset fill on the title band); B/C/D rejected | Discussed — user compared four mocked treatments and approved A; `reference-mock.html` §1-A is the authoritative rendering | S:95 R:85 A:95 D:95 |
| 3 | Certain | Fork/docs icon cluster rides the title bar's right edge; `dotLabel` status text demotes to first body line and stays single-sourced with the dot's aria-label | Discussed — explicit part of treatment A; single-sourcing is a documented existing contract | S:90 R:85 A:95 D:90 |
| 4 | Certain | Same title-bar grammar on session + server tips; weight distinction lives in the body (one plain-text line, no icons/links/registers) | Discussed — user explicitly chose chrome consistency over tier-differentiated chrome; mock §2/§3 authoritative | S:95 R:85 A:90 D:90 |
| 5 | Certain | Session tip = `Session <full name>` / `$N · N windows · <root path>`; server tip = `Server <name>` / `tmux -L <name> · N sessions`, `-L` shown uniformly incl. `default` | Discussed — exact strings approved in the mock; socket flag is the popup's earning fact | S:95 R:85 A:90 D:90 |
| 6 | Certain | Window title needs no backend plumbing; server tip needs none either | Verified in code — `WindowInfo` carries `windowId` + `panes[].{paneId,isActive}` on every payload; server name IS the socket name (`ListServers` ← `ScanSocketDir`) and `sessionCount` rides `ServerInfo` | S:90 R:90 A:95 D:95 |
| 7 | Certain | Flyout render-performance contract is binding: title bar is static text from the passed `win`, no new clocks/subscriptions/lifted state | Constraint documented in row-flyout-card.tsx header + memory; violating it is a review must-fix | S:90 R:75 A:95 D:95 |
| 8 | Confident | Session `$N` + root path are plumbed by extending the existing list-sessions format → `SessionInfo` → `/api/sessions` + SSE → `ProjectSession`, as optional frontend fields | Constitution II (derive from tmux at request time); `#{session_id}` already fetched elsewhere (tmux.go:1056); optional-field idiom mirrors `windowCount?` | S:80 R:70 A:85 D:80 |
| 9 | Confident | Session root path sources from tmux `#{session_path}` (front-runner; verify semantics at plan time) | Mock shows a repo root; `#{session_path}` is the tmux-native "session directory" with no new derivation; alternatives (active-pane cwd, `@rk_present_root`) exist but have worse semantics — verify at plan | S:55 R:80 A:60 D:50 |
| 10 | Confident | Missing-data degradation: title omits underivable segments (`panes` absent → `Window @31`; session id/path absent → shorter body line), never renders empty/NaN segments | `panes`/new fields are optional in the types; graceful-omission is the card's existing idiom (FreshnessLine null-return) | S:65 R:85 A:85 D:75 |
| 11 | Confident | Session/server tips are new row-level surfaces built at tier-1 weight (component choice — extend `Tip` vs small shared title-bar popup — decided at plan), coexisting with the icon `Tip`s without mixing tier-1/tier-2 warmth | Code inspection: existing session-row `Tip`s are icon-scoped, not row-level; the warm-window separation constraint is documented in row-flyout-card.tsx | S:70 R:80 A:75 D:65 |
| 12 | Certain | Tests: unit tests for composition/degradation/single-sourcing; Playwright e2e for the three hover surfaces with sibling `.spec.md` companions; existing flyout tests updated to the new structure | Constitution (Test Companion Docs, Test Integrity) + code-quality.md (UI changes SHOULD include e2e) determine this | S:85 R:90 A:95 D:95 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
