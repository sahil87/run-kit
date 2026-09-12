# Intake: GUI desktop reference — known-desktop table, missing picker rows, `rk gui wm --list`, site guide

**Change**: 260911-91px-gui-desktop-reference
**Created**: 2026-09-11

## Origin

> Desktop reference — known-desktop table + hints, wm_candidates missing rows, picker missing rows, rk gui wm --list + help, docs/site/gui.md + README + install line, skill gotcha edit.
>
> Read fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md in full first, then follow its § Pickup protocol exactly. Base this intake on § Decision log rows R-D1 through R-D8 and the § Change breakdown → "R1 — Desktop reference" subsection (Touches / Tasks / Done means / Manual acceptance: none required — R1 never restarts the live rk-gui desktop, do not run `rk gui wm ... --restart` on the live host).
>
> Treat § Decision log as Certain except R-D1's dnf/pacman package lines, which are Likely — resolve those by looking up the actual distro package names, never by guessing. Before touching README, docs/site/gui.md (new), docs/site/install.md, or the skill page, run `shll standards` and read the relevant entries.

Interaction mode: one-shot `/fab-draft` from the plan doc. This change is **R1** of the plan `fab/plans/sahil/26-09-11-gui-desktop-reference-and-toolbar.md` (the 2026-09-11 gutsy-macaque discussion). Every design decision below is lifted from that plan's § Decision log rows R-D1–R-D8, its § UX copy, and its § Change breakdown → R1; the plan's rows are Certain by the user's instruction, except R-D1's dnf/pacman lines, which this intake resolved by lookup against the Fedora package index (`packages.fedoraproject.org`), the Fedora KDE Plasma 6 change page, and the Arch package/group index (`archlinux.org/packages`, `archlinux.org/groups`) — see § What Changes → The known-desktop table and § Assumptions. The apt names were additionally confirmed against this host's apt index (Ubuntu 22.04: `lxde-core`, `mate-desktop-environment-core`, `cinnamon-core`, `plasma-desktop` all resolve).

Sibling **T1** (the toolbar) is a separate change; the two share only `docs/specs/gui.md` (different sections) and the memory hydrate. R1 does not depend on T1 and is not a base for it.

## Why

**The desktop story is complete in code and absent in prose.** `gui.wm` accepts any binary, the supervisor wraps six known session starters in a D-Bus session, install hints exist for IceWM, LXQt, and XFCE only, and the Settings picker lists only what is *already installed* plus a single LXQt footer line. A user asking for LXDE has no route today: it is not on the ladder, has no alias, no hint, is never wrapped in a bus (so its panel and tray fail silently on the headless display), and neither the README nor the site's install guide mentions the GUI surface at all. The only page that says "the user may pin LXQt/XFCE" is the agent-facing skill topic.

**If we do nothing**, every "can I run MATE / LXDE / Cinnamon on the rk desktop?" question is answered by reading `internal/gui/candidates.go`, and a user who types `rk gui wm startlxde` gets a bare, half-broken desktop with no panel — and no explanation. The picker can never teach a user that XFCE exists, because a select that lists only the inventory shows no *choices*.

