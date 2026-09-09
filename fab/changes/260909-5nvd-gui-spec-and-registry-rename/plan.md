# Plan: GUI Spec Amendments + Registry Rename (`desktop` → `gui`)

**Change**: 260909-5nvd-gui-spec-and-registry-rename
**Intake**: `intake.md`

## Requirements

### Specs: window-views.md View Registry

#### R1: The View Registry names the lens `gui`, gated on `gui.enabled`
`docs/specs/window-views.md` § The View Registry SHALL contain no `desktop` row. In its place a `gui` row SHALL state: availability = `gui.enabled` on (settings-registry bool, default `false`; a user choice, never a probe result; per-host like `code`, so offered on every tab); reachability governs content (live canvas vs enabled-but-not-running empty state), never availability; renderer = noVNC canvas (`GuiSurface`, RFB over the `/ws/gui/{id}` relay); status = **[target]** with links to `gui.md` and `fab/plans/sahil/26-09-09-gui-surface.md`.

- **GIVEN** the amended spec
- **WHEN** a reader scans the View Registry table
- **THEN** the fourth lens row reads `gui`, its availability clause names `gui.enabled`, and no row names `desktop` or the 2026-07-14 desktop-view plan

#### R2: A dated succession note records the rename
The spec header SHALL gain a **Succession note (2026-09-09)** paragraph beside the existing 2026-08-12 one stating that the `desktop` lens is renamed `gui` (plan D1), specified in `gui.md`, and that PR #71 and `fab/plans/sahil/26-07-14-desktop-view.md` are superseded. Historical mentions (the header's "desktop streaming (PR #71)", the § The Problem `desktop (PR #71, unmerged)` row, the migration-map From cell) SHALL remain verbatim.

- **GIVEN** the amended header
- **WHEN** a reader looks for why the lens name changed
- **THEN** a dated succession note explains it and the historical rows still describe the pre-model state accurately

#### R3: R3, R6, and Two Species describe the host-singleton lens
R3 SHALL gain the host-singleton clause (plan D8): for `gui` — one GUI session per host, no window row of its own — the always-reachable tty is the supervisor's pane in the `rk-gui` sibling session on the `rk-daemon` server, reached via the `GUI: Open supervisor logs` palette / empty-state action; no relay sniffing, no window-name typing, no per-window VNC-port option. The stale "A desktop window's tty shows the Xvfb/x11vnc supervisor logs" sentence SHALL be replaced by this clause (the codex-server example stays). R6 SHALL read `gui → VNC WS` (the RFB relay; noVNC connect/disconnect events). § Two Species SHALL no longer list "desktop" as pane-coupled; it SHALL name `web` on the serving row as the pane-coupled case and note `code`/`gui` as host-service lenses whose availability derives from host state and which ride every row.

- **GIVEN** the amended R3/R6/Two Species
- **WHEN** C2's author reads how the supervisor tty is reached and how the dot is derived
- **THEN** both are stated for `gui` and the taxonomy does not file `gui` as pane-coupled

#### R4: The migration map marks `desktop` superseded by `gui`
The § Migration Map `desktop` row SHALL keep its From cell and replace To/Vehicle with: superseded by `gui` per the 26-09-09 plan — `gui` lens in `gui.md` (host-singleton substrate, `gui.enabled` switch, RFB over `/ws/gui/{id}`); PR #71 closed, salvage list in the plan § C2 Salvage; vehicle = the plan, C1–C5.

- **GIVEN** the amended row
- **WHEN** a reader follows the desktop row
- **THEN** it points at `gui.md` and the 26-09-09 plan, not at PR #71 salvage or the 26-07-14 plan

### Specs: surface-layout.md

