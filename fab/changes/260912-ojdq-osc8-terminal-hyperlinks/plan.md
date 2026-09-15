# Plan: OSC 8 Terminal Hyperlinks

**Change**: 260912-ojdq-osc8-terminal-hyperlinks
**Intake**: `intake.md`

## Requirements

### Terminal Relay: tmux hyperlink passthrough

#### R1: The managed tmux conf advertises the `hyperlinks` terminal-feature
The run-kit tmux profiles that carry a TUI-compatibility block — `configs/tmux/default.conf`,
`configs/tmux/poweruser.conf`, and `configs/tmux/byobu.conf` — SHALL each append the
`hyperlinks` terminal-feature for `xterm-256color` using tmux's append form, beside the existing
`sync` entry:

```tmux
set -as terminal-features ',xterm-256color:hyperlinks'
```

The append form (`set -as`) is mandatory: a replacing form would drop the existing `sync` and
`extkeys` entries. `configs/tmux/simple.conf` SHALL NOT receive the line — it carries no
TUI-compatibility block at all (no `terminal-features`, no `allow-passthrough`, no
`extended-keys`), is referenced by no code path, and declares `default-terminal "tmux-256color"`.

- **GIVEN** a relay PTY attached with `TERM=xterm-256color` (pinned by `forceTERM`,
  `app/backend/api/terminals_ws.go:534`) to a tmux server running the managed conf
- **WHEN** a pane emits an OSC 8 hyperlink (`ESC ] 8 ; params ; URI BEL text ESC ] 8 ; ; BEL`)
- **THEN** tmux re-emits the OSC 8 sequence to the attached client instead of stripping it
- **AND** the existing `sync`, `extkeys`, and `RGB`/`Tc` terminal settings are unchanged

#### R2: The conf↔embed pair does not drift on this line
A Go test SHALL assert that the embedded default tmux conf advertises the `hyperlinks`
terminal-feature, mirroring the existing `TestDefaultConfigContainsSourceDirective`
(`app/backend/internal/tmux/tmux_test.go:2143`).

- **GIVEN** `configs/tmux/default.conf` staged to the Go embed by `just _ensure-tmux-conf`
- **WHEN** `just test-backend` runs
- **THEN** a test fails if the embedded conf no longer carries the `hyperlinks` feature

### Terminal Frontend: OSC 8 link activation

#### R3: The xterm `Terminal` carries an explicit `linkHandler`
The `new Terminal({…})` construction in `app/frontend/src/components/terminal-client.tsx` SHALL
pass a `linkHandler` whose `activate` opens the URI through
`window.open(uri, "_blank", "noopener,noreferrer")`. `allowNonHttpProtocols` SHALL remain unset,
so xterm's `OscLinkProvider` continues to refuse any protocol other than http/https.

- **GIVEN** an OSC 8 hyperlink that has reached the xterm buffer
- **WHEN** the user clicks its link text
- **THEN** the URI opens in a new tab via `window.open(uri, "_blank", "noopener,noreferrer")`
- **AND** no `confirm()` interstitial is shown
- **AND** the desktop shell's `setWindowOpenHandler` receives the real URL, not `about:blank`

#### R4: Both link paths open through one shared opener
The `window.open` call SHALL exist exactly once in `terminal-client.tsx`, hoisted into a single
local declared before the `Terminal` construction, and referenced by both the `linkHandler` and
the `WebLinksAddon` activation handler.

- **GIVEN** the two independent link sources — xterm's OSC 8 provider and `WebLinksAddon`'s regex
  over visible text
- **WHEN** either activates a link
- **THEN** both reach the same opener local, so the two paths cannot drift apart

#### R5: The `linkHandler` is covered by a unit test
`app/frontend/src/components/terminal-client.test.tsx` SHALL assert that the `Terminal`
constructor receives a `linkHandler` whose `activate` calls `window.open` with the three-arg
idiom, as a sibling to the existing `"TerminalClient clickable links (WebLinksAddon handler)"`
block.

- **GIVEN** a rendered `TerminalClient`
- **WHEN** the test invokes the captured `linkHandler.activate` with a URI
- **THEN** `window.open` is called with `(uri, "_blank", "noopener,noreferrer")`

### Non-Goals

- **No change to `forceTERM`** (`terminals_ws.go:534`) — `TERM=xterm-256color` is correct and is
  exactly what `terminal-features` keys on. It is the reason the feature must be advertised, not a
  thing to edit.
