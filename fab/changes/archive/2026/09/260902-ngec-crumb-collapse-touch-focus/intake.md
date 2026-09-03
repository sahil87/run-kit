# Intake: Top-Bar Crumb Collapse + Touch Focus Ownership

**Change**: 260902-ngec-crumb-collapse-touch-focus
**Created**: 2026-09-03

## Origin

> Top-bar breadcrumb collapse + keyboard focus ownership on touch devices: (1) crumbs that would truncate below a useful width collapse into a single "…" dropdown instead of rendering fragments like "ru…"/hard-clipped "runKi" with no ellipsis; (2) on coarse pointers the hidden xterm helper textarea must not grab focus as a side effect — keyboard opens only on an explicit tap, with exactly one visible input owner at a time (solid cursor / accent-bordered compose)

Conversational mode. The user shared an iPad screenshot (terminal route, keyboard up) in a `/fab-discuss` session; these two were ranked the real bugs of six findings, and an annotated before/after HTML mock of the fixes was reviewed and approved. The sibling polish bundle (pane-border pane-ID leak, `any-pointer: coarse` audit, status-left clipping) is change **260902-qt7k-ipad-chrome-polish**, queued to the operator — this change must not overlap its scope (in particular, qt7k owns the `coarse:`/`COARSE_QUERY` media-query switch).

## Why

1. **Pain point (bug 1)**: At iPad-portrait widths the top-bar renders crumb shrapnel — the server crumb ellipsizes to `ru…` (two useful characters, still a tap target) and the session crumb hard-clips mid-word to `runKi` with no ellipsis and no gap, gluing onto the heading's `Tab:` prefix. The degradation ladder (crumbs truncate → hide by breakpoint) has no rung between "truncate to 16ch" and "hidden", so mid widths produce fragments that carry no information.
2. **Pain point (bug 2)**: The on-screen keyboard appeared with **no visible input owner** — the terminal cursor was hollow (xterm unfocused) and the compose strip showed its placeholder (unfocused). The known cause class: xterm 6 has element-level focus paths that fire without a deliberate tap — WebKit's long-press recognizer fires `contextmenu` → `rightClickHandler` → `moveTextAreaUnderMouseCursor` during slow scroll-drags, and xterm's `mousedown` handler calls `focus()` on synthetic mouse delivery. A capture-phase suppressor for exactly these paths already exists in `terminal-client.tsx` but is **gated on `scrollLocked`** — unlocked terminals (the normal state) are unprotected.
3. **Consequence if unfixed**: The top bar looks broken on every tablet and narrow desktop window; the phantom keyboard eats half the tablet viewport with nothing focused, and typed keys go nowhere the user can see.
4. **Why this approach**: Bug 1 reuses the existing `BreadcrumbDropdown` component (the crumbs are already dropdown triggers) rather than inventing a new overflow control; bug 2 extends the proven capture-phase suppressor pattern to the unlocked coarse-pointer state rather than adding reactive blur (whose disruption the existing code comment already rules out).

## What Changes

### A. Breadcrumb min-useful-width collapse (`top-bar.tsx`)

Current mechanics (top-bar.tsx ~1026–1112): the left nav's server crumb (`hidden md:flex`) and session crumb (`hidden sm:flex`) each put `truncate max-w-[16ch]` on an inner span, with `min-w-0` on the wrappers so truncation engages under pressure. Two failure modes at mid widths:

1. A crumb can shrink to a useless sliver (`ru…`) before its breakpoint hides it.
2. The session crumb can clip WITHOUT rendering the ellipsis, and with no gap before the center cell's `Tab:` prefix (the screenshot's `runKi Tab:`).

Change — add a collapse rung to the degradation ladder:

