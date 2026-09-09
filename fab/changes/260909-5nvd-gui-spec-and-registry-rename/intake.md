# Intake: GUI Spec Amendments + Registry Rename (`desktop` → `gui`)

**Change**: 260909-5nvd-gui-spec-and-registry-rename
**Created**: 2026-09-09

## Origin

One-shot `/fab-new` invocation picking up row **C1** of the GUI surface execution plan:

> gui-spec-and-registry-rename Plan: fab/plans/sahil/26-09-09-gui-surface.md -- implement C1 (spec amendments + registry rename) per the plan's change breakdown and pickup protocol. Before starting, read the plan file in full, the design study docs/wiki/gui-surface-design-study.html, docs/specs/window-views.md, docs/specs/surface-layout.md, fab/project/constitution.md, and the lenses-and-layout, configuration, daemon-lifecycle memory files. Treat the plan's Decision log (D1-D10) as Certain in SRAD scoring -- spend clarification effort only on the per-change "pick with the user" items the plan names. After merge, fill in the C1 row (change folder / PR) in the plan's tracking table in the same PR.

**Design authority** (read in full before this intake was written):

- `fab/plans/sahil/26-09-09-gui-surface.md` — the execution plan. Its Decision log D1–D10 is treated as **Certain** here (the user's instruction); C1 is the "make the specs say `gui` before code does" row. C1 has no dependencies (C1 ∥ C0).
- `docs/wiki/gui-surface-design-study.html` — the design study (§1 registry fit + availability-vs-reachability table, §2 naming collision, §3 one-per-host, §4 OS split, §5–6 protocol + architecture, §7 resize policy, §8 mobile, §10 agent verbs, §14 the on/off switch, §16 recorded decisions).
- `docs/specs/window-views.md`, `docs/specs/surface-layout.md` — the lens/tile model this rides; these are the files being amended.
- `fab/project/constitution.md` — I (argv slices), II/X (derive, don't store), IV (no new env keys; the one registry-driven settings surface), V (palette parity), VI (tmux owns processes), IX (POST-only mutations).
- Memory: `run-kit/ui/lenses-and-layout` (the shipped lens model — `ViewName = "tty" | "web" | "code"`, `SurfaceKind = ViewName`, "the registry is open-ended — `desktop` adds a `ViewName` member…"), `run-kit/configuration` (the 13-key settings registry; `boolValue` kind exists; no env form for preference keys), `run-kit/daemon-lifecycle` (the `rk-code-server` sibling-session pattern on the `rk-daemon` socket — `ensureCodeServerCore`, the exists/externally-managed/spawn ladder, `KillCodeServerSession`).

**Interaction mode**: one-shot. The plan's "pick with the user" items (glyph, WM probe order, confirm copy) belong to C2/C3, not C1 — C1 records them as placeholders that later rows pick. No questions were asked; every decision below is graded and recorded.

**Current state verified**:

- PR #71 (`260323-a805-web-based-remote-desktop`, "feat: Web-based remote desktop streaming via noVNC") is still **OPEN** on `sahil87/run-kit`.
- The plan file and the design study are already on `main` (commit `e4b20089 docs: GUI surface design study + execution plan`), so links to them from PR #71's closing comment resolve.
- `fab docs-index` covers only `docs/memory` in this project's `fab/project/config.yaml` (`docs_index.roots` default) — `docs/specs/index.md` is hand-curated, so the new `gui.md` row is a manual edit.
- `docs/specs/right-panel.md` § Surface Registry lists `web` / `code` / `agents` only — it does **not** name `desktop`, so the plan's "surface registry mention if any" clause resolves to *no edit* there.
- `docs/specs/ui-state.md` line 69 (the noun table) DOES name `desktop` as a surface kind: `` `tty` · `web` · `code` · `desktop` · `agents` (open registry, window-views.md) ``.
- `docs/specs/index.md` names the lens in two places: the Window Views row description `(tty/web/code/desktop)` and `migration map for iframe / desktop (PR #71)`.

## Why

**The problem.** The specs still describe the remote-desktop lens under the name `desktop`, pointing at a superseded plan (`fab/plans/sahil/26-07-14-desktop-view.md`) and an unmerged, bitrotted PR (#71) whose design the 2026-09-09 study explicitly rejects on three counts (window-name-prefix typing, relay sniffing, fixed-at-creation view — all violations of window-views R1/R3). Anyone picking up C2 (backend) or C3 (tile) today would read `docs/specs/window-views.md` and find a View Registry row whose availability clause ("VNC-port window option present") contradicts decision D3 (availability is the `gui.enabled` setting, never a per-window option), whose renderer column is right but whose status target is wrong, and whose migration-map row still says "salvage PR #71".

**The naming collision** (study §2). "Desktop" already means three things in this repo: the Electron viewer shell (`app/desktop`, `rk desktop install`, `desktop-shell.md` memory, session `rk-desktop`), the wide-viewport branch in every UI memory file ("desktop vs mobile"), and — in the specs — this lens. A user-facing "Desktop" toggle button beside a CLI whose `rk desktop` installs an Electron app is a trap. D1 fixes the kind as `gui`, label "GUI", CLI `rk gui`.

**Why now, before code.** The plan's pickup protocol makes the specs the contract C2/C3/C4 build against. C1 is deliberately docs-only and dependency-free so it lands first and small: after it, `grep -n '\`desktop\`' docs/specs/` returns only historical notes, `docs/specs/gui.md` exists as the single spec page the later rows extend, and PR #71 is closed with a pointer so nobody rebases it by accident.

**Why this shape over alternatives.** Rewriting the study into the specs wholesale was rejected — the study is the design authority and stays where it is; `gui.md` is *short* (the plan's word) and links out. Leaving PR #71 open "for salvage" was rejected — the salvage list lives in the plan (§ C2 Salvage) and the study §12; an open PR invites a rebase nobody wants.

## What Changes

Docs only. No source file under `app/` is touched. Seven edit sites plus one outward action.

### 1. `docs/specs/window-views.md` — the View Registry row and its satellites

**1a. View Registry row `desktop` → `gui`.** Replace the row

```
| `desktop` | VNC-port window option present (set by the desktop launcher, reconciler-cleared) | noVNC canvas | **[target]** — [`fab/plans/sahil/26-07-14-desktop-view.md`](../../fab/plans/sahil/26-07-14-desktop-view.md) |
```

with

```
| `gui` | `gui.enabled` is on (settings registry bool, default `false` — a user choice, never a probe result; a host with Xvnc installed but the switch off shows no button); like `code`, availability is per-HOST not per-window, so the lens is offered on every tab. Reachability (the GUI socket answers) governs the tile's CONTENT — live canvas vs the enabled-but-not-running empty state — never availability ([`gui.md`](gui.md)) | noVNC canvas (`GuiSurface`, RFB over rk's `/ws/gui/{id}` WebSocket relay) | **[target]** — [`gui.md`](gui.md); plan [`fab/plans/sahil/26-09-09-gui-surface.md`](../../fab/plans/sahil/26-09-09-gui-surface.md) |
```

**1b. Header intro.** The header's "desktop streaming (PR #71)" mention stays as history (it names what the spec unified); add a **Succession note (2026-09-09)** paragraph beside the existing 2026-08-12 one: the `desktop` lens is renamed `gui` per D1 and specified in `gui.md`; PR #71 and the 2026-07-14 desktop-view plan are superseded.

**1c. § The Problem table.** The `desktop (PR #71, unmerged)` row is a historical description of the pre-model state — keep it verbatim; it is exactly the kind of "historical note" the acceptance grep tolerates.

**1d. R3 gains the host-singleton clause (D8).** Current text says "A desktop window's tty shows the Xvfb/x11vnc supervisor logs". Amend to: for a **host-singleton lens** (`gui` — one GUI session per host, no window row of its own), R3's "always reachable tty" is the supervisor's pane in the `rk-gui` sibling session on the `rk-daemon` server; the tile's empty state and the palette carry a `GUI: Open supervisor logs` action that navigates there. No relay sniffing, no window-name typing, no `@rk_vnc_port`-style per-window option. Keep the "headless codex-server pane's tty shows the server logs" example.

**1e. R6.** `desktop → VNC WS` becomes `gui → VNC WS (the RFB WebSocket relay; noVNC \`connect\`/\`disconnect\` events)`.

**1f. § Two Species.** "Pane-coupled projections — desktop, and `web` on the row that actually serves the port" — `gui` is *not* pane-coupled (it is a host service, like `code`). Amend the first species to name `web` on the serving row (and note `code`/`gui` as host-service lenses that ride every row, availability derived from host state), so the taxonomy doesn't misfile the renamed lens.

**1g. § Migration Map `desktop` row.** Replace the To/Vehicle cells:

```
| desktop → `gui` | PR #71: name-prefix typing, relay sniffing, tty unreachable, bitrotted against current main | **superseded by `gui` per the 26-09-09 plan** — `gui` lens in [`gui.md`](gui.md): host-singleton substrate, `gui.enabled` switch, RFB over `/ws/gui/{id}`; PR #71 closed, salvage list in the plan § C2 | [`fab/plans/sahil/26-09-09-gui-surface.md`](../../fab/plans/sahil/26-09-09-gui-surface.md) C1–C5 |
```

### 2. `docs/specs/surface-layout.md`

**2a. § One tile per surface kind (v1).** The kinds list `(\`tty\`, \`code\`, \`web\`, \`agents\`)` gains `gui`: `(\`tty\`, \`code\`, \`web\`, \`gui\`, \`agents\`)`, with one clause: `gui` has no content selector in v1 (the tile shows the host's screen; a per-session display option becomes the selector only if per-session GUIs ever land — D2).

**2b. § Mobile.** Append one paragraph: on coarse-pointer viewers the `gui` tile scales the shared desktop client-side (fit, or 1:1 clip+pan) and **never drives a SetDesktopSize resize** — the desktop follows the last-focused *fine-pointer* viewer's tile size (D7); phones are readers of the shared screen, not its geometry authority. Link `gui.md` § Resize policy.

**2c. Companions header** — the first companions sentence lists "lenses, availability derivation"; no lens names, so no edit. The "Four tiles and beyond are out of scope" note is untouched — `gui` is a fourth *kind*, not a fourth *tile*; ≤3 tiles stands.

### 3. `docs/specs/ui-state.md` — noun table

Line 69: `` `tty` · `web` · `code` · `desktop` · `agents` (open registry, window-views.md) `` → `` `tty` · `web` · `code` · `gui` · `agents` (open registry, window-views.md) ``. Single-token edit; the address grammar (`@N/<surface>`) is unchanged.

### 4. `docs/specs/right-panel.md`

No edit — verified its § Surface Registry names `web` / `code` / `agents` only. (Recorded so the plan's "if any" clause has an answer.)

### 5. New `docs/specs/gui.md` — the `gui` surface spec (short)

`[target]` throughout. Sections and the exact content each carries (values verbatim from the plan's decision log and the study):

- **Header** — one-paragraph framing: the host's graphical desktop as a fourth surface kind beside `tty` / `code` / `web`; design authority is the study (`../wiki/gui-surface-design-study.html`); execution plan `../../fab/plans/sahil/26-09-09-gui-surface.md`; companions `window-views.md` (registry row, R3/R6), `surface-layout.md` (tile), `ui-state.md` (`@N/gui` address). Supersedes PR #71 and `fab/plans/sahil/26-07-14-desktop-view.md`.
- **§ Name** (D1) — kind `gui`, label "GUI", CLI `rk gui`; why not `desktop` / `screen` / `display` (the three collisions, one line each).
- **§ The substrate** (D2, D8) — one GUI session per host, `id = host`. A host service like code-server, not a window row: supervised in the `rk-gui` sibling tmux session on the `rk-daemon` socket, pane command `rk gui supervise host`, whose tty IS the supervisor log (R3 for a host singleton). Relay path and state payload are list-shaped (`/ws/gui/{id}`, `gui: [{id, enabled, backend, reachable, display, width, height, viewers}]`) so per-session displays can land later without reshaping. The architecture block from study §6 reproduced as a fenced diagram.
- **§ The switch** (D3) — `gui.enabled`, settings-registry bool, default `false`, home `~/.config/run-kit/config.yaml`, **no env form** (env stays the three binding keys — Constitution IV). Table of the four entry points from study §14 (CLI `rk gui on|off [--yes]|status` · settings-dialog row · palette `GUI: Turn on` / `GUI: Turn off` · tile empty state). On ⇒ supervisor ensured now and re-ensured on daemon boot (the `ensureCodeServer` boot-hook shape, gated on the setting); the 4th toggle button exists **iff** enabled. Off ⇒ button gone on every tab, open `gui` tiles degrade out of `@rk_win_layout` via the existing ladder (option left as written, so re-enabling restores them), session killed after a confirm that lists running apps; CLI needs `--yes`. **Never on by default**: no install, update, or backend probe flips it; `rk doctor` shows `gui: off`. There is deliberately no "Start" button on a disabled host — the button itself doesn't exist there.
- **§ Availability vs reachability** — the study §1 table (`code` shipped vs `gui` proposed): available = `gui.enabled` on; reachable = the GUI socket answers, else the empty state (restart supervisor · open supervisor logs · install hint when the backend is missing); content selector = none in v1; dot = VNC WS health (R6).
- **§ Protocol and relay** (D4) — RFB over rk's own WebSocket relay (`GET /ws/gui/{id}`, sibling of the terminal relay), renderer stock noVNC (`@novnc/novnc`) on a `<canvas>`. VNC never on TCP on Linux — unix socket by convention under `$XDG_STATE_HOME/run-kit/gui/` (`host.sock`, dir 0700, socket 0600); auth `None` (same trust boundary as code-server `--auth none`). Mutations are `POST /api/gui/*`; no route family beyond `/ws/gui/*` and `/api/gui/*`.
- **§ OS split** (D5, D6) — Linux v1 = TigerVNC `Xvnc` (`-rfbunixpath … -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 FrameRate=60`) + a window manager, X11 not Wayland — *unless C0 says KasmVNC*, then Kasm is the Linux default and Xvnc the no-install fallback. macOS v1 = mirror the live session via Apple Screen Sharing, **view-only**: relay dials `127.0.0.1:5900`, noVNC negotiates ARD (security type 30), password from the login Keychain (`security find-generic-password`), never `config.yaml`; "take control" is a later deliberate toggle; XQuartz path dropped; CGVirtualDisplay is an optional later backend.
- **§ Resize policy** (D7) — the desktop follows the **last-focused fine-pointer viewer's** tile size via SetDesktopSize; other viewers scale client-side; **coarse-pointer viewers never drive resize**; palette `GUI: Lock resolution` pins it; HiDPI renders 1× by default.
- **§ Agent verbs** (plan C4, study §10) — `rk gui env` (prints `DISPLAY=:N` + socket path for `eval`), `rk gui exec <cmd…>` (the `rk code exec` shape), `rk gui shot [--out <png>]` (macOS refuses in v1 — view-only mirror), `rk agent setup` exports `DISPLAY` into managed panes when enabled (read-time derivation from the supervisor's stamped display, never a hook push — Constitution X), `rk skill gui` briefing page. All gated on enabled+reachable with exit 1 + the `rk gui on` hint otherwise.
- **§ Smoothness targets** (D9) — measured after C3, not assumed: click-to-pixel < 100 ms, ≥ 30 fps scrolling a browser page at 1080p over Tailscale, < 1 core Xvnc CPU; KasmVNC (Linux only, its own client, iframe via the `/code/` proxy shape) is the upgrade lane, gated on C5's numbers.
- **§ Out of scope** (D10) — audio, multi-monitor, per-session displays, Wayland, macOS "take control", the macOS virtual-display backend, board pins of `(window, gui)`.
- **§ Constitution mapping** — the plan's block verbatim: I (argv slices + timeouts, `id` validated, sockets 0600), II/X (nothing stored — enabled is a preference, reachability a dial probe, running a session probe; deleting the socket degrades to "not running"), IV (no new env keys; no route family beyond `/ws/gui/*` + `/api/gui/*`; the settings row rides the one registry-driven settings surface), V (every verb palette-reachable; ⌘4 is a chord, buttons the mirror), VI (tmux owns Xvnc; the relay reattaches after rk restarts), IX (mutations are POST).
- **§ Phasing** — the plan's C0–C6 table condensed to one line per row with a pointer to the plan for scope/acceptance. The glyph (`▣` placeholder), WM probe order (`openbox`, `xfwm4`, `i3`, `kwin_x11`, `x-session-manager`), and the off-confirm copy are named as **"picked with the user at C2/C3"** — recorded as open, not decided here.

### 6. `docs/specs/index.md`

- New Project Specs row (alphabetical position, between Design Philosophy… — the table is not strictly alphabetical; place it after **Cron** / **Code Bridge** / **CLI Layering** cluster, before **Project Plan**):

  ```
  | [GUI Surface](gui.md) | The `gui` surface — the host's graphical desktop as a fourth tile kind beside tty/code/web: one GUI session per host supervised in the `rk-gui` sibling session, the `gui.enabled` off-by-default switch that both runs the backend and shows the 4th button, RFB over the `/ws/gui/{id}` relay rendered by noVNC, availability-vs-reachability, the fine-pointer-only resize policy, the Linux Xvnc / macOS view-only mirror split, agent verbs (`rk gui env|exec|shot`), and the C0–C6 phasing [target] |
  ```

- Window Views row description: `(tty/web/code/desktop)` → `(tty/web/code/gui)`; `migration map for iframe / desktop (PR #71)` → `migration map for iframe / gui (PR #71 superseded)`.

### 7. `fab/plans/sahil/26-09-09-gui-surface.md` — tracking table

Fill the C1 row: **Change folder** `260909-5nvd-gui-spec-and-registry-rename`, **PR** = the C1 PR link once `/git-pr` creates it (a follow-up commit on the same branch, so it lands in the same PR), **Status** `in progress` at apply; `Done` is marked at merge (the archive/merge step, per pickup protocol step 5). Also flip the header **Status** line from "plan only. No change drafted." to name C1 as drafted/in progress.

### 8. Close PR #71 (outward action, apply stage)

`gh pr close 71 --comment "<text>"` with a comment that (a) states the PR is superseded by the `gui` surface design, (b) links the study (`docs/wiki/gui-surface-design-study.html` on `main`) and the plan (`fab/plans/sahil/26-09-09-gui-surface.md`), (c) names the three spec-rule violations the study lists (name-prefix typing, relay sniffing, fixed-at-creation view), and (d) points at the salvage list (study §12 / plan § C2 Salvage) so the branch stays as reference. The branch itself is **not** deleted (salvage reference). Exact comment text is composed at apply; no other PR state is touched.

### Acceptance (from the plan, made checkable)

- Docs only: `git diff --stat` touches nothing under `app/`.
- `grep -rn '`desktop`' docs/specs/` returns only historical notes: window-views § The Problem table row, the header's "desktop streaming (PR #71)" origin mention, the migration-map From cell, and the succession notes. Every *forward-looking* mention of the lens reads `gui`. The word "desktop" in viewport prose (`docs/specs/design.md`, `surface-layout.md` § Mobile "desktop toggles") is out of scope and untouched.
- `docs/specs/gui.md` exists, is linked from `docs/specs/index.md`, links the study + plan, and contains every D1–D10 value above.
- `fab docs-index --check` passes (byte-stable) after hydrate regenerates the memory indexes.
- PR #71 state is `CLOSED` with the linking comment.
- The plan's C1 row carries the change folder and the PR link; status `in progress`.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) the forward pointers naming the future lens `desktop` — the file `description:` frontmatter `(tty/web/code/desktop)`, § Window Views (Lens Model) "later: desktop" and "the registry is open-ended — `desktop` adds a `ViewName` member…" — become `gui` with a pointer to `docs/specs/gui.md`. Nothing about shipped behavior changes (the `gui` lens is not implemented; `ViewName` stays `"tty" | "web" | "code"` in code).

No other memory file changes: `run-kit/configuration` (the `gui.enabled` key does not exist yet — memory records what shipped), `run-kit/daemon-lifecycle` (no `rk-gui` session exists yet). Those are C2's hydrate.

## Impact

- **Files edited**: `docs/specs/window-views.md`, `docs/specs/surface-layout.md`, `docs/specs/ui-state.md`, `docs/specs/index.md`, `fab/plans/sahil/26-09-09-gui-surface.md`; **created**: `docs/specs/gui.md`; **memory (hydrate)**: `docs/memory/run-kit/ui/lenses-and-layout.md` + regenerated `docs/memory/run-kit/ui/index.md` if the description changes.
- **Not edited**: `docs/specs/right-panel.md` (no `desktop` mention), `docs/wiki/gui-surface-design-study.html` (design authority — already says `gui`), anything under `app/`, `fab/plans/sahil/26-07-14-desktop-view.md` (kept as the superseded historical plan the succession notes point at).
- **External**: GitHub PR #71 closed with a comment. Branch `260323-a805-web-based-remote-desktop` left in place.
- **Downstream**: C2 (`gui-backend-switch-and-relay`) and C3 (`gui-surface-tile`) intakes cite `docs/specs/gui.md` as their spec; C4 hydrates the `gui.md` **memory** file (distinct from this spec).
- **Tests**: none — no source change. `just test` is not required; `fab docs-index --check` is the verification gate.
- **Toolkit standards** (constitution § Toolkit Standards): no CLI surface, help output, README, or `docs/site/` change, so no `shll standards` check is triggered by C1 (C2/C4 will trigger it for `rk gui`).

## Open Questions

None blocking. Items deliberately left open for later rows, recorded in `gui.md` § Phasing as "picked with the user":

- Glyph for the 4th toggle (`▣` placeholder — C3).
- WM probe order (`openbox`, `xfwm4`, `i3`, `kwin_x11`, `x-session-manager` proposed — C2).
- Off-confirm dialog copy listing running apps (C2/C3).
- C0's KasmVNC verdict (determines whether `gui.md` § OS split's "unless C0 says KasmVNC" clause resolves to Xvnc or Kasm — the spec carries both arms until C0 writes its verdict).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Surface kind `gui`, label "GUI", CLI `rk gui` — never `desktop`/`screen`/`display` | Plan D1 + study §2, §16; user instructed D1–D10 be treated as Certain | S:100 R:90 A:100 D:100 |
| 2 | Certain | One GUI session per host (`id = host`); list-shaped relay path `/ws/gui/{id}` and `gui: [...]` payload | Plan D2 + study §3 | S:100 R:90 A:100 D:100 |
| 3 | Certain | Off by default; single switch `gui.enabled` (settings-registry bool, no env form); 4th button exists iff enabled; off kills after a confirm | Plan D3 + study §14, §16 | S:100 R:90 A:100 D:100 |
| 4 | Certain | RFB over rk's WebSocket relay, stock noVNC canvas; unix socket under `$XDG_STATE_HOME/run-kit/gui/`, auth None, never TCP on Linux | Plan D4 + study §5–6 | S:100 R:90 A:100 D:100 |
| 5 | Certain | Linux v1 = TigerVNC Xvnc + WM on X11 unless C0 picks KasmVNC; macOS v1 = view-only Screen Sharing mirror (ARD, Keychain password) | Plan D5/D6 + study §4 | S:100 R:90 A:100 D:100 |
| 6 | Certain | Resize follows the last-focused fine-pointer viewer; coarse viewers never drive resize; `GUI: Lock resolution` pins | Plan D7 + study §7, §8 | S:100 R:90 A:100 D:100 |
| 7 | Certain | R3 host-singleton clause: the supervisor tty is the `rk-gui` window on the rk-daemon server; `GUI: Open supervisor logs` navigates there; no sniffing / name typing / per-window option | Plan D8 + study §1 | S:100 R:90 A:100 D:100 |
| 8 | Certain | Smoothness targets (D9) and out-of-scope list (D10) recorded verbatim in `gui.md` | Plan D9/D10 | S:100 R:95 A:100 D:100 |
| 9 | Certain | `gui.md` is `[target]` throughout; it links the study as design authority and stays short (does not restate the study) | Nothing is implemented; the plan says "short" and "link the study as design authority" | S:95 R:95 A:100 D:100 |
| 10 | Certain | Close PR #71 with a comment linking the study + plan; leave its branch in place as salvage reference | Plan C1 scope names the close explicitly; branch deletion is not named anywhere, and the salvage list references the branch | S:95 R:70 A:95 D:95 |
| 11 | Certain | Also rename `desktop` → `gui` in `docs/specs/ui-state.md`'s noun table (line 69) and in the two `docs/specs/index.md` Window Views description mentions | Not in the plan's file list, but squarely inside its acceptance ("grep for the literal `desktop` lens in specs returns only historical notes"); one-token edits, trivially reversible | S:80 R:95 A:95 D:90 |
| 12 | Certain | `docs/specs/right-panel.md` needs no edit | Verified: its § Surface Registry lists `web`/`code`/`agents`; the plan's clause is conditional ("if any names `desktop`") | S:85 R:100 A:100 D:100 |
| 13 | Certain | Historical `desktop` mentions kept verbatim: window-views § The Problem row, the header's "desktop streaming (PR #71)", the migration-map From cell; a dated succession note explains the rename rather than rewriting history | Acceptance explicitly tolerates "historical notes"; the surface-layout/window-views precedent is dated amendment notes, not silent rewrites | S:85 R:90 A:95 D:85 |
| 14 | Certain | Window-views § Two Species is amended so `gui` (a host-service lens, like `code`) is not misfiled as "pane-coupled" | The current text names "desktop" as pane-coupled, which D2/D8 contradict; leaving it would make the spec self-inconsistent after the rename | S:75 R:90 A:90 D:85 |
| 15 | Certain | Tracking-table C1 row: change folder + status `in progress` at apply; PR link added by a follow-up commit once `/git-pr` creates it; `Done` at merge | The plan says both "in the same PR" and "mark Done on merge" — the PR number cannot exist before the PR does, so the link lands as a same-branch follow-up commit | S:70 R:100 A:90 D:85 |
| 16 | Certain | Affected memory is only `run-kit/ui/lenses-and-layout` (forward-pointer rename); `configuration` and `daemon-lifecycle` memories are untouched until C2 ships | Memory records shipped behavior (memory index preamble); `gui.enabled` and `rk-gui` do not exist yet | S:85 R:95 A:95 D:95 |
| 17 | Certain | Glyph, WM probe order, and confirm copy are recorded in `gui.md` as "picked with the user at C2/C3", not decided here | The plan assigns them to later rows; the user scoped clarification to items *this* change names, and C1 names none | S:90 R:100 A:95 D:95 |
| 18 | Certain | `change_type` is `docs` | Docs-only change; the plan's acceptance is "docs only" | S:100 R:100 A:100 D:100 |

18 assumptions (18 certain, 0 confident, 0 tentative, 0 unresolved).
