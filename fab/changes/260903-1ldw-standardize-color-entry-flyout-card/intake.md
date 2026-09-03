# Intake: Standardize color-selector invocation on the row flyout card

**Change**: 260903-1ldw-standardize-color-entry-flyout-card
**Created**: 2026-09-03

## Origin

Created by `/fab-proceed`'s promptless create-new dispatch from a synthesized change description carrying **user-confirmed decisions** from a prior design discussion (all four numbered decisions below were explicitly confirmed by the user — they are discussion outcomes, not agent assumptions). No questions were asked at intake per the promptless-defer contract.

> Standardize color-selector invocation on the row flyout card. The color picker (SwatchPopover / label picker) is invoked inconsistently across sidebar tiers on fine pointers: the window tier uses the hover flyout card's `Change color…` row (the target pattern), the session tier and the server group header use hover-revealed palette icons in right-edge action clusters, and the server tile in the TMUX SERVERS panel has no color entry at all. On coarse pointers all three tiers are already standardized (260817-ve5m) on the rail-triggered shared flyout card. Converge fine pointers on the same card: retire the fine-pointer hover action clusters entirely (all icons, not just palette) on session rows and server group headers, drop `coarseOnly` so the card is the fine-pointer hover surface (retiring the separate identity tips those tiers show), give the server tile the same server card, keep the Host panel instance-color icon as the documented exception, and ensure a `Server: Set Color` command-palette action exists for keyboard parity.

**Key user-confirmed decisions** (each expanded in *What Changes*):
1. Retire the fine-pointer hover action clusters ENTIRELY on session rows and server group headers — palette icon AND sibling icons (Spawn agent, New tab, Kill, etc.) — because every cluster action already exists as a flyout-card row. Drop `coarseOnly` on those tiers' cards; the card becomes the single fine-pointer hover surface, retiring the separate identity tips (their content is carried verbatim by the card).
2. The server tile in the TMUX SERVERS panel hosts the SAME server flyout card (option "b": every representation of an entity hosts the same card) — fixing the asymmetry where server color could only be changed on the sessions-pane group row.
3. The Host panel instance-color palette icon (`app/frontend/src/components/sidebar/host-panel.tsx:83`, `aria-label="Set instance color"`) stays AS-IS — the documented exception. Instance color is a whole-host accent (top-bar wash + PWA titlebar tint via `instance-accent.ts`, stored in config.yaml `instance_color`), closer to theme than to row color, has no entity row, and already has a second home in the Settings dialog.
4. Keyboard parity (Constitution V): add a `Server: Set Color` command-palette action — verified missing in `app/frontend/src/app.tsx` (`Session: Set Color` at ~2591, `Tab: Set Color` at ~2702, and `Tab: Label` at ~592 exist; the `Server:` family has Create/Move up/Move down/Switch but no color action). Once the hover icon retires, the palette must remain the keyboard path for every tier.

**Alternatives the user rejected**: (a) standardizing on hover icons instead (adding one to the window row and server tile) — the card is already the coarse-pointer standard, so converging on the card unifies pointer regimes and labeled card rows are more discoverable than hover-revealed icons; (b) leaving the server tile inert (pure navigation) — rejected in favor of decision 2; (c) giving the Host panel header its own card — one action doesn't justify inventing a card idiom for a panel header.

**Accepted trade-off** (user-confirmed): color changes go from one click (hover icon) to hover-dwell + click (card row). Acceptable because color changes are occasional and consistency/discoverability win.

## Why