#### R5: `gui` is a tileable kind; coarse viewers never drive its resize
§ One tile per surface kind (v1) SHALL list `gui` among the kinds (`tty`, `code`, `web`, `gui`, `agents`) with a clause that `gui` has no content selector in v1 (the tile shows the host's screen; a per-session display option would become the selector only if per-session GUIs land — D2). § Mobile SHALL gain a paragraph: coarse-pointer viewers scale the shared desktop client-side (fit, or 1:1 clip+pan) and never drive a SetDesktopSize resize; the desktop follows the last-focused fine-pointer viewer's tile size (D7); link `gui.md` § Resize policy. The ≤3-tiles rule is untouched.

- **GIVEN** the amended spec
- **WHEN** C3's author reads the kinds list and the Mobile section
- **THEN** `gui` is a named kind and the phone-never-resizes rule is stated

### Specs: gui.md and index

#### R6: `docs/specs/gui.md` exists, short, `[target]`, carrying D1–D10
A new `docs/specs/gui.md` SHALL exist with these sections, values verbatim from the plan's decision log and the study: Header (fourth surface kind; design authority = `../wiki/gui-surface-design-study.html`; plan link; companions window-views / surface-layout / ui-state; supersedes PR #71 and the 26-07-14 plan) · § Name (D1, the three collisions) · § The substrate (D2/D8: `id = host`, `rk-gui` sibling session on the `rk-daemon` socket, pane command `rk gui supervise host`, list-shaped `/ws/gui/{id}` + `gui: [{id, enabled, backend, reachable, display, width, height, viewers}]`, the study §6 architecture diagram as a fenced block) · § The switch (D3: `gui.enabled` bool default `false` in `~/.config/run-kit/config.yaml`, no env form; the four entry points table; on/off semantics; never on by default; no Start button on a disabled host) · § Availability vs reachability (study §1 table) · § Protocol and relay (D4: RFB over `GET /ws/gui/{id}`, stock noVNC canvas, unix socket `$XDG_STATE_HOME/run-kit/gui/host.sock` dir 0700 socket 0600, auth None, `POST /api/gui/*`, no other route family) · § OS split (D5/D6 including the Xvnc flag string, the "unless C0 says KasmVNC" arm, and the macOS view-only mirror via ARD type 30 + Keychain password) · § Resize policy (D7) · § Agent verbs (`rk gui env|exec|shot`, `rk agent setup` DISPLAY export by read-time derivation, `rk skill gui`; gated exit 1 + `rk gui on` hint) · § Smoothness targets (D9) · § Out of scope (D10) · § Constitution mapping (I, II/X, IV, V, VI, IX — the plan's block) · § Phasing (C0–C6 one line each + pointer to the plan; glyph `▣` placeholder, WM probe order, off-confirm copy recorded as "picked with the user at C2/C3").

- **GIVEN** the new file
- **WHEN** C2/C3/C4 authors read it
- **THEN** every D1–D10 value is present, the study is linked as authority, and the three open items are recorded as open

#### R7: The specs index and residual noun-table mention read `gui`
`docs/specs/index.md` SHALL gain a `[GUI Surface](gui.md)` row in Project Specs (placed after the Cron / Code Bridge / CLI Layering cluster, before Project Plan) and its Window Views row description SHALL read `(tty/web/code/gui)` and `migration map for iframe / gui (PR #71 superseded)`. `docs/specs/ui-state.md`'s noun table SHALL list `` `tty` · `web` · `code` · `gui` · `agents` ``. `docs/specs/right-panel.md` SHALL NOT be edited (it names no `desktop` lens).

- **GIVEN** the amended index and noun table
- **WHEN** `grep -rn '`desktop`' docs/specs/` runs
- **THEN** the only hits are window-views.md historical notes (header origin mention, § The Problem row, migration-map From cell, succession note) and `cli-layering.md`'s `desktop` CLI family (the Electron shell, not the lens)

### Plan tracking and PR #71

#### R8: The plan's tracking table carries C1
`fab/plans/sahil/26-09-09-gui-surface.md` C1 row SHALL read Change folder `260909-5nvd-gui-spec-and-registry-rename`, Status `in progress`; the PR cell is filled by a follow-up commit once `/git-pr` creates the PR (ship stage) and Status flips to `Done` at merge. The header **Status (2026-09-09)** line SHALL note C1 is in progress.

- **GIVEN** the amended plan
- **WHEN** the next agent runs the pickup protocol
- **THEN** C1's row names its change folder and reads in progress

