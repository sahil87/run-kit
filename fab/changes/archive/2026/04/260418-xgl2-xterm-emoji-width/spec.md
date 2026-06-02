# Spec: Fix xterm.js emoji / wide-character rendering

**Change**: 260418-xgl2-xterm-emoji-width
**Created**: 2026-04-18
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **WebGL renderer toggling** — verifying whether the ghost-glyph artifacts are WebGL-specific vs. width-mismatch–specific is explicitly out of scope. User opted out during intake. If Unicode 15 grapheme widths do not resolve the observed rendering, renderer investigation becomes a follow-up change.
- **Font selection / bundling** — this change does not alter `fontFamily` or font loading. Font determinism is owned by `260417-hyrl-bundle-jetbrains-mono-nerd-font`.
- **Server-side emoji stripping / rewriting** — tmux's byte stream is untouched. All correction happens client-side.
- **Runtime-toggleable behavior** — no config flag to disable Unicode 15 widths. Unicode 15 is strictly more correct than the Unicode 6 default.

## Frontend: xterm.js Unicode Width Handling

### Requirement: Unicode 15 Grapheme Widths Active

The xterm.js Terminal in `app/frontend/src/components/terminal-client.tsx` SHALL activate Unicode 15 grapheme-aware width tables via the `@xterm/addon-unicode-graphemes` addon. Specifically:

- The addon `@xterm/addon-unicode-graphemes` SHALL be a declared dependency in `app/frontend/package.json`, compatible with the installed `@xterm/xterm` major version (v6).
- The Terminal constructor in the init effect MUST be invoked with `allowProposedApi: true` so that the Unicode service (`terminal.unicode`) is accessible.
- After `terminal.open(container)` completes, the init effect MUST load a `UnicodeGraphemesAddon` instance via `terminal.loadAddon(...)` and then set `terminal.unicode.activeVersion = "15-graphemes"`.
- The addon load MUST match the existing dynamic-import + `cancelled`-guard pattern used by the Clipboard, WebLinks, and WebGL addon loads in the same effect.
- The addon load MUST precede the WebGL addon load so the renderer measures cell widths against the active Unicode 15 table on first paint.

#### Scenario: emoji with ASCII follow-up renders without overlap
- **GIVEN** a terminal session connected to tmux via the WebSocket relay
- **WHEN** the tmux-rendered byte stream contains a character classified as wide by Unicode 15 (e.g. `✅`, `❌`, `✨`) immediately followed by ASCII text
- **THEN** the ASCII text following the emoji SHALL render at the column position tmux used in its own layout
- **AND** subsequent characters on the same row SHALL NOT visually overlap prior characters

#### Scenario: grapheme cluster renders as a single wide cell
- **GIVEN** the terminal is active
- **WHEN** a grapheme cluster (e.g. flag emoji `🇯🇵`, skin-tone modifier sequence `👋🏽`, ZWJ family `👨‍👩‍👧`) is written
- **THEN** the cluster SHALL occupy exactly 2 cells
- **AND** the next character SHALL render in the third cell without visible misalignment

#### Scenario: pure-ASCII output is unaffected
- **GIVEN** the terminal is active
- **WHEN** only ASCII content is rendered (no characters requiring Unicode 7+ width tables)
- **THEN** rendering SHALL be visually identical to the pre-change behavior
- **AND** no performance regression measurable by the existing e2e suite SHALL be introduced

### Requirement: Dependency Install Orthogonality

Adding `@xterm/addon-unicode-graphemes` MUST NOT alter font loading, tmux handling, WebSocket message framing, SSE events, or any backend code path.

#### Scenario: backend unchanged
- **GIVEN** the change is applied
- **WHEN** the backend test suite (`cd app/backend && go test ./...`) runs
- **THEN** all existing tests SHALL pass without modification

#### Scenario: font loading unchanged
- **GIVEN** the change is applied
- **WHEN** the TerminalClient init effect runs
- **THEN** the existing `document.fonts.load(...)` awaits for JetBrainsMono Nerd Font weights SHALL run exactly as before
- **AND** the Terminal `fontFamily` option SHALL remain `'"JetBrainsMono Nerd Font", ui-monospace, monospace'`

### Requirement: Why-Comment Present

