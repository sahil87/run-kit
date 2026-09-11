# GUI desktop reference and toolbar — how a person picks a desktop, and what the tile's pill carries

> Plan doc — written 2026-09-11 from the gutsy-macaque discussion. Child of
> [`26-09-09-gui-surface.md`](26-09-09-gui-surface.md) (the parent — protocol,
> switch, relay, tile, agent verbs) and sibling of
> [`26-09-10-gui-lxqt-desktop.md`](26-09-10-gui-lxqt-desktop.md) (the session
> starters, `rk gui wm`, the picker) and
> [`26-09-10-gui-viewer-ergonomics.md`](26-09-10-gui-viewer-ergonomics.md)
> (V-D10, the toolbar pill). This doc owns two things those plans left open:
> **how a person learns which desktops exist and installs one rk does not
> already know**, and **what the tile's session toolbar exposes, on every
> pointer kind, at phone width**. It reopens exactly one prior decision —
> V-D10's "fine-pointer non-fullscreen viewers never see the pill" — and
> otherwise treats D1–D10, L-D1–L-D7, and V-D1–V-D14 as settled.
> Authority for design: § Decision log below, plus `docs/specs/gui.md`
> § Switching desktops and § The toolbar pill (which the two changes amend
> when they ship).

**Goal**: a user who wants LXDE, MATE, or any other desktop can find out in
one place what rk supports, what to install, and what happens when they pin
something rk has never heard of; and a viewer on any device can change the
desktop's resolution, go fullscreen, launch a terminal or browser, and reach
the input helpers from the tile itself — one tap on a phone, one hover on a
laptop — without knowing the palette exists.

**Problem (2026-09-11)**: the desktop story is complete in code and absent
in prose. `gui.wm` accepts any binary, the supervisor wraps six known
session starters in a D-Bus session, install hints exist for IceWM, LXQt,
and XFCE only, and the Settings picker lists only what is *already*
installed plus a single LXQt footer line. A user asking for LXDE has no
route: it is not on the ladder, has no alias, no hint, is never wrapped in a
bus (so its panel and tray would fail silently on the headless display),
and neither README nor the site's install guide mentions the GUI at all.
The only page that says "the user may pin LXQt/XFCE" is the agent-facing
skill topic. On the viewer side the pill mounts only on coarse pointers or
in fullscreen, carries viewer posture only (zoom, pointer mode, quality,
key bar, stats, exit-fullscreen), and a laptop user watching the tile has no
toolbar at all — resolution, fullscreen, and the launchers are palette-only.

**Status (2026-09-11)**: R1 **Done** — `91px`, PR #946 merged 2026-09-11. T1
implemented as change `abna` (PR #948, pending review; the once-only
live-desktop resize acceptance is deferred to post-merge because the host gui
was off during the pipeline). Operator handover: § Operator protocol below.

---

## What exists today (so intakes do not re-derive it)

