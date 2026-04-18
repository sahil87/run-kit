# Intake: Fix xterm.js emoji / wide-character rendering

**Change**: 260418-xgl2-xterm-emoji-width
**Created**: 2026-04-18
**Status**: Draft

## Origin

Discussion-mode session. User shared a screenshot (`.uploads/260418105740-image.png`) showing
the rk terminal rendering a `gh pr view` (or similar) output that contained emoji checkmarks
(`✅`). Lines containing emojis showed visible ghost / overlapping characters underneath the
text — fragments of nearby characters appearing in a second offset row, with the line wrapping
clearly desynced from where xterm thought the column boundary was.

> There is a problem in the way the terminal (xterm) renders text in case of any special character.

Diagnosis (presented to the user before this change was opened):

- xterm.js v6 defaults to **Unicode 6 width tables**, which classify many emojis (✅, ❌, ✨,
  most Misc Symbols & Symbols For Legacy Computing blocks) as **1 cell wide**.
- The browser actually renders these emojis at **~2 cells wide**: `JetBrainsMono Nerd Font`
  (the bundled webfont, see `260417-hyrl-bundle-jetbrains-mono-nerd-font`) does **not** include
  color emoji glyphs, so the browser falls back to a system color-emoji font (Apple Color Emoji
  on macOS, Noto Color Emoji on Linux). Color emoji fonts ignore monospace cell sizing.
- Result: the visual position of subsequent characters drifts away from xterm's internal grid →
  overlapping / ghost glyphs, especially with the WebGL renderer.
- tmux is wcwidth-aware (and on the new Mac config uses Unicode 11+ via `tmux 3.4+`), so tmux
  lays out the buffer assuming emoji = 2 cells. xterm laying it out as 1 cell is the source of
  the desync.

Fix agreed during discussion:

1. Install `@xterm/addon-unicode-graphemes` (xterm v6's grapheme-aware addon — supersedes the
   older `@xterm/addon-unicode11`).
2. Set `allowProposedApi: true` on the `Terminal({...})` constructor (required to opt-in to
   the Unicode API surface).
3. After `terminal.open(...)`, load the addon and activate the version:
   ```ts
   const { UnicodeGraphemesAddon } = await import("@xterm/addon-unicode-graphemes");
   terminal.loadAddon(new UnicodeGraphemesAddon());
   terminal.unicode.activeVersion = "15-graphemes";
   ```
4. Apply as a fab change (not a direct patch).
5. **Skip** the canvas-vs-WebGL renderer comparison the diagnosis suggested as a verification
   step — user explicitly opted out. Width handling is the working hypothesis and is what we
   ship.

## Why

1. **Problem**: Any tmux output containing emojis or other glyphs that Unicode 6 classifies as
   narrow but newer Unicode revisions (and the actual rendered font fallback) treat as wide
   produces visually broken terminal output. Today, the trigger is everywhere — `gh pr view`
   output, fab checklist files (`✅`/`❌`), Claude Code's own UI markers, GitHub-flavored
   markdown rendered by anything that uses emoji status indicators, even basic prompt themes
   like Starship that use `✗`/`✓`. This makes rk visibly unreliable as soon as a user runs a
   modern CLI tool.

2. **Consequence if we don't fix it**: rk's value proposition is "the terminal you'd see in
   tmux, in a browser." Users seeing garbled output for routine commands lose trust in the
   tool. Worse, the bug looks like a font / CSS bug (because of the visual ghosting), so users
   are likely to spend time debugging the wrong layer (font weights, browser zoom, viewport
   widths) before suspecting Unicode width tables.

3. **Why this approach over alternatives**:
   - **Strip / replace emojis server-side** — destroys information, requires intercepting the
     tmux byte stream, and contradicts the constitution's "wrap, don't reinvent" principle.
   - **Force a monospace-respecting emoji font via CSS `font-family`** — fragile, depends on
     OS-bundled fonts, and not all monospace emoji fonts cover all the characters in the wide
     gap between Unicode 6 and Unicode 15.
   - **Use the older `@xterm/addon-unicode11`** — covers Unicode 11 only and was authored for
     xterm v5; `@xterm/addon-unicode-graphemes` is the v6-era successor that covers Unicode 15
     and grapheme clusters (ZWJ sequences, flag emoji, skin-tone modifiers). Strictly better
     for the same install cost.
   - **Toggle the `unicodeVersion` Terminal option directly** — the `unicodeVersion` option
     only switches between width tables that have been registered with the Unicode service.
     The grapheme addon is what registers the `"15-graphemes"` table. Without the addon, the
     option is a no-op past `"6"`.

   The chosen approach (install addon + opt-in via `allowProposedApi` + activate
   `"15-graphemes"`) is the path the xterm.js maintainers document for exactly this scenario.

