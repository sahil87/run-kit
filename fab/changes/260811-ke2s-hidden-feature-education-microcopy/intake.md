# Intake: Hidden-Feature Education Micro-Copy

**Change**: 260811-ke2s-hidden-feature-education-microcopy
**Created**: 2026-08-11

## Origin

> The current Compose text box has a lot of space (desktop layout, between the file-attach and Insert buttons). Can we educate the user using that space about "Enter" / "Alt+Enter" / "Shift+Enter" / "Cmd+Enter"? … Any other suggestions like this about educating the user about hidden features? … placeholder might be better than the legend, agreed. I genuinely love [empty states as tip space] also. Almost nobody today knows about the keyboard shortcuts. About the Compose text box. And so on. All these are small but high impact changes. Can you make an exhaustive list? … D-12, 15 + A + B + C11: Do these, in a single fab change.

Conversational mode: a `/fab-discuss` session explored the compose strip's key policy and the app's discoverability surfaces, produced an exhaustive lettered/numbered menu (A placeholder education, B empty-state education, C persistent hints, D feature-adjacent one-liners), and the user hand-picked the scope. Key decisions reached in conversation:

- **Placeholder over an inline legend row** in the compose strip — the legend was explicitly superseded ("placeholder might be better than the legend, agreed"). A legend costs layout and can lie about mode; a placeholder costs nothing.
- **Empty states as tip space** is the user's favorite mechanism ("I genuinely love [it]").
- **Explicitly EXCLUDED from scope**: the persistent `⌘K commands · ⌘/ shortcuts` corner anchor (menu item C10), the `⇧A` next-waiting-agent hint in the WaitingBadge tip (D13), and lens-switch chord hints (`⌘.`/`Ctrl+``) in the ViewSwitcher (D14). The user selected "D-12, 15 + A + B + C11" — nothing else.
- **Rejected outright** during discussion: first-run onboarding tours / dismissible banners (state to maintain, against the terse aesthetic) and rotating tip carousels (gimmicky).
- Constraint stated at selection time: **no new routes, no dialogs, no persistent state** — pure copy plus small Tip additions.

## Why

run-kit is keyboard-first by constitution (Principle V: every action keyboard-reachable, `Cmd+K` the primary discovery mechanism), and it already has a complete education *infrastructure*: a searchable shortcuts overlay (`⌘/`, palette entry, sidebar-footer icon), palette rows with kbd hints, and a two-tier Tip system with keycap chips. The problem is that **every one of those surfaces is gated behind hover or behind the very features users don't know exist**. In practice ("almost nobody today knows about the keyboard shortcuts — about the Compose text box, and so on") the features with zero always-visible surface are simply never found: the compose strip's four-way Enter policy, ↑ sent-history recall (no visible surface anywhere in the app), the palette's prefix namespaces (`Board:`, `Pin:`, `View:`, `Window:`, `Selection:`…), click-the-heading-to-rename (the only rename path — there is no dialog by design), sidebar multi-select, and the `⇧O` open-in-last-used chord.

If we don't fix it, the keyboard-first design keeps paying its complexity cost (classifier-driven Enter matrix, readline chords, recall walk, macro system) while most users interact as if none of it exists. The chosen approach — micro-copy in placeholders, empty states, and existing Tips — educates at the exact moment and place the feature is relevant, costs no layout, no state, and no new chrome, and cannot go stale on mode (each hint is computed where the mode is known).

## What Changes

All changes are in `app/frontend/src/`. Copy strings below are **concrete proposals**; apply may tune wording for fit but MUST preserve the named facts (which chord, mode-awareness, where the action lives). Two cross-cutting rules:

1. **Platform-aware keycaps, never hardcoded lies.** The fixed Enter-policy chords (not rebindable — they live in `classifyComposeEnter`) use the existing `composeSubmitKeycap()` seam (`lib/compose-keys.ts`) for the ⌘/Ctrl split. Chords for **rebindable actions** (`open-last-used`, `create-session`, `command-palette`) MUST be read from the effective bindings map (`useKeybindings().byAction` + `formatCombo`), and the hint MUST be omitted when the binding is unbound/disabled — mirroring the shortcuts overlay's `sheetChord` rule ("a hint advertising a dead chord would lie", shortcuts-overlay.tsx:500-509).
2. **Coarse pointers keep the short copy.** Keyboard-chord hints don't render on touch — matching the established "tips never render on coarse pointers" convention. Use the existing `use-coarse-pointer.ts` hook where a string branches.

### A. Placeholder education

**A1 — Compose strip placeholder** (`components/compose-strip.tsx:765-771`). Today: `"Compose text…"` (terminal target) / `"Compose prompt…"` (selection broadcast). New, fine-pointer:
- Terminal target: `Compose text — Enter inserts · ⌘Enter sends · ↑ history` (⌘/Ctrl via `composeSubmitKeycap()`)
- Selection broadcast: `Compose prompt — ⌘Enter sends to all selected` (broadcast takes the chat Enter policy: plain Enter is a local newline, ⌘Enter the sole submit)
- Coarse pointer: keep the current short strings.
This is also the **sole surfacing of ↑ sent-history recall** (260806-kadm) anywhere in the UI — today it has none.

**A2 — Chat lens send box** (`components/chat-view.tsx:288`). Today: `"Message the agent…"`. New (fine-pointer): `Message the agent — Enter for newline · ⌘Enter sends`. Chat's policy deliberately diverges from the strip (Enter=newline here), so the placeholder is where the divergence stops surprising people. Coarse: keep current.

**A3 — Command palette input** (`components/command-palette.tsx:155`). Today: `"Type a command..."` (and `"Confirm action..."` while confirming — untouched). New: `Type a command — try Board: Pin: View: Window:`. The prefix namespaces are an entire hidden command system with no other always-visible surface.

### B. Empty states as tip space

**B4 — Compose strip "No focused terminal"** (`components/compose-strip.tsx:770`). New: `No focused terminal — click a pane to target it`.

**B5 — Palette no-results row** (`components/command-palette.tsx:173`). Today: `No results`. New: `No results — try a prefix: Board:, Pin:, View:, Window:`.

**B6 — Sidebar no-sessions empty state** (`components/sidebar/index.tsx:2420`). Today: `(no sessions — + new)`. Enrich to also name the chord and/or the session crumb's `+ New Session`, e.g. `(no sessions — + new, or ⇧⌘N)` with the chord read from `byAction.get("create-session")` and dropped when unbound. Keep the parenthesized terse style of the surrounding sidebar copy.

**B7 — Board page empty state** (`components/board/board-page.tsx:1167`). Today: `No panes pinned to this board yet. Pin a window from the sidebar.` Sharpen to name the concrete affordances: the window-row 📌 pin icon and the `Pin:` palette prefix, e.g. `No panes pinned to this board yet — hover a sidebar window row and click its 📌, or ⌘K → Pin:`.

**B8 — Host overview empty zones** (`components/host-overview-page.tsx` — HOST HEALTH / BOARDS / SERVICES zones; SERVICES today renders bare `No services` at :400). Each empty zone names the action that fills it (e.g. SERVICES points at the services config source; BOARDS points at board creation / pinning). Exact copy decided at apply after reading each zone's actual fill mechanism — do not invent actions the app doesn't have.

**B9 — Shortcuts overlay no-match state** (`components/shortcuts-overlay.tsx:1130`). Today: `no shortcuts match — try a shorter term`. Light touch only (flagged marginal in discussion but included in the selected scope): mention that the filter spans app + custom + tmux rows, or leave as-is if a better string doesn't emerge. Lowest priority item.

### C11. Window heading rename hint

`WindowHeading` (`components/top-bar.tsx` ~1440-1700) is the **only** rename affordance (no rename dialog by design). The rename button carries `aria-label="Rename window {name}"` (:1684) — screen readers are covered — but sighted users get no "click to rename" cue beyond the hover boot-sweep animation, which signals interactivity without naming the action. Add a visible hover hint: a `title="click to rename"` attribute (or a Tier-1 `Tip` if it composes cleanly with the boot-sweep hover treatment — apply judges which; `title` is the safe minimum that cannot fight the sweep timer). Verify first that no hint already exists on the current build.

### D. Feature-adjacent one-liners

**D12 — Sidebar multi-select discoverability** (window-row multi-select, 260807-nf9f — APG multiselectable tree, `components/sidebar/index.tsx:2005`). Shift/Cmd-click extension and the `Selection:` palette prefix are invisible until triggered by accident. Add a **stateless** dimmed micro-copy line to the selection bulk-action surface, shown whenever a selection is active (no first-time tracking — that would be persistent state, which is out of scope by the stated constraint): e.g. `⇧click extends · ⌘K → Selection:`. Placement inside the existing bulk-actions UI; exact slot decided at apply from the current markup.

**D15 — Open split-button chord** (`components/open-button.tsx:112`). The primary `Tip label={primaryLabel}` carries no kbd. Add the `open-last-used` chord (default `⇧O`) via the Tip's existing `kbd` slot, read from `byAction.get("open-last-used")` + `formatCombo`, omitted when unbound. The chevron Tip (`"Open in… (choose app)"`) is untouched.

### Tests

- Unit tests that assert the touched strings (`compose-strip.test.tsx`, `command-palette` tests, board/sidebar tests as applicable) are updated in the same commit — tests conform to the implementation spec (Constitution § Test Integrity).
- If any Playwright `.spec.ts` asserts these strings, update it AND its sibling `.spec.md` companion in the same commit (Constitution § Test Companion Docs).
- New behavior worth a unit test: the mode-aware strip placeholder (terminal vs selection vs coarse) and the unbound-chord omission rule (hint text drops when the binding is unbound).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — placeholder/empty-state education micro-copy pattern (mode-aware, platform-aware, coarse-pointer-short, unbound-chord omission), the compose-strip placeholder policy line, sidebar multi-select hint, open-button Tip kbd, window-heading rename hint.
- `run-kit/chat`: (modify) — the chat send-form placeholder string is documented in the Send-form requirement; update the recorded copy.

## Impact

Frontend only (`app/frontend/src/components/` + colocated tests): `compose-strip.tsx`, `chat-view.tsx`, `command-palette.tsx`, `sidebar/index.tsx`, `board/board-page.tsx`, `host-overview-page.tsx`, `shortcuts-overlay.tsx` (light), `top-bar.tsx`, `open-button.tsx`. No backend, no API, no routes, no persistent state, no new components (at most a tiny shared helper for the chord-hint-or-empty derivation). Verification gates: `just test-frontend` (unit) + `npx tsc --noEmit`; e2e only if existing specs assert touched strings.

## Open Questions

None — the scope was hand-picked from an enumerated menu in conversation, and the two soft spots (host-zone copy, D12 hint slot) are deliberately delegated to apply as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly menu items A1–A3, B4–B9, C11, D12, D15; C10 (corner chord anchor), D13 (⇧A hint), D14 (lens chords) excluded | User enumerated the selection verbatim ("D - 12, 15 + A + B + C11") | S:95 R:90 A:95 D:95 |
| 2 | Certain | Placeholder education instead of an inline legend row in the compose strip | Discussed — user chose placeholder over legend ("placeholder might be better than the legend, agreed") | S:90 R:85 A:95 D:90 |
| 3 | Certain | No new routes/dialogs/state; first-run tours and rotating tips rejected | User-confirmed constraint at selection; rejected alternatives recorded in discussion | S:90 R:90 A:90 D:95 |
| 4 | Certain | Chord rendering: `composeSubmitKeycap()` for fixed Enter-policy chords; `useKeybindings().byAction` + `formatCombo` for rebindable chords, hint omitted when unbound | Codebase seams exist and the overlay already encodes the omit-when-unbound rule (shortcuts-overlay.tsx:500-509) | S:75 R:85 A:95 D:90 |
| 5 | Confident | Coarse-pointer surfaces keep the short placeholder/copy (no chord hints on touch) | Matches the documented "tips never render on coarse pointers" convention; `use-coarse-pointer.ts` exists | S:60 R:90 A:80 D:75 |
| 6 | Confident | D12 hint is a stateless dimmed line in the bulk-action surface whenever a selection is active (not a first-time-only popup) | First-time tracking needs persistent state, which item 3 excludes; stateless placement has one obvious home | S:55 R:85 A:70 D:60 |
| 7 | Confident | Copy strings above are proposals; apply may tune wording but must keep the named facts (chord, mode, action pointer) | Copy is trivially reversible; the facts are the deliverable, the phrasing is not | S:65 R:95 A:75 D:70 |
| 8 | Confident | Host-overview zone copy finalized at apply after reading each zone's actual fill mechanism | Zone semantics not fully read at intake; inventing actions would be worse than deferring within a bounded slot | S:50 R:90 A:70 D:65 |
| 9 | Certain | Tests asserting touched strings updated in-commit; `.spec.md` companions updated when `.spec.ts` changes | Constitution § Test Integrity + § Test Companion Docs give a deterministic answer | S:80 R:85 A:95 D:90 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
