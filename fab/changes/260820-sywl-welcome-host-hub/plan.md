# Plan: Welcome Host Hub

**Change**: 260820-sywl-welcome-host-hub
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Welcome Page Restyle

#### R1: SPA design-token restyle with system theme response
The welcome page's inline CSS SHALL define the SPA's actual design-token values as CSS custom properties (copied, never imported — the page keeps its `default-src 'none'` CSP and stays fully self-contained) and SHALL respond to `prefers-color-scheme` with the SPA's light-theme values. Token values are copied from `app/frontend/src/globals.css`: dark `--bg-primary:#0f1117`, `--bg-card:#171b24`, `--bg-inset:#0a0c12`, `--text-primary:#e8eaf0`, `--text-secondary:#7a8394`, `--border:#454d66`, `--accent:#5b8af0`, `--accent-green:#22c55e`, `--signal-yellow:#facc15`, `--signal-red:#f87171`; light `#f8f9fb`, `#ffffff`, `#e8eaef`, `#1a1d24`, `#6b7280`, `#d1d5db`, `#4a7ae8`, `#16a34a`, `#b07d02`, `#dc2626`. All hardcoded colors in the page (card, inputs, buttons, dividers, dots, `code`, error/progress lines, the static titlebar strip) SHALL move to these variables; `color-scheme` becomes `light dark`. Buttons and input focus SHALL use `--accent` (the SPA accent, replacing the page's legacy `#34d399` green); the running dot uses `--accent-green`; starting/progress amber uses `--signal-yellow`; errors use `--signal-red`. No manual theme toggle is added.

- **GIVEN** the welcome page under a system dark appearance
- **WHEN** it renders
- **THEN** every surface uses the SPA dark token values (pixel-comparable to the SPA's dark theme surfaces)

- **GIVEN** the welcome page under a system light appearance
- **WHEN** it renders
- **THEN** the light token values apply throughout, with no hardcoded dark remnants (inputs, dividers, dots, strip included)

#### R2: Shared form-contract parity
The add form SHALL match the shared host-form contract (the `HostFormDialog` contract from 260820-d99v, whose copy source is the strip's Edit Host dialog in `app/frontend/src/components/shell-titlebar-strip.tsx`): field order **Name (optional) then URL**, labels `Name` and `URL`, and client-side URL validation with the exact copy `Enter a full http(s) URL, e.g. http://host:3000` shown for a value that does not parse as an http(s) URL (checked before the `welcome:test-host` ping; main-side errors keep rendering as today). The URL field keeps `autofocus` (it is the required field and the ⇧⌘M empty-state target). The blank-Name-falls-back-to-ping-hostname behavior is unchanged.

- **GIVEN** the welcome page add form
- **WHEN** compared against the Edit Host dialog's contract
- **THEN** field order (Name, URL), labels, and validation copy match

- **GIVEN** a URL input value like `not a url` or `ftp://x`
- **WHEN** the user submits
- **THEN** the inline error reads `Enter a full http(s) URL, e.g. http://host:3000` and no IPC ping fires

#### R3: "Your Hosts" section
`welcome.html`/`welcome.ts` SHALL render a **Your Hosts** section listing registered hosts as the page's top rung (above the This Mac section — it is the strongest "already have it here" state), populated from the **existing** `servers:list` channel via the `runkitShell.servers` bridge group (the welcome page is already a privileged `servers:*` sender — `isHostsSender` includes it — so NO new IPC channels or preload surfaces are added). Row anatomy mirrors the SPA strip dropdown (`shell-titlebar-strip.tsx` rows): a ~3px left-edge accent bar in the host's persisted `accentColor` (rendered only when the value passes the strict `#RGB`/`#RRGGBB`/`#RRGGBBAA` hex gate — never interpolated unvalidated), a fixed-width active `✓` marker column, the host name, the dimmed origin, and a right-aligned accelerator hint (`⌥⌘{n}` on darwin, `Alt+{n}` elsewhere, list order, capped at 9 — mirroring `hostAcceleratorHint`). Click or Enter on a row invokes `servers:switch` with that host's id (main's `switchToHost` attaches the view and navigates the window away). With zero registered hosts the section is hidden entirely (first-launch flow unchanged); under an older preload lacking the `servers` group, or when `servers:list` answers a failure, the section stays hidden (graceful degradation, no error).

- **GIVEN** two registered hosts with persisted accent colors
- **WHEN** the welcome page loads (any mode — plain or `?mode=add`)
- **THEN** Your Hosts renders both rows above This Mac with accent bar, name, dimmed origin, and `⌥⌘1`/`⌥⌘2` hints (platform-appropriate)

- **GIVEN** a row is clicked (or Enter pressed on its focused row)
- **WHEN** `servers:switch` resolves ok
- **THEN** main attaches that host's view (the window navigates away from welcome)

- **GIVEN** an empty host list, a missing `servers` bridge group, or an `{ok:false}` list answer
- **WHEN** the page loads
- **THEN** the section is absent and the rest of the page behaves exactly as today

#### R4: Local ⇧⌘M handler with list interaction grammar
`welcome.ts` SHALL bind a document `keydown` for the host-menu chord — `e.code === "KeyM"` with Shift plus the platform primary modifier (meta on darwin, ctrl otherwise) and no other modifiers, mirroring the SPA registry's `host-menu-open` binding (`lib/keybindings.ts`, `code: "KeyM"`, shifted tier). With hosts listed, the chord focuses the Your Hosts list (roving tabindex: one row holds `tabIndex=0`, arrows ↓/↑ move the seat without wrapping, Enter selects, plain digits 1–9 — `e.code` `Digit1`–`Digit9`, no modifiers, only while focus is inside the list — select the Nth row, matching the SPA dropdown's grammar); with no hosts listed it focuses the add form's URL field. The handler is shell-owned and local — no IPC, no accelerator, no coordination with the SPA binding (the two surfaces never coexist on screen).

