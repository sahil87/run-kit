# Intake: Sidebar Footer Global Chrome + Desktop Settings Dialog

**Change**: 260724-6j1v-sidebar-footer-chrome-settings
**Created**: 2026-07-25

## Origin

> Research more candidates from the top bar that can be moved to the new section that houses the settings icon at the bottom. […] yes to 1, 2, 6 [help, theme, connection dot]. Make these all right aligned, like the settings icon is. Keep the connection dot (only) left aligned. Agreed to folding notifications into settings. Also agreed to resting version line to the footer. […] Do you think even the version should be left aligned? [Agent recommended yes — left, as a status segment; user accepted via mockup.] The settings page, can you make it look like it's not just built for a mobile screen only — let it take more space. Align it better. […] Agreed — let's do all this.

Conversational mode: an extended `/fab-discuss` session inventoried the top-bar right cluster (`top-bar.tsx:500-681`), classified items page-scoped vs app-global, and the user approved two HTML mockups (footer layout and desktop settings dialog) before invoking `/fab-fff`. Mockup files (visual reference, self-contained HTML): `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-candid-wombat/e5c547ce-44db-41ca-bda2-9646f9346b9c/scratchpad/footer-mockup.html` and `settings-mockup.html`.

## Why

1. **Pain point**: The top-bar right cluster mixes page-scoped actions (splits, close, font, fixed-width) with app-global chrome (help, theme, notifications, connection status). The sidebar footer introduced by change o7q8 (the settings gear row, `sidebar/index.tsx:1316-1331`) created a natural home for app-global chrome, but only the gear lives there. Meanwhile the settings dialog is hard-capped at `max-w-sm` (384px, `dialog.tsx:29`) — a phone card that looks cramped and ragged on desktop displays.
2. **Consequence of not fixing**: the top bar stays crowded (more items overflow into the chevron menu on narrow widths), global preferences remain scattered across three surfaces (bar chips, overflow rows, settings dialog), and the settings dialog stays visually mobile-only as more settings accumulate (notifications will make it worse).
3. **Why this approach**: grouping by role — page-scoped actions stay near the page heading in the top bar; app-global chrome consolidates at the sidebar footer (passive readouts left, actions right) and in the settings dialog. The overflow pyramid already solves *space*; this change is about *conceptual grouping*. The desktop dialog uses one CSS-grid code path that collapses back to today's phone layout below narrow widths — no second dialog.

## What Changes

### 1. Sidebar footer — new layout (`app/frontend/src/components/sidebar/index.tsx`)

The footer row (currently `flex justify-end` with only the gear) becomes `justify-between`:

