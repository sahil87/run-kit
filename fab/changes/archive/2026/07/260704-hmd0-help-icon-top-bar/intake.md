# Intake: Help Icon on Top Bar

**Change**: 260704-hmd0-help-icon-top-bar
**Created**: 2026-07-04

## Origin

Backlog item `[hmd0]` (2026-07-03), invoked one-shot via `/fab-new hmd0`:

> Add a help icon on the top bar (next to the theme icon) pointing to https://shll.ai/run-kit

No prior conversation context — all design decisions below were derived from the codebase and project conventions.

## Why

1. **Problem**: run-kit has no in-app pointer to its documentation. The only help affordance today is the notifications-specific link buried inside the bell dropdown (`NOTIFICATIONS_HELP_URL`, `top-bar.tsx:1144`). A user landing on the dashboard has no discoverable path to the project docs/landing page.
2. **Consequence if unfixed**: users must already know the docs URL or dig through the repo — friction for onboarding and for sharing the tool.
3. **Approach**: a persistent help icon in the top-bar right cluster is the conventional, zero-cost affordance. The cluster already hosts the route-agnostic controls (FixedWidth → Notification → Theme → connection dot), so one more small chip fits the established pattern without new UI surface (Constitution IV — no new pages, no settings).

## What Changes

### Top bar: `HelpLink` control (`app/frontend/src/components/top-bar.tsx`)

A new small component rendered in the route-agnostic block of the right cluster, immediately **after `ThemeToggle` and before the connection dot** (the dot stays the right-most element, per the cluster-ordering comment at `top-bar.tsx:323`):

```tsx
// Help — external docs/landing page. Opens in a new tab.
const HELP_URL = "https://shll.ai/run-kit";

function HelpLink() {
  return (
    <a
      href={HELP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Help — run-kit docs"
      title="Help — run-kit docs"
      className="rk-glint min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center"
    >
      {/* ? glyph — inline SVG or text glyph, 14px, matching sibling icons */}
    </a>
  );
}
```

Cluster slot (mirrors the sibling spans):

```tsx
{/* Theme toggle — route-agnostic. */}
<span className="hidden sm:flex">
  <ThemeToggle />
</span>

{/* Help — route-agnostic external docs link. */}
<span className="hidden sm:flex">
  <HelpLink />
</span>
```

Exact behavior:
- **Anchor, not button** — it navigates externally; `target="_blank"` + `rel="noopener noreferrer"` so the dashboard (terminal sessions, SSE) is never unloaded.
- **Route-agnostic** — renders in every mode (terminal, root, board, cockpit), exactly like FixedWidthToggle/NotificationControl/ThemeToggle.
- **`hidden sm:flex`** wrapper — hidden below the `sm` breakpoint, consistent with every other cluster control.
- **Chip styling identical to `ThemeToggle`** (`top-bar.tsx:786`): `rk-glint` hover treatment (CRT glint = buttons, per the hover-animation vocabulary), 24px square on fine pointers / `coarse:30px` on touch — the documented uniform sizing for the whole right-side cluster.
- **Icon**: a question-mark glyph, 14px, `currentColor` — rendered like the sibling inline SVGs.
- **URL as named constant** `HELP_URL` adjacent to the component (pattern: `NOTIFICATIONS_HELP_URL`; code-quality: no magic strings).

### Command palette: `Help: Documentation` action (`app/frontend/src/app.tsx`)

Constitution V makes the palette the primary discovery mechanism, and the review policy flags actions missing from the palette. Add one action to the route-agnostic action set assembled in `app.tsx` (alongside `viewActions` / `configActions`):

```tsx
{
  label: "Help: Documentation",
  run: () => window.open(HELP_URL, "_blank", "noopener,noreferrer"),
}
```

`HELP_URL` is exported from `top-bar.tsx` (or a shared constants module if one already fits) so the icon and the palette action cannot drift.

### Tests (`app/frontend/src/components/top-bar.test.tsx`)

Unit tests asserting:
- the help link renders in the top bar with `href="https://shll.ai/run-kit"`,
- `target="_blank"` and `rel` containing `noopener`,
- an accessible name (aria-label) is present.

No dedicated Playwright e2e — the control is a static anchor in existing chrome with no interactive state; unit coverage in the existing `top-bar.test.tsx` suite is proportionate.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar right cluster ("chrome") gains a route-agnostic help link chip + a `Help: Documentation` palette action

## Impact

- `app/frontend/src/components/top-bar.tsx` — new `HELP_URL` constant + `HelpLink` component + one cluster slot (~25 lines)
- `app/frontend/src/app.tsx` — one palette action (~5 lines)
- `app/frontend/src/components/top-bar.test.tsx` — new test block
- No backend, no API, no routes, no config. Frontend-only.

## Open Questions

None — the backlog item specifies both the location ("next to the theme icon") and the target URL.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Placement: immediately after ThemeToggle, before the connection dot | "Next to the theme icon" allows either side; appending after theme preserves the documented stable order (FixedWidth → Bell → Theme) and keeps the dot right-most; trivial to swap | S:70 R:95 A:75 D:65 |
| 2 | Certain | Anchor opening in a new tab (`target="_blank" rel="noopener noreferrer"`), URL in a named `HELP_URL` constant | External URL given verbatim in the backlog item; new-tab precedent is `NOTIFICATIONS_HELP_URL`; navigating in-place would unload live terminal/SSE state | S:80 R:90 A:90 D:85 |
| 3 | Confident | Visual: question-mark glyph in the standard 24px/`coarse:30px` `rk-glint` chip matching ThemeToggle | `?` is the universal help glyph; chip sizing and glint hover are documented as uniform across the right cluster (context.md mobile/hover conventions) | S:60 R:90 A:85 D:70 |
| 4 | Certain | Route-agnostic rendering in all modes, `hidden sm:flex` below the `sm` breakpoint | Every always-present cluster control (FixedWidth, Bell, Theme) follows exactly this pattern; deviating would be the surprising choice | S:50 R:90 A:90 D:80 |
| 5 | Confident | Add a `Help: Documentation` command-palette action opening the same URL | Not requested by the backlog item, but Constitution V (palette = primary discovery) and the review rule "new actions must be palette-registered" make omission a should-fix | S:45 R:90 A:85 D:70 |
| 6 | Confident | Unit tests in `top-bar.test.tsx` only; no dedicated e2e | code-quality mandates tests for new behavior; e2e is "where possible/proportionate" and a static anchor has no flow to drive | S:50 R:85 A:85 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