- Below a **minimum useful width (~6ch)** per crumb, the server and session crumbs collapse into a **single `… ▾` crumb** rendered in their place: one `BreadcrumbDropdown` whose items are the two levels (`{server}` → `{session}`), each navigating to its route, preserving each original crumb's dropdown actions (the session crumb's `+ New Session` entry must survive inside the collapsed menu). Both destinations stay one tap away; the trigger gets a `title` tip naming it (e.g. "Navigation").
- Implementation shape: CSS alone cannot conditionally swap DOM on content-vs-space; use a `ResizeObserver`/measurement on the left cell (or a container query if the shell already provides one) to derive `crumbsCollapsed`, flipping between the two renderings. Hysteresis or a rounded threshold to avoid flapping at the boundary.
- **Ellipsis guarantee**: whatever renders, a truncated crumb always shows `…` (audit why `text-overflow: ellipsis` failed to paint on the session crumb — likely the wrapper compressing below the span's padding/ellipsis reserve) and keeps a ≥6px gap before the center cell.
- The center heading cell contract is untouched: q8ey's no-`min-w-0`-on-the-outer-cell rule and the `max-w-[16ch] sm:max-w-[28ch]` heading spans stay exactly as documented in the file's comments. The fix spends the LEFT cell's space better; it never takes width from the heading.
- Existing breakpoint hides (`hidden md:flex` / `hidden sm:flex`) remain the outer rungs; the collapse rung sits between full crumbs and breakpoint-hidden.

### B. Coarse-pointer focus gate for xterm's non-tap focus paths (`terminal-client.tsx`)

Current mechanics (terminal-client.tsx:574–637): a `scrollLocked`-gated effect installs capture-phase `touchend`/`contextmenu`/`mousedown` suppressors plus a `focusin` blur backstop, each checking `evaluateMediaQuery("(pointer: coarse)")` per event. Unlocked terminals have none of this.

Change — on coarse pointers, the helper textarea gains focus **only from a deliberate tap**:

- **Always-on (not lock-gated) capture-phase `contextmenu` suppression on coarse pointers**: the long-press → `moveTextAreaUnderMouseCursor` path is never a deliberate focus request on touch (right-click has no touch meaning). Split it out of the `scrollLocked` effect into an unconditional effect with the same per-event `coarse()` check and the same capture-phase pattern.
- **Deliberate tap stays intact**: the synthetic click chain from a clean tap (touchstart→touchend→mousedown→click) must continue to focus the terminal and open the keyboard — the gate targets only the side-effect paths (long-press contextmenu; any focus during an active scroll/drag sequence). Do NOT suppress `mousedown` outside the locked state (that is the tap's focus path).
- **Media-query note**: use the same per-event `evaluateMediaQuery` pattern; the query string should reference the shared constant/rule so qt7k's `pointer:` → `any-pointer:` switch (if it lands) applies here automatically — coordinate rather than hardcode a second divergent query.
- **Visible-owner audit (small)**: verify the two owner affordances already exist and suffice — xterm's native hollow-vs-solid cursor for the terminal, and the compose strip's `focus:border-accent` for compose. No new chrome is expected; if the audit finds a state where the keyboard can be up with neither affordance active, that state is a bug of this change's scope.
- **Out of scope**: the desktop restore router is already mobile-skipped (`app.tsx` restore effect skips `isMobile` — verified in `docs/memory/run-kit/ui/focus-ownership.md`); focus-memory recording seams and the code-server steal guard are untouched.

### C. Tests

- Unit (Vitest): crumb collapse state derivation (collapsed rendering carries both levels + preserved actions); ellipsis-guarantee regression if expressible in jsdom.
- e2e (Playwright, via `just test-e2e` / `just pw`): a width-sweep spec asserting no crumb renders under the useful-width floor and the collapsed `… ▾` menu navigates to both levels; a coarse-pointer spec (touch emulation) asserting long-press/contextmenu inside an **unlocked** terminal does not focus the xterm textarea while a plain tap does. Follow the constitution's Test Intent Comments rule (Proves/Steps JSDoc). Note the pointer-events hover gate and `filter({ has })` Playwright traps from project memory when writing these.

## Affected Memory

- `run-kit/ui/top-bar`: (modify) the breadcrumb degradation ladder gains the collapse rung; the crumb/heading width contract prose updates
- `run-kit/ui/terminal`: (modify) the scroll-lock suppressor section extends to the always-on coarse contextmenu gate
- `run-kit/ui/focus-ownership`: (modify) only if the audit adds anything to the owner-affordance story (expected: a cross-reference, not a mechanism change)

## Impact

- `app/frontend/src/components/top-bar.tsx` (left-cell crumbs, ~986–1160), `breadcrumb-dropdown.tsx` (consumed, likely unchanged)
- `app/frontend/src/components/terminal-client.tsx` (suppressor effects, ~574–637)
- `app/frontend/tests/e2e/` — new/extended specs; `top-bar.test.tsx` unit additions
- No backend, API, or tmux-layer changes; no new settings keys; no route changes
- Coordination: qt7k (operator-queued) owns the `pointer:` vs `any-pointer:` media-query decision — this change consumes whatever rule lands, keeping one definition

## Open Questions

- Exact collapse threshold: is 6ch-per-crumb the right floor, and should the two crumbs collapse together (one rung) or independently (server first)? Front-runner: collapse together — a lone surviving crumb next to a `…` menu reads worse than one menu.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `BreadcrumbDropdown` for the collapsed `… ▾` crumb | Component exists with items/label/onNavigate/action props; constitution IV resists new controls | S:85 R:90 A:90 D:85 |
| 2 | Confident | Collapse both crumbs into ONE menu at the threshold (not independently) | Discussed in mock (single `… ▾`); a lone sliver crumb beside a menu re-creates the bug <!-- assumed: joint collapse — independent per-crumb collapse is the fallback if the joint menu tests poorly --> | S:70 R:80 A:70 D:60 |
| 3 | Confident | Measurement-driven collapse (ResizeObserver on the left cell) rather than a fixed breakpoint | Fragment width depends on name lengths, not viewport alone — a breakpoint cannot express "would truncate below 6ch" | S:65 R:75 A:75 D:65 |
| 4 | Certain | Always-on coarse-pointer capture-phase `contextmenu` suppression; `mousedown` suppression stays lock-gated | The existing suppressor block documents both paths; long-press has no touch meaning, while mousedown is the deliberate tap's focus path | S:80 R:85 A:85 D:80 |
| 5 | Confident | No new visible-owner chrome — native hollow/solid cursor + compose `focus:border-accent` suffice once side-effect focus is gated | The phantom-keyboard state becomes unreachable when focus requires a deliberate tap; adding chrome would duplicate existing affordances | S:65 R:85 A:70 D:65 |
| 6 | Tentative | 6ch minimum useful width per crumb | Eyeballed from the screenshot (`ru…` = useless, `runKit` = useful); tuning expected during apply <!-- assumed: 6ch floor — adjust from real name distributions during implementation --> | S:45 R:90 A:55 D:50 |

6 assumptions (2 certain, 3 confident, 1 tentative, 0 unresolved).