| Piece | Where | Behavior |
|---|---|---|
| WM ladder (`gui.wm` empty) | `internal/gui/backend.go` `wmLadder` | `icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`, first on PATH wins; none ⇒ bare display |
| Known session starters | `internal/gui/candidates.go` `sessionStarterOrder` | `startlxqt, lxqt-session, startxfce4, xfce4-session, startplasma-x11, x-session-manager` — only these run under `dbus-run-session` and are torn down as a process group |
| Aliases | `cmd/rk/gui_wm.go` | `auto`, `icewm`, `lxqt`, `xfce`; anything else is a literal bare binary, `LookPath`'d, refused off-PATH with `PinInstallHint` unless `--force` |
| Install hints | `internal/gui/hint.go` | package-manager-aware (`apt-get → dnf → pacman` probe) wording for the VNC backend, IceWM, LXQt (`lxqt-core`), XFCE (`xfce4`); nothing else. Never executed |
| Seeded look | `internal/gui/seed.go`, `seed_lxqt.go` | IceWM profile via `ICEWM_PRIVCFG`, LXQt defaults via prepended `XDG_CONFIG_DIRS`; XFCE and Plasma run stock |
| Picker candidates | `candidates.go` `WMCandidates` → status doc `wm_candidates` | installed-only rows `{name,label,kind,installed:true}` (alias collapse: one DE = one row); `wm_candidates_hint` = the LXQt install line, empty once LXQt is present |
| Picker UI | `components/gui-wm-picker.tsx`, `lib/gui-desktop.ts` | Settings select `Auto (ladder)` · installed rows · `Other…` free text; footer `Install more: <hint>`; palette `GUI: Desktop…` sub-list with the hint as a trailing disabled row; pick ⇒ `Restart the desktop now?` confirm (`hooks/use-desktop-pick.ts`) |
| `rk gui wm --help` | `gui_wm.go` `Long` | names the four aliases and "anything else is a literal binary name"; says session starters run under D-Bus; lists no desktops, no packages |
| Setting description | `internal/settings/settings.go` `gui.wm` | "Pin the window manager … Empty picks the first installed one from the ladder (…). Takes effect on rk gui restart." |
| Human docs | `README.md`, `docs/site/*.md` | **no mention of the GUI surface anywhere**; `docs/site/skill/gui.md` is the agent topic (139 of the 150-line `skillLineBudget`) |
| Toolbar pill | `components/gui-toolbar.tsx`, mounted from `gui-surface.tsx` line ~1054 under `(coarsePointer \|\| fullscreen) && !credentials` | chips: `−` `fit` `+` · `⌖` pointer mode (coarse) · `◐` quality · `⌨` key bar (coarse) · `∿` stats · `⤢` exit fullscreen (fullscreen only); shown on mount and on `revealSignal` (tile tap; top-edge pointermove while fullscreen), hides after `TOOLBAR_HIDE_MS` = 3 s; touch on the pill passes through `gui-pointer.ts` (never owned) |
| Pill rule | memory `gui.md` § Design Decisions → "Every pill control mirrors an existing palette action" | each chip calls the identical callback object its `buildGuiActions` row calls, threaded from `app.tsx` |
| Palette family | `lib/palette/gui.ts` `buildGuiActions` | Turn on/off · Desktop… · Open terminal · Open browser · Resolution → presets / Match this tile / Custom… / Auto · Quality → … · Fullscreen · Paste clipboard · Send key… · HiDPI on/off · Zoom in/out/fit · 1:1 · Pointer → Trackpad/Touch · Show/Hide key bar · Lock/Unlock resolution · Show/Hide stats · Reconnect · Open supervisor logs |
| Resolution semantics | V-D1–V-D5, memory `gui.md` § The `gui.geometry` key | host preference, default `1920x1080` fixed; `auto` follows the focused fine-pointer tile; live RandR resize; `rk gui lock` host pin renders `locked` in status and stream; rows hidden on the macOS mirror |
| E2E | `tests/e2e/gui-surface.spec.ts`, `gui-desktop-picker.spec.ts`, `_gui.ts` helpers | real-rig specs isolated per worktree (own socket family + state home); `gui-perf.spec.ts` is `@perf`, never gated |

---

## Decision log (decided in the 2026-09-11 gutsy-macaque discussion — intakes treat these as Certain unless marked Likely)

### R — the desktop reference