#### R9: PR #71 is closed with a linking comment; its branch stays
PR #71 SHALL be closed via `gh pr close 71 --comment` with a comment that states it is superseded by the `gui` surface design, links `docs/wiki/gui-surface-design-study.html` and `fab/plans/sahil/26-09-09-gui-surface.md` (both on `main`), names the three spec-rule violations the study lists (window-name-prefix typing, relay sniffing, fixed-at-creation view), and points at the salvage list (study §12 / plan § C2 Salvage). The branch `260323-a805-web-based-remote-desktop` SHALL NOT be deleted.

- **GIVEN** the apply run
- **WHEN** `gh pr view 71 --json state` is read afterwards
- **THEN** state is `CLOSED`, the latest comment carries both links, and the branch still exists on origin

### Non-Goals

- No source change under `app/` — `ViewName` stays `"tty" | "web" | "code"`; C3 adds `gui`.
- No edit to `docs/wiki/gui-surface-design-study.html` (design authority, already says `gui`) or to `fab/plans/sahil/26-07-14-desktop-view.md` (kept as the superseded historical plan).
- No rename of "desktop" where it means the Electron shell or the wide viewport (`cli-layering.md`, `design.md`, memory files).
- No memory edits at apply — hydrate owns `run-kit/ui/lenses-and-layout`'s forward-pointer rename.

### Design Decisions

