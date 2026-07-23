# Intake: App-Wide Tier-1 Tooltip System (`Tip` Component)

**Change**: 260722-73al-tip-tooltip-system
**Created**: 2026-07-22

## Origin

Promptless dispatch via `/fab-proceed` from a completed design discussion. Four tooltip design
variants were mocked up on an interactive page (session scratchpad `tooltip-design.html`, shown in
the run-kit dashboard) and reviewed; the user approved the recommendation **"A-shell + C-content"
verbatim** — quiet-card visual shell (Variant A) with keycap-annotated content model (Variant C).
All decisions below marked "user-approved" were made in that discussion; this intake transfers
them across the pipeline boundary without re-litigating.

> App-wide tier-1 tooltip system (`Tip` component) replacing native `title=` attributes.

## Why

1. **The pain point**: run-kit has exactly one designed tooltip — the `StatusDotTip` hover-card
   (`app/frontend/src/components/status-dot-tip.tsx`, built on `@floating-ui/react`) — while the
   rest of the chrome leans on native `title=` attributes: 28 sites in
   `app/frontend/src/components/top-bar.tsx` alone, plus `view-switcher.tsx`, `open-button.tsx`,
   `waiting-badge.tsx`, `sidebar/index.tsx`, `top-bar-overflow-menu.tsx`, `board/board-header.tsx`
   and others (~45 native `title=` sites across `app/frontend/src/components/`). Native titles are
   OS-styled (they break the terminal aesthetic every other surface maintains), slow (~1s fixed
   delay), unstylable, and **invisible to keyboard users** — a direct violation of Constitution V
   (Keyboard-First: every user-facing action reachable via keyboard).
2. **The consequence of not fixing**: keyboard users never see the affordance hints
   (shortcut annotations like "Shift+click: force reload" are mouse-hover-only today), and the
   chrome's most frequent micro-interaction stays visually foreign to the design system.
3. **Why this approach**: generalizing the already-proven StatusDotTip shell into a tiny shared
   tier-1 component reuses an existing dependency (`@floating-ui/react` `^0.27.19`, already in
   `app/frontend/package.json`), keeps one visual language across both tooltip tiers, and gives
   focus-visible keyboard support for free via `useFocus`. Rejected alternatives are recorded in
   Design Decisions below.

## What Changes

### 1. New shared component: `Tip` (`app/frontend/src/components/tip.tsx`, ~60 lines)

A tier-1 tooltip built on `@floating-ui/react`. Tier-1 means: **names a control** — plain text +
optional keycap, `role="tooltip"` + `aria-describedby`, NEVER interactive content.

**Visual shell — "quiet card" (Variant A, user-approved)**: generalize the StatusDotTip shell to
one line:
- `bg-bg-card`, 1px `border-border`, 5px border radius, soft shadow
- 11px mono type, `text-text-primary` label
- Optional dim modifier note in `text-text-secondary` (e.g. label "Refresh page" + dim note
  "⇧click: force")

**Content model — keycap-annotated (Variant C, user-approved)**: optional `kbd` slot rendering a
keycap chip:
- `bg-bg-inset`, 1px border with 2px bottom edge, 3px radius, 10px type
- The `kbd` value is a **static string prop per call site** (e.g. `kbd="⌘K"`); **NO automatic
  shortcut-registry wiring in this change** — that is a deferred follow-up.

**Props sketch** (final API shaped at apply):

```tsx
<Tip label="Refresh page" note="⇧click: force" placement="bottom">
  <button aria-label="Refresh page" onClick={...}>…</button>
</Tip>

<Tip label="Send" kbd="Enter" placement="top">…</Tip>
```

### 2. Shared behavior spec (user-approved, all points binding)

- **Open delay**: 300ms on hover; **0ms while the cluster is "warm"** (a sibling tip closed
  <500ms ago). Use floating-ui's `FloatingDelayGroup` per control cluster — macOS-menu sweep
  behavior.
