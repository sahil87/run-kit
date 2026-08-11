# Intake: Light-Theme Signal Color Tokens

**Change**: 260811-m3f3-light-theme-signal-color-tokens
**Created**: 2026-08-11

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a user conversation about light-theme contrast. The user audited the frontend's five signal hues, measured WCAG contrast against the light backgrounds, and agreed on a specific token design (including a custom gold after rejecting the first yellow proposal). The synthesized conversation description is the sole source; all specific hex values and scope boundaries below were agreed in that conversation.

> The frontend's five signal hues ride fixed Tailwind `-400` utility classes tuned for the dark theme. The theme system already re-themes its own tokens per theme (`--color-accent-green`: #22c55e dark → #16a34a light), but the fixed classes never adapt, and on the light theme they fall far below WCAG contrast (≥3:1 required for UI graphics per 1.4.11, ≥4.5:1 for normal text). Promote the four hues to theme tokens defined exactly like `--color-accent-green`, keep dark pixel-identical, and swap the class usages to the new tokens.

## Why

1. **Pain point**: The light theme renders signal colors (status-dot hues, PR row glyphs, waiting badges/halos, error text, warning banners) with fixed dark-tuned Tailwind classes. Measured against the light backgrounds (bg-primary `#f8f9fb`, bg-card `#ffffff`, bg-inset `#e8eaef`):
   - `yellow-400` #facc15 — **1.5:1**
   - `yellow-300` #fde047 — **1.3:1** (worst; chat warning body text)
   - `purple-400` #c084fc — **2.6:1**
   - `blue-400` #60a5fa — **2.5:1**
   - `red-400` #f87171 — **2.8:1**

   All fall below WCAG 1.4.11's ≥3:1 bar for UI graphics (and far below 4.5:1 for normal text). Yellow signals — the "an agent needs you now" attention language — are nearly invisible on light backgrounds.

2. **Consequence of not fixing**: light-theme users cannot reliably see the highest-priority signals in the app — waiting halos, pending checks, failing PRs, error text. The attention-surfacing system (status pyramid, waiting rollups) is effectively dark-theme-only.