A concise comment MUST immediately precede the `UnicodeGraphemesAddon` load in `terminal-client.tsx` explaining that xterm.js defaults to Unicode 6 width tables, that tmux assumes wcwidth-based (Unicode 14/15) layout, and that enabling Unicode 15 graphemes keeps the two in sync.

#### Scenario: reviewer reads the init effect
- **GIVEN** a reviewer reading `terminal-client.tsx` without prior context
- **WHEN** they encounter the Unicode addon load
- **THEN** the adjacent comment SHALL make the reason for the addon self-evident without a repo-wide grep

## Testing and Verification

### Requirement: Existing Tests Pass

Existing unit (`just test-frontend`), integration / e2e (`just test-e2e`), and type-check (`cd app/frontend && npx tsc --noEmit`) passes MUST remain passing after the change. Tests MAY be adjusted only where they directly reference the xterm addon-load chain (e.g. mocks of dynamic imports for Clipboard / WebLinks / WebGL); no behavioral assertions are required to change.

#### Scenario: test gate
- **GIVEN** the change is applied and dependencies are installed
- **WHEN** the developer runs `just test` (backend + frontend + e2e)
- **THEN** all suites SHALL pass without new failures

#### Scenario: type check
- **GIVEN** the change is applied
- **WHEN** `cd app/frontend && npx tsc --noEmit` is run
- **THEN** no type errors SHALL be reported

### Requirement: Manual Playwright Smoke Check

The applier SHALL run a manual visual check at both desktop (≥1024px) and mobile (375×812) viewports to confirm no overlapping glyphs when emoji content is present in the tmux pane. The trigger content SHALL include at least one character that Unicode 6 classifies as narrow but Unicode 15 classifies as wide (e.g. `✅`).

#### Scenario: before-and-after visual
- **GIVEN** a tmux pane displaying content including `✅` with ASCII following
- **WHEN** the terminal is viewed in the browser at 1024×768 and 375×812
- **THEN** no ghost glyphs or overlapping text SHALL be visible
- **AND** line wrapping SHALL occur at the column tmux itself targets (no visible drift)

## Memory Updates

### Requirement: `docs/memory/run-kit/ui-patterns.md` Updated

The memory file SHALL document, under the existing terminal-rendering content (adjacent to `### Terminal Font Bundling`), that the TerminalClient opts into Unicode 15 grapheme widths via `@xterm/addon-unicode-graphemes` with `allowProposedApi: true`, and that this alignment with tmux's wcwidth-based layout is why emoji and other wide graphemes render correctly.

#### Scenario: future reader navigates memory
- **GIVEN** a reader browsing `docs/memory/run-kit/ui-patterns.md`
- **WHEN** they reach the terminal-rendering section
- **THEN** a concise subsection SHALL describe the Unicode-width configuration, the reason (tmux/xterm width alignment), and the required `allowProposedApi: true` flag

## Design Decisions

1. **Unicode addon choice: `@xterm/addon-unicode-graphemes` over `@xterm/addon-unicode11`**
   - *Why*: `addon-unicode-graphemes` is authored for `@xterm/xterm` v6 and covers Unicode 15 plus grapheme clusters (ZWJ sequences, flag emoji, skin-tone modifiers). `addon-unicode11` was authored for xterm v5 and only covers Unicode 11 without grapheme clustering — strictly less coverage for the same install cost.
   - *Rejected alternatives*:
     - `@xterm/addon-unicode11` — narrower Unicode version coverage, older API era.
     - Pinning `unicodeVersion: '11'` via the Terminal constructor option alone — the `unicodeVersion` option only switches between tables registered with the Unicode service, and the default registry only contains `'6'`. Without an addon that registers a newer table, the option is effectively a no-op past Unicode 6.
     - Stripping emojis from the byte stream server-side — destroys information, contradicts the "wrap, don't reinvent" constitution principle, and requires intercepting tmux output.

2. **Gate Unicode API access behind `allowProposedApi: true`**
   - *Why*: xterm.js v6 exposes `terminal.unicode` under the proposed-API surface; accessing `terminal.unicode.activeVersion` without this flag throws. Enabling it is the documented approach.
   - *Rejected alternative*: wrapping the access in a try/catch — masks real failures and obscures the dependency on the proposed API in the source.