- **Keyboard**: opens immediately on `:focus-visible` (never on mouse-down focus) —
  `useFocus` with the `visibleOnly` default.
- **Dismiss**: pointer-leave, Escape (`useDismiss`), and on activating the control (click hides —
  the tooltip must never sit over the click's result).
- **Touch**: suppressed under `pointer: coarse` — the control's `aria-label` carries the name;
  no long-press tooltip layer.
- **Placement**: below for top-bar controls, above for bottom-bar chips, right for sidebar rows;
  flip + shift at viewport edges (floating-ui middleware, exactly as StatusDotTip does).
- **Content cap**: one line, ≤40ch, sentence-cased label (+ optional dim modifier note / keycap).
  Existing `title` strings that exceed the cap (e.g. the sidebar ALL/CUR scope chip's three-way
  sentence at `sidebar/index.tsx:1145`) get rewritten to a short label at migration time.
- **Reduced motion**: no fade — instant show/hide.
- **ARIA**: `role="tooltip"` on the floating element, `aria-describedby` on the anchored control.

### 3. Two-tier taxonomy, hard boundary (user-approved)

- **Tier-1 `Tip`**: names a control — plain text + optional kbd, carries `role="tooltip"` +
  `aria-describedby`, never interactive content.
- **Tier-2 hover-cards** (`StatusDotTip`): **unchanged by this change**, and deliberately carry
  NO tooltip role (it holds real `<a>` links — see the existing in-file comment explaining why).
- **Promotion rule**: a tooltip needing a second line of state or anything clickable becomes a
  tier-2 card; **no middle species**. Consequence for migration: native `title=` sites whose
  value is *state or content* rather than a control name (e.g. the server-tile window-count
  summary at `sidebar/server-panel.tsx:258`, the PR-URL reveal at
  `sidebar/status-panel.tsx:375`, the cwd reveal at `status-panel.tsx:523`) are NOT tier-1
  material and are left as native `title=` in this change (promoting them to tier-2 cards is out
  of scope).

### 4. Migration — replace native `title=` on interactive chrome controls

Mechanical rule: **`title=` is REMOVED wherever `Tip` lands** (never both, or the OS bubble
doubles the styled tip). `aria-label`s stay untouched.

Order and inventory (native tooltip `title=` counts verified against the working tree):

1. **`top-bar.tsx` first — 28 sites** (lines 249–2827): back/forward/navigate-up, breadcrumb
   crumb type titles (Host / tmux Server / Session / Window), connection dot (`dotTitle`),
   "Click to rename" hint, board + help buttons, theme/label chips, refresh ("Shift+click: force
   reload" → label + dim modifier note), terminal font-size cluster (Aa, −, +, reset), update
   pill + dismiss, notification status + test + setup-guide link, fixed-width and autofit
   toggles.
2. **`top-bar-overflow-menu.tsx`** — 3 sites ("More controls", "Copy version",
   "Check for updates") — part of the top-bar control cluster.
3. **`breadcrumb-dropdown.tsx:160`** (`title={title}` pass-through on the crumb trigger).
4. **`view-switcher.tsx:113`** (1 site), **`open-button.tsx:112,123`** (2),
   **`waiting-badge.tsx:45,62`** (2), **`sidebar/index.tsx:1145`** (ALL/CUR scope chip — content
   rewritten to fit the ≤40ch cap).
5. **Board twin (known trap)**: `/board/$name` does not render AppShell and re-implements chrome
   in `board-page.tsx`. Verified inventory today: `board-page.tsx`'s three `title=` matches are
   `<Dialog title=…>` **props, not native tooltips** (do not touch); the board chrome's one real
   native tooltip is `board/board-header.tsx:84` ("Unpin from board") — migrate it. Re-inventory
   the board route during apply in case chrome moved.
6. **Remaining app-wide control-name tooltips** (per the "app-wide" mandate, filtered by the
   tier-1 taxonomy): `sidebar/status-panel.tsx:262` ("Refresh PR status"),
   `iframe-window.tsx:79,99` ("Refresh", "Switch to terminal" — NOT the `title="Proxied
   content"` on the `<iframe>` itself, which is its accessible name and is asserted by two e2e
   specs), `chat-view.tsx:281,292` + `compose-strip.tsx:471,483` (insert/send buttons — natural
   `kbd` slot users: "Send" + `Enter` keycap), `host-overview-page.tsx:440,471`,
   `swatch-popover.tsx:267`.

**Explicitly untouched**: `Dialog title=` props everywhere (component prop, not a tooltip);
`title="Proxied content"` on the proxied iframe; the state/content-reveal titles listed under the
promotion rule (§3); panel-heading `title` props (`host-panel.tsx:108`, `boards-section.tsx:41`,
`server-panel.tsx:122`, `status-panel.tsx:316` — `CollapsiblePanel`-style props, not native
attributes). Sites where `title` merely mirrors an `aria-label` on a non-hoverable element keep
the aria-label only (drop the title, add no Tip).

### 5. Tests

- **Colocated Vitest**: `app/frontend/src/components/tip.test.tsx` — renders label/note/kbd,
  tooltip role + aria-describedby wiring, no render under coarse pointer.
- **Playwright**: new e2e spec (e.g. `app/frontend/tests/e2e/tooltips.spec.ts`) + sibling
  `tooltips.spec.md` companion doc (Constitution: Test Companion Docs) — tooltip appears on
  keyboard focus, appears after hover, absent under coarse-pointer emulation.
- **Existing e2e title selectors** (grepped `app/frontend/tests/`): `pr-status-sidebar.spec.ts`
  (`[title='…pull/386']` — stays valid, PR-URL reveal titles are out of scope),
  `server-panel-grid.spec.ts:61` (`toHaveAttribute("title", /\d+ windows?…/)` — stays valid,
  server-tile state title is out of scope), `top-bar-overflow.spec.ts:424` +
  `web-view-lens.spec.ts:90` (`getByTitle("Proxied content")` — stays valid, iframe accessible
  name untouched). Re-grep before removal in case the tree moved; any spec that does break gets
  its `.spec.ts` AND sibling `.spec.md` updated in the same commit.

### Design Decisions (rejected alternatives, recorded from the design session)

- **Rejected: inverse-video tooltip as default** — reserved as a possible future semantic
  register, not implemented here.
- **Rejected: typed-reveal animation for tooltips** — the motion vocabulary keeps typed-sweep
  for labels; motion at tooltip frequency grates.
- **Deferred: automatic shortcut-registry wiring for the `kbd` slot** — static strings per call
  site in this change.

## Affected Memory

- `run-kit/ui-patterns`: (modify) add the two-tier tooltip taxonomy (tier-1 `Tip` vs tier-2
  hover-cards), the `Tip` behavior contract (delays/warm clusters, focus-visible, coarse-pointer
  suppression, placement conventions), and the "no native `title=` on chrome controls" migration
  rule to the frontend UI patterns file.

## Impact

- **Frontend only** — no backend, no API, no routes. New file `app/frontend/src/components/tip.tsx`
  (+ `tip.test.tsx`); edits across ~14 component files (inventory in §4); one new e2e spec +
  companion doc; possible touch-ups to existing e2e specs only if seams move.
- **Dependencies**: none added — `@floating-ui/react ^0.27.19` already present (StatusDotTip).
- **Risk**: mechanical but wide (~40 call sites); the board-twin trap and e2e title selectors are
  the two known failure modes, both inventoried above. `StatusDotTip` must remain functionally
  unchanged.
- **Verification gates**: `just test-frontend` (Vitest incl. `tip.test.tsx`), `tsc --noEmit`,
  `just test-e2e` (isolated port 3020), `just build`.

## Open Questions

- None — the design session resolved shell, content model, taxonomy, behavior, and migration
  rules; residual judgment calls are graded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New shared `Tip` component at `app/frontend/src/components/tip.tsx` built on `@floating-ui/react` | User-approved in design session; dependency already present via StatusDotTip | S:95 R:85 A:95 D:95 |
| 2 | Certain | Visual shell = quiet card (Variant A): `bg-bg-card`, 1px `border-border`, 5px radius, soft shadow, 11px mono, dim modifier note | Approved verbatim from the four-variant mockup review | S:95 R:90 A:95 D:95 |
| 3 | Certain | Content model = keycap-annotated (Variant C); `kbd` is a static string prop per call site, no shortcut-registry wiring | Approved verbatim; registry wiring explicitly deferred to a follow-up | S:95 R:90 A:95 D:95 |
| 4 | Certain | Behavior spec: 300ms open / 0ms warm-cluster (500ms window, `FloatingDelayGroup`), focus-visible open, dismiss on leave/Escape/activate, coarse-pointer suppression, per-region placement, ≤40ch one-line cap, instant under reduced motion | Approved point-by-point in the design session | S:90 R:85 A:90 D:90 |
| 5 | Certain | Two-tier taxonomy with hard boundary; `StatusDotTip` unchanged and role-less; promotion rule: state or clickable content ⇒ tier-2, no middle species | Approved; matches the existing in-code rationale in status-dot-tip.tsx | S:95 R:85 A:95 D:95 |
| 6 | Certain | `title=` removed wherever `Tip` lands; `aria-label`s stay; rejected alternatives (inverse-video default, typed-reveal animation) stay rejected | Approved migration rule — native+styled double-bubble is the failure mode it prevents | S:95 R:80 A:95 D:95 |
| 7 | Confident | Migration scope is app-wide across control-name tooltips (incl. overflow menu, breadcrumb dropdown, board-header, status-panel refresh, iframe-window buttons, chat/compose send, host-overview, swatch-popover), ordered top-bar-first — not just the files named in the discussion | Title says "app-wide"; the named list reads as ordering, and the approved taxonomy (row 5) cleanly filters which remaining sites qualify | S:55 R:80 A:70 D:60 |
| 8 | Confident | State/content-reveal native titles (server-tile counts, PR-URL, cwd) stay native `title=` — neither converted to tier-1 nor promoted to tier-2 cards in this change | Promotion rule says they are tier-2 material; building new hover-cards is scope creep the discussion never sanctioned, and two e2e specs assert these exact title seams | S:60 R:80 A:75 D:65 |
| 9 | Confident | `Tip` API wraps a single child element (clone/spread reference props onto it), mirroring StatusDotTip's reference-props pattern | ~40 call sites demand minimal churn; the codebase already uses the floating-ui reference-props idiom | S:60 R:85 A:80 D:65 |
| 10 | Confident | Initial `kbd`/note usage: only where the existing title text already encodes a shortcut or modifier (e.g. "Send (Enter)" → label "Send" + kbd `Enter`; "Refresh page (Shift+click: force reload)" → label + dim "⇧click: force") | Derivable mechanically from current title strings; no invented shortcuts, consistent with no-registry decision | S:65 R:85 A:75 D:70 |
| 11 | Confident | `FloatingDelayGroup` clusters = one per chrome region: top-bar control cluster (incl. overflow menu), breadcrumb, bottom-bar chips, sidebar rows, board header | Follows the approved macOS-sweep intent; region boundaries are the natural grouping already used for placement | S:60 R:90 A:75 D:70 |
| 12 | Confident | Over-cap title strings are rewritten to short sentence-cased labels at migration (e.g. ALL/CUR scope chip → "Show all servers" / "Show current server only") | The approved ≤40ch one-line cap forces it; wording is trivially reversible copy | S:65 R:90 A:80 D:75 |
| 13 | Confident | New e2e coverage lands as a dedicated `tooltips.spec.ts` + `tooltips.spec.md` rather than edits spread across existing chrome specs | Keeps the companion-doc obligation contained; existing specs only change if their title seams actually break | S:55 R:90 A:80 D:70 |

13 assumptions (6 certain, 7 confident, 0 tentative, 0 unresolved).
