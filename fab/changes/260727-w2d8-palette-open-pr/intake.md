# Intake: Palette Open PR

**Change**: 260727-w2d8-palette-open-pr
**Created**: 2026-07-27

## Origin

Conversational — designed in a `/fab-discuss` session before this intake.

> i want a feature to command k to when i can open a pr in browser, and discuss who will it work in host machine and in local

Followed by the scoping message:

> this will be specific to open: PR #123123, working on local only, removing the spoke of host

Key decisions from the conversation:
- The action joins the existing `Open:` palette family with the PR number baked into the label: `Open: PR #123123`.
- **Client-side only** ("local only, removing the spoke of host"): pure `window.open(prUrl, ...)` in the viewer's browser. Explicitly NO host spoke — no `POST /api/open`, no server-side exec, no ` (on host)` label variant, no deeplink. Behavior is identical for a local browser and a remote client, because `prUrl` is a public GitHub URL reachable from any client.
- Visible only when the current terminal window has a `prUrl`; no PR → no palette entry.

## Why

1. **Pain point**: the only way to open a change's PR from run-kit today is the mouse-only `PrLinkRow` anchor in the sidebar status panel (`app/frontend/src/components/sidebar/status-panel.tsx:373`). There is no keyboard path, violating Constitution Principle V (Keyboard-First: "Every user-facing action MUST be reachable via keyboard. The command palette (`Cmd+K`) SHALL be the primary discovery mechanism for actions").
2. **Consequence of not fixing**: opening the PR — one of the most common actions while babysitting an agent's change — always forces a hand off the keyboard, and on mobile requires hunting the sidebar's status panel.
3. **Why this approach**: the PR URL is already on the client (`prUrl`/`prNumber` on `WindowInfo`, `app/frontend/src/types.ts:100`, derived server-side from `fab pane map` per Constitution Principle X), and the palette already has a URL-opening precedent (`Help: Documentation` → `window.open(HELP_URL, "_blank", "noopener,noreferrer")`, `app/frontend/src/app.tsx:2092`). A host-side open (server exec) was considered and rejected: it would open a browser on the host where nobody may be looking, fails headless, and adds an exec surface for zero benefit — `window.open` runs in whichever browser has the page open, so it works identically for local and remote viewers.

## What Changes

### Palette action: `Open: PR #{n}`

A new command-palette action on the terminal window page (`/$session/$window`):

- **Label**: `Open: PR #123123` — the actual PR number from `currentWindow.prNumber` baked into the label. If `prUrl` is present but `prNumber` is absent, the label falls back to `Open: PR`.
- **id**: `open-pr` (does not collide with the kind-qualified `open-deeplink:*`/`open-host:*` ids the OpenTarget actions use).
- **onSelect**: `window.open(prUrl, "_blank", "noopener,noreferrer")` — exactly the `Help: Documentation` pattern.
- **Visibility**: the action is built only when `currentWindow?.prUrl` is set. No PR bound to the window (or not on a terminal window page) → the action does not exist in the palette.
- **Placement**: rendered alongside the existing `Open:` actions (the `openActions` block composed near `app/frontend/src/app.tsx:2020`), so all `Open:`-prefixed entries group together in the palette.

### Implementation seam

Follow the established pure-builder pattern (`lib/palette-view.ts` / `lib/palette-pin.ts` / `lib/palette-open.ts`):

- Add a small pure builder to `app/frontend/src/lib/palette-open.ts` (it already owns the `Open:` label family), e.g.:

  ```ts
  export function buildOpenPrAction(
    prUrl: string | undefined,
    prNumber: number | undefined,
    onOpen: (url: string) => void,
  ): OpenPaletteAction[] {
    if (!prUrl) return [];
    return [{
      id: "open-pr",
      label: prNumber != null ? `Open: PR #${prNumber}` : "Open: PR",
      onSelect: () => onOpen(prUrl),
    }];
  }
  ```

  (Exact signature at the implementer's discretion — the contract is: pure, returns `[]` without `prUrl`, label carries the number when known, `onSelect` delegates so `window.open` stays out of the pure lib.)
- Wire it in `app.tsx` next to the existing `buildOpenActions` call, sourcing `currentWindow.prUrl` / `currentWindow.prNumber` (`app.tsx:460` derivation), and concatenating into the same `openActions` array.
- Unit tests in `app/frontend/src/lib/palette-open.test.ts` (colocated, existing file): label composition with/without `prNumber`, empty result without `prUrl`.

### Explicitly NOT changing (the removed host spoke)

- **No `OpenTarget`**: the PR action is a standalone palette action, NOT an entry in the `buildOpenTargets` list. This keeps the documented palette↔menu mirror for Open **targets** intact (`lib/palette-open.ts` header: "Mirrors OpenMenuRows' collapsed-row labels exactly so palette↔menu never drift") — the top-bar Open split-button menu is untouched.
- **No backend change**: no new endpoint, no `POST /api/open` involvement, no `wt open`, no exec.
- **No keyboard chord**: per the existing Open-actions registration note, the palette entry itself is the keyboard path (documented in the registration comment per the code-review rule "new keyboard shortcuts must be documented in the command palette registration").
- **No board/server-page variant**: v1 is the terminal window page only, where the current-window context is unambiguous. Per-window entries on board pages can come later if wanted.

## Affected Memory

- `run-kit/ui-patterns`: (modify) add the `Open: PR #{n}` palette action to the documented palette/keyboard surface (two-tier tooltips / palette actions section)

## Impact

- `app/frontend/src/lib/palette-open.ts` — new pure builder (+ its `.test.ts`)
- `app/frontend/src/app.tsx` — one wiring addition in the `openActions` composition
- Frontend-only; no Go backend, no API, no routes, no new dependencies
- Scale: small — roughly 30–50 lines including tests

## Open Questions

- None — all decisions were resolved in the preceding discussion.

## Assumptions

<!-- STATE TRANSFER: This table is the sole continuity mechanism between the intake-stage
     agent and the apply-entry agent (which co-generates plan.md). -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Client-side `window.open` only; no host spoke (no server exec, no `/api/open`, no deeplink) | Discussed — user explicitly scoped "working on local only, removing the spoke of host" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Label is `Open: PR #{n}` with the real PR number baked in | Discussed — user wrote "specific to open: PR #123123"; joins the existing `Open:` label family | S:90 R:95 A:90 D:90 |
| 3 | Certain | Action exists only when the current window has `prUrl` | Discussed and accepted ("no PR, no palette entry"); mirrors the hidden-button rule of the existing Open actions | S:85 R:95 A:90 D:90 |
| 4 | Confident | v1 scope is the terminal window page only (no board/server-page variant) | Proposed in discussion as simplest v1, user did not object; boards lack a single-window context; easily added later <!-- assumed: terminal-page-only scope — board pages have no unambiguous current window --> | S:70 R:90 A:80 D:75 |
| 5 | Confident | Palette-only — the top-bar Open split-button menu is untouched | User asked for "command k" specifically; keeping the PR action out of `OpenTarget` preserves the documented palette↔menu target mirror | S:65 R:90 A:85 D:75 |
| 6 | Confident | Pure builder in `lib/palette-open.ts` + colocated unit test, wired in `app.tsx` | Established codebase pattern (palette-view/pin/open libs); code-quality.md requires tests for new behavior | S:60 R:95 A:95 D:85 |
| 7 | Certain | `window.open(url, "_blank", "noopener,noreferrer")` window features | Existing pattern at `app.tsx:2092` and the sidebar anchor's `rel`; security-reviewed in top-bar tests | S:80 R:95 A:100 D:95 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
