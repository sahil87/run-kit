# Intake: Status Bar Copyable Segments

**Change**: 260902-3m72-status-bar-copyable-segments
**Created**: 2026-09-02

## Origin

One-shot user request, dispatched promptlessly via `/fab-proceed` after a code-exploration conversation that located both the target surface and the pattern to mirror.

> Make items on the status bar clickable an copyable where possible (just like the Pane Details section on the left panel)

Key context established in the conversation (source of truth for scope):

- **Target surface**: `app/frontend/src/components/status-bar.tsx` — the desktop-only, full-width 24px status strip (mobile renders no bar at all). Its left `WindowCluster` renders passive `Segment` spans: git branch (`⑂`), fab line, agt line, tmx pane (`pane N/M %id`), cwd basename. The **pr** segment is already interactive — a real anchor to `win.prUrl` (open-first). The right cluster renders passive spans (cpu/mem/ld inside `MetricsFlyout`, server name, hostname, version) plus already-interactive ⌘K/compose buttons and the connection dot. The `OverflowMenu` (`…`) renders dropped segments as informational `role="menuitem"` spans.
- **Pattern to mirror**: `app/frontend/src/components/sidebar/status-panel.tsx` — the Pane panel's `CopyableRow` / `PrLinkRow` interaction contract (details in What Changes).
- "Where possible" is the user's scope softener: segments with a meaningful copyable raw value get the affordance; purely informational/live-metric items may stay passive.

## Why

1. **Pain point**: The status bar mirrors the Pane panel's registers (branch, fab change, tmux pane id, cwd, PR) but every one of them is a dead span — a user who wants the branch name, the pane id (`%42`), or the full cwd path must open the sidebar's Pane panel (or a terminal) to copy it, even though the value is drawn right there on screen. The Pane panel already solved this with click-to-copy rows; the status bar — which absorbed the retired desktop PANE/HOST panels precisely to be the always-visible mirror of those values — never inherited the affordance.
2. **Consequence of not fixing**: The status bar stays a read-only ornament for values users routinely need in shell commands (`tmux` targets, `cd` paths, branch names, change ids), and the two register surfaces (Pane panel vs. status bar) present inconsistent interaction models for identical data — the same register is copyable in one place and inert in the other.
3. **Why this approach**: The user explicitly named the Pane panel as the pattern ("just like the Pane Details section"). Mirroring `CopyableRow`'s exact contract (raw-value copy, 1s `copied ✓` feedback, selection guard, hover accent, real `<button>`) keeps one interaction vocabulary across both register surfaces, reuses proven mechanics (`copyToClipboard` in `@/lib/clipboard`), and satisfies Constitution V (keyboard-first — a `<button>` is natively focusable/activatable) without inventing new UI.

## What Changes

All changes are confined to the status bar surface (`app/frontend/src/components/status-bar.tsx` and its tests), plus the possible extraction of a small shared copy-feedback helper. The Pane panel's behavior does not change; the shared register resolvers (`sidebar/registers.ts`) are untouched (the bar's MIRROR-NOT-ROLLUP header rule holds — nothing is re-derived).

### Left cluster: copyable window registers