1. **The pain point**: on fine pointers (desktop hover) the same operation — "change this entity's color" — has three different invocation idioms across four sidebar surfaces, verified in code:
   - **Tab (window) row**: hover flyout card → `Change color…` row (`app/frontend/src/components/sidebar/window-row.tsx` ~341; the card's action rows are "additive on fine pointers" per the ~333 comment) — the target pattern, established by change 93dy.
   - **Session row**: hover-revealed palette icon in the right-edge action cluster (`app/frontend/src/components/sidebar/session-row.tsx` ~447, `aria-label="Set color for ${session.name}"`) → `SwatchPopover` directly (~519). The session flyout card exists but is `coarseOnly: true` (~174); fine hover shows a separate identity tip instead.
   - **Server group header** (sessions pane): hover-revealed palette icon (`app/frontend/src/components/sidebar/index.tsx` ~2853, `aria-label="Set color for server ${server}"`, change x4sf) → portalled `SwatchPopover` (~2922); the server card is `coarseOnly: true` (~2617).
   - **Server tile** (TMUX SERVERS panel, `app/frontend/src/components/sidebar/server-panel.tsx`): NO color entry at all — identity tip only.

   On coarse pointers (touch) all three tiers are ALREADY standardized (change 260817-ve5m): the rail-triggered shared flyout card (`row-flyout-card.tsx`) with a `Change color…` row. The inconsistency is a fine-pointer-only artifact.

2. **The consequence of not fixing it**: users must learn three idioms for one operation; the server tile leaves server color unreachable from the SERVERS panel entirely; the hover-icon idiom is undiscoverable (icons appear only on hover, unlabeled); and every future card-row action added to one tier deepens the divergence between pointer regimes.

3. **Why this approach**: the flyout card is already the coarse standard on all three tiers and the fine standard on the window tier — promoting it to the fine-pointer action surface on the remaining tiers converges both pointer regimes on ONE gesture (precedent: 93dy made exactly this move on the window tier, where the card replaced per-dot hover tips as the tier-2 hover surface). Every cluster action already exists as a card row, so retiring the clusters loses no capability; the identity tips' content (title + facts line) is already carried verbatim by the card's title bar + facts line, so the card can be the single hover surface per row.

## What Changes

### 1. Session row (`app/frontend/src/components/sidebar/session-row.tsx`)

- **Retire the fine-pointer hover action cluster entirely** — the trailing hover-revealed icon group (~440–480: `Set color for ${session.name}` palette, `Spawn agent in ${session.name}`, `New tab in ${session.name}`, `Kill session ${session.name}`) is currently render-gated `!coarse`; remove it on fine pointers too (i.e., remove the cluster, full stop). Every action already exists as a card row (Change color…, Spawn agent…, Update annotations, New tab, Kill session — 260817-ve5m + 260827-8n6k).
- **Drop `coarseOnly: true`** on the session `useRowFlyout` (~174) so the shared card's hover/focus triggers activate on fine pointers, matching the window tier's mechanics (hover-dwell open at the sidebar's right edge). Coarse behavior is unchanged: the 56px status rail's tap/scrub remains the coarse trigger.
- **Retire the fine-pointer identity tip** (`useIdentityTip`/`IdentityTipCard` from `sidebar/identity-tip.tsx`, change xb77): its content — `Session <full name>` title + facts line `$N · N windows · ~/{path}` — is already carried verbatim by the card's `PopupTitleBar` + facts line, so the card becomes the single hover surface for the row.
- The direct `SwatchPopover` mount (~519) remains but is now invoked only from the card's `Change color…` row (and stays suppressing the card while open, as the coarse path already does).

### 2. Server group header (`app/frontend/src/components/sidebar/index.tsx`)

- **Retire the fine-pointer header action cluster entirely** — the palette (`Set color for server ${server}` ~2853), `+` new session, and `Kill server ${server}` (~2873) three-button cluster (change x4sf, currently render-gated `!coarse`). The rail-triggered server card already carries Change color… / New session / Kill server rows bound to the same stable identity-arg seams (`onServerColorChange`/`onCreateSession`/`onKillServer` — no new props, preserving the R6a memo contract).
- **Drop `coarseOnly: true`** on the server-group `useRowFlyout` (~2617) so the card opens on fine-pointer hover/focus; the header rail's tap/scrub remains the coarse trigger.
- **SwatchPopover anchoring**: the portalled popover (~2922) currently anchors at the palette button on fine pointers and falls back to the header element (`headerRef`) on coarse where the button is render-gated off. With the button gone, the header-anchor fallback (with its existing flip heuristic) becomes the anchor on every pointer class — the coarse path's code already handles this.

### 3. Server tile (`app/frontend/src/components/sidebar/server-panel.tsx`)

- **Add the SAME server flyout card to each server tile** in the TMUX SERVERS panel — the shared `row-flyout-card.tsx` shell with the server card's content (title `tmux -L <server>`-style facts + Change color… / New session / Kill server rows), opened on fine-pointer hover/focus like the other tiers. This is decision 2's "every representation of an entity hosts the same card" and is what gives the tile color entry for the first time. The card's content/state should be shared or extracted with the sessions-pane server card rather than duplicated (the shared-shell precedent from 260817-ve5m).
- **Retire the tile's identity tip** (`Server <name>` title + socket flag + session count) — the card carries the same facts, keeping "single hover surface per row" consistent with the other tiers.
- The tile's existing portalled `SwatchPopover` flip-heuristic pattern (referenced by the header picker's comment) anchors the popover opened from the tile card's Change color… row.

### 4. `identity-tip.tsx` retirement

Consumers of `sidebar/identity-tip.tsx` are exactly `session-row.tsx`, `index.tsx` (server group header), and `server-panel.tsx` (+ their tests). After changes 1–3 the module has no consumers; delete it and its test coverage (dead code per code-quality). If any consumer must remain for an unforeseen reason, keep the module and note why.

### 5. Command palette: `Server: Set Color` (`app/frontend/src/app.tsx`)

Add a `Server: Set Color` palette action alongside the existing `Session: Set Color` (~2591) and `Tab: Set Color` (~2702), following their registration/anchoring shape (Constitution V: the palette is the complete action registry and the keyboard fallback once hover icons retire). It targets the current route's server (mirroring how `Session: Set Color` scopes) and opens the same SwatchPopover / label picker the card row opens.

### 6. Tests

- **Unit**: update `session-row.test.tsx`, `index.test.tsx` / `index.core.test.tsx`, `server-panel.test.tsx` for the removed clusters/tips and the new fine-pointer card + tile card; extend `row-flyout-card.test.tsx` only if the shared shell changes; add coverage for the new palette action where palette actions are tested.
- **e2e**: retarget specs that drive the retired hover-icon selectors (`Set color for…`, `Spawn agent in…`, `New tab in…`, `Kill session…`) to the card rows. Grep hits: `new-window-unnamed.spec.ts`, `api-integration.spec.ts`, `spawn-agent.spec.ts`, `row-flyout.spec.ts`, `sync-latency.spec.ts`. Each modified `test()` keeps its **Proves/Steps** intent comment current (Constitution: Test Intent Comments).

### Non-goals

- No coarse-pointer behavior changes on the three existing tiers (rail + card, 260817-ve5m, stays as-is).
- No new coarse trigger (rail) on the server tile — the tile card is a fine-pointer hover/focus surface in this change.
- No change to the Host panel instance-color icon or the Settings dialog's instance-color home (decision 3).
- No change to the SwatchPopover / label picker itself (its vocabulary and layout are owned by 260723-wwoi / 260819-9hh6).

## Affected Memory

- `run-kit/ui/sidebar`: (modify) session-row and server-group-header sections — fine-pointer action clusters retired, cards no longer coarse-only, identity tips retired; server-panel tile section — tile hosts the server card; `identity-tip.tsx` module retirement
- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card — the three-tier card contract is now both-pointer-classes on all tiers (fine hover/focus + coarse rail), plus the server-tile fourth surface
- `run-kit/ui/dialogs-and-state`: (modify) SwatchPopover invocation map — card row is the sole row-level entry on both pointer classes; header/tile anchoring notes
- `run-kit/ui/keyboard-and-palette`: (modify) new `Server: Set Color` palette action in the action registry

## Impact

- **Code**: `app/frontend/src/components/sidebar/session-row.tsx`, `app/frontend/src/components/sidebar/index.tsx`, `app/frontend/src/components/sidebar/server-panel.tsx`, `app/frontend/src/components/sidebar/identity-tip.tsx` (delete), possibly `app/frontend/src/components/sidebar/row-flyout-card.tsx` (shared shell, only if the tile mount needs it), `app/frontend/src/app.tsx` (palette action).
- **Tests**: `session-row.test.tsx`, `index.test.tsx`/`index.core.test.tsx`, `server-panel.test.tsx`, possibly `identity-tip` test removal; e2e: `new-window-unnamed.spec.ts`, `api-integration.spec.ts`, `spawn-agent.spec.ts`, `row-flyout.spec.ts`, `sync-latency.spec.ts`.
- **No backend impact** — frontend-only; color mutations ride existing seams (`onColorChange`/`onServerColorChange`).
- **Constitution touchpoints**: V (Keyboard-First — the new palette action is the compliance move), IV (no new routes/surfaces — the card is an existing surface promoted, not a new idiom).
- **Render-performance contract**: the memoized row components (`memo(SessionRowInner)` etc.) and stable identity-arg callbacks must keep their prop shapes — the card already binds to existing seams, so no new props are expected (R6a memo contract).

## Open Questions

- None asked (promptless-defer dispatch). No genuine unknowns surfaced: all four scope-defining decisions were user-confirmed in the originating discussion, and the remaining implementation choices grade Confident or better from codebase precedent (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Retire fine-pointer hover action clusters ENTIRELY (all icons) on session rows and server group headers; drop `coarseOnly` so the shared flyout card is the fine-pointer action surface; accepted trade-off hover-dwell + click | Discussed — user-confirmed decision 1; precedent 93dy (window tier) + 260817-ve5m (coarse cards) verified in code | S:95 R:70 A:90 D:95 |
| 2 | Certain | Server tile in TMUX SERVERS panel hosts the SAME server flyout card (option "b") | Discussed — user-confirmed decision 2, rejecting the inert-tile alternative | S:90 R:75 A:85 D:90 |
| 3 | Certain | Host panel instance-color palette icon stays AS-IS (documented exception) | Discussed — user-confirmed decision 3; instance color is a whole-host accent with a Settings-dialog second home | S:95 R:90 A:90 D:95 |
| 4 | Certain | Add `Server: Set Color` command-palette action | Discussed — user-confirmed decision 4; verified missing in app.tsx while Session/Tab color actions exist; Constitution V requires palette parity | S:90 R:85 A:95 D:90 |
| 5 | Certain | Fine-pointer identity tips retire on session rows and server group headers — the card is the single hover surface per row | Discussed — user-confirmed in decision 1; card carries title + facts line verbatim (xb77 content ⊂ card content) | S:90 R:80 A:85 D:85 |
| 6 | Certain | Card's `Change color…` row anchors the existing portalled SwatchPopover; the server header uses its existing `headerRef` fallback anchor + flip heuristic on all pointer classes | Coarse path already anchors at the header when the palette button is render-gated off (code comment at index.tsx ~2586) — the mechanism exists | S:70 R:85 A:90 D:85 |
| 7 | Certain | Update unit tests for the three components and retarget the five e2e specs hitting retired cluster selectors to card rows, keeping Proves/Steps intent comments current | code-quality.md mandates tests for changed behavior; Constitution Test Intent Comments binds e2e edits | S:80 R:85 A:90 D:90 |
| 8 | Confident | Server tile's identity tip also retires — the tile card carries the same facts | Implied by user's "single hover surface per row" + option "b" symmetry; not individually enumerated in the confirmed decisions | S:70 R:80 A:80 D:75 |
| 9 | Confident | `identity-tip.tsx` module is deleted once its three consumers (session-row, index.tsx, server-panel) drop it | Dead-code removal per code-quality; consumer list verified by grep — no other importers | S:55 R:90 A:85 D:80 |
| 10 | Confident | Server tile card opens on fine-pointer hover/focus only; NO coarse rail is added to the tile in this change | The change's framing is fine-pointer standardization and the tile has no rail today; adding a tile rail later is cheap and separable | S:55 R:80 A:60 D:55 |
| 11 | Confident | `Server: Set Color` mirrors `Session: Set Color`'s registration shape and scopes to the current route's server | Existing palette color actions define the idiom; one obvious front-runner | S:60 R:80 A:75 D:70 |
| 12 | Confident | Shared card content between the sessions-pane server card and the tile card is extracted/shared rather than duplicated | code-quality anti-pattern: duplicating existing utilities; 260817-ve5m's one-shell precedent | S:60 R:75 A:80 D:70 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