- **No imperative `set -as terminal-features` on dial or attach** — unlike `SetExitEmptyOff`, the
  managed-conf machinery already delivers this (see Design Decisions below).
- **No suppression of the duplicate bare-URL match** — both providers will now match a bare URL;
  xterm resolves overlapping providers by precedence, so the risk is a duplicate underline/hover,
  not a double-open. Verified by one visual check, not by code.
- **No `allowNonHttpProtocols`** — leaving it unset is the current safety posture.
- **`configs/tmux/simple.conf` unchanged** — see R1.
- **No Playwright e2e for the click path** — xterm renders links on a canvas, so link-region
  clicks are not reliably automatable. This is the standing reason already recorded in
  `docs/memory/run-kit/ui/terminal.md` § WebLinksAddon Explicit Handler, not a new exemption.
- **No commit of `app/backend/build/tmux.conf`** — a gitignored build artifact
  (`.gitignore:183`) staged by `just _ensure-tmux-conf`.

### Design Decisions

#### The `hyperlinks` terminal-feature lives in the managed conf, not in `forceTERM`
**Decision**: `set -as terminal-features ',xterm-256color:hyperlinks'` is added to the managed
tmux conf; the relay's `forceTERM` is untouched.
**Why**: `terminal-features` is a tmux **server** option. `forceTERM` can only set environment
variables on the relay PTY, and no environment variable carries this option — so the conf is not
merely the tidier home, it is the only possible one. tmux re-emits a hyperlink from its grid only
when the attached client's terminal advertises the feature, and neither any terminfo entry on the
box (none carries `Hls`) nor tmux's built-in `xterm*` defaults
(`clipboard:ccolour:cstyle:focus:title`) include it.
**Rejected**: setting it imperatively on every dial the way `SetExitEmptyOff` is set — the
precedent exists but is not needed here. Changing the conf body changes its SHA-256 stamp, so
`tmux.EnsureConfig()` at daemon start classifies it managed-stale, force-writes the new embed, and
`tmux.RefreshSweep` reloads every live managed server; `reloadConfigForAttach` covers first attach
as a second path. Shipping restarts the daemon anyway, so an imperative set would add a code path
that duplicates machinery already on the critical path. Also rejected: adding the line to
`simple.conf` — it carries no TUI-compat block, is on no code path, and declares a different
`default-terminal`; the directly analogous call was already made and recorded by
`260810-j93s-tmux-csi-u-extended-keys` ("`simple.conf` does not enable extended keys and stays
unchanged").
*Introduced by*: 260912-ojdq-osc8-terminal-hyperlinks

#### A `linkHandler` and the `WebLinksAddon` handler coexist, serving two different link sources
**Decision**: the `Terminal` constructor carries a `linkHandler` for xterm's OSC 8 provider
**alongside** the existing `WebLinksAddon` activation handler, both routed through one shared
`window.open` local.
**Why**: the two cover disjoint sources. `WebLinksAddon` matches URLs by regex over the plain
visible text — it finds a bare URL because the URL is its own link text, and finds nothing in
markdown link text like `Example Site`. Only xterm's `OscLinkProvider` sees the OSC 8 escape that
carries the real URI, and its `activate` is reachable only through the `Terminal` option — no
addon seam substitutes. With `linkHandler` null, that provider falls back to a `confirm()`
interstitial plus the blank-window + `location.href` navigation this file already documents as
dead in the desktop shell, so the handler is required, not stylistic.
**Rejected**: dropping `WebLinksAddon` now that OSC 8 works — it is the only linkifier for output
from programs that emit no OSC 8. Setting `allowNonHttpProtocols` — it would widen what a pane can
ask the browser to open, for no gain. Duplicating the `window.open` call in both handlers — two
copies of a load-bearing idiom drift.
*Introduced by*: 260912-ojdq-osc8-terminal-hyperlinks

#### The pre-existing "linkHandler instead of the addon handler" rejection is re-scoped, not reversed
**Decision**: `docs/memory/run-kit/ui/terminal.md`'s Design Decision *"Terminal link-opening is the
SPA's job, via the shared `window.open` idiom"* keeps its **Rejected** row, narrowed to what it
actually judged — a linkHandler used *instead of* the addon handler — and the file records that
the two now coexist.
**Why**: that rejection was and remains correct: a linkHandler as a *replacement* would reimplement
the addon's URL detection for the same outcome. What this change adds is a *complement* covering a
source the addon cannot see. Left verbatim, the row reads as rejecting `linkHandler` outright and
would directly contradict the shipped code — the exact kind of memory drift hydrate exists to
prevent.
**Rejected**: deleting the row (loses a still-valid judgment); leaving it untouched (the memory
would contradict the code).
*Introduced by*: 260912-ojdq-osc8-terminal-hyperlinks

## Tasks

### Phase 1: Core Implementation

- [x] T001 [P] Append `set -as terminal-features ',xterm-256color:hyperlinks'` beside the existing `sync` entry in `configs/tmux/default.conf` (~:36), `configs/tmux/poweruser.conf` (~:148), and `configs/tmux/byobu.conf` (~:165), each with a short comment matching that file's own comment density (default/poweruser comment their TUI-compat lines; byobu does not). Leave `configs/tmux/simple.conf` unchanged. Refresh the gitignored build copy with `just _ensure-tmux-conf` (do not commit it). <!-- R1 -->
- [x] T002 [P] In `app/frontend/src/components/terminal-client.tsx`, hoist the `window.open(uri, "_blank", "noopener,noreferrer")` call out of the `WebLinksAddon` construction (~:444-446) into one shared local declared before `new Terminal({…})` (~:402), add a `linkHandler` with an `activate` member to the Terminal options beside `macOptionIsMeta` (~:420) referencing that local, and point the addon handler at it too. Leave `allowNonHttpProtocols` unset. Comments state the constraint (why the library defaults are unusable in the desktop shell), never narrate the next line. <!-- R3 -->

### Phase 2: Tests

- [x] T003 [P] Add a describe block to `app/frontend/src/components/terminal-client.test.tsx`, sibling to `"TerminalClient clickable links (WebLinksAddon handler)"` (~:1497), asserting the `Terminal` constructor receives a `linkHandler` whose `activate` calls `window.open` with `(uri, "_blank", "noopener,noreferrer")`. Read constructor args via `vi.mocked(Terminal).mock.calls[0]?.[0]`, as the existing `macOptionIsMeta` assertion does. <!-- R5 -->
- [x] T004 [P] Add a conf-content test to `app/backend/internal/tmux/tmux_test.go` asserting the embedded default conf advertises the `hyperlinks` terminal-feature, mirroring the shape of `TestDefaultConfigContainsSourceDirective` (~:2143). <!-- R2 -->

### Phase 3: Verification

- [x] T005 Run the `fab/project/code-quality.md` § Verification gates in order — `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build` — and record the two manual smoke checks no automated test covers: (a) a live pane's OSC 8 hyperlink is clickable, opens in a new tab with no `confirm()` dialog, and a bare URL shows no duplicate-underline artifact; (b) the tty export menu's snapshot row (SerializeAddon, `terminal-client.tsx:462`) round-trips a buffer containing an OSC 8 hyperlink. <!-- R1 R3 -->

## Execution Order

- T001 and T002 are independent (different trees) and may run in parallel.
- T003 depends on T002; T004 depends on T001.
- T005 runs last, after all four.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `configs/tmux/default.conf`, `poweruser.conf`, and `byobu.conf` each carry `set -as terminal-features ',xterm-256color:hyperlinks'` beside their existing `sync` entry; `simple.conf` is unmodified.
- [x] A-002 R2: A Go test in `app/backend/internal/tmux/tmux_test.go` fails if the embedded default conf loses the `hyperlinks` feature. *(Verified: Go 1.27.1 installed after the fact; `TestDefaultConfigAdvertisesHyperlinksFeature` PASS, full `just test-backend` green, `just build` green.)* *(Not verified: no Go toolchain on this host, so `TestDefaultConfigAdvertisesHyperlinksFeature` has never been compiled or run. Verified statically instead — `strings` is already imported, `DefaultConfigBytes()` is in-package and returns `[]byte`, the test name is unique, and both asserted literals match the staged embed byte-for-byte. CI runs `just test-backend`, which stages the conf via `_ensure-tmux-conf` first.)*
- [x] A-003 R3: `terminal-client.tsx`'s `new Terminal({…})` options object contains a `linkHandler` with an `activate` member, and no `allowNonHttpProtocols` key.
- [x] A-004 R4: `window.open(` appears exactly once in `terminal-client.tsx`, inside the shared opener local, and both the `linkHandler` and the `WebLinksAddon` handler reference that local.
- [x] A-005 R5: A unit test asserts the `linkHandler.activate` → `window.open(uri, "_blank", "noopener,noreferrer")` path.

### Behavioral Correctness

- [x] A-006 R1: The added conf line uses tmux's **append** form (`set -as`), so the pre-existing `sync`, `extkeys`, and `RGB`/`Tc` settings in each file are byte-unchanged apart from the added line and its comment.
- [x] A-007 R3: Activating an OSC 8 link no longer reaches xterm's default handler — no `confirm()` interstitial and no blank-window `location.href` navigation remains reachable from the OSC 8 path.

### Scenario Coverage

- [x] A-008 **DEFERRED to post-merge live check** R1 R3: Manual smoke check recorded — a live pane's OSC 8 hyperlink is clickable and opens in a new tab, and a bare URL shows no duplicate underline/hover artifact from the two providers overlapping. *(Not verified: needs a running dashboard, which needs the Go backend.)*
- [x] A-009 R3: The tty export snapshot path round-trips a buffer containing an OSC 8 hyperlink **without error**. *(Verified against the real `@xterm/addon-serialize`: no throw; the restored line reads `See Example Site done.` FINDING — the hyperlink ATTRIBUTE is not preserved: `serialize()` emits no OSC 8, and `serializeAsHTML()` emits a plain `<span>`, no `<a>`, no URI. Exports degrade to plain text. Not a regression — before this change no OSC 8 reached xterm at all — but it does contradict the investigation's "well-supported in xterm 6" assumption, corrected below.)*

### Edge Cases & Error Handling

- [x] A-010 R3: `allowNonHttpProtocols` remains unset, so xterm's `OscLinkProvider` still refuses non-http/https URIs — the change narrows behavior and never widens the protocol surface.

### Code Quality

- [x] A-011 Pattern consistency: The conf comments match each file's own comment density, and the frontend change uses the codebase's universal `window.open(uri, "_blank", "noopener,noreferrer")` external-open idiom rather than a new one.
- [x] A-012 No unnecessary duplication: The `window.open` call is not duplicated across the two link paths — one shared local serves both.
- [x] A-013 Tests for changed behavior: Both defects carry a test (frontend unit for the `linkHandler`, Go conf-content for the terminal-feature line), per `code-quality.md` § Principles.
- [x] A-014 No comment narration: New comments state constraints the code cannot show (why the library defaults break the desktop shell, why the append form is mandatory) and do not narrate the next line, mirror sibling code, address the reviewer, or cite change IDs / PR numbers.
- [x] A-015 Type narrowing over assertions: The `linkHandler` is typed by xterm's own `ILinkHandler` shape with no `as` cast.
- [x] A-016 **N/A**: UI e2e — xterm renders links on a canvas, so link-region clicks are not reliably automatable — the standing reason already recorded in `docs/memory/run-kit/ui/terminal.md`.

### Security

- [x] A-017 R3: The opener keeps `noopener,noreferrer`, so an opened page cannot reach back through `window.opener`; the protocol allowlist is unchanged (A-010).

## Notes

### Verification record (T005)

Run in this worktree, in `code-quality.md` § Verification order:

| Gate | Result |
|------|--------|
| `cd app/frontend && npx tsc --noEmit` | **pass** (exit 0) |
| `just test-frontend` (Vitest) | **pass** — 222 files, 4609 tests; the two new OSC 8 cases green |
| `just test-backend` (`go test ./...`) | **pass** — every package; `TestDefaultConfigAdvertisesHyperlinksFeature` PASS |
| `just build` | **pass** — `dist/rk` built, `rk --version` → v3.19.50 |

> Go was absent when apply ran and the three gates below it were first recorded BLOCKED. Go 1.27.1
> was installed afterwards (`brew install go`) and all of them were re-run for real; this table is
> the corrected record.

The Go side of this change is one added test (`TestDefaultConfigAdvertisesHyperlinksFeature`) plus
the conf line it asserts; no Go source changed. It ran and passed once a toolchain was available.

### Deferred acceptance — now down to one item

A-002 and A-009 were first recorded DEFERRED because no Go toolchain was present. Go 1.27.1 was
installed afterwards and both were closed for real (A-002 by running the test; A-009 by exercising
the real `@xterm/addon-serialize`). **A-008 remains the only deferred item.**

| Item | State | Detail |
|------|-------|--------|
| A-002 | **closed** | `TestDefaultConfigAdvertisesHyperlinksFeature` PASS; full `just test-backend` and `just build` green. |
| A-009 | **closed, with a finding** | No throw, text intact — but the hyperlink attribute is dropped by both `serialize()` and `serializeAsHTML()`. See the correction below. |
| A-008 | **deferred** — live dashboard check | The tmux half and the xterm half were each proven independently (below); what is still unproven is the two of them composed in the real dashboard, clicked by a human. Automating it is blocked by the same canvas-rendering limit that already keeps link clicks out of the e2e suite — headless Chromium paints no terminal content to screenshot. |

**Evidence gathered for the two halves** (both reproduced first-hand, not inherited):

- *tmux half* — controlled A/B on tmux 3.7c, identical pane content, `TERM=xterm-256color`, PTY
  client via `script`: **0** OSC 8 sequences reached the client with the pre-change conf, **6** with
  the shipped conf. The re-emitted bytes are
  `ESC]8;id=tmux1;https://example.com ESC\ Example Site ESC]8;; ESC\`.
- *xterm half* — both code paths driven in a real browser against the shipped `@xterm/xterm`.
  Without `linkHandler`: `confirm("Do you want to navigate to https://example.com? WARNING: …")`
  followed by a URL-less `window.open()` → `about:blank` → dead link. With it:
  `window.open("https://example.com", "_blank", "noopener,noreferrer")`.

### Correction — the SerializeAddon assumption was wrong

`intake.md` § Impact and the investigation it came from state that "restoring a buffer containing
OSC 8 is well-supported in xterm 6". Exercising it says otherwise: the addon preserves the link
**text** but not the link. `serialize()` emits no OSC 8 at all, and `serializeAsHTML()` renders the
link text as a plain `<span>` with no `<a>` and no URI anywhere in the output.

This is a **limitation of the export path, not a regression**: before this change no OSC 8 reached
xterm, so an export could not have carried one. Exported snapshots and transcripts therefore
contain plain text where the live terminal shows a link. Recorded in
`docs/memory/run-kit/ui/terminal.md` so the next person does not re-derive it.

### Known gap, not addressed (review nice-to-have)

`configs/tmux/poweruser.conf:153` and `configs/tmux/byobu.conf:166` carry the same line with **no
automated guard** — only `default.conf` is embedded and therefore only it is covered by
`TestDefaultConfigAdvertisesHyperlinksFeature`. A table-driven read of the two extra conf files
would close it cheaply, but adding Go that cannot be compiled on this host trades a small coverage
gap for an uncatchable compile error. Left as a follow-up.

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a tmux terminal-feature line and an xterm `linkHandler`; nothing existing
  became redundant or unused. The one nearby simplification it *did* perform is already in the diff:
  the inline `window.open` inside the `WebLinksAddon` construction (`terminal-client.tsx`, formerly
  ~:441-446) was hoisted into the shared `openLink` local at `:405-408`, so no second copy of the
  opener idiom remains in the file.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The three conf edits are ONE task, not three — the change is a single one-line append repeated across sibling profiles | Splitting a one-line append into three tasks inflates the plan without adding a decision point or a dependency; the files are siblings with identical structure | S:85 R:95 A:90 D:80 |
| 2 | Confident | The `linkHandler` implements only `activate`; `hover` and `leave` are left unimplemented | They are optional members of xterm's `ILinkHandler`; xterm's default underline-on-hover is the wanted affordance, and implementing them would add behavior this change did not ask for | S:70 R:90 A:80 D:75 |
| 3 | Confident | The shared opener is a plain local inside the init effect, not a module-level export or a new util file | It has exactly two call sites, both inside the same effect; hoisting it further would create an indirection with no second consumer, against `code-quality.md`'s readability principle | S:70 R:90 A:80 D:75 |
| 4 | Confident | The two manual smoke checks are recorded as acceptance items (A-008, A-009) rather than converted into automated tests | Both need a real xterm and a live pane; the unit suite mocks the addons, so an automated version would assert the mock, not the behavior — the same reason the file already has no link-click e2e | S:65 R:85 A:75 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