The four passive window-register segments become click-to-copy, each copying the **raw underlying value** (the Pane panel's rule — never the truncated display text):

| Segment | Display today | Raw value copied |
|---------|---------------|------------------|
| git (`⑂`) | branch name (truncating) | `activePane.gitBranch` — the branch name |
| fab | `getFabLine(win)` (change · stage · state) | `parseFabChange(win.fabChange).id` — the 4-char change id |
| tmx | `pane N/M %id` | the pane id, e.g. `%42` (`activePane.paneId`) |
| cwd | basename of the path | the full absolute path (`activePane.cwd ?? win.worktreePath`) |

The **agt** segment stays passive: its line is derived ephemeral state (`getAgentLine`) with no stable raw value, and the Pane panel's agt row is likewise not copyable.

When a copyable value is absent the segment is absent already (existing gating: `gitBranch &&`, `fabLine &&`); the tmx segment can render with an empty `paneId` — in that case it stays passive (the Pane panel has the same fork: `paneId ? CopyableRow : plain div`).

### PR segment: unchanged open-first anchor

The pr segment keeps its existing open-first anchor (`href={win.prUrl}`, new tab). No hover copy icon is added in the 24px strip: native right-click → "Copy Link Address" plus the Pane panel's `PrLinkRow` copy icon already cover URL copy, and the strip lacks the Pane panel's row real estate for the hover-revealed sibling-icon split. The no-URL pr branch (plain span) stays passive as well (the Pane panel copies segment text there, but in the strip that text is fully visible and holds no hidden raw value).

### Right cluster: copyable identity segments, passive metrics

- **server name**, **hostname**, and **version** become click-to-copy of their displayed raw strings (the server name as passed in props; the host name as displayed — `instanceName ?? metrics.hostname`; the version as displayed via `displayVersion`).
- **cpu/mem/ld** stay non-copyable: live ~2.5s-tick metrics with no stable value worth copying; the `MetricsFlyout` hover/focus card behavior is preserved unchanged.
- **connection dot**, **⌘K**, **compose**, and **zen exit** are unchanged (already interactive or pure status).

### Overflow menu: copy-action rows for dropped copyable segments

In `OverflowMenu`, the informational rows that mirror **copyable** strip segments (git, tmx, cwd, version) become `role="menuitem"` **buttons** that copy the same raw values — below a breakpoint the menu row is that register's only surface, so keyboard parity requires the action to live there too (Constitution V; the menu already has roving focus and an `actionRow` button pattern to follow). The **ld** and **cpu · mem** rows stay informational spans (mirroring the strip's non-copyable metrics). Copy feedback inside a menu row uses the same `copied ✓` swap; the menu does NOT close on copy (the user may want to read the row).

### Interaction contract (mirroring the Pane panel's `CopyableRow`)

Every copyable segment follows `status-panel.tsx`'s proven mechanics exactly:

- The segment becomes a real `<button type="button">` (keyboard focusable + Enter/Space activatable — Constitution V), styled to keep the current segment look (transparent, no border, monospace inherit).
- Click handler: guard first — `if (window.getSelection()?.toString()) return;` (never clobber an in-progress text selection) — then `void copyToClipboard(rawValue)` (`@/lib/clipboard`).
- Feedback: the segment's label/prefix swaps to `copied ✓` for `COPY_FEEDBACK_MS` (1000ms), managed by a single `copiedKey` state + one timer ref (cleared on re-copy and unmount) — the Pane panel's `copiedRow` pattern, keyed per segment.
- Hover affordance: `group` on the button + `group-hover:text-accent` on the value span (the clickability reveal), alongside the existing register-name `Tip`.
- The copy-interaction logic (selection guard + clipboard call + feedback timer) SHOULD be factored into a small shared helper/hook used by both `status-panel.tsx` and `status-bar.tsx` rather than duplicated (code-quality anti-pattern: duplicating existing utilities); exact factoring is a plan decision.

The bar stays **presentational-by-contract**: the copied-feedback state is component-local UI state, no new props, no fetching, no new derivations.

### Tests

- **Unit** (`app/frontend/src/components/status-bar.test.tsx`, extending the existing suite): per-segment copy assertions with `copyToClipboard` mocked — raw value copied (full cwd path, pane id, branch, change id), selection guard short-circuits, `copied ✓` feedback appears and reverts after the timer, overflow-menu copy rows work via click and keyboard (roving focus + Enter), non-copyable segments (agt, metrics, connection dot) render no button.
- **e2e**: UI changes SHOULD include Playwright coverage where possible (`fab/project/code-quality.md`); an e2e spec exercising a status-bar segment copy (clipboard permissions permitting) with the Constitution's mandatory Proves/Steps intent comment. Feasibility (clipboard access per browser project) is assessed at plan time; unit coverage is the mandatory floor.

## Affected Memory

- `run-kit/ui/status-signals`: (modify) The desktop status bar section (window-mirror + host clusters, degradation ladder) gains the segment copy-affordance contract: which segments copy which raw values, the mirrored `CopyableRow` mechanics, the overflow-menu copy-row parity, and the deliberately passive set (agt, metrics, dot).

## Impact

