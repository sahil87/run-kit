# Intake: Welcome Host Hub

**Change**: 260820-sywl-welcome-host-hub
**Created**: 2026-08-20

## Origin

Conversational (`/fab-discuss` session on the desktop-shell host switcher UX). The user asked for a UX that works in **all three states** — no host registered, hosts registered but none open, a host open — ideally the same solution everywhere. Agreed model: one mental model, one chord, rendered by whichever surface owns the screen. The SPA surface is covered by 260820-nv0o (⇧⌘M opens the strip dropdown) and 260820-d99v (shared HostFormDialog). This change delivers the shell-owned surface: the welcome page is promoted to a **Host Hub** — restyled to the SPA design language, showing registered hosts, and handling ⇧⌘M locally. The user's design-language complaint (issue 1) applies here directly: the current `welcome.html` is a hand-styled dark-only approximation of the SPA that has drifted.

## Why

1. **Pain point**: in the "hosts registered but none open" state (active host failed its load gate, or user is on the welcome page), registered hosts are invisible — the page shows only an add form and the This Mac section; the menu bar is the only path to existing hosts. And the page's look diverges from the SPA (hardcoded dark palette, no theme response), so the first-run and failure experiences read as a different product.
2. **If unfixed**: the two shell-owned states of the universal host UX stay broken/inconsistent, undermining the ⇧⌘M-means-hosts mental model established by the SPA changes.
3. **Approach**: the welcome page is shell-owned, fully self-contained (strict CSP, inline CSS, no network) and must stay so — it is the zero-hosts bootstrap and the all-hosts-down fallback (on win32 the *only* path to host #1). So the fix is in-place: restyle to SPA tokens, add a Your Hosts list with the SPA dropdown's row anatomy, and bind ⇧⌘M in a local keydown handler. Each surface handles its own keys — no IPC, no accelerators.

## What Changes

### 1. Restyle `welcome.html` to the SPA design language

- Replace the current approximated palette in `app/desktop/src/welcome/welcome.html`'s inline CSS with the SPA's actual design-token values (background, card, border, text-primary/secondary, accent) copied from the frontend theme (`globals.css` token values), keeping the page fully self-contained (values are copied, not imported — CSP forbids external fetches).
- Support light/dark via `prefers-color-scheme` (system rung of the SPA's three-mode theme; the page currently hardcodes `color-scheme: dark`). No manual theme toggle on this page.
- Typography/spacing aligned with the SPA (monospace stack already matches; heading sizes, label treatment, input/button styles brought to token values).
- The add form keeps field parity with the shared form contract (Name optional + URL, same labels and validation copy as `HostFormDialog` from 260820-d99v).

### 2. "Your Hosts" section (the state-B fix)

- New section listing registered hosts, rendered above the add form. Row anatomy mirrors the SPA strip dropdown: ~3px accent bar in the host's persisted color, name, dimmed origin, right-aligned ⌥⌘n hint (matching the list order the shell menu uses). Click/Enter on a row switches to that host via the existing main-side switch path.
- Empty state (no hosts registered): the section is hidden entirely and the add form is the hero — first-launch flow unchanged.
- Bridge additions in `preload.ts` (welcome bridge): a host-list read (name, origin/url, accent color, active flag, order) and a switch-to-host invoker, both backed by existing `hosts.ts` / main-side seams. Structural narrowing in `welcome.ts` per the page's existing bridge pattern; the page degrades gracefully (no list section) under an older preload.

### 3. Local ⇧⌘M handler

- `welcome.ts` binds a document keydown for ⇧⌘M (mac) / ⇧Ctrl+M (win/linux): focuses the Your Hosts list (roving focus, arrows + Enter, plain digits 1–9 select — the same interaction grammar as the SPA dropdown). With no hosts registered it focuses the add form's URL field.
- Shell-owned and shipped with the shell — no coordination with the SPA binding (each surface owns its screen's keys; the chords never coexist).

### Non-goals

- No removal or relocation of the add form or This Mac local-daemon section (states and flows preserved; This Mac gets the token restyle only).
- No SPA changes (owned by 260820-nv0o / 260820-d99v).
- No native-menu changes; ⌥⌘1–9 continue to work on this page as native accelerators.

## Affected Memory

- `run-kit/desktop-shell`: (modify) welcome page — Host Hub sections (Your Hosts list, row anatomy, ⇧⌘M/digit handler), SPA-token styling + prefers-color-scheme, new welcome-bridge surfaces (host list, switch)

## Impact

- `app/desktop/src/welcome/welcome.html` (styles + markup), `welcome.ts` (list rendering, keydown, bridge narrowing)
- `app/desktop/src/preload.ts`, `main.ts`, `hosts.ts` — welcome-bridge list/switch surfaces (+ node-test siblings where logic is electron-free)
- Design reference: the SPA strip dropdown rows (`shell-titlebar-strip.tsx`) and frontend theme tokens
- Sequencing: depends on 260820-d99v only for the form-contract *copy* (labels/validation text); no code dependency — can build against the agreed contract if d99v is in flight

## Open Questions

- (none — the three-state model, row anatomy, and key ownership were decided in the discussion)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Welcome page stays the bootstrap/fallback surface and keeps its add form; it is restyled in place, never replaced | Discussed — user confirmed the two-surface model ("we just need both to follow the same design language") | S:95 R:85 A:90 D:90 |
| 2 | Certain | Your Hosts list with SPA row anatomy (accent bar, name, origin, ⌥⌘n hint); click/Enter switches | Discussed — explicit part of the accepted three-state UX | S:90 R:85 A:85 D:85 |
| 3 | Certain | ⇧⌘M handled locally in welcome.ts (focus list; empty list → focus URL field), digits select | Discussed — the per-surface key-ownership principle the user accepted | S:90 R:85 A:85 D:85 |
| 4 | Confident | Token values are copied into the inline CSS (not imported); page follows prefers-color-scheme only | CSP/self-containment forces copying; system-theme-only is the minimal faithful rung — a manual toggle would add chrome the page doesn't need | S:70 R:85 A:85 D:75 |
| 5 | Confident | Welcome bridge gains list + switch surfaces with graceful degradation under an older preload | Follows the page's existing structural-narrowing pattern; shell + page ship together so skew is rare | S:65 R:85 A:85 D:80 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
