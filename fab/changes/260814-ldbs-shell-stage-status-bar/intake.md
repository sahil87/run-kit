# Intake: Shell Stage + Status Bar — the Composed Frame

**Change**: 260814-ldbs-shell-stage-status-bar
**Created**: 2026-08-14 (rescoped 2026-08-14 — supersedes the earlier "detached rail + bottom bar" scope in this same change)

## Origin

Design session (2026-08-14) following the shipped gap-seam tile chrome (`260814-011r`, merged as PR #601). The session iterated an interactive mock through three approved steps: (1) detached rail + bottom-bar cards on a continuous stage — approved; (2) the user then proposed deleting the desktop bottom bar outright (its key chips are touch affordances) with its useful remnants relocating — agreed with refinements; (3) the user proposed promoting the sidebar's bottom panels into a first-class full-width status bar — agreed. The final composed mock (stage + rail card, no desktop bottom bar, full-width status bar with real segment content) was reviewed and the user directed: **"Once PR 603 merges, rebase / reset to the latest origin/main and then go ahead with the changes."** This intake replaces the earlier ldbs intake; the bottom-bar-*card* idea is superseded (the bar is deleted on fine pointers instead).

> Recompose the desktop shell frame around the shipped gap-seam vocabulary: a single-row **stage** (tile grid + rail card floating on one continuous `bg-bg-inset` ground), the desktop bottom bar **deleted on fine pointers** (kept verbatim for coarse pointers), and a new full-width attached **status bar** at the shell bottom that absorbs the sidebar's PANE/HOST panels (left = current-window registers, right = host segments + the ⌘K / compose hints). Two-family vocabulary is the organizing rule: **attached frame** (top bar, sidebar, status bar — flush, 1px seams, square) vs **floating cards** (tiles, rail — gaps, radius, dimmed borders).

## Why

1. **The pain point**: (a) 011r's floating-card language stops abruptly at the tile grid's edges — the rail is still welded on with `border-l`, the bottom bar with a 3px seam. (b) On a fine-pointer desktop the bottom bar is vestigial: five of its chips (Tab/Ctrl/Alt/F-keys/arrows) are key-*simulation* affordances for keyboardless devices, and only ⌘K + the compose toggle carry desktop value — 48px of prime vertical space spent on touch affordances. (c) The sidebar's PANE/HOST panels put *current-window* status inside a *server-navigation* surface: registers truncate in a ~200px column and steal height from the session list.
2. **If we don't fix it**: the terminal route reads as two half-applied design systems; desktops keep paying 48px for chips they can't use; window status stays squeezed in the wrong container.
3. **Why this approach**: extend the exact shipped vocabulary (same `rk-card-border`, `rounded-md`, 6px gaps) to the rail; delete rather than decorate the bar where it has no job (pointer-gated, so iPads lose nothing); and give the registers the container that fits them — a VS Code-style full-width status bar, which also inherits the killed bar's two useful affordances as right-side hints. Net vertical math on desktop: −48px bar +24px status bar = **+24px terminal**.

**Alternatives rejected** (all from the session):
- **Bottom bar as a detached card** (the earlier ldbs scope): superseded — approved at step 1, then obsoleted by the delete-the-bar decision at step 2.
- **Viewport-gated bar removal**: rejected — `isMobileViewport()` is width-OR-coarse, so an iPad at desktop width would lose its only Ctrl/Tab/F-keys. The kill rule is **pointer-based** (fine → gone, coarse → today's bar verbatim).
- **Settings gear to the rail bottom** (the VS Code manage-gear pattern): rejected — the rail exists only on the terminal route while the gear must stay reachable on every route; it stays in the top bar. The rail stays purely surface toggles.
- **Compose opener at the rail bottom or sidebar bottom**: rejected — it's a content verb, not app meta, and the sidebar is collapsible. It lands as a status-bar hint (plus a close affordance in the expanded strip).
- **Status bar starting right of the sidebar** (sidebar full height): rejected — makes the bar read stage-scoped while carrying host-global segments, and gives the frame two competing bottom edges.
- **Sidebar bottom gap + rounded bottom-right corner**: rejected — a half-card. The sidebar sits on no ground; the frame family is flush and square. If the sidebar ever floats, that's full Tier-2 (whole sidebar as a card), a separate future change.
- **Scrollable status bar on narrow widths**: rejected — a scrolling status bar hides what it exists to show; overflow uses the top-bar-style degradation ladder + chevron instead.
- **A mobile status bar**: rejected — vertical budget; the drawer keeps the PANE/HOST panels as the mobile home (the established persistent-chrome→tap-away degradation pattern).

## What Changes

### 1. Stage composition (desktop terminal route)

When `hasRightPanel` holds (`!isMobile && !!rightPanelChildren` in `components/shell/shell.tsx`), the region right of the sidebar becomes a single-row **stage**: a nested grid on the `bg-bg-inset` ground, `p-[6px]` padding, `gap-[6px]`, columns `1fr auto` — tile grid | rail card. **No bottom-bar row** (superseding the earlier two-row stage).

Current geometry (verified): Shell's desktop grid is `'"sidebar content rightpanel" "sidebar bottombar rightpanel"'` with the rail column spanning both rows and the `footer[gridArea:bottombar]` scoped to the content column.

**Mechanism (decided)**: the stage is a **nested grid** wrapping Shell's `{children}` and the rightpanel aside — NOT a bare grid-template-areas flip, because grid `gap` applies to all tracks and would open a 6px seam against the sidebar. Consumers' `gridArea: "content"` styles rebind to the nested template automatically (areas bind to direct children). Constraints:
- The sidebar column gets **no** gap — its `border-r` / 3px drag-handle seam stays the attached seam; the top bar stays attached (the stage's 6px top padding is the gap below it).
- The outer grid becomes single-row on this branch (`"sidebar stage"` + the status-bar row per §4); `ShellGridRefContext` stays on the outer grid (no consumers outside shell.tsx — verified previously).
- Shell's mobile grid and the no-`rightPanelChildren` desktop grid (board/host/server consumers) stay byte-identical apart from the shared bottom-bar/status-bar rules in §3–§4.
- **Rail collapse leaves no stray gap**: `rightPanelVisible === false` flips the stage template to `1fr` (dropping the `auto` column) while the aside stays mounted-hidden (right-panel P3 hide-never-unmount) — an explicit `auto` track would keep its column-gap even with a hidden item.

### 2. Rail card (`components/right-panel.tsx`)

The rail container (currently `w-[46px] shrink-0 border-l border-border …`) **loses `border-l border-border`** and becomes a rounded card: `rounded-md`, the shared 55% dimmed `rk-card-border` (shipped in 011r), `bg-bg-primary`. It occupies stage row 1 / col 2 — starting 6px below the top bar and ending 6px above the status bar. Width and ALL behavior unchanged (toggles, lit states, dots, disabled-at-3 tooltip, `⇧⌘.`, `runkit-rail-open`, `right-panel-rail` testid). Chrome only. The rail stays purely surface toggles — no meta cluster (rejected above).

### 3. Desktop bottom bar deleted on fine pointers (`components/bottom-bar.tsx` + call sites)

On **fine pointers**, `BottomBar` does not render at all — at BOTH desktop render sites (the app-shell footer, app.tsx ~3694, and the board twin, board-page.tsx ~1057). On **coarse pointers** (mobile AND desktop-width touch devices like iPads) the bar renders exactly as today — attached `border-t-[3px]` frame, key chips, all behavior; no card treatment anywhere.
- The gating MUST keep the PR #598 lesson: the render gate and any caller-side reserved frames live so that no fixed-height gap is left behind (frames inside the gating component; effects gated on the same predicate).
- The pointer gate should reuse the existing coarse-pointer detection seam (the `coarse:` variant infrastructure / `isMobileViewport()`'s pointer half) rather than a new media-query one-off — implementation picks the exact vehicle (CSS `coarse:` display gate vs the JS pointer check) per the codebase's precedent.
- The bar's desktop-useful remnants relocate: ⌘K and the compose opener become status-bar hints (§4); everything else (key chips, Surfaces chip, scroll-lock) was touch-only and simply doesn't exist on fine pointers.
- The **iPad seam** (desktop width + coarse pointer) deliberately gets BOTH the status bar and the key-chip bar: width decides the status bar, pointer decides the key-chip bar.

### 4. Status bar — new full-width attached frame chrome (new `components/status-bar.tsx`)

A **full-width attached strip** at the shell bottom on desktop (all desktop routes): ~24px, `border-t border-border`, `bg-bg-primary`, mono ~10.5–11px. It is FRAME chrome like the top bar — flush, square, never a card. The sidebar ends flush above it (T-junction of the sidebar's `border-r` into the bar's `border-t`; no gap, no corner radius — rejected above). Shell's desktop grid gains the status-bar row spanning ALL columns (sidebar included).

**Segments** (each a small `seg` cluster; values reuse the EXISTING register resolvers — `sidebar/registers.ts`, the pane-panel four-register view, host metrics — never re-derived; Constitution X: all segments are already-derived state):
- **Left (window-scoped — terminal route only)**: `tmx <pane a/b %id>` · `⑂ <git branch>` · `out <agent · state>` · `agt <state + age>` (with the status-dot hue vocabulary) · `fab <id slug>` (the active-change register) · the PR register (colored per the shared PR vocabulary; click → open PR). `cwd` renders as a basename segment with the full path in its tooltip.
- **Right (host-scoped — every desktop route)**: compact host metrics `cpu 17% · mem 24/59G · ld .14` (the PANE/HOST panels' cpu sparkline and mem bar graphs move to a hover **flyout** on this segment — the row-flyout-card pattern; the Host Overview page stays the deep view) · `<server>` · `<host> v<version>` · the connection dot · the `⌘K` palette hint · the `a` compose hint.
- **Semantics**: the status bar is a **current-window mirror**, not a new rollup — attention surfacing (waiting badges, rollups, nav) stays entirely on the status-pyramid machinery. Clickable segments (PR, ⌘K, compose, flyout triggers) get palette parity (Constitution V).

**Sidebar panels graduate**: the desktop sidebar's PANE and HOST panels are REMOVED (the session list gets the height back; the sidebar becomes pure navigation). The **mobile drawer keeps both panels unchanged** — a small honest fork: the panels become drawer-only.

**Overflow — degradation ladder, never scroll** (the top-bar overflow precedent):
1. Compress in place: flexible segments truncate (`min-w-0 truncate` on branch/fab-slug; `out` drops the agent name; labels degrade to glyphs). Fixed-value segments don't stretch.
2. Drop whole segments by priority — the **status pyramid** (PR > fab > agent > tmux) orders left-cluster survival: `PR → fab → agt → git → out → tmx → cwd` (last-listed dies first); right cluster drops hints first, then `ld → cpu/mem → version`, the connection dot last. Clusters degrade independently.
3. A trailing `…` overflow chevron (the `menuOnly` row pattern) carries every dropped segment, so the full set stays one click away at any width.
Mechanics: a small breakpoint ladder (container query or the top bar's `lg`/`md` steps) — deterministic thresholds, not JS measurement; only the ~700–1100px band needs to survive (below that the mobile branch takes over and the bar doesn't render).

**Mobile**: no status bar at all (rejected above).

### 5. Compose affordances

- The status bar's `a` hint is the desktop **opener** (click → open the compose strip; the `compose-toggle` chord and palette entry remain the keyboard-first path).
- The **expanded** compose strip gains an `a|` close affordance next to the attach (📎) button — clicking it closes the strip, so open and close live in the same visual family. The strip's chrome is otherwise unchanged, including the in-tile dock.

### 6. Tile grid inset moves to the stage (`components/surface-layout.tsx`)

011r's grid container carries `gap-[6px] p-[6px] bg-bg-inset`; the stage now provides the outer inset and ground, so the grid **drops `p-[6px]` and its own `bg-bg-inset`** (keeping `gap-[6px]` and all divider/sash/intersection machinery). Net tile geometry unchanged: 6px from every edge, single seams. NOTE: PR #603 rewires the seam-drag listeners in this same file — this change lands AFTER #603 merges and rebases onto it; the inset-drop edit must be re-verified against the rebased file.

### 7. Design reversals to record honestly

| Earlier decision | Now |
|------------------|-----|
| Rail is a FULL-HEIGHT shell column ("rail to shell bottom", e2e-asserted at `tests/e2e/right-panel.spec.ts` ~411, 260812-nm4p) | Rail card in stage row 1 only |
| Bottom bar SCOPED to the content column (same e2e test) | Desktop fine-pointer: no bar at all; coarse: today's bar |
| Bottom bar renders on all form factors (48px reserved) | Fine-pointer desktop reclaims it; status bar takes 24px back |
| PANE/HOST panels live in the desktop sidebar | Registers → status bar; panels drawer-only |

The right-panel e2e test asserting rail-full-height + bar-scoped flips accordingly; `right-panel.spec.md` and every other touched `.spec.md` update in the same commit (Constitution).

### 8. Scope bounds

- Sidebar and top bar stay attached; full Tier-2 sidebar card-ification stays deferred.
- Mobile: no status bar, drawer panels unchanged, mobile bar unchanged. Coarse desktop-width: status bar + today's key-chip bar.
- Stage gaps are STATIC seams — no sash/grips on rail/status-bar gaps (nothing there is resizable).
- No new routes or params (Constitution IV — and the change deletes two sidebar panels and a whole bar off the fine-pointer desktop); no behavior changes to any relocated affordance beyond its location.

## Affected Memory

- `run-kit/ui/routes-and-shell`: (modify) § Shell Grid Layout — the stage + status-bar row composition replaces the "third column spans both rows" description
- `run-kit/ui/lenses-and-layout`: (modify) § Right Rail (detached card, row 1 only) + § Tile renderer (grid cedes `p-[6px]`/ground to the stage) + § app.tsx integration (rail-visibility text)
- `run-kit/ui/compose-and-bottom-bar`: (modify) § Bottom Bar — pointer-gated existence (fine: none; coarse: verbatim); compose opener/close affordance relocation
- `run-kit/ui/status-signals`: (modify) NEW status-bar section — segments, register reuse, the current-window-mirror (not-a-rollup) rule, the pyramid-ordered degradation ladder
- `run-kit/ui/sidebar`: (modify) PANE/HOST panels leave the desktop sidebar (drawer-only fork)
- `run-kit/ui/visual-design`: (modify) the two-family rule (attached frame vs floating cards) + the vocabulary row's extent

NOTE for hydrate: `docs/memory/run-kit/ui-patterns.md` is a map file — never write there; the ui files are large, grep for headings and read only the relevant sections.

## Impact

- `app/frontend/src/components/shell/shell.tsx` — outer grid (single content row + status-bar row), nested stage grid, collapse-safe template; doc comment
- `app/frontend/src/components/status-bar.tsx` — NEW component + colocated test; consumes existing register resolvers/SSE state via props or the established context seams
- `app/frontend/src/app.tsx` — fills the status-bar slot; removes the fine-pointer footer BottomBar; compose-opener wiring; `fixedWidth` reconcile against the stage ground
- `app/frontend/src/components/right-panel.tsx` — rail card chrome
- `app/frontend/src/components/bottom-bar.tsx` — fine-pointer render gate (both sites; PR #598 no-gap property)
- `app/frontend/src/components/compose-strip.tsx` — `a|` close affordance next to attach
- `app/frontend/src/components/sidebar/` — PANE/HOST panels become drawer-only (gate, don't delete — mobile keeps them)
- `app/frontend/src/components/surface-layout.tsx` — drop `p-[6px]`/`bg-bg-inset` (post-#603 rebase)
- `app/frontend/src/globals.css` — only if a shared treatment needs a new consumer form
- Tests: `shell.test.tsx` (grid templates), NEW `status-bar.test.tsx`, `bottom-bar.test.tsx` (pointer gate), `surface-layout.test.tsx` (ceded inset), sidebar panel tests (drawer-only gate), `tests/e2e/right-panel.spec.ts` + `.spec.md` (reversal flips), possibly `surface-layout.spec.ts`; a NEW/extended e2e asserting status-bar presence + segment degradation per viewport width (the width-sweep pattern) and no-bottom-bar on the desktop project
- Vertical math: fine-pointer desktop nets +24px terminal; coarse desktop-width pays 24px for the status bar and keeps its chips

## Open Questions

None — three mock iterations resolved the design; remaining latitude is graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Composition verbatim from the approved composed mock: single-row stage (tile grid + rail card, 6px ground), desktop bottom bar deleted on fine pointers, full-width attached status bar at the shell bottom | Three explicit user approvals culminating in "go ahead with the changes" | S:90 R:75 A:90 D:90 |
| 2 | Certain | Kill rule is pointer-based: fine → no BottomBar at either desktop site; coarse (incl. iPad desktop-width) → today's bar verbatim; width decides the status bar, pointer decides the chip bar | Discussed explicitly — the iPad seam was the deciding case | S:85 R:80 A:85 D:85 |
| 3 | Certain | Status bar is attached frame chrome (full-width, flush, square); sidebar ends flush above it — no gap, no bottom-right radius; the half-card sidebar treatment rejected | User asked the junction question directly; recommendation accepted via "go ahead" | S:85 R:80 A:85 D:85 |
| 4 | Certain | Segment layout: left = window registers (tmx/git/out/agt/fab/PR, cwd basename+tooltip; terminal route only), right = compact host metrics + server/version + connection dot + ⌘K/a hints (all desktop routes); HOST graphs demote to a hover flyout; Host page stays the deep view | Discussed segment-by-segment against the real PANE/HOST panel screenshot | S:85 R:80 A:85 D:85 |
| 5 | Certain | Overflow = 3-stage ladder (truncate → pyramid-ordered segment drop → `…` chevron with menuOnly rows), never scroll; breakpoint/container-query driven | User asked directly; ladder recommendation given and accepted | S:85 R:85 A:85 D:85 |
| 6 | Certain | Mobile: no status bar; drawer keeps PANE/HOST panels (drawer-only fork); mobile bar untouched | User asked directly; drawer-as-mobile-home accepted | S:85 R:85 A:90 D:90 |
| 7 | Certain | Status bar is a current-window MIRROR, never a rollup — attention stays on the status-pyramid machinery; clickable segments get palette parity | Flagged as the vocabulary tension in-session; uncontested | S:80 R:80 A:90 D:85 |
| 8 | Certain | Rail card chrome-only (behavior/width/testid unchanged); rail stays surface toggles (no meta cluster); settings gear stays in the top bar | Explicit in-session decisions with rejected alternatives recorded | S:85 R:85 A:90 D:90 |
| 9 | Certain | Compose: status-bar `a` hint = desktop opener; expanded strip gains `a|` close next to attach; chord/palette unchanged | User proposed the close-next-to-attach form; opener placement settled at the status bar | S:80 R:85 A:85 D:80 |
| 10 | Certain | Land AFTER PR #603 merges: rebase/reset onto latest origin/main first; re-verify the surface-layout.tsx edits against the rebased file | Direct user instruction | S:95 R:90 A:95 D:95 |
| 11 | Confident | Stage lands as a nested grid in Shell wrapping `{children}` + the rightpanel aside (areas rebind to direct children); collapse flips the template to `1fr` while the aside stays mounted-hidden | Carried from the prior intake's verification (gap can't scope per-track; auto tracks keep their gap) | S:70 R:80 A:80 D:75 |
| 12 | Confident | StatusBar is a new presentational component fed by existing resolvers/state (registers.ts, host metrics, PR vocabulary) — no new derivation, no new fetches | Constitution X + anti-duplication; exact prop/context seam is the plan's call | S:65 R:80 A:80 D:75 |
| 13 | Confident | The pointer gate reuses the existing coarse-detection seam (`coarse:` variant or `isMobileViewport()`'s pointer half) — no new one-off media query; PR #598's no-gap property preserved at both sites | Established seams exist; exact vehicle is the plan's call | S:60 R:85 A:80 D:70 |
| 14 | Confident | Sidebar PANE/HOST panels are GATED to the drawer render (not deleted) — mobile keeps them byte-identical | Mobile-home decision requires the code to survive; gating beats duplication | S:65 R:85 A:85 D:80 |
| 15 | Confident | The status bar renders on ALL desktop routes (host segments always; window segments only on the terminal route), replacing nothing on board/host/server routes but adding the strip there | "Host-scoped ones persist" was stated in-session for route degradation; uniform frame beats per-route presence flicker | S:55 R:75 A:70 D:65 |
| 16 | Confident | `fixedWidth` (centered 900px) mode: the centered column sits on the stage ground; the app.tsx inset/primary split reconciles against it (no double grounds) | Carried from the prior intake; orthogonal preference | S:45 R:80 A:60 D:55 |

16 assumptions (10 certain, 6 confident, 0 tentative, 0 unresolved).