| # | Decision | Why |
|---|----------|-----|
| R-D1 | **Three more known desktops.** `sessionStarterOrder` grows to `startlxqt, lxqt-session, startxfce4, xfce4-session, startplasma-x11, startlxde, mate-session, cinnamon-session, x-session-manager` (the new three before the generic `x-session-manager`, after Plasma). Labels `LXDE`, `MATE`, `Cinnamon`. `rk gui wm` gains the aliases `lxde`, `mate`, `cinnamon`, `plasma` (⇒ `startplasma-x11`). Each new starter gets a `dePackages` row. apt lines (Certain): `sudo apt install --no-install-recommends lxde-core` · `… mate-desktop-environment-core` · `… cinnamon-core`; a Plasma apt line `… plasma-desktop`. dnf/pacman lines are best-effort wording, **Likely** — `dnf install @lxde-desktop-environment` may not exist on current Fedora; the intake verifies the package names against the distro package indexes (a web lookup, not an install) before pinning the strings. The WM ladder itself does not change | the table is where the D-Bus wrap and the hint live; a desktop not in it comes up half-broken. Three rows cost nothing and cover every "lightweight full desktop" a user is likely to name. GNOME stays out: `gnome-session` needs a compositor path Xvnc does not provide and is not worth a half-working row |
| R-D2 | **`wm_candidates` carries the known-but-missing desktops too.** Rows for every known DE in the table (the primary starter name) are emitted with `installed:false` and a per-row `hint` (the `DEInstallHint` line); installed rows keep `hint` empty. The IceWM ladder head is also emitted as a row when missing (`installed:false`, `WMInstallHint`). Bare WMs other than IceWM appear only when installed (as today). `wm_candidates_hint` is **retired** from the document; both UI doors read per-row hints. Alias collapse and order rules stay: installed rows first in ladder-then-starter order, then missing rows in table order | the picker's job is to show the *choices*, not the inventory; a select that lists only what is installed can never teach a user that XFCE exists. Per-row hints replace the single-desktop footer that could only ever nag about LXQt |
| R-D3 | **Both picker doors render missing desktops as disabled rows with their install line.** Settings select: `<option disabled>` labelled `LXQt — not installed`; beneath the select a collapsed `Install more ▾` disclosure expands to one line per missing desktop, `LXQt: sudo apt install --no-install-recommends lxqt-core` (monospace, selectable). Palette `GUI: Desktop…` sub-list: the missing rows ride after the installed ones, disabled, label `LXQt (not installed)`, description = the install line. `Other…` stays as the escape for a typed binary, and its field's placeholder becomes `binary name, e.g. startlxde` | a disabled option in the select is the honest "exists, not here"; the disclosure keeps the row short when four desktops are missing; the palette already has a disabled-row idiom for the hint |
| R-D4 | **`rk gui wm --list`** prints the candidate table the picker reads: columns `NAME LABEL KIND INSTALLED HINT`, installed rows first, `HINT` empty for installed rows; `--json` alongside emits the `wm_candidates` array verbatim. `--list` with a positional is usage (exit 2). The no-argument report is unchanged | the CLI twin of the picker, so a shell user (and the skill page) has one command that answers "what can I run here and how do I get it" |
| R-D5 | **`rk gui wm --help` names the desktops.** The `Long` gains a table of the known desktops with alias, starter binary, and the apt install line (noting the runtime hint is package-manager-aware), the generic recipe (`sudo apt install <pkg>` → `rk gui wm <starter> --restart`), and the D-Bus caveat: a binary not in the known list runs bare — panels and trays of an unlisted full desktop may fail on the headless display; ask for it to be added, or use `--list` to see the known set. The `gui.wm` setting description gains one clause: "Run `rk gui wm --list` for installed and installable desktops." | the help text is the first place a shell user looks; today it says `<binary>` and stops. The toolkit help-dump standard binds the wording — check `shll standards help-dump` before writing |
| R-D6 | **A human-facing site guide, `docs/site/gui.md`,** in the boards/notifications guide shape. Sections: what it is (one sentence: the host's desktop as a fourth tile, off by default, shared by every viewer and every agent) · turning it on (`rk gui on`, what starts, the `rk gui status` line, the 4th tile button) · the desktops table (IceWM default and seeded · LXQt seeded · XFCE stock · Plasma / LXDE / MATE / Cinnamon known, with the apt lines and a note that `rk gui wm --list` shows the lines for your package manager) · choosing one (the three doors: Settings picker, palette `GUI: Desktop…`, `rk gui wm … --restart`; "restart closes apps on the display") · running something rk does not know (the recipe, the bare-WM caveat, `--force`) · resolution (fixed by default, presets, `auto`, lock; `rk gui resize`) · watching and driving (phone: pointer modes, key bar, the toolbar pill; laptop: zoom, fullscreen; quality) · agents (one paragraph pointing at `rk skill gui`) · macOS is view-only · troubleshooting (`rk gui status`, `rk doctor`, `GUI: Open supervisor logs`, "nothing installed for you"). README gains a `## GUI — the host's desktop in a tile` section between Boards and the phone section, three sentences plus the guide link, and a `rk gui` row in § Command reference; `docs/site/install.md` § Prerequisites gains one line naming the optional GUI packages with a link to the guide | README and the install guide are where a person looks first, and neither says the word GUI; the guide is the single page every hint, help text, and picker footer can point to. Both surfaces are bound by the toolkit standards (`shll standards`) — the intake checks the README and docs/site standards before writing |
| R-D7 | **Skill page: one gotcha edit, inside budget.** `docs/site/skill/gui.md` → the "desktop may be a full DE" gotcha reads "IceWM is the default; the user may pin any known desktop (`rk gui wm --list`)"; no new section. The page sits at 139 of 150 lines and R1 adds at most one line | the skill page is agent-facing depth; the human reference lives in the site guide, and the 150-line guard is a test |
| R-D8 | **Out of scope for R1**: a generic "wrap this binary in a session bus" flag or setting (recorded as a follow-up — if a fourth unknown desktop request arrives, add `gui.wm_session: bool` or a `--session` flag then); GNOME; installing anything from rk (Constitution III / the install-composition standard: probe, degrade, hint); changing the WM ladder order; a wallpaper or theme picker | keep R1 to prose, a table, and the picker; the escape hatch is a real design question (where does the second bit live?) that three known rows make unnecessary today |

### T — the toolbar

| # | Decision | Why |
|---|----------|-----|
| T-D1 | **The pill mounts for every viewer; only its reveal differs.** Amends V-D10. Fine-pointer non-fullscreen viewers get the fullscreen reveal rule: a pointermove within `TOOLBAR_REVEAL_EDGE_PX` of the wrapper's top edge shows it; it still hides after 3 s. Coarse viewers keep the tap reveal and the shown-on-mount discovery. Empty and credentials states still never mount it; nothing changes on the mirror backend beyond the rows that are already hidden there | resolution, fullscreen, and the launchers are the things a laptop viewer reaches for while watching an agent, and today that viewer has no toolbar and must know the palette. Hover-reveal keeps the tile clean by default |
| T-D2 | **A resolution chip that reads as status and acts through a menu.** Label: the live desktop size as `1920×1080 ▾` (from the stream's geometry), `auto ▾` under the follow policy, prefixed with a lock glyph while `locked` (host pin) — e.g. `🔒 1920×1080`. Tap opens an anchored menu (one column, monospace, the palette's disabled-row and `current` description idioms) whose rows ARE the existing palette rows: the five presets (`current` on the live one), `Match this tile`, `Auto (follow this tile)`, `Custom…`, then `Lock resolution` / `Unlock resolution`. While locked the size rows are disabled with the description `locked`; while the setting is `auto` the lock rows carry V-D4's semantics unchanged. The menu closes on pick, Escape, or outside tap; picking a size does not confirm — the two-tap path (chip, then row) is the mis-tap guard. Hidden on the macOS mirror, where the palette hides the rows too | resolution is a host setting on a shared desktop, so a bare preset chip on a 3-second auto-hiding pill invites a phone mis-tap that reflows every viewer's windows and moves an agent loop's coordinates. A status-labelled chip answers "what size is it" without a tap and puts the change behind one deliberate step |
| T-D3 | **Chip inventory and order**, left to right, groups separated by a 1-px divider: **Display** `WxH ▾` · `⤢` (fullscreen **toggle** — enters when not fullscreen, exits when fullscreen; today the pill has exit only) · **View** `−` `fit` `+` · `◐ <quality>` · **Input** `⌖` pointer mode (coarse only) · `⌨` key bar (coarse only) · `⎘` Paste clipboard · `⌥` Send key… · **Launch** `▣` Open terminal · `◍` Open browser · **Health** `∿` stats · `↻` Reconnect. Not on the pill: Turn off, Desktop…, Open supervisor logs, HiDPI, 1:1 — the first three restart or kill the display or leave the tile, the last two are rare and stay in the palette | the frequency order while watching an agent: size and fullscreen, then reading zoom and quality, then typing helpers on a phone, then "put something on the empty desktop", then health. Every chip already has a palette row and a callback object, so the rule "no toolbar-only functionality" holds with zero new actions |
| T-D4 | **Overflow under a `⋯` chip, decided by pill width, not pointer kind.** The pill measures its wrapper (a `ResizeObserver` on the surface wrapper). Below 560 px of wrapper width the pill shows the **primary set** — `WxH ▾` · `⤢` · `−` `fit` `+` · `⌖` · `⌨` (the two coarse chips only on coarse) · `⋯` — and the rest (`◐` quality, `⎘` paste, `⌥` send key, `▣` terminal, `◍` browser, `∿` stats, `↻` reconnect) live in a `⋯` menu rendered like the resolution menu, each row the palette row's label. At 560 px and above everything is inline and `⋯` is absent. A 375-px phone therefore shows seven chips plus `⋯`, fitting one row at the pill's current chip metrics (the touch-target rules in `context.md` § Mobile apply: `coarse:min-h-[36px]`) | the user's call (2026-09-11): overflow goes under a `⋯` or chevron menu, and `⋯` is the one that reads as "more" beside a `▾` that already means "menu for this chip". Measuring the wrapper rather than the pointer keeps a narrow desktop split tile honest too |
| T-D5 | **Every chip and every menu row calls the palette's callback object.** The pill and its two menus are built from the same `buildGuiActions` input the palette receives (threaded from `app.tsx` as today), selecting rows by their stable `id`s (`gui-resolution-*`, `gui-fullscreen`, `gui-open-terminal`, …). No chip has logic of its own; the label for a menu row is the palette row's label with the `GUI: ` prefix stripped. Constitution V is unchanged: the palette stays the complete registry and the pill stays its mirror | the shipped rule (memory `gui.md` § "Every pill control mirrors an existing palette action") is the reason adding eight chips is cheap: nothing new to keep in step |
| T-D6 | **The pill's touch rules and reveal machinery are reused, not rewritten.** `gui-pointer.ts`'s never-owned selector gains the two menus' test ids; the hide timer restarts on any pill or menu interaction; an open menu suspends the hide timer until it closes | a menu that disappears mid-choice because the 3-second timer fired is the one new failure mode T1 can introduce |
| T-D7 | **Out of scope for T1**: a connection-health dot on the pill (the stats overlay carries fps, Mbit/s, RTT already), a drag-to-move pill, per-viewer chip customization, a bottom-docked variant, and any change to the key bar's contents | postures and one pill; the health dot is a real idea but a separate one |

---

## UX copy (final — intakes may quote)

### `rk gui wm --list`

```
$ rk gui wm --list
NAME             LABEL     KIND     INSTALLED  HINT
icewm-session    IceWM     wm       yes
startlxqt        LXQt      session  yes
startxfce4       XFCE      session  no         sudo apt install --no-install-recommends xfce4
startplasma-x11  Plasma    session  no         sudo apt install --no-install-recommends plasma-desktop
startlxde        LXDE      session  no         sudo apt install --no-install-recommends lxde-core
mate-session     MATE      session  no         sudo apt install --no-install-recommends mate-desktop-environment-core
cinnamon-session Cinnamon  session  no         sudo apt install --no-install-recommends cinnamon-core
```

### Settings picker

- Select options: `Auto (ladder)` · `IceWM` · `LXQt` · `XFCE — not installed` (disabled) · … · `Other…`
- Disclosure line under the select, collapsed: `Install more ▾`; expanded, one line per missing row: `XFCE: sudo apt install --no-install-recommends xfce4`
- `Other…` field placeholder: `binary name, e.g. startlxde`

### Palette `GUI: Desktop…`

`Auto (ladder)` · `IceWM` (`current`) · `LXQt` · `XFCE (not installed)` disabled, description `sudo apt install --no-install-recommends xfce4` · …

### Toolbar pill (wide)

```
[ 1920×1080 ▾ ][ ⤢ ] | [ − ][ fit ][ + ][ ◐ Balanced ] | [ ⌖ Trackpad ][ ⌨ ][ ⎘ ][ ⌥ ] | [ ▣ ][ ◍ ] | [ ∿ ][ ↻ ]
```

### Toolbar pill (narrow, < 560 px)

```
[ 1920×1080 ▾ ][ ⤢ ] | [ − ][ fit ][ + ] | [ ⌖ ][ ⌨ ] | [ ⋯ ]
```

`⋯` menu rows: `Quality → Balanced` · `Paste clipboard` · `Send key…` · `Open terminal` · `Open browser` · `Show stats` / `Hide stats` · `Reconnect`

### Resolution menu rows

`1280×720` · `1600×900` · `1920×1080` (`current`) · `2560×1440` · `1080×1920 (portrait)` · `Match this tile` · `Auto (follow this tile)` · `Custom…` · `Lock resolution` / `Unlock resolution`. Locked: size rows disabled, description `locked`. Chip label while locked: `🔒 1920×1080`.

Aria labels: the resolution chip `Resolution 1920×1080, menu`; the overflow chip `More actions`; the fullscreen chip `Enter fullscreen` / `Exit fullscreen`.

---

## Change breakdown

Two fab changes, disjoint in code, sharing only `docs/specs/gui.md` (different sections) and the memory hydrate. Full lane for both (the plan task counts are above the light-lane threshold).

| Stage | Change | Lane | Depends on | Change ID | PR | Status |
|---|---|---|---|---|---|---|
| R1 | Desktop reference: table + hints, `wm_candidates` missing rows, picker rows, `rk gui wm --list` + help, site guide + README + install line, skill gotcha | full | — | `91px` | #946 | **Done** — merged 2026-09-11 |
| T1 | Toolbar: mount-for-all + hover reveal, resolution menu chip, fullscreen toggle, launch/input/health chips, `⋯` overflow by width | full | — | `abna` | #948 | shipped 2026-09-11 (PR pending review; live-desktop acceptance post-merge) |

### R1 — Desktop reference

**Touches**: `internal/gui/candidates.go` (`sessionStarterOrder`, labels, `WMCandidates` missing rows + `hint`, `WMCandidatesHint` removed), `internal/gui/hint.go` (three `dePackages` rows + Plasma, `sessionStarterDEs`), `internal/gui/status.go` / `assemble.go` (drop `wm_candidates_hint`, `WMCandidate.Hint`), `cmd/rk/gui_wm.go` (aliases, `--list`, `--json`, `Long`), `internal/settings/settings.go` (`gui.wm` desc), `api/gui.go` handler test, `frontend/src/api/client.ts` (`GuiWMCandidate.hint`, drop `wm_candidates_hint`), `lib/gui-desktop.ts` (`buildWMOptions` disabled rows, `buildDesktopPaletteRows` missing rows, a `missingWMs()` helper for the disclosure), `components/gui-wm-picker.tsx` (disabled options, `Install more ▾` disclosure, placeholder), `docs/site/gui.md` (new), `README.md`, `docs/site/install.md`, `docs/site/skill/gui.md` + `cmd/rk/skill/gui.md` (byte-identical pair; one gotcha line), `docs/specs/gui.md` § Switching desktops, `tests/e2e/gui-desktop-picker.spec.ts`.

**Tasks (indicative, ~8)**: (1) table + hints + aliases with unit tests, incl. the Likely dnf/pacman verification; (2) `WMCandidates` missing rows and per-row `hint`, `Assemble` wiring, drop the footer field, handler test; (3) `rk gui wm --list`/`--json` and the `Long` rewrite, help-dump check; (4) frontend model + `gui-desktop.ts` helpers with tests; (5) picker UI (select + disclosure + placeholder) and palette rows, unit tests; (6) e2e: picker shows a disabled not-installed row with its hint (stub the status document with a missing XFCE), disclosure expands; (7) site guide + README section + install line + setting desc, checked against `shll standards`; (8) spec § Switching desktops amendment and the skill gotcha within budget.

**Done means**: `rk gui wm --list` on this host prints the installed rows (IceWM, LXQt) and the missing rows with apt lines; `rk gui wm lxde` refuses with the `lxde-core` line; Settings shows `XFCE — not installed` disabled and the disclosure line; the palette sub-list shows the same; `docs/site/gui.md` exists and README links it; `just test` green apart from the known environmental e2e set; `skill_test.go` budget holds.

**Manual acceptance on the live `rk-gui` session**: none required — R1 never restarts the desktop. Do not run `rk gui wm … --restart` on the live host as part of acceptance; a throwaway assertion that `--force` still pins is a unit test.

### T1 — Toolbar

**Touches**: `components/gui-toolbar.tsx` (inventory, groups, resolution chip + menu, `⋯` chip + menu, width measurement, fullscreen toggle), a new `components/gui-toolbar-menu.tsx` (the anchored one-column menu both chips share, palette-row idioms, Escape/outside-tap close, hide-timer suspension), `components/gui-surface.tsx` (mount gate → always when `!credentials` and not empty; fine-pointer top-edge reveal outside fullscreen; thread the action input; the `ResizeObserver`), `components/gui-pointer.ts` (never-owned selector gains the menu test ids), `lib/palette/gui.ts` (export the stable ids or a `pickGuiActions(ids)` helper — no new rows), `docs/specs/gui.md` § The toolbar pill (amend V-D10's two-context rule), `tests/e2e/gui-surface.spec.ts` (+ intent comments per the constitution), `gui-toolbar.test.tsx`, `gui-pointer.test.ts`.

**Tasks (indicative, ~9)**: (1) extract the shared menu component with tests; (2) resolution chip label derivation (live WxH / `auto` / lock glyph) from the stream entry, unit tests; (3) resolution menu built from the palette rows by id, locked/auto disabled semantics; (4) fullscreen toggle + launch/input/health chips, all by palette id; (5) width-measured overflow with the `⋯` menu, threshold constant, tests at 375/560/1280 wrapper widths; (6) mount-for-all + fine-pointer top-edge reveal in `gui-surface.tsx`, hide-timer suspension while a menu is open; (7) `gui-pointer.ts` pass-through for the menus; (8) e2e at 375×812 coarse (pill shows primary set + `⋯`, `⋯` opens, resolution chip opens and a preset row posts the resize) and 1280 fine (hover top edge reveals; menu rows present; pill absent by default); (9) spec amendment.

**Done means**: on a 375-px coarse viewport the pill fits one row with `⋯`; the resolution chip shows the live size and a preset row resizes the desktop (verified against `rk gui status`); on a 1280-px fine viewport the pill is absent until a top-edge hover and every chip is inline; `pnpm exec tsc --noEmit` clean; the Playwright verification loop in `context.md` § Playwright-Driven Development run at both viewports with screenshots attached to the PR.

**Manual acceptance on the live `rk-gui` session**: resizing from the pill changes the shared desktop — run it once, restore the prior size (`rk gui resize <prev>`), and never while an agent loop or perf job is on the display (`tmux -L rk-daemon list-windows -t rk-jobs`).

---

## Constitution mapping

| Principle | R1 | T1 |
|---|---|---|
| I Security | hints are strings, nothing executed; `--list` runs `LookPath` only | no subprocesses |
| II No database | candidates derived from PATH per request, as today | postures stay in localStorage; resolution stays the settings key |
| III Wrap, don't reinvent | rk probes and hints; the package manager is the user's | reuses noVNC seams, the palette rows, the Control primitive |
| IV Minimal surface | no new route, no new page; the picker is the existing settings carve-out; a `--list` flag on an existing verb | no new route; the pill is the shipped mirror, wider |
| V Keyboard-first | `rk gui wm --list` is the shell path; both UI doors already reachable via palette | every chip = a palette row; menus close on Escape; T-D5 keeps the registry complete |
| Toolkit standards | README, docs/site, help text and the skill page are bound — `shll standards` checked in tasks (3), (7), (8) | — |
| Test intent comments | new e2e tests carry Proves/Steps blocks | same |

## Risks

| Risk | Mitigation |
|---|---|
| dnf/pacman package names for LXDE/MATE/Cinnamon are wrong | marked Likely (R-D1); the intake verifies against the distro indexes; a wrong non-apt line is wording, never executed |
| Retiring `wm_candidates_hint` breaks an older frontend against a newer daemon (or the reverse) during a rolling upgrade | the frontend is embedded in the same binary; the only other reader is the picker spec — update both in one change; `omitempty` on `hint` keeps the document shape stable otherwise |
| README / docs/site edits fail a toolkit standard | the standards are enumerated by `shll standards`; task (7) reads the README and docs/site entries first and cites them in the PR |
| Skill page line budget | 139/150; R1 edits one line and adds none |
| The pill at 375 px with the resolution label overflows one row | the label is the widest chip; the threshold (560 px) and chip set are tuned in task (5) with a real 375-px Playwright screenshot; if it still wraps, the size label drops the `×H` half below 400 px (`1920 ▾`) |
| A menu open across the 3-second hide | T-D6: the hide timer is suspended while a menu is open |
| Hover-reveal on fine pointers fires on incidental mouse travel across the top edge | the reveal is the shipped fullscreen rule (24 px band); the pill auto-hides; acceptable, and the palette remains the no-mouse path |
| The two changes edit `docs/specs/gui.md` | different sections; serial queue means T1 rebases onto R1's merged spec mechanically |

---

## Operator protocol

**Strategy**: `merge-auto`, one serial queue, R1 then T1. The two changes are disjoint in code, so two concurrent lanes are permissible if the operator prefers, but serial costs one stage of latency and removes the one shared-file rebase (`docs/specs/gui.md`, memory `gui.md`). No `depends_on` on either entry — the order is the graph.

### Before the queue starts

1. `git fetch origin && git rebase origin/main` (or `git pull --ff-only` on a main checkout) — this plan must be on the operator's main.
2. **Draft both intakes** with `/fab-draft`, one per stage, each pointing at its § Decision log rows and § Change breakdown section and following § Pickup protocol. Record the 4-char IDs in the § Change breakdown table above. The intake gate (confidence ≥ 3.0) runs at spawn.
3. Nothing to install on the host for R1 or T1. Do not install LXDE/MATE/Cinnamon on the host to "test" R1 — the missing rows are the point, and the e2e stubs the status document.
4. `fab operator autopilot start --queue <R1,T1> --mode merge-auto`.
5. Enroll each spawn with `--stop-stage ship` so Copilot's 15–90 minute latency never gates the queue; run `/git-pr-review` over both PRs an hour after the last merge as the post-queue sweep.

### Rules

- **R1 is not a base for T1** — a skipped R1 does not pause the queue; re-queue it individually. A skipped T1 likewise.
- **Arming**: `gh pr ready` then `gh pr merge --auto --squash`, one armed PR at a time, and only once the spawned agent's pane is idle and its `review-pr` stage is no longer actively working (the arm-before-idle lesson from `26-09-10-gui-combined-execution.md` § Deviations).
- **Decision authority**: § Decision log is Certain except R-D1's non-apt package lines (Likely). A conflict with a parent or sibling plan's decision is an escalation to the user, not a local fix. T-D1 deliberately amends V-D10; the T1 agent records that amendment in the spec and in memory `gui.md` § Design Decisions.
- **Live display**: R1 touches it not at all. T1's manual acceptance resizes it once and restores it; serialize with any `rk-jobs` perf window.
- **Bookkeeping**: fill the § Change breakdown row when the change is created; mark Done when merged; T1's PR (the last) updates this plan's § Status line.

### Timeouts and escalation

Per `fab-operator` § Autopilot: stage > 30 min ⇒ flag; total > 2 h ⇒ flag. Estimate from the combined-execution record: R1 ~1 h 15 (mixed Go + React + docs), T1 ~1 h 30 (Playwright loop at two viewports); the queue ~3 h.

## Pickup protocol (for the agent taking R1 or T1)

1. Read this file in full, then `docs/specs/gui.md` (§ Switching desktops and § The toolbar pill), `fab/project/constitution.md`, `fab/project/context.md` (§ Mobile Responsive Design, § Playwright-Driven Development), and the memory files `gui` (§ The `rk gui` CLI family, § Design Decisions), `ui/keyboard-and-palette` (§ The `GUI:` palette family), `ui/lenses-and-layout` (§ GUI Surface), `configuration` (§ Settings Registry) — R1 also `toolkit-standards`.
2. Treat § Decision log as Certain in SRAD scoring except R-D1's dnf/pacman lines (Likely — resolve by lookup, not by guessing).
3. R1: run `shll standards` and read the README, docs/site, help-dump, and skill entries before touching those surfaces. Keep `docs/site/skill/gui.md` and `cmd/rk/skill/gui.md` byte-identical.
4. T1: verify at 375×812 (coarse) and 1280×800 (fine) with Playwright against the worktree's `just dev` rig before opening the PR; attach both screenshots.
5. Fill your row in § Change breakdown when you create the change; mark Done when merged.