## What Changes

### 1. Frontend dependency

Add `@xterm/addon-unicode-graphemes` to `app/frontend/package.json`. Use the latest
xterm-v6-compatible version (the addon's peerDependency is `@xterm/xterm: ^6`).

```bash
pnpm -C app/frontend add @xterm/addon-unicode-graphemes
```

`pnpm-lock.yaml` will update accordingly.

### 2. Terminal constructor: `allowProposedApi: true`

`app/frontend/src/components/terminal-client.tsx:153-158` currently constructs the Terminal
with:

```ts
terminal = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace',
  fontSize: fontPx,
  theme: deriveXtermTheme(activeTheme.palette),
});
```

Add `allowProposedApi: true`:

```ts
terminal = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace',
  fontSize: fontPx,
  theme: deriveXtermTheme(activeTheme.palette),
  allowProposedApi: true,
});
```

This is required to access `terminal.unicode` (the Unicode service is currently in xterm's
proposed-API surface; without this flag, accessing `terminal.unicode.activeVersion` throws).

### 3. Load the addon and activate Unicode 15 graphemes

After `terminal.open(...)` and the existing addon loads (Clipboard, WebLinks, WebGL — see
`terminal-client.tsx:167-184`), add the unicode-graphemes load. Place it **before** WebGL so
the renderer queries the correct width tables on first measure:

```ts
// Unicode 15 + grapheme clustering — emojis, ZWJ sequences, flag/skin-tone
// modifiers render at the correct cell widths, matching tmux's wcwidth-based
// layout. Without this, xterm defaults to Unicode 6 width tables and emojis
// classified as wide by tmux end up overlapping subsequent characters.
const { UnicodeGraphemesAddon } = await import("@xterm/addon-unicode-graphemes");
if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
terminal.loadAddon(new UnicodeGraphemesAddon());
terminal.unicode.activeVersion = "15-graphemes";
```

Match the existing dynamic-import + `cancelled` guard pattern used by Clipboard / WebLinks /
WebGL above it. The comment is necessary (non-obvious why-this-exists) and worth keeping per
the project's commenting convention.

### 4. Verification

- `cd app/frontend && pnpm install` (post-add) and `cd app/frontend && npx tsc --noEmit` —
  type check passes.
- `just test-frontend` — vitest unit tests pass. The terminal-client tests do not currently
  assert on Unicode behavior, but they exercise the init path that now includes the new addon
  load — ensure no regressions.
- `just test-e2e` — Playwright e2e suite passes.
- **Manual Playwright check** at the same viewport as the screenshot:
  1. Start `RK_PORT=3020 just dev`.
  2. Open a session, run `printf 'ASCII before ✅ ASCII after\n'` (or paste a fab checklist
     file with `✅`/`❌` markers).
  3. Confirm no overlapping glyphs, and that the next prompt wraps at the column tmux thinks
     it should.
  4. Repeat at desktop (1024×768) and mobile (375×812) viewports.

The verification step explicitly does **not** include toggling between WebGL and canvas
renderers — user opted out of that comparison. If width handling alone does not resolve the
ghosting, that follow-up becomes a separate change.

### 5. No backend / tmux changes

The fix is entirely client-side. tmux is already producing the byte stream correctly; xterm
just needs to know the right cell widths to lay out that stream.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — Add a short subsection documenting that the xterm.js
  Terminal is constructed with `allowProposedApi: true` and that Unicode width handling is
  switched to `"15-graphemes"` via `@xterm/addon-unicode-graphemes`. Note the rationale (tmux
  is wcwidth-aware; xterm must agree). Adjacent to existing terminal-rendering content (font
  bundling, font scaling).

## Impact

**Files touched**:

- `app/frontend/package.json` — add `@xterm/addon-unicode-graphemes` dependency.
- `app/frontend/pnpm-lock.yaml` — updated by `pnpm add`.
- `app/frontend/src/components/terminal-client.tsx` — add `allowProposedApi: true` to Terminal
  options; load `UnicodeGraphemesAddon` after `terminal.open()`; set
  `terminal.unicode.activeVersion = "15-graphemes"`.

**Bundle size**: small — the addon is a single-purpose module containing the Unicode 15 width
tables (kilobytes, not megabytes; comparable to other xterm addons already loaded).

**Risks**:

- **Proposed-API stability**: `allowProposedApi: true` opts into a non-stable API surface.
  Future xterm versions may rename `terminal.unicode.activeVersion` or move it out of the
  proposed namespace. Mitigation: pin the addon to a known-good major version, watch xterm
  release notes when bumping `@xterm/xterm`. Unlikely to break on patch / minor bumps.
- **Width-table mismatch with tmux**: if tmux on the user's machine uses a different Unicode
  width source than `15-graphemes`, isolated codepoints could still mis-align. Practically,
  modern tmux (3.4+) tracks Unicode 14/15 closely and `15-graphemes` is the closest match
  available to xterm.
- **Unit tests** in `terminal-client.test.tsx` may need a stub for `UnicodeGraphemesAddon` if
  they `vi.mock` the dynamic import surface. Verify at apply-time.

**Non-risks**:

- No backend code change.
- No change to WebSocket / SSE wire format.
- No change to tmux session handling.
- No new config surface.
- No change to font loading (the prior `260417-hyrl-bundle-jetbrains-mono-nerd-font` change
  remains the source of truth for font determinism — this change only affects width tables).

## Open Questions

None. The design is small, well-scoped, and the user has confirmed approach + non-scope
(skip the WebGL/canvas comparison).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `@xterm/addon-unicode-graphemes` (not the older `@xterm/addon-unicode11`) | Discussed — v6-era addon, supersedes unicode11, covers Unicode 15 + grapheme clusters | S:95 R:75 A:90 D:90 |
| 2 | Certain | Set `allowProposedApi: true` on the Terminal constructor | Discussed — required to access `terminal.unicode` (currently a proposed-API surface in xterm v6) | S:95 R:80 A:90 D:95 |
| 3 | Certain | Activate `terminal.unicode.activeVersion = "15-graphemes"` after loading the addon | Discussed — this is the table the addon registers; `unicodeVersion` constructor option alone is a no-op past `"6"` without it | S:95 R:80 A:90 D:90 |
| 4 | Certain | Apply as a fab change, not a direct patch | User explicitly chose "Apply as a fab change" when asked | S:100 R:90 A:100 D:100 |
| 5 | Certain | Skip the WebGL-vs-canvas renderer comparison as a verification step | User explicitly answered "no" when asked whether to verify it's not a WebGL-only artifact | S:100 R:80 A:100 D:100 |
| 6 | Confident | Only `app/frontend/src/components/terminal-client.tsx` needs source code changes (plus deps) | Grepped — `terminal-client.tsx` is the sole xterm.js consumer; other files only reference it through tests/themes | S:85 R:75 A:85 D:80 |
| 7 | Certain | Load order: Unicode addon **before** WebGL addon load, after `terminal.open()` | Clarified — user confirmed | S:95 R:65 A:80 D:75 |
| 8 | Certain | Place a comment explaining the why (Unicode 6 default vs tmux wcwidth) above the addon load | Clarified — user confirmed | S:95 R:90 A:85 D:85 |
| 9 | Certain | Memory update goes into `docs/memory/run-kit/ui-patterns.md` (modify), not a new file | Clarified — user confirmed | S:95 R:85 A:80 D:80 |
| 10 | Certain | Existing unit / e2e tests do not need changes beyond verifying they still pass | Clarified — user confirmed | S:95 R:75 A:75 D:75 |
| 11 | Certain | No need to expose a config flag to disable the new behavior | Clarified — user confirmed | S:95 R:80 A:80 D:85 |
| 12 | Certain | No change to font loading / `document.fonts.load(...)` timing | Clarified — user confirmed | S:95 R:85 A:85 D:85 |

12 assumptions (11 certain, 1 confident, 0 tentative, 0 unresolved).