- **GIVEN** the welcome page with 3 hosts listed, on darwin
- **WHEN** ⇧⌘M is pressed
- **THEN** the first host row receives focus; ↓/↑ move focus; digit `2` (while the list has focus) switches to the second host; Enter switches to the focused row's host

- **GIVEN** the welcome page with no hosts (or a hidden section)
- **WHEN** the chord is pressed (⇧Ctrl+M on win/linux)
- **THEN** the URL input receives focus

#### R5: Theme-aware welcome strip color
The page's static titlebar strip SHALL use the background token (so it follows light/dark with the page), and `showWelcome` in `main.ts` SHALL paint the win/linux window-controls overlay with a theme-appropriate welcome strip color instead of the fixed `DEFAULT_STRIP_COLOR`: a pure `welcomeStripColor(darkMode: boolean)` helper in `src/strip.ts` returns `DEFAULT_STRIP_COLOR` for dark and the light `--bg-primary` value (`#f8f9fb`) for light, and `showWelcome` passes `nativeTheme.shouldUseDarkColors`. (darwin is unaffected — `applyOverlayColor` returns early there.)

- **GIVEN** a win/linux shell under a light system theme
- **WHEN** the welcome page is shown
- **THEN** the native `─ ▢ ✕` overlay is painted `#f8f9fb`, matching the page strip

- **GIVEN** dark system theme
- **WHEN** the welcome page is shown
- **THEN** the overlay stays `DEFAULT_STRIP_COLOR` (`#0f1117`) — today's behavior byte-for-byte

### Non-Goals