- `app/frontend/src/components/status-bar.tsx` — primary: `Segment` grows a copyable variant (or a sibling `CopyableSegment`), `WindowCluster` + right cluster + `OverflowMenu` wiring, component-local copied-state.
- `app/frontend/src/components/status-bar.test.tsx` — extended unit coverage.
- `app/frontend/src/components/sidebar/status-panel.tsx` + a new shared helper (e.g. under `src/hooks/` or `src/lib/`) — only if the shared copy-feedback extraction lands (behavior-neutral refactor of the Pane panel's `handleCopy`).
- Possibly one Playwright spec under `app/frontend/tests/e2e/`.
- Desktop-only blast radius: mobile renders no status bar; the sidebar Pane panel, register resolvers, and status-pyramid machinery are untouched. No backend, API, or state changes.

## Open Questions

None blocking — every decision point was resolved by graded assumption under promptless dispatch (see Assumptions). Rows worth a `/fab-clarify` glance if the user disagrees with a default: #5 (pr segment stays anchor-only), #6 (right-cluster identity segments included in scope), #8 (overflow rows become copy actions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mirror the Pane panel's `CopyableRow` contract verbatim: `copyToClipboard` of the raw value, 1s `copied ✓` prefix swap (`COPY_FEEDBACK_MS`), `window.getSelection()` guard, `group-hover:text-accent` reveal, real `<button>` per Constitution V | User's verbatim request names the Pane panel as the pattern; conversation confirmed the exact mechanics in `status-panel.tsx` | S:90 R:85 A:95 D:95 |
| 2 | Certain | Copy RAW values, not display text: tmx → pane id (`%42`), cwd → full absolute path, git → branch name, fab → change id, pr → PR URL | Discussed — matches exactly what the Pane panel copies today; copying truncated display text would be useless | S:85 R:85 A:95 D:90 |
| 3 | Confident | Live metrics (cpu/mem/ld) and the connection dot stay non-copyable; `MetricsFlyout` behavior preserved | "Where possible" softener; ephemeral ~2.5s-tick values have no stable raw value worth copying | S:65 R:90 A:80 D:70 |
| 4 | Confident | The agt segment stays passive | No raw underlying value (derived state line); the Pane panel's agt row is likewise not copyable — mirroring keeps the surfaces consistent | S:60 R:90 A:75 D:70 |
| 5 | Confident | The pr segment keeps its open-first anchor with NO hover copy icon in the strip; the no-URL pr branch stays passive | Native right-click link copy + the Pane panel's `PrLinkRow` icon already cover URL copy; the 24px strip lacks room for the hover-icon sibling split | S:45 R:90 A:65 D:55 |
| 6 | Confident | Right-cluster identity segments (server name, hostname, version) become copyable of their displayed raw strings | "Items on the status bar … where possible" reads inclusively and the values are meaningful (tmux `-L` targets, bug reports); the named pattern only covers window registers, so this extends it — flagged for optional review | S:40 R:90 A:60 D:50 |
| 7 | Confident | Copied feedback = the Pane panel's prefix/label swap to `copied ✓` (accepting a transient width shift in the strip), not a tooltip or value swap | "Just like the Pane panel" is direct signal for the swap; a 1s transient shift in a truncating flex strip is benign | S:50 R:90 A:75 D:70 |
| 8 | Confident | OverflowMenu rows mirroring copyable segments (git/tmx/cwd/version) become copy-action menuitem buttons; ld and cpu·mem rows stay informational; menu stays open on copy | Constitution V keyboard-first — below a breakpoint the menu row is the register's only surface; the menu's `actionRow` button pattern already exists | S:50 R:85 A:75 D:65 |
| 9 | Certain | Scope confined to `status-bar.tsx` (+ tests, + optional shared-hook extraction); resolvers untouched; presentational-by-contract preserved (copied state is component-local, no new props/fetches); mirror-not-rollup rule intact | The bar's own header contract and the conversation's scoping; nothing here needs new derivations | S:80 R:85 A:90 D:85 |
| 10 | Confident | Testing = mandatory unit coverage in `status-bar.test.tsx` (copy per segment, guard, feedback timer, overflow rows, keyboard) + Playwright e2e where feasible (clipboard permissions assessed at plan time) | `code-quality.md`: new behavior MUST have tests; UI changes SHOULD include e2e — feasibility of clipboard assertions varies by browser project | S:60 R:85 A:85 D:80 |
| 11 | Confident | Factor the copy-interaction logic (guard + clipboard + feedback timer) into a shared helper/hook consumed by both `status-panel.tsx` and `status-bar.tsx`; exact shape left to plan | Code-quality anti-pattern: duplicating existing utilities; the Pane panel's `handleCopy` is the proven implementation to lift | S:55 R:85 A:80 D:65 |

11 assumptions (3 certain, 8 confident, 0 tentative, 0 unresolved).