**Why this approach**: three more rows in the existing known-desktop table cost nothing and cover every "lightweight full desktop" a user is likely to name (LXDE, MATE, Cinnamon), plus a Plasma alias for a starter that is already known. Emitting the *known-but-missing* desktops in `wm_candidates` with a per-row install hint lets both UI doors and a new `rk gui wm --list` show the same table — so the picker, the CLI, the help text, and a new human-facing site guide all answer "what can I run here and how do I get it" from one derivation. The install hints stay strings rk never executes (Constitution III and the toolkit's install-composition standard: probe, degrade, hint). A generic "wrap this binary in a session bus" flag was considered and deferred (R-D8) — three known rows make it unnecessary today, and where the second bit lives is a real design question.

## What Changes

### 1. The known-desktop table grows by three desktops (R-D1)

`internal/gui/candidates.go` `sessionStarterOrder` becomes (new entries after Plasma, before the generic `x-session-manager`):

```go
var sessionStarterOrder = []string{
	"startlxqt", "lxqt-session",
	"startxfce4", "xfce4-session",
	"startplasma-x11",
	"startlxde",
	"mate-session",
	"cinnamon-session",
	"x-session-manager",
}
```

Because `sessionStarters` in `backend.go` is derived from this slice, the three new starters are automatically wrapped in `dbus-run-session --` and torn down as a process group — no other supervisor change. **The WM ladder (`wmLadder`) does not change** (R-D8).

`WMCandidateLabel` gains `startplasma-x11 → "Plasma"`, `startlxde → "LXDE"`, `mate-session → "MATE"`, `cinnamon-session → "Cinnamon"`. `x-session-manager` keeps its raw name as its label and has no hint (as today).

`cmd/rk/gui_wm.go` `guiWMAliases` gains `lxde → startlxde`, `mate → mate-session`, `cinnamon → cinnamon-session`, `plasma → startplasma-x11`. The `Use` line becomes `wm [auto|icewm|lxqt|xfce|plasma|lxde|mate|cinnamon|<binary>]`.

#### Install lines (`internal/gui/hint.go`)

Four new `dePackages` values, wired into `sessionStarterDEs` for `startplasma-x11`, `startlxde`, `mate-session`, `cinnamon-session`. Existing convention holds: **dnf lines name explicit packages, never a `@group`** (the `lxqtPackages` comment: "dnf names the explicit package list, never the @lxqt-desktop group"); the `generic` line is the `install <x> with your package manager` sentence. Nothing here is ever executed.

| Desktop | apt (Certain — plan + this host's apt index) | dnf (verified against packages.fedoraproject.org, Fedora 43–45 + rawhide) | pacman (verified against archlinux.org) | generic |
|---|---|---|---|---|
| LXDE (`startlxde`) | `sudo apt install --no-install-recommends lxde-core` | `sudo dnf install lxde-common lxsession lxpanel pcmanfm openbox lxterminal` — `lxde-common` ships `/usr/bin/startlxde` | `sudo pacman -S lxde` — the `lxde` group (17 pkgs incl. `lxde-common`, `lxsession`, `lxpanel`, `openbox`, `pcmanfm`) | `install lxde with your package manager` |
| MATE (`mate-session`) | `sudo apt install --no-install-recommends mate-desktop-environment-core` | `sudo dnf install mate-session-manager mate-panel marco caja` — `mate-session-manager` ships `/usr/bin/mate-session` | `sudo pacman -S mate` — the `mate` group (14 pkgs incl. `mate-session-manager`, `mate-panel`, `marco`, `caja`) | `install mate with your package manager` |
| Cinnamon (`cinnamon-session`) | `sudo apt install --no-install-recommends cinnamon-core` | `sudo dnf install cinnamon cinnamon-session nemo` — `cinnamon-session` ships `/usr/bin/cinnamon-session` | `sudo pacman -S cinnamon` — a single package (extra/cinnamon 6.6.x) depending on `cinnamon-session` | `install cinnamon with your package manager` |
| Plasma (`startplasma-x11`) | `sudo apt install --no-install-recommends plasma-desktop` | **No install command.** Fedora ≥ 40 ships Plasma 6 Wayland-only — the "KDE Plasma 6" change dropped the X11 session, and `plasma-workspace-x11` exists only on EPEL 8/9. The dnf line is the honest sentence `Fedora 40+ ships no Plasma X11 session (startplasma-x11 is not packaged) — pick another desktop` | `sudo pacman -S plasma-desktop plasma-x11-session` — since Plasma 6.4 the X11 session is the separate `plasma-x11-session` package (extra, 6.7.x) | `install plasma with your package manager` |

The plan's example `dnf install @lxde-desktop-environment` is **not** used: the Fedora comps group ids could not be fetched (the pagure raw URLs 404), and the codebase convention already avoids groups, so the question is moot. Unit tests in `hint_test.go` cover each new starter × each package manager (the existing `DEInstallHint` table-test shape), and `PinInstallHint("startlxde", …)` returns the LXDE line.

### 2. `wm_candidates` carries the known-but-missing desktops (R-D2)

`WMCandidate` gains `Hint string \`json:"hint,omitempty"\``. `WMCandidates(lookPath)` emits, **in this order**:

1. **Installed rows** as today — ladder then session-starter order, alias-collapsed (one DE = one row), `installed:true`, `hint` empty.
2. **Missing known-desktop rows**, in table order (`startlxqt`, `startxfce4`, `startplasma-x11`, `startlxde`, `mate-session`, `cinnamon-session` — the *primary* starter name of each DE with a `sessionStarterDEs` entry; never the alias `lxqt-session`/`xfce4-session`, never `x-session-manager`), `installed:false`, `kind:"session"`, `hint` = `DEInstallHint(name, lookPath)`.
3. **The IceWM ladder head** (`icewm-session`) when missing: `installed:false`, `kind:"wm"`, `hint` = `WMInstallHint(lookPath)`, positioned first among the missing rows (ladder before starters, mirroring the installed order).

Bare WMs other than IceWM (`openbox`, `xfwm4`, `i3`, `kwin_x11`) appear only when installed, as today. A DE counts as installed when *either* its primary or its alias starter resolved (so a host with only `lxqt-session` gets one installed LXQt row and no missing LXQt row). Missing rows are emitted **only where a desktop can be installed — `goos == "linux"`**; on darwin (the Screen Sharing mirror starts no WM) and with a nil `lookPath` the list stays exactly as today (the nil seam still yields a non-nil empty slice, so the document serializes `[]`).

`WMCandidatesHint` is **deleted**; `Status.WMCandidatesHint` (`wm_candidates_hint`) is removed from `internal/gui/status.go`, and `Assemble` (`assemble.go`) drops the second assignment. The `api/gui_test.go` cases `TestGuiStatusWMCandidates` / `TestGuiStatusWMCandidatesEmptyCarriesHint` are rewritten: the document never carries `wm_candidates_hint`; a Linux lookPath that resolves nothing yields the seven missing rows (IceWM + six DEs) each with its apt hint under an apt-detecting lookPath; a lookPath resolving `startlxqt` yields an installed LXQt row with empty `hint` and no missing LXQt row.

Example document fragment on a host with IceWM and LXQt installed, apt detected:

```json
"wm_candidates": [
  {"name":"icewm-session","label":"IceWM","kind":"wm","installed":true},
  {"name":"startlxqt","label":"LXQt","kind":"session","installed":true},
  {"name":"startxfce4","label":"XFCE","kind":"session","installed":false,"hint":"sudo apt install --no-install-recommends xfce4"},
  {"name":"startplasma-x11","label":"Plasma","kind":"session","installed":false,"hint":"sudo apt install --no-install-recommends plasma-desktop"},
  {"name":"startlxde","label":"LXDE","kind":"session","installed":false,"hint":"sudo apt install --no-install-recommends lxde-core"},
  {"name":"mate-session","label":"MATE","kind":"session","installed":false,"hint":"sudo apt install --no-install-recommends mate-desktop-environment-core"},
  {"name":"cinnamon-session","label":"Cinnamon","kind":"session","installed":false,"hint":"sudo apt install --no-install-recommends cinnamon-core"}
]
```

Compatibility: the frontend is embedded in the same binary; the only other reader is the picker e2e spec, updated in this change. `omitempty` on `hint` keeps installed rows byte-identical to today's shape.

### 3. Both picker doors render missing desktops (R-D3)

`frontend/src/api/client.ts`: `GuiWMCandidate` gains `hint?: string` (and its doc comment drops "installed is always true"); `GuiStatus.wm_candidates_hint` is removed.

`lib/gui-desktop.ts`:
- `WMOption` gains `disabled?: boolean`. `buildWMOptions` emits, after `Auto (ladder)`: installed rows as today, then one **disabled** option per missing row labelled `` `${label} — not installed` `` (e.g. `XFCE — not installed`), then `Other…`.
- New `missingWMs(status): GuiWMCandidate[]` — the `installed === false` rows, in document order (the disclosure's source).
- `buildDesktopPaletteRows` emits the installed rows as today, then one row per missing candidate: `id: \`desktop-${c.name}\``, `label: \`${c.label} (not installed)\``, `description: c.hint` (omitted when the hint is empty), `disabled: true`, inert `onSelect`. The trailing `desktop-install-hint` row is **removed**.

`components/gui-wm-picker.tsx`:
- The `<select>` renders `<option disabled>` for the disabled options (React `disabled` attribute; value = the candidate name, never selectable).
- Beneath the select, when `missingWMs(status)` is non-empty, a **collapsed disclosure** `Install more ▾` (`data-testid="gui-wm-install-more"`) expands to one line per missing desktop, `` `${label}: ${hint}` `` — e.g. `XFCE: sudo apt install --no-install-recommends xfce4` — monospace (`font-mono`), user-selectable text, `data-testid="gui-wm-install-line"` per line. Implementation: the repo's existing collapsible idiom (a native `<details>/<summary>` or the `Control` chip toggling local state — apply picks whichever the codebase already uses in the settings dialog). The old `gui-wm-install-hint` footer paragraph is removed.
- The `Other…` field's placeholder becomes `binary name, e.g. startlxde` (replacing `entry.default || "unset"`).

Palette `GUI: Desktop…` copy (final): `Auto (ladder)` · `IceWM` (`current`) · `LXQt` · `XFCE (not installed)` disabled, description `sudo apt install --no-install-recommends xfce4` · …

Unit tests: `gui-desktop.test.ts` (disabled options, `missingWMs`, palette missing rows, no hint row) and `gui-wm-picker.test.tsx` (disabled `<option>`, disclosure collapsed by default and expanding, placeholder text, no footer) replace the `wm_candidates_hint` cases.

### 4. `rk gui wm --list` and `--json` (R-D4)

Two new flags on `rk gui wm`:

- `--list` prints the candidate table the picker reads — the same `gui.WMCandidates(guiLookPathFn)` derivation — as aligned columns `NAME LABEL KIND INSTALLED HINT`, installed rows first, `INSTALLED` as `yes`/`no`, `HINT` empty for installed rows. Exit 0; state, not a verdict. Read-only: `LookPath` only, no settings write, no tmux.
- `--json` (with `--list`) emits the `wm_candidates` array verbatim (the same JSON the status document carries), following the `rk gui status --json` output idiom (data on stdout via the sink).
- `--list` with a positional argument is a usage error (exit 2, the `usageError` helper). `--list` combined with `--restart` or `--force` is likewise usage.
- The no-argument report (`wm: auto → icewm-session (running)`) is unchanged.

Final copy (from the plan's § UX copy):

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

Tests in `gui_wm_test.go` (seam-injected `guiLookPathFn`): the table shape, `--json` array equality with `gui.WMCandidates`, the usage exits. `rk help-dump` must still exit 0 with valid JSON (the help-dump standard's conformance test already pins this).

### 5. `rk gui wm --help` names the desktops; the setting description points at `--list` (R-D5)

The `Long` text is rewritten to carry:

1. The existing report/pin paragraphs (state-not-verdict, `auto` clears, `--force`, `--restart` chaining).
2. A **known-desktop table**: alias · starter binary · apt install line, one row each for IceWM (`icewm` · `icewm-session` · `sudo apt install --no-install-recommends icewm`, default and seeded), LXQt (seeded), XFCE, Plasma, LXDE, MATE, Cinnamon — with the note that the runtime hint (`--list`, the refusal line) is worded for the detected package manager (apt, dnf, pacman).
3. The **generic recipe**: `sudo apt install <pkg>` → `rk gui wm <starter> --restart`.
4. The **D-Bus caveat**: a binary not in the known list runs bare — panels and trays of an unlisted full desktop may fail on the headless display; ask for it to be added, or run `--list` to see the known set.
5. A `--list` / `--json` paragraph.

Wording is bound by the toolkit `help-dump` standard (the `Long` is captured byte-for-byte into the dump's `text`; the dump must stay valid JSON, exit 0, stderr empty) and by principle №3; it is checked in the apply task by running `bin/rk help-dump | jq .` on a HEAD build.

`internal/settings/settings.go` `gui.wm` description gains one trailing clause: `… Takes effect on rk gui restart. Run rk gui wm --list for installed and installable desktops.`

### 6. Human docs: `docs/site/gui.md` (new), README section + command row, install line (R-D6)

Bound by the `readme-extraction` standard (read: README links into `docs/site/` written naturally as `docs/site/gui.md`; links between `docs/site` pages relative; any link leaving the published set — `docs/specs/`, source — absolute `https://github.com/sahil87/run-kit/blob/main/…`; no images unless absolute; `gui` is not a reserved page name) and the `install-composition` standard (no per-formula `brew install` lines — apt lines for third-party desktops are fine).

**`docs/site/gui.md`** — the boards/notifications guide shape: `# GUI — the host's desktop in a tile`, then the notifications guide's `> [← Back to the README](https://github.com/sahil87/run-kit/blob/main/README.md)` line, then sections in this order:

1. **What it is** — one sentence: the host's desktop as a fourth tile beside tty/code/web, off by default, shared by every viewer and every agent.
2. **Turning it on** — `rk gui on`, what starts (Xvnc on a private display, the window manager, the `rk-gui` supervisor session), the `rk gui status` line, the 4th tile button (⌘4).
3. **Desktops** — the table: IceWM (default, seeded) · LXQt (seeded) · XFCE (stock) · Plasma / LXDE / MATE / Cinnamon (known), with the alias, starter, and apt line per row, plus the note that `rk gui wm --list` prints the lines for *your* package manager and that Fedora ≥ 40 has no Plasma X11 session.
4. **Choosing one** — the three doors: Settings → `gui.wm` picker (disabled `— not installed` rows, `Install more ▾`), palette `GUI: Desktop…`, `rk gui wm <alias> --restart`; "restart closes apps on the display".
5. **Running something rk does not know** — the recipe, the bare-WM caveat (no D-Bus wrap ⇒ panels/trays may fail), `--force`.
6. **Resolution** — fixed `1920x1080` by default, the presets, `auto` (follow the tile), the host lock; `rk gui resize`, `rk gui lock`.
7. **Watching and driving** — phone: pointer modes (trackpad/touch), the key bar, the toolbar pill; laptop: zoom (Ctrl+= / − / 0), fullscreen; quality presets.
8. **Agents** — one paragraph pointing at `rk skill gui`.
9. **macOS is view-only** — the Screen Sharing mirror.
10. **Troubleshooting** — `rk gui status`, `rk doctor`, `GUI: Open supervisor logs`, "nothing installed for you" (the `no VNC backend` hint).

Every command named in the guide must exist in `rk help-dump` (readme-extraction rule 7 cross-checks prose against the dump).

**`README.md`** — a new section `## GUI — the host's desktop in a tile` **between `## Boards — watch many panes at once` and `## Drive it from your phone (HTTPS over Tailscale)`**: three sentences (what it is and that it is off by default; `rk gui on` and the 4th tile; pick a desktop from Settings or `rk gui wm`, IceWM default) plus `See the [GUI guide](docs/site/gui.md) for desktops, resolution, phone controls, and troubleshooting.` And a `rk gui` row in § Command reference, placed after `rk cron`: `` | `rk gui` | The host's desktop as a tile — `on`/`off`/`status`, `wm` (pick a desktop; `--list` shows installed and installable ones), `resize`, and the agent verbs (`exec`, `shot`, `key`). | ``.

**`docs/site/install.md`** § Prerequisites — one added bullet: `Optional — the GUI tile (the host's desktop in the dashboard) needs a VNC X server and a window manager: \`sudo apt install --no-install-recommends tigervnc-standalone-server icewm\` on Debian/Ubuntu; \`rk gui status\` prints the line for your package manager. See the [GUI guide](gui.md).`

### 7. Skill page: one gotcha line, byte-identical pair, inside budget (R-D7)

`docs/site/skill/gui.md` line 139 (the "desktop may be a full DE" gotcha) becomes: `- **The desktop may be a full DE** — IceWM is the default; the user may pin any known desktop (\`rk gui wm --list\` names them, \`rk gui wm lxqt\` pins one); every verb on this page works identically regardless. On a full desktop \`rk gui windows\` also lists the DE's panel as a window — filter by \`app\` when looking for user apps.` One line edited, none added — the page stays at 139 of the 150-line `skillLineBudget`. `cmd/rk/skill/gui.md` is kept byte-identical (`cmp` in the apply task; the drift-guard test enforces it).

### 8. Spec amendment and e2e (Touches)

`docs/specs/gui.md` § Switching desktops: the alias list gains `plasma|lxde|mate|cinnamon`; the `wm_candidates` sentence becomes `{name, label, kind: wm|session, installed, hint?}` with installed-then-missing ordering and the per-row hint; `wm_candidates_hint` is struck; the picker paragraph describes the disabled rows and the `Install more ▾` disclosure; a `rk gui wm --list` sentence is added; the LXQt-seeded paragraph is unchanged.

`tests/e2e/gui-desktop-picker.spec.ts`: the stubbed `GET /api/gui/host` document gains a missing XFCE row `{ name: "startxfce4", label: "XFCE", kind: "session", installed: false, hint: "sudo apt install --no-install-recommends xfce4" }`; the existing "no install hint" test is replaced by two tests with Proves/Steps intent blocks (constitution § Test Intent Comments): (a) the Settings select lists `Auto`, both installed candidates, a disabled `XFCE — not installed` option, and `Other…`, and the `Install more ▾` disclosure expands to the exact `XFCE: sudo apt …` line; (b) the palette sub-list shows `XFCE (not installed)` disabled with the hint as its description and Enter on it does nothing. The file-header comment is updated accordingly.

### Out of scope (R-D8)

A generic "wrap this binary in a session bus" flag or `gui.wm_session` setting (recorded as a follow-up); GNOME; installing anything from rk; changing the WM ladder order; a wallpaper or theme picker; anything in T1 (the toolbar pill).

### Manual acceptance

**None required on the live `rk-gui` session** — R1 never restarts the desktop. Do not run `rk gui wm … --restart` on the live host as part of acceptance; that `--force` still pins is a unit test. Do not install LXDE/MATE/Cinnamon on the host to "test" the missing rows — the missing rows are the point, and the e2e stubs the status document.

## Affected Memory

- `run-kit/gui`: (modify) § The `rk gui` CLI family — the `wm` verb's new aliases, `--list`/`--json`, the rewritten help; the supervisor's session-starter set (+3); § Design Decisions — new entries "Known-but-missing desktops ride `wm_candidates`" (why: choices, not inventory; per-row hints retire the LXQt footer) and "Fedora Plasma has no X11 session; the dnf line is a sentence"; the picker section's `wm_candidates_hint` references removed.
- `run-kit/configuration`: (modify) § Settings Registry — the `gui.wm` row's description gains the `--list` clause and the alias list.
- `run-kit/ui/keyboard-and-palette`: (modify) § The `GUI:` palette family — `GUI: Desktop…` rows: missing desktops as disabled `(not installed)` rows with the install line as description; the `Install more:` footer row removed.
- `run-kit/ui/dialogs-and-state`: (modify) the Settings `gui.wm` picker description — disabled options, the `Install more ▾` disclosure, the `Other…` placeholder.
- `run-kit/toolkit-standards`: (modify) the help-dump + P9 new-surface check gains the `gui wm --list`/`--json` flags; the README/docs/site conformance note records the new `docs/site/gui.md` page and the README GUI section.
- `run-kit/api-and-sockets`: (modify) the `GET /api/gui/{id}` document — `wm_candidates` row shape (`installed:false` rows + `hint`), `wm_candidates_hint` removed.

## Impact

**Backend (Go, `app/backend/`)**: `internal/gui/candidates.go` (+3 starters, labels, missing rows, `Hint`, `WMCandidatesHint` removed), `internal/gui/hint.go` (+4 `dePackages`, `sessionStarterDEs` rows), `internal/gui/status.go` + `assemble.go` (drop `wm_candidates_hint`), `cmd/rk/gui_wm.go` (aliases, `--list`, `--json`, `Long`), `internal/settings/settings.go` (`gui.wm` desc), tests: `candidates_test.go`, `hint_test.go`, `gui_wm_test.go`, `api/gui_test.go`, `settings_test.go` if it pins descriptions. The supervisor gains no code — `sessionStarters` derives from the slice.

**Frontend (`app/frontend/src/`)**: `api/client.ts`, `lib/gui-desktop.ts` (+ test), `components/gui-wm-picker.tsx` (+ test), `lib/palette/gui.ts` untouched (rows come from `buildDesktopPaletteRows`). `tests/e2e/gui-desktop-picker.spec.ts`.

**Docs**: `docs/site/gui.md` (new), `README.md`, `docs/site/install.md`, `docs/site/skill/gui.md` + `app/backend/cmd/rk/skill/gui.md` (byte-identical), `docs/specs/gui.md`.

**API surface**: additive `hint` field on `wm_candidates` rows; `installed:false` rows appear on Linux; `wm_candidates_hint` removed (sole readers updated in-change). No new route (Constitution IV); `--list` is a flag on an existing verb.

**Security**: hints are strings, never executed; `--list` runs `LookPath` only (Constitution I).

**Verification gates**: `just test-backend`, `pnpm exec tsc --noEmit` via `just test-frontend`, `just test-e2e "e2e/gui-desktop-picker"` (one spec per run), `bin/rk help-dump | jq .` on a HEAD build, `cmp docs/site/skill/gui.md app/backend/cmd/rk/skill/gui.md`, `skill_test.go` budget; the known environmental e2e set (boards-multi-server, create-server-waiting, legacy-*-sweep, multi-server-sidebar, protected-kill-confirm, plus the status-bar / surface-layout load flakes) is pre-existing in long-named worktrees and is not this change's.

## Open Questions

- None blocking. Informational: the Fedora comps group ids (`lxde-desktop` / `lxde-desktop-environment` etc.) could not be fetched (pagure raw URLs 404 for f43/f44/f45); this is moot because the codebase convention names explicit dnf packages rather than groups, and every dnf package name used is verified on packages.fedoraproject.org for Fedora 43–45.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `sessionStarterOrder` grows to `…startplasma-x11, startlxde, mate-session, cinnamon-session, x-session-manager`; labels `LXDE`/`MATE`/`Cinnamon`/`Plasma`; aliases `lxde`/`mate`/`cinnamon`/`plasma`; WM ladder unchanged | Plan R-D1, user-declared Certain; the supervisor's D-Bus wrap derives from the slice so no other code moves | S:95 R:85 A:95 D:95 |
| 2 | Certain | apt lines: `lxde-core`, `mate-desktop-environment-core`, `cinnamon-core`, `plasma-desktop` (all `--no-install-recommends`) | Plan R-D1 Certain; confirmed resolving in this host's Ubuntu 22.04 apt index | S:95 R:90 A:95 D:95 |
| 3 | Certain | pacman lines: `sudo pacman -S lxde` (group), `sudo pacman -S mate` (group), `sudo pacman -S cinnamon`, `sudo pacman -S plasma-desktop plasma-x11-session` | Plan marked Likely; resolved by lookup — the `lxde` and `mate` groups and the `cinnamon` and `plasma-x11-session` (Plasma 6.7) packages verified on archlinux.org | S:90 R:90 A:90 D:90 |
| 4 | Confident | dnf lines name explicit verified packages: LXDE `lxde-common lxsession lxpanel pcmanfm openbox lxterminal`; MATE `mate-session-manager mate-panel marco caja`; Cinnamon `cinnamon cinnamon-session nemo` | Every package verified active on packages.fedoraproject.org (F43–45); the session binaries' owning packages confirmed via file lists. The *set* is a best-effort minimal desktop (the XFCE/LXQt rows' precedent), and hints are wording never executed | S:80 R:90 A:75 D:70 |
| 5 | Certain | The Plasma dnf line is a sentence, not a command: `Fedora 40+ ships no Plasma X11 session (startplasma-x11 is not packaged) — pick another desktop` | Fedora's "KDE Plasma 6" change dropped the X11 session in F40; `plasma-workspace-x11` shows only EPEL 8/9 builds. A fake install command would be worse than an honest sentence; the `generic` fallback idiom already allows prose | S:75 R:90 A:80 D:70 |
| 6 | Certain | dnf lines never use `@group` ids; the plan's `@lxde-desktop-environment` example is dropped | Codebase convention (`lxqtPackages` comment) — the unfetchable comps ids are moot | S:85 R:95 A:95 D:90 |
| 7 | Certain | `wm_candidates` emits known-but-missing DE rows (primary starter, `installed:false`, per-row `hint`), plus a missing `icewm-session` row; installed rows first (ladder→starter), missing rows in table order; alias collapse unchanged; `wm_candidates_hint` retired | Plan R-D2 | S:95 R:80 A:90 D:90 |
| 8 | Confident | Missing rows are emitted only on Linux (`goos == "linux"`); darwin and nil-`lookPath` keep today's output | R-D2 is silent; the hint functions already gate on Linux and the darwin backend starts no WM, so a missing row there would carry an empty hint and an uninstallable choice | S:60 R:90 A:85 D:75 |
| 9 | Certain | Settings select: disabled `<option>` `Label — not installed`; a collapsed `Install more ▾` disclosure with one monospace selectable `Label: hint` line per missing desktop; `Other…` placeholder `binary name, e.g. startlxde`. Palette: disabled `Label (not installed)` rows, description = hint, after installed rows; the `Install more:` footer row removed | Plan R-D3 + § UX copy | S:95 R:90 A:90 D:95 |
| 10 | Confident | The disclosure is built with the repo's existing collapsible idiom (native `<details>/<summary>` or a `Control` chip toggling local state) — apply picks the pattern already used in the settings dialog | Implementation detail below the plan's resolution; trivially reversible; either satisfies the copy and test ids | S:60 R:95 A:80 D:70 |
| 11 | Certain | `rk gui wm --list` prints `NAME LABEL KIND INSTALLED HINT`, installed first, `HINT` empty for installed; `--json` emits the `wm_candidates` array verbatim; `--list` + positional (or `--restart`/`--force`) is usage exit 2; the bare report is unchanged | Plan R-D4 + § UX copy; usage-exit convention is the repo's `usageError` | S:95 R:90 A:90 D:90 |
| 12 | Certain | `--json` reuses the `rk gui status --json` sink idiom (data on stdout) rather than a new output path | Existing `newSink(cmd)`/`Dataf` seam in `gui_wm.go`; the status verb already has a `--json` form | S:70 R:95 A:85 D:80 |
| 13 | Certain | `Long` gains the known-desktop table (alias · starter · apt line, package-manager note), the generic recipe, the D-Bus caveat, the `--list` paragraph; `gui.wm` description gains `Run rk gui wm --list for installed and installable desktops.` | Plan R-D5; bound by the help-dump standard (checked: the dump only requires exit 0/valid JSON/hidden-node filtering — prose is free) | S:95 R:95 A:90 D:90 |
| 14 | Certain | New `docs/site/gui.md` with the ten sections in R-D6's order; README `## GUI — the host's desktop in a tile` between Boards and the phone section (three sentences + guide link) and a `rk gui` command-reference row; one optional-GUI bullet in `docs/site/install.md` § Prerequisites | Plan R-D6; standards read (`readme-extraction`: natural `docs/site/gui.md` link from README, relative links inside docs/site, absolute for anything else, `gui` not a reserved name; `install-composition`: no `brew install` lines) | S:95 R:90 A:90 D:90 |
| 15 | Certain | The site guide opens with the notifications guide's `> [← Back to the README](https://github.com/…/README.md)` line and H1-then-sections shape | R-D6 says "the boards/notifications guide shape"; notifications carries the back-link, boards does not — the back-link is the richer, standard-safe (absolute) form | S:70 R:95 A:85 D:75 |
| 16 | Certain | Skill gotcha line 139 reworded to "IceWM is the default; the user may pin any known desktop (`rk gui wm --list` …)"; no new lines; `cmd/rk/skill/gui.md` kept byte-identical; 139/150 budget holds | Plan R-D7; `skillLineBudget` test and drift guard enforce it | S:95 R:95 A:95 D:95 |
| 17 | Certain | Out of scope: session-bus flag/setting, GNOME, installing from rk, ladder order, wallpaper/theme picker, anything toolbar | Plan R-D8 | S:95 R:95 A:95 D:95 |
| 18 | Certain | `docs/specs/gui.md` § Switching desktops amended (aliases, row shape, ordering, hint, disclosure, `--list`); `wm_candidates_hint` struck | Plan § Change breakdown → R1 Touches | S:90 R:95 A:90 D:90 |
| 19 | Certain | E2E: the picker spec's stubbed document gains a missing XFCE row with its hint; two new intent-commented tests (Settings disabled option + disclosure line; palette disabled row) replace the "no install hint" test; run as `just test-e2e "e2e/gui-desktop-picker"` | Plan task (6); constitution § Test Intent Comments; memory on one-spec-per-run filtering | S:90 R:90 A:90 D:90 |
| 20 | Certain | No manual acceptance on the live `rk-gui` desktop; never run `rk gui wm … --restart` on the live host; never install desktops on the host to test | Plan § R1 Manual acceptance + user instruction | S:100 R:100 A:100 D:100 |
| 21 | Certain | Change type stays `feat` (new CLI flags, API field, UI rows) even though the change carries a new docs page | The behavior surface grows; docs are one of eight tasks | S:85 R:95 A:90 D:90 |

21 assumptions (18 certain, 3 confident, 0 tentative, 0 unresolved).
