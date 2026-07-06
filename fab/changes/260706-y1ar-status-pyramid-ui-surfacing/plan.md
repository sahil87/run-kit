# Plan: Status-Pyramid UI Surfacing

**Change**: 260706-y1ar-status-pyramid-ui-surfacing
**Intake**: `intake.md`

> Design authority: `docs/specs/status-pyramid.md` (untracked in this worktree; merges via PR #316 — do NOT commit/modify it). Where intake and spec diverge, the spec wins. Builds on the merged #314 three-state `agentState` (`active|waiting|idle`) + per-pane fields + branch-derived PR fields (already in-tree).

## Requirements

### Status Dot: Tier Ladder (palette v3)

#### R1: Two-family tier ladder replaces the 3-tier precedence
`statusDotState` SHALL be rewritten as two ladders joined at the top: `fabChange` present → cool family (`prNumber` → purple PR; else `stage===intake` → blue; else green); no `fabChange` → warm family when a fresh `agentState` exists (`prNumber` → orange PR; else yellow, shape by state) → else the gray L0 floor (`activity==="active"` ? solid : ring). First tier whose precondition holds owns core hue + shape. `PHASE_HUE` SHALL be reworked to palette v3 (blue/green/purple cool, yellow/orange warm, gray floor); the amber `execution`/`completion` tokens retire.

- **GIVEN** a window with `fabChange` at stage `apply`, no PR **WHEN** the dot renders **THEN** the core hue is green (not amber) with shape by `fabDisplayState`.
- **GIVEN** a window with `fabChange` at stage `intake` **WHEN** it renders **THEN** the core hue is blue.
- **GIVEN** a window with `fabChange` and a `prNumber` **WHEN** it renders **THEN** the core is purple with `prShape`.
- **GIVEN** a plain window (no `fabChange`) with a fresh `agentState` of `active` **WHEN** it renders **THEN** the core is yellow, solid.
- **GIVEN** a plain window with a fresh `agentState` of `idle` **WHEN** it renders **THEN** the core is yellow, ring.
- **GIVEN** a plain window with a fresh `agentState` and a `prNumber` **WHEN** it renders **THEN** the core is orange with `prShape`.
- **GIVEN** a window with neither `fabChange` nor a fresh `agentState` (even if it has a `prNumber`) **WHEN** it renders **THEN** it stays on the gray floor (`activity` → solid/ring); its PR never owns the dot (D1).

#### R2: Additive constant-yellow waiting halo, ladder-exempt
When the rolled-up `agentState === "waiting"`, the dot SHALL be wrapped in a constant-yellow pulsing halo; the core hue AND shape SHALL be untouched (never a hue-flip). Under `prefers-reduced-motion` the halo SHALL render as a static yellow outer ring (no pulse), per the `rk-*` animation discipline. The halo overlays ANY tier (blue core + halo, green failed + halo, yellow core + halo, etc.).

- **GIVEN** a fab window at intake that is `waiting` **WHEN** it renders **THEN** the core stays blue-solid and a yellow halo is added.
- **GIVEN** a fab window at review whose `fabDisplayState` is `failed` and which is `waiting` **WHEN** it renders **THEN** the core stays the green failed shape and a yellow halo is added.
- **GIVEN** `prefers-reduced-motion: reduce` **WHEN** a waiting dot renders **THEN** the halo is a static yellow ring, not an animation.

#### R3: `dotLabel`/aria composes attention
The accessible label SHALL compose phase + status + attention, e.g. `"review — failed — agent waiting 3m"`. When `agentState` is `waiting`, the label SHALL append the agent-waiting fact (with duration when present).

- **GIVEN** a review-failed window that is waiting 3m **WHEN** the label is composed **THEN** it reads `"review — failed — agent waiting 3m"`.
- **GIVEN** a non-waiting window **WHEN** the label is composed **THEN** no attention suffix is added.

### Status Dot: Warm agent family

#### R4: Ad-hoc agent tier consumes #314 freshness
The warm agent tier SHALL be gated on a *fresh* `agentState` (present + not shell-reconciled — #314 already clears stale/shell values server-side, so `agentState` on the window is authoritative). When `agentState` is absent, the ladder SHALL fall through to the gray L0 floor. A plain window's PR (no fab change, no fresh agent) SHALL NOT render a PR dot.

- **GIVEN** a plain window with no `agentState` and no `fabChange` **WHEN** it renders **THEN** it is the gray floor, even with a `prNumber`.

### Row Minimalism

#### R5: WindowRow trailing status cluster removed
`window-row.tsx` SHALL remove the trailing status cluster entirely: the stage-word span (`win.fabStage && win.fabDisplayState !== "done"`, red-when-failed) and the `WindowDuration`/`TickingDuration` leaves (and their per-second `useNow` tick). The leading `StatusDot` SHALL become the row's only status signal; the freed width goes to the window name. Hover-reveal action icons (pin/color/kill) SHALL be untouched. `getWindowDuration` loses its window-row caller; it SHALL be removed from `format.ts` if it has no other caller (else rescoped) — no dead code.

- **GIVEN** a fab window at stage apply **WHEN** its row renders **THEN** no `apply` stage word and no duration text appear in the row; only the leading dot and the name.
- **GIVEN** the row **WHEN** hovered **THEN** the pin/color/kill icons still reveal and function.

### PANE panel four-register view

#### R6: Four orthogonal register lines
`status-panel.tsx` `WindowContent` SHALL render the pyramid register view — one line per layer, orthogonal, never collapsed, so the dot is mentally derivable: `output` (L0 activity + elapsed), `agent` (L1 `agentState` + epoch duration), `fab` (L2 `fabChange · fabStage · fabDisplayState`), `PR` (L3 `prNumber`/State/Checks/Review/IsDraft). Absent layers render as absent (a plain shell pane shows only `output`). The L3 register SHALL show the PR for ANY pane with a `prNumber` (derivation universal, Principle X) — dropping the current `fabChange &&` gate on the PR row. Existing `PrLinkRow` behavior (anchor open, click-to-copy) folds into the L3 register. The L0 `output` register SHALL always show its own elapsed value (the pierce rule — waiting duration is never muted by flowing output; the register view is never contested for space).

- **GIVEN** a plain shell pane (no agent, no change, no PR) **WHEN** the panel renders **THEN** only the `output` register shows.
- **GIVEN** a window with a waiting agent whose output is flowing **WHEN** the panel renders **THEN** the `agent waiting Xm` register shows and the `output active` register shows independently.
- **GIVEN** a window with a `prNumber` but no `fabChange` **WHEN** the panel renders **THEN** the `PR` register still shows (universal derivation).

### StatusDotTip agent line

#### R7: Tip gains an agent line on every tier
`status-dot-tip.tsx` SHALL add an agent line to the hover card on every tier (`agent: waiting 3m` / `active` / `idle 12m`); omitted when no `agentState`. The tip SHALL keep the exact stage label. Post-Row-Minimalism the tip is the recovery path for the removed stage word + durations.

- **GIVEN** a window with `agentState` waiting 3m **WHEN** the tip opens **THEN** it shows an `agent: waiting 3m` line in addition to the phase/status label.
- **GIVEN** a window with no agent **WHEN** the tip opens **THEN** no agent line appears.

### Attention rollups

#### R8: Session row waiting badge
The sidebar session row SHALL render a count badge (styled per the existing chip vocabulary) when its windows' rolled-up-`waiting` count is > 0; absent when 0.

- **GIVEN** a session with 2 waiting windows **WHEN** the row renders **THEN** a `2`-style waiting badge shows.
- **GIVEN** a session with 0 waiting windows **WHEN** the row renders **THEN** no badge shows.

#### R9: Cockpit server-tile waiting badge
The Cockpit TMUX SERVERS zone per-server tile SHALL render a waiting-count badge (sum over the server's sessions' windows) when > 0.

- **GIVEN** a server with 3 waiting windows across its sessions **WHEN** the Cockpit tile renders **THEN** a `3`-style badge shows.

#### R10: Board header count + waiting-pane seam
The board header SHALL render a count of waiting panes; a waiting board pane SHALL get a pulsing seam (3px, border-width system) in the attention hue, reduced-motion static.

- **GIVEN** a board with 1 waiting pane **WHEN** the header renders **THEN** a `1` waiting count shows and that pane has a pulsing yellow seam.
- **GIVEN** `prefers-reduced-motion` **WHEN** a waiting board pane renders **THEN** the seam is static.

### Palette nav

#### R11: `Agent: Next waiting` command
The command palette SHALL register an `Agent: Next waiting` action that navigates focus to the next window whose rolled-up `agentState` is `waiting`, cycling current server first then other servers. With none waiting it SHALL be a no-op with a "no agents waiting" hint/toast. It SHALL be keyboard-reachable (Constitution V).

- **GIVEN** windows waiting on the current and another server **WHEN** the action is invoked repeatedly **THEN** it cycles current-server waiting windows first, then the others.
- **GIVEN** no waiting windows **WHEN** the action is invoked **THEN** nothing navigates and a "no agents waiting" hint shows.

### Web Push on sustained waiting

#### R12: One push per sustained-waiting episode
The backend SHALL, at the SSE per-tick assembly seam, send exactly ONE Web Push per waiting episode when a window's rolled-up `agentState` has been `waiting` sustained ≥ 15s, via the existing `internal/push` subsystem. Dedupe SHALL key on the episode identity (window + waiting epoch); a new epoch is a new episode; the arm SHALL reset when the state leaves `waiting`. `idle`/`active` SHALL never push. State SHALL be in-memory only (Constitution II — durable state; in-memory episode tracking mirrors existing collectors). Body: window name + `waiting for input`.

- **GIVEN** a window enters `waiting` and stays waiting ≥ 15s **WHEN** the SSE assembles a tick past the threshold **THEN** exactly one push fires for that episode.
- **GIVEN** the same episode continues past the push **WHEN** subsequent ticks assemble **THEN** no further push fires.
- **GIVEN** the window leaves `waiting` and later re-enters (new epoch) **WHEN** it sustains ≥ 15s again **THEN** a new push fires.
- **GIVEN** a window that flaps to `waiting` for < 15s **WHEN** ticks assemble **THEN** no push fires.

### D2: merged/closed PR retention

#### R13: Verify-then-implement PR-retention leaning
The change SHALL first verify #314's branch→PR derivation semantics and record the finding, then implement the spec's D2 leaning where not already satisfied: a merged PR stays visible for a grace window (retain last-known derived PR); a closed-unmerged PR on a window whose fab change is still live SHALL fall back to the fab (green working) tier so the dot shows live stage, not a dead PR. This is the only task that may adjust backend behavior; everything else is frontend.

- **GIVEN** a branch whose PR just merged **WHEN** the dot renders within the grace window **THEN** the purple/orange done-square is still shown (not lost to the open-only branch lookup).
- **GIVEN** a closed-unmerged PR on a window with a live `fabChange` **WHEN** the dot renders **THEN** it shows the live fab (green) tier, not a dead PR skipped-ring.

### Docs

#### R14: Docs-site page + state-matrix SVG rebuilt for palette v3
`docs/site/status-dot.md` SHALL be rewritten: the Precedence section from 3-tier `PR > fab > tmux` to the two-family 4-tier ladder + additive waiting overlay (incl. D1's gate change), and document Row Minimalism (the dot is the row's only signal; stage/duration live in the tip + PANE-panel register view). `docs/img/status-dot-matrix.svg` SHALL be rebuilt for palette v3: the two families (cool fab: blue/green/purple; warm ad-hoc: yellow/orange) + gray floor, and the waiting overlay (constant-yellow halo, shown as an overlay applicable to every tier, not a new tier row). Note the deliberate break from fab-kit's 4-phase grouping (green collapse).

- **GIVEN** the docs page **WHEN** read **THEN** its Precedence section describes the two-family ladder and the additive halo, and mentions Row Minimalism.
- **GIVEN** the matrix SVG **WHEN** rendered **THEN** it shows the two families + gray floor + a waiting-overlay row/callout.

### Non-Goals

- The `stuck` overlay (slow pulse on idle-too-long) and `@rk_agent_msg` question text are OUT — future tenants of the animation channel only.
- No top attention banner, no second per-row indicator, no new pages/routes (Constitution IV; spec deliberate non-goals).

### Design Decisions

1. **Additive halo, not hue-flip**: waiting = constant-yellow pulsing halo, core hue+shape kept — *Why*: family identity must survive attention; *Rejected*: hue-flip (destroys family identity), self-colored halo (reduced-motion form vanishes), fuchsia (motivating amber collision gone).
2. **D1 per-family PR ownership**: purple requires `fabChange && prNumber`, orange requires fresh-agent `&& prNumber`; a plain pane's PR never owns the dot — *Why*: derivation stays universal in register/tip/PR-line but a plain shell never shows a mystifying PR dot.
3. **Push at the SSE assembly seam**: the per-tick per-server loop already has rolled-up window `AgentState` — *Why*: no new poller/goroutine; in-memory episode map mirrors the prstatus/metrics collectors; poll-derived, no durable store.

## Tasks

### Phase 1: Types + ladder core (frontend foundation)

- [x] T001 Rework `PHASE_HUE`, `DotPhase`, `fabPhase`, and `statusDotState` in `app/frontend/src/components/pr-status-line.tsx` to the palette-v3 two-family ladder: cool fab (blue intake / green apply→review-pr collapsed / purple PR), warm ad-hoc agent (yellow working / orange PR), gray floor; add a `waiting` attention flag to `StatusDotState`. <!-- R1 R2 R4 -->
- [x] T002 <!-- rework: aria for idle ad-hoc agent reads "agent — pending" (SHAPE_LABEL ring→pending); use agent-native "idle" per module doc + docs/site --> Add `agentWaiting`/attention composition to `dotLabel` in `app/frontend/src/components/status-dot-label.ts` (compose `"— agent waiting Xm"` suffix; keep exact stage label). <!-- R3 -->

### Phase 2: Dot rendering + tip + panel

- [x] T003 Render the additive constant-yellow halo in `app/frontend/src/components/status-dot.tsx` when `state.waiting` — a wrapper ring/box-shadow that keeps the core hue+shape; pulsing via a new `rk-*` utility, static under reduced-motion. <!-- R2 -->
- [x] T004 <!-- rework: .rk-waiting-halo sets unlayered border-radius:9999px which beats layered rounded-none — waiting done-square renders as circle; delete the border-radius (box-shadow follows element radius) --> Add the pulse/halo keyframe + `rk-*` utility class (and the board-pane seam pulse) to `app/frontend/src/globals.css`, zeroed under the existing `prefers-reduced-motion` block. <!-- R2 R10 -->
- [x] T005 <!-- rework: tip Open-PR link gated on pr/agentPr phases — floor pane with prUrl shows no PR; offer the link whenever win.prUrl exists (spec row 10 / D1 universal derivation) --> Add the agent line to the hover card in `app/frontend/src/components/status-dot-tip.tsx` (`dotTipContent` composes `agent: {state} {duration}`; omitted when no `agentState`). <!-- R7 -->
- [x] T006 Rebuild `WindowContent` in `app/frontend/src/components/sidebar/status-panel.tsx` as the four-register view (output/agent/fab/PR), absent layers absent, L3 PR register ungated from `fabChange` (universal derivation), folding `PrLinkRow` into the PR register; L0 output always shows elapsed. <!-- R6 -->

### Phase 3: Row minimalism + rollups + palette

- [x] T007 Remove the trailing status cluster (stage word + `WindowDuration`/`TickingDuration`) from `app/frontend/src/components/sidebar/window-row.tsx`; keep the leading `StatusDot` and hover icons. <!-- R5 -->
- [x] T008 Remove/rescope `getWindowDuration` in `app/frontend/src/lib/format.ts` (no dead code) once its window-row caller is gone; keep `formatDuration`/`parseFabChange`. <!-- R5 -->
- [x] T009 Add a waiting-count badge to `app/frontend/src/components/sidebar/session-row.tsx` (count of windows whose rolled-up `agentState === "waiting"`; chip vocabulary; hidden when 0). <!-- R8 -->
- [x] T010 Add a per-server waiting-count badge to the Cockpit TMUX SERVERS server tile (sum over the server's sessions' windows). <!-- R9 -->
- [x] T011 Add the board header waiting-pane count and the per-pane pulsing seam (3px border-width, attention hue, reduced-motion static) in `app/frontend/src/components/board/board-header.tsx` + `board-pane.tsx`. <!-- R10 -->
- [x] T012 Register the `Agent: Next waiting` palette action in `app/frontend/src/components/command-palette.tsx` — cycles waiting windows (current server first, then others), no-op + "no agents waiting" hint when none; keyboard-reachable. <!-- R11 -->

### Phase 4: Backend — D2 + push

- [x] T013 D2 verification + implementation in `app/backend/internal/prstatus/prstatus_branch.go` (+ sessions/ladder gate as needed): record whether the branch lookup drops merged/closed PRs (it does — `--state open` only), then retain last-known derived PR for a grace window so the merged done-square survives, and ensure a closed-unmerged PR on a live-change window falls back to the fab tier (the ladder's `prNumber` gate is only reached when a PR is derived). <!-- R13 -->
- [x] T014 <!-- rework: notifyWaiting runs synchronous webpush (10s timeout, serialized) inside the SSE poll loop, breaking the zero-network hot-path guarantee — decide() stays sync, fan notify out in a goroutine; ALSO: transient fetch-error servers get their episodes reaped (sustain reset / duplicate push) — only sweep keys of successfully-polled servers --> Add the push-on-sustained-waiting episode watcher at the SSE assembly seam in `app/backend/api/sse.go` (after `attachPRStatus`), with an in-memory per-window episode tracker (window+epoch keyed, ≥15s sustain, one push per episode, re-arm on state change), calling `internal/push.Notify`. Extract the pure episode-decision logic into a testable helper. <!-- R12 -->

### Phase 5: Tests + docs

- [x] T015 <!-- rework: add reduced-motion assertion for halo/seam static forms (A-019) --> [P] Rewrite/extend unit tests for the new ladder + halo + label: `pr-status-line.test.tsx`, `status-dot.test.tsx` (enumerate the decision-table rows), and add halo + reduced-motion assertions. <!-- R1 R2 R3 R4 -->
- [x] T016 [P] Update `status-panel.test.tsx` for the four-register view, `window-row.test.tsx` for cluster removal, `status-dot-tip` agent-line coverage, and `format.test.ts` (if present) for the `getWindowDuration` removal. <!-- R5 R6 R7 -->
- [x] T017 [P] Add unit tests for rollup counting (session/server/board waiting counts) and the palette next-waiting cycle helper. <!-- R8 R9 R10 R11 -->
- [x] T018 [P] Add backend unit tests: the push episode-decision helper (`app/backend/api/sse_test.go`) and the D2 retention/grace-window behavior (`app/backend/internal/prstatus/prstatus_branch_test.go`). <!-- R12 R13 -->
- [x] T019 <!-- rework: select mocks **/api/windows/*/select never match (?server= appended) and fall through to live backend — add trailing * in all three specs --> Add e2e specs (each with a sibling `.spec.md`, Constitution — Test Companion Docs): row minimalism (no stage word/duration in rows), PANE register panel, and the `Agent: Next waiting` palette action, under `app/frontend/tests/`. <!-- R5 R6 R11 -->
- [x] T020 [P] Rewrite `docs/site/status-dot.md` (two-family ladder + additive halo + Row Minimalism + D1 gate). <!-- R14 -->
- [x] T021 [P] Rebuild `docs/img/status-dot-matrix.svg` for palette v3 (two families + gray floor + waiting overlay callout; note the green collapse). <!-- R14 -->

## Execution Order

- T001 → T002 → (T003, T005, T006) — the label/tip/panel consume the reworked `StatusDotState`. T004 (CSS) blocks T003's pulse but can be authored alongside.
- T007 depends on T001 (dot is the sole signal). T008 follows T007 (caller removed first).
- T013 (D2 backend) is independent of the frontend; T014 (push) is independent of D2. Both are independent of Phase 1–3.
- Phase 5 tests follow their implementation tasks; docs (T020, T021) are independent and parallel.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `statusDotState` implements the two-family ladder; fab non-PR windows read blue (intake) / green (else), plain fresh-agent windows read yellow, PR windows read purple (fab) / orange (agent); `PHASE_HUE` has no amber tokens.
- [x] A-002 R2: a `waiting` window of any tier renders the additive yellow halo with the core hue+shape unchanged; reduced-motion yields a static yellow ring. The `done`-square case is now correct — `.rk-waiting-halo` no longer sets `border-radius`, so the box-shadow follows the element's own `rounded-none`, keeping the waiting done-square's corners sharp.
- [x] A-003 R3: `dotLabel` composes `"{stage} — {status} — agent waiting Xm"` when waiting; no suffix otherwise.
- [x] A-004 R4: a plain window (no fab change, no fresh agent) stays on the gray floor even with a `prNumber`.
- [x] A-005 R5: the window row renders no stage word and no duration text; only the leading dot + name + hover icons.
- [x] A-006 R6: the PANE panel shows four orthogonal registers (output/agent/fab/PR), absent layers absent; the PR register shows for any pane with a `prNumber`.
- [x] A-007 R7: the StatusDotTip shows an agent line on every tier when `agentState` is present, omitted otherwise.
- [x] A-008 R8: the session row shows a waiting-count badge when > 0, hidden at 0.
- [x] A-009 R9: the Cockpit server tile shows a per-server waiting-count badge (session-sum) when > 0.
- [x] A-010 R10: the board header shows a waiting-pane count and a waiting pane has a pulsing (reduced-motion static) seam.
- [x] A-011 R11: the `Agent: Next waiting` palette action cycles waiting windows current-server-first, no-ops with a hint when none, and is keyboard-reachable.
- [x] A-012 R12: sustained-waiting (≥15s) fires exactly one push per episode via `internal/push`, re-arms on a new epoch, never pushes for idle/active, in-memory only.
- [x] A-013 R13: the D2 finding is recorded; a merged PR's done-square survives a grace window and a closed-unmerged PR on a live change falls back to the fab tier.
- [x] A-014 R14: `docs/site/status-dot.md` and `docs/img/status-dot-matrix.svg` reflect palette v3 (two families + gray floor + additive halo + Row Minimalism + green collapse).

### Behavioral Correctness

- [x] A-015 R1: the retired amber `execution`/`completion` phases no longer appear anywhere (no `text-amber-400` for the dot); apply/review/review-pr collapse to a single green.
- [x] A-016 R5: `getWindowDuration` has no remaining caller and is removed (no dead code); `formatDuration`/`parseFabChange` remain.
- [x] A-017 R6: the L0 output register always shows its elapsed value (the waiting-pierce rule holds — flowing output never mutes the register view).

### Scenario Coverage

- [x] A-018 R1: unit tests enumerate the decision-table rows (floor/ad-hoc/fab families × shapes).
- [x] A-019 R2: a halo test covers blue-core-waiting and green-failed-waiting (core unchanged), plus reduced-motion. The reduced-motion static-ring form is now asserted via an e2e (`agent-next-waiting.spec.ts` — `emulateMedia({reducedMotion:'reduce'})` then computed-style checks: `animation-name === "none"` and a non-empty `box-shadow`), the only layer where real-browser CSS + `globals.css` media queries evaluate (jsdom does not).
- [x] A-020 R11: an e2e (with `.spec.md`) exercises `Agent: Next waiting`.
- [x] A-021 R5,R6: e2e specs (with `.spec.md`) exercise row minimalism and the register panel.
- [x] A-022 R12: a backend test drives the episode helper across enter/sustain/push/continue/leave/re-enter.

### Edge Cases & Error Handling

- [x] A-023 R12: a waiting episode shorter than 15s produces no push; a state change re-arms the episode.
- [x] A-024 R13: a transient gh error during grace-window retention keeps the last-good derived PR (does not drop the done-square early).
- [x] A-025 R4: absent `agentState` falls through to the floor; a shell-reconciled pane (cleared server-side) shows no agent tier.

### Code Quality

- [x] A-026 Pattern consistency: new code follows the surrounding component/Go patterns (shared color tokens, `rk-*` animation discipline, `exec.CommandContext` with timeouts, no shell strings, type narrowing over `as`).
- [x] A-027 No unnecessary duplication: rollup-count logic and the next-waiting cycle reuse a shared helper rather than being reimplemented per surface; PR color tokens stay in the single source of truth.
- [x] A-028 No polling from the client: rollup counts derive from the existing SSE session data, not new fetch/`setInterval`.
- [x] A-029 Test companion docs: every new/modified `*.spec.ts` ships a sibling `*.spec.md` in the same commit-unit (Constitution — Test Companion Docs).
- [x] A-030 Keyboard-first: the new palette action is registered and reachable via the command palette (Constitution V), documented in its registration.
- [x] A-031 No new routes/pages: rollups and the palette action add no route (Constitution IV).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/frontend/src/components/pr-status-line.tsx` `PrStatusLine` — zero live render sites (dead since the Dashboard deletion, 260701-70a0; only comments and an absence-assertion testid reference it); this change folds the last full-line PR surface into the PANE panel's L3 register, so the component is now purely historical.
- `app/frontend/src/components/pr-status-line.tsx` `prShape` closed→`skipped` branch — unreachable from `statusDotState` now that `prOwnsDot` excludes `prState === "closed"` (a closed PR never owns the dot); only direct-call tests exercise it. The PR-row "skipped" cells in `docs/site/status-dot.md`'s matrix document a dot state that can no longer render.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Palette v3 two-family ladder + additive yellow halo, core hue/shape untouched, reduced-motion static ring | Spec § The Tier Ladder / § The Channel Model + intake assumptions 3,4 mark this decided | S:90 R:75 A:90 D:90 |
| 2 | Certain | Amber `execution`/`completion` tokens retire; apply/review/review-pr collapse to one green | Spec § The Channel Model "green collapse"; decision-table rows 14–20 | S:88 R:80 A:90 D:88 |
| 3 | Confident | Halo rendered as an outer box-shadow/ring wrapper keeping the inner dot markup intact (additive), pulsing via a new `rk-*` keyframe zeroed under reduced-motion | Spec pins additive+reduced-motion semantics; exact CSS mechanism is a decides-and-records detail matching the existing `rk-*` discipline | S:70 R:85 A:80 D:70 |
| 4 | Confident | Yellow token = `text-yellow-400` / a `--` yellow for the halo, matching the existing `PR_CHECKS_COLORS.pending` yellow usage | Spec pins "constant yellow"; token choice reuses the established yellow-400 already in the palette | S:70 R:88 A:82 D:75 |
| 5 | Confident | L3 PR register in the PANE panel is ungated from `fabChange` (shows for any pane with a `prNumber`) | Spec § Signal Inventory L3 + § Row Minimalism register view + Principle X (derivation universal); intake §3 | S:70 R:75 A:82 D:72 |
| 6 | Confident | Push episode identity = window id + waiting epoch; ≥15s sustain measured from first-seen-waiting tick; in-memory map on the hub, re-armed when state leaves waiting | Spec § Attention Propagation (Web Push row) + intake assumption 6; mirrors existing in-memory collectors | S:70 R:80 A:78 D:70 |
| 7 | Confident | D2: branch lookup (`--state open`) DROPS merged/closed PRs → the done-square is currently lost; fix = retain last-known derived PR for a grace window in the BranchRefresher (a closed-unmerged PR simply yields no derivation → ladder already falls back to the fab tier) | Verified by reading prstatus_branch.go (`--state open`) + attachPRStatus gate; spec D2 target | S:75 R:70 A:82 D:70 |
| 8 | Confident | `Agent: Next waiting` navigates by the existing window-selection/navigation mechanism the palette already uses; cycle state (which waiting window is "current") tracked locally in the action | Spec names the action + Constitution V; exact focus semantics follow existing palette nav patterns | S:62 R:85 A:75 D:70 |
| 9 | Confident | Rollup counts derive from the existing SSE session data already in the frontend (no new endpoint/poll); a shared `countWaiting(windows)` helper serves all surfaces | Constitution II/anti-patterns (no client polling), code-quality (no duplication); session data already carries `agentState` | S:75 R:85 A:85 D:80 |
| 10 | Confident | `stuck` overlay and `@rk_agent_msg` question text are OUT of scope (future tenants) | Spec § Future Tenants + intake assumption 9; task prompt scope guard | S:85 R:90 A:88 D:85 |

10 assumptions (2 certain, 8 confident, 0 tentative).