- **Left — passive readouts** (a status segment):
  - **Connection dot**: moves from the top bar (top-bar.tsx:1117-1133). Same semantics — per-page "this page's live data is flowing" (`isConnected`), `w-2 h-2 rounded-full`, `bg-accent-green` connected / `bg-text-secondary` disconnected, `role="status" aria-live="polite"`, Tip label with the same dot title text, non-focusable span (readout, not a control).
  - **Version line**: NEW. Renders `displayVersion(daemonVersion)` (e.g. `v0.9.3`) from `useUpdateNotification`; plain `RunKit`-style fallback is NOT needed here — when `daemonVersion` is null render nothing. 10px `text-text-secondary`, click-to-copy with the existing toast pattern (mirror the overflow menu's version-row copy behavior, `top-bar-overflow-menu.tsx`). The overflow menu's fixed version row is unchanged — it remains the update surface; the footer version is a passive readout only.
- **Right — actions**, in order: **Help · Theme · Gear (existing)**:
  - **Help**: same `HELP_URL` export (`top-bar.tsx:1946`), anchor with `target="_blank" rel="noopener noreferrer"`, same question-mark SVG.
  - **Theme**: same cycle behavior as the top-bar `ThemeToggle` (`cycleTheme` system→light→dark→system, Ctrl/Cmd-click opens the theme selector via the `theme-selector:open` event) and the same three mode SVGs.
  - All three right-cluster icons use the **gear's borderless footer idiom** — `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]`, no border, `text-text-secondary hover:text-text-primary transition-colors` — NOT the top bar's bordered `rk-glint` chips. Tips with `placement="top"` (row hugs the viewport bottom), consistent with the existing gear.

### 2. Top bar — removals (`app/frontend/src/components/top-bar.tsx`, `top-bar-overflow-menu.tsx`)

Remove from the right cluster `rightItems` and from the overflow candidate set:

- `theme` entry (ThemeToggle + ThemeMenuRow)
- `help` entry (HelpLink + HelpMenuRow)
- `notification` entry (NotificationControl + NotificationMenuRows) — functionality moves to the settings dialog (§3)
- The trailing **connection dot** (the exempt block, top-bar.tsx:1114-1134) — moves to the sidebar footer (§1). The overflow chevron becomes the right-most element. Trailing-width reservation logic simplifies accordingly (chevron only).

**Stays untouched**: view-switcher, Open-in-App, both SplitButtons, fixed-width, terminal-font (Aa), board autofit, close/kill ✕, UpdateChip, RefreshButton, the overflow chevron, and the overflow menu's fixed version row (still the resting update surface with its ⟳ check affordance).

`HELP_URL`, `cycleTheme`, and the theme/help SVGs should be moved or re-exported so the footer and the command palette share single definitions (no drift). Dead components (`ThemeToggle`, `HelpLink`, `NotificationControl`, their menu rows) are deleted, not orphaned.

### 3. Settings dialog — Notifications block (`app/frontend/src/components/settings-dialog.tsx`)

New **Notifications** row under the **This device** scope (push subscription is per-browser, so the scope is semantically exact). Contents map 1:1 from the bell popover (`NotificationControl`, top-bar.tsx:2423-2560):

- Subscription status line (dot + "Subscribed on this device" / not-subscribed / blocked states as the existing control models them)
- Enable/Disable action button
- "Send test notification" button (disabled until subscribed, same as existing tip semantics)
- "Setup & troubleshooting guide" link (same `NOTIFICATIONS_HELP_URL`)
- When push is unsupported (insecure context / no service worker — the case where `NotificationControl` renders nothing): show the row with a short "Not supported in this browser" note instead of hiding it (a settings pane should explain absence, not vanish).

### 4. Settings dialog — desktop layout (`settings-dialog.tsx`, `dialog.tsx`)

- `Dialog` gets a width variant instead of the hardcoded `max-w-sm` (`dialog.tsx:29`) — e.g. a `size?: "sm" | "lg"` prop defaulting to `"sm"`. Spawn/kill/create-session dialogs keep `sm`; the settings dialog uses the wide variant (~`max-w-2xl`, ≈660px).
- Each setting becomes a **preference row**: CSS grid `grid-template-columns: 190px 1fr`, label column left (label + small sublabel hint underneath in `text-text-secondary`), control column right so all controls align on one vertical rule. Hairline separators between rows (a low-opacity border).
- Scope headings ("This host" / "This device") become full-width underlined rules with the storage hint right-aligned on the same line.
- Text inputs cap at ~320px (`max-w`) so they don't stretch edge-to-edge.
- **Responsive, one code path**: below ~480px the row grid collapses to a single column (label above control) — reproducing today's stacked phone layout via a media/container query on `grid-template-columns`. No second dialog implementation.
- Field inventory and scopes are UNCHANGED (faithful to current code): This host = Instance name, SSH host, Accent color, Theme (mode + dark/light pair); This device = Terminal font size + the new Notifications block (§3).

### 5. Tests

- Update affected unit tests (`top-bar.test.tsx`, `sidebar/index.test.tsx` or `sidebar.test.tsx`, `settings-dialog.test.tsx`, `dialog.test.tsx`) for moved/removed/added elements.
- Update any Playwright e2e specs that locate the theme toggle, help link, bell, or connection dot in the top bar; add/extend coverage for the footer cluster. Constitution: any modified `*.spec.ts` updates its sibling `*.spec.md` in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) top-bar chrome inventory changes (theme/help/bell/dot leave the bar), new sidebar-footer global-chrome row (readouts left / actions right, borderless idiom, version readout), settings-dialog desktop preference-row layout + Notifications block.
- `run-kit/architecture`: (modify) connection-dot derivation now feeds the sidebar footer via `SidebarProps.isConnected` (not the TopBar); `SessionContextType` no longer carries `hostMetricsConnected` (deleted with its `dedicatedMetricsConnected`/`METRICS_SUB` feeders — the field listing at :653 and the dedicated Host-metrics-stream-health subsection at :661-665 are stale); the TopBar `mode` prop description (:677) must drop the L3 Notification/Theme/Help members and the dot/`isConnected` pass-through.