3. **Addon load order: Unicode before WebGL**
   - *Why*: The WebGL renderer measures cell widths against whatever Unicode tables are active at construction time. Activating `"15-graphemes"` after WebGL initialises would require a forced re-measure that the current init flow does not perform. Loading the Unicode addon first makes the renderer initialise with the correct table the first time.
   - *Rejected alternative*: Loading Unicode last and triggering a manual re-measure — more moving parts, no benefit.

4. **No config flag to disable the new behavior**
   - *Why*: Unicode 15 width tables are strictly more correct than the default Unicode 6 tables for output produced by modern tmux and modern CLI tools. There is no plausible user scenario where Unicode 6 widths produce more correct rendering.
   - *Rejected alternative*: Gating behind an env var / URL parameter — unnecessary complexity; feature-flagging a bug fix invites stale code paths.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `@xterm/addon-unicode-graphemes` (not `@xterm/addon-unicode11`) | Confirmed from intake #1; rationale holds at spec level — v6-era addon, Unicode 15 + grapheme clusters | S:95 R:75 A:90 D:90 |
| 2 | Certain | Set `allowProposedApi: true` on the Terminal constructor | Confirmed from intake #2 — required to access `terminal.unicode` (proposed-API surface in xterm v6) | S:95 R:80 A:90 D:95 |
| 3 | Certain | Activate `terminal.unicode.activeVersion = "15-graphemes"` after the addon loads | Confirmed from intake #3 — addon registers this table; the constructor `unicodeVersion` option is a no-op past `"6"` without the addon | S:95 R:80 A:90 D:90 |
| 4 | Certain | Apply as a fab change (not a direct patch) | Confirmed from intake #4 — user explicitly chose | S:100 R:90 A:100 D:100 |
| 5 | Certain | Skip the WebGL-vs-canvas renderer comparison as a verification step | Confirmed from intake #5 — user explicitly opted out; recorded as a Non-Goal | S:100 R:80 A:100 D:100 |
| 6 | Confident | Only `terminal-client.tsx` needs source code changes (plus deps) | Carried from intake #6 — grepped; sole xterm.js consumer in the frontend | S:85 R:75 A:85 D:80 |
| 7 | Certain | Load order: Unicode addon loads **before** the WebGL addon, after `terminal.open()` | Upgraded from intake #7 (user confirmed during clarify); codified as Design Decision #3 | S:95 R:65 A:80 D:75 |
| 8 | Certain | Place a why-comment above the addon load explaining Unicode 6 default vs tmux wcwidth | Upgraded from intake #8 (user confirmed) — required by Why-Comment Present requirement | S:95 R:90 A:85 D:85 |
| 9 | Certain | Memory update goes into `docs/memory/run-kit/ui-patterns.md` (modify), not a new file | Upgraded from intake #9 (user confirmed) — adjacent to existing terminal-rendering content | S:95 R:85 A:80 D:80 |
| 10 | Certain | Existing unit / e2e tests do not need behavioral changes — verification only | Upgraded from intake #10 (user confirmed) — tests exercise the init path but not Unicode behavior directly | S:95 R:75 A:75 D:75 |
| 11 | Certain | No config flag to disable the new behavior | Upgraded from intake #11 (user confirmed) — codified as Design Decision #4 | S:95 R:80 A:80 D:85 |
| 12 | Certain | No change to font loading / `document.fonts.load(...)` timing | Upgraded from intake #12 (user confirmed) — orthogonal to the prior font-bundling change | S:95 R:85 A:85 D:85 |
| 13 | Confident | Test suites (`just test-frontend`, `just test-e2e`, `tsc --noEmit`) pass without modification after the addon load is added | New at spec — the addon chain is dynamic-imported and guarded by `cancelled`; behavioral tests do not assert Unicode properties. jsdom-based unit tests may need a stub for the new dynamic import if an existing setup stubs Clipboard / WebLinks / WebGL | S:75 R:70 A:75 D:80 |
| 14 | Confident | `UnicodeGraphemesAddon` default export shape matches sibling addons — `new UnicodeGraphemesAddon()` then `loadAddon(instance)` | New at spec — consistent with the published `@xterm/addon-*` convention used by Clipboard, WebLinks, WebGL already in this file | S:80 R:75 A:85 D:85 |

14 assumptions (11 certain, 3 confident, 0 tentative, 0 unresolved).