3. **Why this approach**: the theme-token mechanism already exists and works (`--color-accent-green` is defined in the `@theme` block plus both `html[data-theme]` blocks in `app/frontend/src/globals.css`). Promoting the four hues to identical per-theme tokens reuses that proven seam, keeps dark pixel-identical (dark token values are today's exact hexes), and centralizes the swap: `pr-status-model.ts` is the single source of truth for the shared PR/phase color vocabulary, so sidebar rows, session tiles, the row flyout card, and the pane panel all inherit from one edit.

## What Changes

### 1. Four new theme tokens in `app/frontend/src/globals.css`

Define exactly like `--color-accent-green` — in the `@theme` block (defaults, ~line 38), the `html[data-theme="dark"]` block (~line 52), and the `html[data-theme="light"]` block (~line 67):

| Token | Dark (today's hex — pixel-identical) | Light |
|-------|--------------------------------------|-------|
| `--color-signal-yellow` | `#facc15` (yellow-400, unchanged) | `#b07d02` (custom gold) |
| `--color-signal-purple` | `#c084fc` (purple-400) | `#9333ea` (purple-600) |
| `--color-signal-blue` | `#60a5fa` (blue-400) | `#2563eb` (blue-600) |
| `--color-signal-red` | `#f87171` (red-400) | `#dc2626` (red-600) |

```css
/* @theme block + html[data-theme="dark"] */
--color-signal-yellow: #facc15;
--color-signal-purple: #c084fc;
--color-signal-blue: #60a5fa;
--color-signal-red: #f87171;

/* html[data-theme="light"] */
--color-signal-yellow: #b07d02;
--color-signal-purple: #9333ea;
--color-signal-blue: #2563eb;
--color-signal-red: #dc2626;
```

Tailwind 4 generates the utility families (`text-signal-yellow`, `bg-signal-red`, `border-signal-yellow/50`, opacity modifiers via color-mix) automatically from the `@theme` tokens — the same way `text-accent-green` works today.

**Yellow specifics (explicit user decision)**: `yellow-700` #a16207 (4.9:1) was proposed first and **REJECTED** by the user as reading brown. `#b07d02` was chosen instead: 3.6:1 on white, 3.45:1 on bg-primary, 3.0:1 on inset — passes the ≥3:1 graphics bar on all three light backgrounds while keeping visible yellow chroma. **Accepted trade-off**: text surfaces reusing the token (waiting badge, chat warning body) land below the 4.5:1 AA text threshold; the user accepted this. A two-tone split (brighter gold for glyphs, darker shade for text-only surfaces) was considered and set aside for single-token simplicity.

### 2. `globals.css` hardcoded `#facc15` literals → `var(--color-signal-yellow)`

Verified occurrences (current line numbers):

- `rk-waiting-halo` keyframes (lines 269-270): two `color-mix(in srgb, #facc15 …)` stops
- Board waiting seam `rk-waiting-seam` keyframes + static class (lines 288-292): `border-color` literals — the "check ~line 283" instruction from the conversation is confirmed, the same hardcoded yellow is there
- `prefers-reduced-motion` static fallbacks (lines 531-532): `.rk-waiting-halo { box-shadow: 0 0 0 2px #facc15; }` and `.rk-waiting-seam { border-color: #facc15; }`

All swap the literal for `var(--color-signal-yellow)`.

**Comment rewrite**: the block at globals.css lines ~258-267 documents "Yellow is a CONSTANT (#facc15 — Tailwind yellow-400) … theme-independent by design". Update it to say the **semantic** (yellow = attention / "needs you now") is constant while the **value** is per-theme via `--color-signal-yellow`.

### 3. `app/frontend/src/components/pr-status-model.ts` — the shared vocabulary (single edit point)

Swap raw palette classes for the new token utilities:

- `PR_STATE_COLORS`: `merged: "text-purple-400"` → `text-signal-purple`; `closed: "text-red-400"` → `text-signal-red` (line 33-34)
- `PR_CHECKS_COLORS`: `fail: "text-red-400"` → `text-signal-red`; `pending: "text-yellow-400"` → `text-signal-yellow` (lines 39-40)
- `PR_REVIEW_COLORS`: `changes_requested: "text-red-400"` → `text-signal-red`; `review_required: "text-yellow-400"` → `text-signal-yellow` (lines 45-46)
- `PHASE_HUE`: `building: "text-blue-400"` → `text-signal-blue`; `agent: "text-yellow-400"` → `text-signal-yellow` (lines 169, 171)
- `prGlyphColor` chain (lines 247-250): `text-red-400` → `text-signal-red`, `text-yellow-400` → `text-signal-yellow`, `text-purple-400` → `text-signal-purple`
- Update the doc comments referencing the old class names (lines ~163-165, ~217-234) to the new token names

Sidebar rows, session tiles, the row-flyout card, and the pane panel all consume this module — they inherit the swap with no per-surface edits.

### 4. `app/frontend/src/components/waiting-badge.tsx`

- Line 39: `bg-yellow-400/15 text-yellow-400` → `bg-signal-yellow/15 text-signal-yellow`
- Line 50: `hover:bg-yellow-400/25` → `hover:bg-signal-yellow/25`
- Line ~12 doc comment claims "(yellow-400, theme-independent)" — update wording to the semantic-constant/value-per-theme framing, matching the globals.css comment rewrite

### 5. `app/frontend/src/components/chat-view.tsx` — warning banner + error text

- Warning banner (line 122): `border-yellow-400/50 bg-yellow-400/10 … text-yellow-300` → `border-signal-yellow/50 bg-signal-yellow/10 … text-signal-yellow` (yellow-300 body text collapses into the single yellow token — the user's single-token decision)
- Banner label (line 126): `text-yellow-400/80` → `text-signal-yellow/80`
- Error text `text-red-400` (lines 107, 264, 433, 451, 471) → `text-signal-red`
- `border-red-500/50` / `bg-red-500/10` washes (lines 107, 264, 417, 451): **decision deferred** — see Open Questions. If kept, only the `text-red-400` foregrounds change in these class lists.

### 6. `app/frontend/src/components/status-dot.tsx`

- Line 106: failed-dot red center `bg-red-400` → `bg-signal-red`

### 7. Error-text and kill-affordance sweep (`text-red-400` / `hover:text-red-400` → `signal-red`)

- `app/frontend/src/components/create-session-dialog.tsx` (lines 312, 321)
- `app/frontend/src/components/spawn-agent-dialog.tsx` (line 284)
- `app/frontend/src/components/settings-dialog.tsx` (line 174)
- `app/frontend/src/components/sidebar/status-panel.tsx` (line 475)
- `app/frontend/src/app.tsx` (line 3499)
- `hover:text-red-400` kill affordances: `app/frontend/src/components/sidebar/index.tsx` (line 2412), `sidebar/session-row.tsx` (line 264), `sidebar/window-row.tsx` (line 620)

Sweep note: `session-tiles.tsx` contains a deliberate NUL byte at line 63 that makes plain `grep` silently skip the file — verify it with `grep -a` (or perl) before declaring the sweep complete (it currently has no `-400` signal-class hits, but the completeness check must not be NUL-blind).

### 8. Tests (project rule: code-quality.md requires tests covering changed behavior)

Candidate shape (agreed in conversation): a unit test asserting

- the four `--color-signal-*` tokens are defined in all three globals.css theme blocks (with the dark values equal to the legacy hexes — the pixel-identical guarantee), and/or
- the `pr-status-model.ts` color maps (`PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `PHASE_HUE`, `prGlyphColor`) reference `signal-*` classes rather than raw palette classes.

Existing `pr-status-model.test.ts` and `status-dot.test.tsx` assert the current class strings and will need their expectations updated to the new token classes. UI-only color swaps may not warrant new e2e; existing e2e (e.g. `agent-next-waiting.spec.ts` reduced-motion assertions) must stay green.

### Explicitly out of scope

- Row label colors and the selection ring (already OKLCH theme-adapted with a contrast guard in `themes.ts`)
- `text-text-secondary` surfaces (4.8:1 on light — fine)
- `--color-accent-green` (already themed; 3.3:1 as text is borderline — possible follow-up, not this change)
- Terminal pane content (ANSI colors come from user-selected terminal themes, not app CSS)

## Affected Memory

- `run-kit/ui-patterns`: (modify) The Status Dot waiting-halo, WaitingBadge, and board-pane waiting-seam sections all document the yellow as "constant … theme-independent" (e.g. "constant-yellow pulsing box-shadow ring", "bg-yellow-400/15 text-yellow-400, theme-independent"); update to the semantic-constant / value-per-theme framing and the new `signal-*` token names. The § Shared PR vocabulary and § Status Dot hue tables cite `text-yellow-400`/`text-blue-400`/`text-purple-400`/`text-red-400` class names that change to `text-signal-*`.

## Impact

- **Frontend only** — no backend, no API, no routes. Single CSS file (`globals.css`) + ~11 TSX/TS component files under `app/frontend/src/`.
- **Dark theme**: zero visual change (dark token values are today's exact hexes) — regression risk is a typo'd hex or missed utility-name mapping, both covered by the token unit test and existing component tests.
- **Light theme**: intentional visual change — all four signal hues darken to meet ≥3:1.
- **Test surface**: `pr-status-model.test.ts` and `status-dot.test.tsx` expectation updates; one new token/vocabulary unit test; existing e2e untouched in intent (class-name-based selectors, if any, may need the same rename).
- Verification gates per code-quality.md: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test` / `just build`.

## Open Questions

- `chat-view.tsx` and the dialogs also use `red-500` variants (`border-red-500/50`, `bg-red-500/10`) as border/background **washes** (not foreground signals). Do those also move to `signal-red` derivatives (e.g. `border-signal-red/50`, `bg-signal-red/10`), or stay as raw `red-500` classes? Washes at 10-50% opacity are not contrast-critical the way foreground signals are, so leaving them is viable — but it splits the red story across two sources.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Promote four hues to `--color-signal-{yellow,purple,blue,red}` theme tokens defined exactly like `--color-accent-green` (in `@theme` + both `html[data-theme]` blocks); swap listed class usages to `text-signal-*`/`bg-signal-*` utilities | Discussed — explicit user decision; mechanism verified present in globals.css | S:90 R:85 A:95 D:95 |
| 2 | Certain | Light values: yellow `#b07d02` (custom gold), purple `#9333ea`, blue `#2563eb`, red `#dc2626`; dark values are today's exact hexes so dark stays pixel-identical | Discussed — user chose each hex; `yellow-700` explicitly rejected as reading brown; sub-4.5:1 text trade-off on the yellow token explicitly accepted | S:95 R:80 A:95 D:95 |
| 3 | Certain | `yellow-300` chat warning body text collapses into the single `--color-signal-yellow` token (no two-tone split) | Discussed — two-tone split considered and set aside for single-token simplicity | S:90 R:80 A:90 D:90 |
| 4 | Certain | globals.css waiting-halo keyframes and board waiting seam swap `#facc15` literals for `var(--color-signal-yellow)`; the "theme-independent by design" comment block is rewritten to semantic-constant / value-per-theme | Discussed — explicit in the conversation, including the seam check instruction; literals verified at lines 269-270 and 288-292 | S:90 R:85 A:95 D:90 |
| 5 | Confident | The `prefers-reduced-motion` static fallbacks (globals.css lines 531-532, `.rk-waiting-halo` / `.rk-waiting-seam` with literal `#facc15`) get the same `var(--color-signal-yellow)` swap | Found during verification, not named in the conversation — but they are the same waiting-yellow surface; leaving them would break reduced-motion light-theme users identically | S:70 R:85 A:90 D:85 |
| 6 | Confident | `waiting-badge.tsx` line ~12 doc comment ("yellow-400, theme-independent") gets the same wording update as the globals.css comment block | The conversation mandated the globals.css comment rewrite; this comment makes the identical stale claim | S:60 R:90 A:85 D:85 |
| 7 | Confident | `change_type` is `fix` (WCAG contrast failure is an accessibility defect, not a new capability) — pinned via `set-change-type` so refresh re-inference cannot flip it | Judgment call; the change repairs a measured conformance failure in existing UI | S:60 R:85 A:75 D:65 |
| 8 | Confident | Test shape: one unit test asserting the four tokens exist in all three globals.css theme blocks with dark values equal to legacy hexes, plus pr-status-model map assertions on `signal-*` classes; no new e2e | Discussed — conversation named this candidate and noted UI-only color swaps may not warrant e2e; code-quality.md requires tests for changed behavior | S:70 R:85 A:80 D:70 |
| 9 | Unresolved | Whether `red-500` border/background washes (`border-red-500/50`, `bg-red-500/10` in chat-view.tsx and dialogs) also move to `signal-red` derivatives or stay raw | Deferred — promptless dispatch. Conversation explicitly flagged this as an open sub-decision; washes are not foreground signals, so a default exists (keep), but it is the user's aesthetic call | S:35 R:80 A:40 D:30 |

9 assumptions (4 certain, 4 confident, 0 tentative, 1 unresolved).