#### Historical mentions stay; a dated succession note explains the rename
**Decision**: Keep every pre-rename `desktop` mention that describes history (the PR #71 origin, the pre-model problem table, the migration-map From cell) verbatim and add one dated succession note.
**Why**: The specs' own precedent (the 2026-08-12 and 2026-09-04 notes in window-views.md) is dated amendment notes, not silent rewrites; the plan's acceptance explicitly tolerates historical notes.
**Rejected**: Rewriting history to say `gui` everywhere (misdescribes PR #71, which really was a `desktop:` window-name design).
*Introduced by*: 260909-5nvd-gui-spec-and-registry-rename

#### `gui.md` is short and links the study rather than restating it
**Decision**: `gui.md` carries the decisions (D1–D10 values) and the contracts later rows build against; rationale, alternatives, and evaluations stay in the study.
**Why**: The plan says "short" and "link the study as design authority"; duplicating the study creates a second source that drifts.
**Rejected**: Folding the study into the spec (two copies of the protocol matrix).
*Introduced by*: 260909-5nvd-gui-spec-and-registry-rename

## Tasks

### Phase 1: Setup

*(none — docs-only change, no scaffolding)*

### Phase 2: Core Implementation

- [x] T001 Amend `docs/specs/window-views.md`: replace the `desktop` View Registry row with the `gui` row (R1); add the **Succession note (2026-09-09)** paragraph to the header (R2); rewrite R3's desktop sentence into the host-singleton clause, update R6 to `gui → VNC WS`, and amend § Two Species so `gui` is a host-service lens not a pane-coupled one (R3); replace the migration-map `desktop` row's To/Vehicle cells (R4). Keep the header's "desktop streaming (PR #71)", § The Problem row, and the From cell verbatim. <!-- R1 R2 R3 R4 -->
- [x] T002 [P] Amend `docs/specs/surface-layout.md`: add `gui` to the § One tile per surface kind (v1) kinds list with the no-content-selector-in-v1 clause; append the coarse-viewers-never-drive-resize paragraph to § Mobile linking `gui.md` § Resize policy. <!-- R5 -->
- [x] T003 [P] Create `docs/specs/gui.md` with every section and value R6 enumerates (`[target]` throughout; fenced study-§6 architecture diagram; the four-entry-point switch table; the availability-vs-reachability table; the Xvnc flag string; the constitution mapping block; the C0–C6 phasing lines with the three "picked with the user" items). <!-- R6 -->
- [x] T004 [P] Residual renames: add the `[GUI Surface](gui.md)` row to `docs/specs/index.md` Project Specs and update the Window Views row's two descriptions; change `docs/specs/ui-state.md` line 69's `` `desktop` `` to `` `gui` ``. Do not touch `docs/specs/right-panel.md`. <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Fill the C1 row in `fab/plans/sahil/26-09-09-gui-surface.md` (Change folder `260909-5nvd-gui-spec-and-registry-rename`, PR left blank for the ship-stage follow-up, Status `in progress`) and update the header Status line. <!-- R8 -->
- [x] T006 Close PR #71 with `gh pr close 71 --comment "<text>"` using the comment in § Notes below; verify `gh pr view 71 --json state` reads `CLOSED` and `git ls-remote --heads origin 260323-a805-web-based-remote-desktop` still lists the branch. <!-- R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `docs/specs/window-views.md` View Registry has a `gui` row gated on `gui.enabled`, renderer noVNC canvas, status `[target]` linking `gui.md` and the 26-09-09 plan; no `desktop` row remains
- [x] A-002 R2: the header carries a dated **Succession note (2026-09-09)** naming the rename, `gui.md`, and the superseded PR #71 / 26-07-14 plan
- [x] A-003 R3: R3 states the `rk-gui` supervisor-pane clause and the `GUI: Open supervisor logs` action; R6 reads `gui → VNC WS`; § Two Species no longer lists desktop as pane-coupled
- [x] A-004 R4: the migration-map desktop row's To/Vehicle cells point at `gui.md` and the 26-09-09 plan and say PR #71 is closed
- [x] A-005 R5: `surface-layout.md` lists `gui` in the kinds list with the v1 no-selector clause and § Mobile states coarse viewers never drive GUI resize
- [x] A-006 R6: `docs/specs/gui.md` exists with all thirteen sections R6 names and every D1–D10 value (checked against the plan's decision log)
- [x] A-007 R7: `docs/specs/index.md` has the GUI Surface row and the updated Window Views description; `ui-state.md` noun table reads `gui`; `right-panel.md` is unchanged in the diff
- [x] A-008 R8: the plan's C1 row names the change folder with Status `in progress`; the header Status line mentions C1
- [x] A-009 R9: `gh pr view 71 --json state` is `CLOSED`; the closing comment links the study and the plan; the branch still exists on origin

### Behavioral Correctness

- [x] A-010 R7: `grep -rn '`desktop`' docs/specs/` returns only window-views.md historical notes and `cli-layering.md`'s CLI-family mention

### Scenario Coverage

- [x] A-011 R6: every relative link in `gui.md` (study, plan, companion specs) resolves to an existing file

### Edge Cases & Error Handling

- [x] A-012 R9: the PR-close step is idempotent — if PR #71 is already closed the task verifies state and adds no duplicate comment

### Code Quality

- [x] A-013 Pattern consistency: amendments follow the existing dated-note and `**[target]**` conventions of `window-views.md` / `surface-layout.md`
- [x] A-014 No unnecessary duplication: `gui.md` links the study for rationale rather than restating its protocol matrix
- [x] A-015 Docs only: `git diff --stat origin/main...HEAD` touches nothing under `app/`
- [x] A-016 Comment discipline: no change IDs or PR numbers cited in spec prose except where the text is explicitly a succession/migration note

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

**PR #71 closing comment (T006)**:

```
Superseded by the `gui` surface design — closing without merge.

The 2026-09-09 design study (docs/wiki/gui-surface-design-study.html on main) and its execution plan (fab/plans/sahil/26-09-09-gui-surface.md) replace this branch's approach. The study records three conflicts with the window-views spec that this PR carried: `desktop:` window-name typing (R1), relay type-sniffing that made the tty unreachable (R3), and a view fixed at creation rather than derived per viewer (R2).

The branch stays as reference — the salvage list is in the study §12 and the plan § C2 Salvage (noVNC canvas + scaleViewport, the WM detection ladder and dbus-run-session traps, the XDG/Chrome isolation script, tools/rk-virtual-display).

Spec amendments land in change 260909-5nvd-gui-spec-and-registry-rename.
```

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Task grouping is one task per spec file plus one for residual renames, one for the tracking table, one for the PR close | Follows the intake's edit-site list; docs-only so no test tasks | S:95 R:100 A:100 D:95 |
| 2 | Certain | The PR #71 comment text is fixed in § Notes so apply needs no judgment | Intake §8 specified the four content points; writing it here removes an apply-time decision | S:90 R:95 A:100 D:95 |
| 3 | Confident | § Two Species is rewritten to name `web` on the serving row as pane-coupled and `code`/`gui` as host-service lenses | Intake assumption 14; the exact sentence shape is the apply author's | S:80 R:90 A:90 D:80 |

3 assumptions (2 certain, 1 confident, 0 tentative).