- No removal/relocation of the add form, SSH rung, or This Mac section — flows preserved; they get the token restyle only.
- No SPA changes (owned by 260820-nv0o / 260820-d99v). No new IPC channels, preload surfaces, or `hosts.ts` changes (the existing `servers` group covers list + switch).
- No native-menu changes; ⌥⌘1–9 / Alt+1–9 keep working here as native accelerators (the hint column documents them).
- No list polling/subscription — one fetch at wire-up (the page is short-lived; the SPA dropdown's open-time-snapshot precedent).

### Design Decisions

#### Reuse the existing `servers` bridge group instead of new welcome channels
**Decision**: The Your Hosts list and row switch ride the existing `servers:list` / `servers:switch` channels through the already-exposed `runkitShell.servers` group; no preload or main changes for list/switch.
**Why**: The welcome page is already a privileged `servers:*` sender (`isHostsSender` delegates to the navigation allowlist, which includes the welcome `file://` URL), and `servers:list`'s `HostInfo` projection (`id`, `name`, `url`, `active`, `accentColor?`, `waiting?`) carries exactly the fields the intake asks for. New welcome-specific channels would duplicate a privileged surface (the no-duplication anti-pattern) for zero capability gain.
**Rejected**: Dedicated `welcome:list-hosts`/`welcome:switch-host` channels — more IPC surface to gate and test, same data; the intake's "backed by existing `hosts.ts`/main-side seams" intent is satisfied more directly by consuming the existing seam.
*Introduced by*: 260820-sywl-welcome-host-hub

#### Welcome-page logic stays inline; the one new pure seam goes to `strip.ts`
**Decision**: Row-model derivation, chord matching, and roving focus live inline in `welcome.ts` (compile-gated by strict tsc, no unit tests); the only new pure decision (`welcomeStripColor`) lands in the electron-free `strip.ts` with `strip.test.ts` coverage.
**Why**: `welcome.ts` is deliberately import/export-free (it must emit as a browser-runnable global script under the page's CSP), so its inline logic cannot be imported by `node --test` — the page's established testing posture (the This Mac and SSH rungs shipped the same way, with their pure halves tested only where main.ts consumes them from modules).
**Rejected**: A second global-script file for testable welcome logic (no export path for node:test either — complexity without coverage); relaxing the no-import rule (breaks the browser-runnable emit).
*Introduced by*: 260820-sywl-welcome-host-hub

## Tasks

### Phase 2: Core Implementation

- [x] T001 Restyle `app/desktop/src/welcome/welcome.html` inline CSS to SPA token custom properties with a `prefers-color-scheme: light` override block: define the R1 variable set on `:root` (dark defaults + light overrides), set `color-scheme: light dark`, and convert every hardcoded color (body, card, headings, labels, inputs, buttons incl. `.ghost`, dividers, dots, `code`, error/`ssh-progress` lines, `.titlebar-strip`) to `var(--…)`; buttons/input-focus move to `--accent`, running dot to `--accent-green`, amber to `--signal-yellow`, errors to `--signal-red` <!-- R1 -->
- [x] T002 Align the add form in `app/desktop/src/welcome/welcome.html` + `welcome.ts` to the shared contract: reorder to Name (optional) before URL, labels `Name` / `URL`, keep URL `autofocus`; add a client-side http(s)-URL pre-check in `welcome.ts` `connect()` showing `Enter a full http(s) URL, e.g. http://host:3000` before any ping <!-- R2 -->
- [x] T003 Add the Your Hosts section markup + CSS to `app/desktop/src/welcome/welcome.html`: `section#hosts hidden` as the top rung above `section#local`, `h2` heading matching the local section's label treatment, a list container, and row styles mirroring the SPA dropdown anatomy (relative row, 3px rounded accent bar, ✓ marker column, name, dimmed origin, absolutely-positioned right-aligned hint in `--text-secondary`) <!-- R3 -->
- [x] T004 Wire the section in `app/desktop/src/welcome/welcome.ts`: structural narrowing of the `runkitShell.servers` group (`list`, `switch`), a `servers:list` envelope narrower (id/name/url/active/accentColor?), row building (origin via `new URL().origin` fallback raw, strict hex gate before `style.backgroundColor`, platform hint `⌥⌘{n}`/`Alt+{n}` capped at 9), click + Enter → `switch(id)`, section hidden on empty/absent-group/failure <!-- R3 -->
- [x] T005 Add the local chord + list grammar in `app/desktop/src/welcome/welcome.ts`: document keydown for Shift+meta/ctrl+`KeyM` (exact modifiers) focusing the list's roving seat or the URL field when no rows; roving tabindex over rows with ↓/↑ (no wrap), Enter select, and `Digit1`–`Digit9` (unmodified, list-focused) Nth-row select <!-- R4 -->
- [x] T006 Add `welcomeStripColor(darkMode: boolean)` to `app/desktop/src/strip.ts` (+ cases in `strip.test.ts`: dark → `DEFAULT_STRIP_COLOR`, light → `#f8f9fb`); use it from `showWelcome` in `app/desktop/src/main.ts` via `nativeTheme.shouldUseDarkColors` when resetting the overlay <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Verify: `cd app/desktop && pnpm run compile && npx tsc --noEmit && node --test "dist/**/*.test.js"`; confirm the welcome page still renders standalone (bridge-unavailable degrade) and that no frontend/backend files changed (scope check) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every color in `welcome.html` rides a token custom property; a `prefers-color-scheme: light` block overrides the full set; `color-scheme` is `light dark`; no hardcoded palette hex remains outside the `:root`/media-query token definitions
- [x] A-002 R2: Form field order is Name then URL with labels `Name`/`URL`; invalid URLs show `Enter a full http(s) URL, e.g. http://host:3000` client-side without pinging
- [x] A-003 R3: Your Hosts renders above This Mac from `servers:list` with accent bar, ✓ marker, name, dimmed origin, and platform-correct capped hints; click/Enter switches via `servers:switch`
- [x] A-004 R4: ⇧⌘M (darwin) / ⇧Ctrl+M (other) focuses the list (rows present) or the URL field (none); arrows move the seat, Enter selects, unmodified digits 1–9 select the Nth row while the list has focus
- [x] A-005 R5: `welcomeStripColor` exists in `strip.ts` with test coverage; `showWelcome` paints the overlay theme-appropriately; the page strip uses the background token

### Behavioral Correctness

- [x] A-006 R3: No new IPC channels, preload surfaces, or `hosts.ts` changes exist — list/switch consume the existing `servers` group only
- [x] A-007 R2: Blank Name still falls back to the ping hostname; main-side validation/ping errors still render inline as before

### Scenario Coverage

- [x] A-008 R3: Zero hosts → section hidden, first-launch flow unchanged; absent `servers` group or `{ok:false}` list → section hidden with no error (older-preload degrade)
- [x] A-009 R4: The chord ignores wrong-modifier combos (no bare M, no ⌘M, no extra alt/ctrl); digit selection does not fire while typing in the form inputs

### Edge Cases & Error Handling

- [x] A-010 R3: A malformed/missing `accentColor` renders no accent bar (strict hex gate before style interpolation); a malformed `url` falls back to the raw string for the origin column; hosts past index 9 render no hint

### Code Quality

- [x] A-011 Pattern consistency: bridge access uses the page's structural-narrowing pattern (`Reflect.get`, no `as` casts, no global augmentation); `welcome.ts` stays import/export-free; new CSS follows the page's existing section/label conventions
- [x] A-012 No unnecessary duplication: no parallel welcome-specific IPC for data the `servers` group already carries; hint/hex logic mirrors the SPA rules by value (the page cannot import SPA modules)

### Security

- [x] A-013 R3: `accentColor` is regex-gated (`#RGB`/`#RRGGBB`/`#RRGGBBAA`) before any style assignment; no new privileged IPC surface is added; the page's CSP is unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the removed hardcoded palette and the old form order are the restyle itself, not discovered redundancy; no symbol, file, or config became unused)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse existing `servers:list`/`servers:switch` (welcome is already a privileged sender) — no new bridge channels | Verified in `main.ts` (`isHostsSender` → navigation allowlist incl. welcome URL); intake's "backed by existing seams" intent + no-duplication anti-pattern | S:80 R:90 A:95 D:90 |
| 2 | Certain | Chord matcher mirrors the SPA registry: `e.code === "KeyM"`, Shift + platform primary modifier, exact modifiers | Read from `lib/keybindings.ts` (`host-menu-open`, shifted tier, code KeyM) | S:85 R:90 A:95 D:90 |
| 3 | Confident | Your Hosts is the page's top rung, above This Mac | Intake says only "above the add form"; the page's rungs order by "already have it here", and registered hosts are the strongest such state | S:55 R:90 A:80 D:70 |
| 4 | Confident | Page accent moves from legacy `#34d399` green to the SPA `--accent` blue; dot keeps green via `--accent-green` | Intake names the accent token among the copied values; SPA buttons/focus are accent-blue, running-dot semantics are accent-green | S:60 R:90 A:80 D:75 |
| 5 | Confident | Host list fetched once at wire-up, no poll/refetch | SPA dropdown's open-time-snapshot precedent; the page is short-lived and list mutations from this page navigate away | S:55 R:90 A:80 D:75 |
| 6 | Confident | Welcome overlay color derives from `nativeTheme.shouldUseDarkColors` at `showWelcome` (win/linux); pure pick in `strip.ts` | Keeps R1's light theme coherent with the native controls corner; darwin unaffected; smallest main-side change that avoids a dark corner on a light page | S:50 R:85 A:80 D:70 |
| 7 | Confident | Inline `welcome.ts` logic ships compile-gated without unit tests; the one new pure decision goes to `strip.ts` + test | The page's established posture (import-free script, no export path for node:test); precedent: This Mac/SSH rungs | S:55 R:85 A:75 D:70 |

7 assumptions (2 certain, 5 confident, 0 tentative).