## Impact

- `app/frontend/src/components/top-bar.tsx` — remove 3 cluster entries + trailing dot; keep exports shared with palette
- `app/frontend/src/components/top-bar-overflow-menu.tsx` — candidate rows shrink; version row unchanged
- `app/frontend/src/components/sidebar/index.tsx` — footer row rework
- `app/frontend/src/components/settings-dialog.tsx` — layout rework + Notifications block
- `app/frontend/src/components/dialog.tsx` — width variant prop
- Unit tests + e2e specs (+ `.spec.md` companions) touching the moved elements
- No backend changes. No route changes (Constitution IV). Keyboard reachability preserved via existing palette actions (`Theme: *`, `Settings: Open`, `View: Refresh Page`); verify a palette action exists for Help and Notifications post-move (Constitution V) and add one if missing.

## Open Questions

- None blocking. (Host-route/mobile connection-dot visibility is recorded as a graded assumption below.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Move help + theme + connection dot to sidebar footer; dot left, actions right | Discussed — user chose items 1, 2, 6 and specified the alignment explicitly | S:95 R:85 A:95 D:95 |
| 2 | Certain | Version readout sits LEFT with the dot (passive-readout segment), not in the right cluster | Discussed — user asked; agent recommended left; reflected in approved mockup v2 | S:90 R:90 A:90 D:90 |
| 3 | Certain | Notifications fold into settings dialog; update chip, refresh, chevron stay in top bar | Discussed — "Agreed to folding notifications into settings"; mockup marked stays/leaves and was approved | S:95 R:80 A:90 D:90 |
| 4 | Certain | Settings dialog goes desktop-wide (~660px) with 190px-label preference rows, collapsing to one column on narrow screens | Discussed — user asked for it; approved the settings mockup showing exactly this | S:90 R:85 A:90 D:85 |
| 5 | Confident | Footer icons use the gear's borderless idiom, not bordered rk-glint chips | Stated in both mockup notes the user approved; consistent with existing footer gear | S:75 R:90 A:85 D:80 |
| 6 | Confident | Dialog width becomes a `size` prop on the shared Dialog; other dialogs keep `sm` | Agent-stated implementation note in the final approved message; minimal-surface change | S:70 R:90 A:90 D:85 |
| 7 | Confident | Overflow menu's fixed version row stays as the update surface; footer version is a passive readout only | Footer version was agreed as "resting version line"; removing the menu's update surface was never discussed | S:60 R:85 A:80 D:75 |
| 8 | Tentative | With the dot gone from the top bar, routes without a sidebar (Host `/`) and the closed mobile drawer simply lose the connection indicator — no host-route special case | Caveat was surfaced twice; user approved the mockups (dot marked "leaves the bar") without requesting a fallback. Easily reversed by re-adding a mode-gated dot later | S:45 R:80 A:55 D:50 |
| 9 | Confident | Unsupported-push browsers see a "Not supported" note in the settings Notifications row (instead of the bell's render-nothing behavior) | A settings pane explains absence; render-nothing is a bar-chip idiom. Low blast radius | S:50 R:90 A:75 D:70 |

9 assumptions (4 certain, 4 confident, 1 tentative, 0 unresolved).
