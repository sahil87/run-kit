# Intake: Sidebar Current-Session Manual-Collapse Latch

**Change**: 260823-atrb-sidebar-current-session-collapse-latch
**Created**: 2026-08-23

## Origin

Promptless dispatch (`/fab-proceed` create-new), synthesized from a live conversation following a user report on 2026-08-23. The report amends the just-shipped change `260822-o0cz-sidebar-current-session-derived-expand` (merged PR #707).

> With the always-expanded rule from o0cz, the user can no longer minimize/collapse a session while being in a window inside it — the chevron (and keyboard ArrowLeft collapse, which routes through the same `toggleSession` seam) writes the exception to the `runkit-session-collapsed` map but is a visual no-op while the session is current. This breaks their navigation workflow. "Always expanded" is too strong.

The design below — **expand-on-entry with a manual-collapse latch** — was agreed in that conversation, including the latch's key (session, not window), its clear condition (current SESSION key change), and the implementation shape (refs in `Sidebar`, `currentSessionName={null}` pass-down, o0cz read sites untouched). No questions were asked (promptless dispatch); every decision is recorded in `## Assumptions`.

## Why

1. **Pain point**: The shipped o0cz rule is a pure derived predicate — a session renders collapsed only when it has a collapsed exception AND it is not the current route's session. That makes the collapse control **inert on the current session**: the chevron click and keyboard ArrowLeft both commit the exception to the `runkit-session-collapsed` map, but the group visibly stays expanded while current. The user cannot fold the session they are working in, which is precisely where a large session's window list crowds the tree they are trying to navigate.

2. **Consequence of not fixing**: A core sidebar affordance (the chevron, plus its keyboard-first ArrowLeft twin — Constitution V) silently does nothing on the one session the user is most likely to interact with. The write-but-no-fold behavior also *looks* like a bug (the control appears broken), and the invisible exception then surprises the user later when they navigate away and the session snaps shut.

3. **Why this approach**: Convert the pure predicate into **event-driven transition semantics** (the `lib/present-auto-expand.ts` precedent): navigation INTO a session still reveals it (keeping o0cz's disorientation fix for keyboard tab/session cycling), but a manual fold of the current session sets a **latch** that suppresses the derived override until the current session changes. This preserves both properties the two prior rules each sacrificed:
   - Pre-o0cz no-auto-expand: protected the manual fold but blinded keyboard navigation landing in a collapsed session (no painted row, no highlight, no autoscroll).
   - Shipped o0cz always-expanded: fixed the disorientation but made the fold control a no-op on the current session (this report).

   The latch is deliberately NOT persisted state — it is a render-time ref reconcile in `Sidebar`, following the codebase's derive-over-store convention (the sidebar session-order `orderOverrideRef` pattern; no watcher effect).

## What Changes

### 1. Behavior — expand-on-entry with a manual-collapse latch

The five agreed rules, verbatim:

1. **Navigating INTO a session still reveals it** (the shipped o0cz behavior is kept): landing in a collapsed session via ⌘↑/⌘↓ tab cycling, session jump, click, or deep link paints its rows, and the armed deferred scroll (`pendingScrollKeyRef` / `rowsVersion` retry) completes.
2. **Collapsing the CURRENT session now actually folds it** (chevron click or keyboard ArrowLeft — both route through `toggleSession` in `Sidebar`): `toggleSession` sets a latch when the toggled key equals the current session key AND the toggle direction is collapse (i.e. it is writing the exception); the latch suppresses the derived override so the group folds immediately.
3. **The latch clears when the current SESSION key changes** (`${currentServer}:${currentSession}`) — implemented as a render-time ref reconcile in `Sidebar` (compare against a last-current-key ref; do NOT introduce a watcher effect). Leaving the session and re-entering it reveals it again (rule 1 applies afresh). **Deliberate consequence**: cycling windows WITHIN your deliberately-folded current session keeps it folded — the user chose to minimize it; the latch keys on the session, not the window.
4. **Expanding the current session** (second chevron click / ArrowRight) clears both the exception (existing raw-map toggle semantics — deletes the entry) and the latch, so the state stays coherent.
5. **Implementation shape**: the latch lives in `Sidebar` — a ref holding the latched session key or null, plus the last-current-key ref. No state bump is needed for fold-visibility because `toggleSession` already commits `setCollapsed` (a re-render), and navigation re-renders via props. When the latch is active for the current session, `Sidebar` passes `currentSessionName={null}` down to `ServerGroup` for that server — the two o0cz read sites in `ServerGroupInner` are **NOT touched at all**.

### 2. Code — `app/frontend/src/components/sidebar/index.tsx`

- **Latch refs + render-time reconcile in `Sidebar`**: a `latchedSessionKeyRef` (string or null) plus a last-current-key ref compared during render against `${currentServer}:${currentSession}`; when the current session key changes, clear the latch in the same render-time reconcile (the `orderOverrideRef` SSE-echo-clear idiom at `index.tsx:1720-1725` is the in-file precedent — mutating a ref during render is safe, and the render output is already correct without a nudge).
- **Latch set/clear inside `toggleSession`** (`index.tsx:893-912`): when the computed toggle is a **collapse** (`next[key] = true`) and `key === latchable current session key`, set the latch; when the toggle is an **expand** (`delete next[key]`) of the latched key, clear the latch. The existing raw-map + StrictMode-safe semantics are kept exactly: the localStorage write and ref mirror (`collapsedRef`) stay outside the state updater; the latch set/clear rides alongside, also outside the updater.
- **Latched `currentSessionName` pass-down** (`index.tsx:1741`): the existing per-server pass `currentSessionName={srvInfo.name === currentServer ? currentSession : null}` gains the latch term — when the latch is active for the current session, pass `null` for that server, so the derived override in `ServerGroupInner` never fires.
- **The `ServerGroupInner` read sites and memo deps are unchanged**: both `(collapsed[key] ?? false) && session.name !== currentSessionName` sites — the `rowSlice`/`rowSignature` useMemo feeding roving/visible rows (`index.tsx:2402`, deps at `:2425`) and the render body driving `SessionRow`'s `isCollapsed` (`index.tsx:2873-2874`) — stay byte-identical.

### 3. Tests — `app/frontend/src/components/sidebar/index.test.tsx`

- **Rewrite**: the o0cz scroll-block test "current session ignores its collapsed exception: the chevron writes the map but rows stay painted" (`index.test.tsx:2600`) asserts the now-removed always-expanded behavior; rewrite it to the latch semantics — chevron on the current session folds immediately AND the exception is written to `runkit-session-collapsed`.
- **Add coverage**:
  - Fold-while-current, then navigate away and back → the session re-reveals (latch cleared on session-key change; rule 1 applies afresh).
  - Fold-while-current, then switch windows WITHIN the session → stays folded (latch keys on session, not window).
  - Expand-click on the folded current session → clears both the exception (map entry deleted / storage key removed when emptied) and the latch.
  - Keyboard ArrowLeft on the current session folds it (it rides `toggleSession` — the tree keydown path at `index.tsx:1410`/`1435`).
- **Check**: whether any keyboard-nav block tests need their fixture back — they were re-anchored to `currentSession: null` in o0cz (e.g. the operator-row test at `index.test.tsx:2818-2825` uses `currentSession: null` to defeat the derived expand) and should be unaffected; verify rather than assume. The other o0cz tests ("the exception re-applies on navigate-away", "navigating into a collapsed session reveals it...") assert behavior this change keeps and should pass unmodified.

### 4. Memory — `docs/memory/run-kit/ui/sidebar.md`

Amend to the new rule — "**expands on entry; a manual fold while current wins until the current session changes**":

- The Design Decision "**Current-session expand is derived at render time, never persisted**" (the o0cz entry) — rewrite Decision/Why/Rejected to the latch semantics (the record of this change's rejected alternatives below belongs there).
- § Session collapse persistence — the read-site sentence describing the unconditional derived override.
- § Desktop selection-keyed autoscroll — the "Current session always reveals; only non-current folds defer" bullet.
- § Session rows — the chevron note ("on the CURRENT session the toggle still writes/deletes the exception but the group stays visually expanded while current").

### Rejected alternatives

- **Keeping the pure derived predicate (shipped o0cz rule)** — makes the collapse control a visual no-op on the current session; the user cannot minimize the session they are working in (the reported problem).
- **Reverting to the pre-o0cz no-auto-expand rule** — reintroduces the disorientation bug: keyboard navigation landing in a collapsed session with no painted row, highlight, or autoscroll.
- **Clearing the latch on any window change (not just session change)** — would pop the session back open while the user cycles within it right after deliberately folding it.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) Amend the "Current-session expand is derived at render time, never persisted" Design Decision plus the related prose (§ Session collapse persistence read-site sentence, § Desktop selection-keyed autoscroll bullet, § Session rows chevron note) to the new rule: expands on entry; a manual fold while current wins until the current session changes.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — latch refs + render-time reconcile in `Sidebar`; latch set/clear inside `toggleSession`; latched `currentSessionName` pass-down at the `ServerGroup` render site. `ServerGroupInner` untouched.
- `app/frontend/src/components/sidebar/index.test.tsx` — one test rewritten, four behaviors added, one fixture-anchoring check.
- `docs/memory/run-kit/ui/sidebar.md` — Design Decision + three prose sections amended (hydrate).
- Frontend-only; no backend, API, or e2e spec surface. The render-performance invariants (memo tree, R6a) are untouched by construction: no new props thread through `ServerGroup`/`SessionRow`/`WindowRow`, and the latch is refs + the existing `currentSessionName` prop value.

## Open Questions

- None — the design was fully agreed in conversation; no genuine unknowns remained (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Latch keys on the SESSION (`${currentServer}:${currentSession}`), not the window: window cycling within a deliberately-folded current session keeps it folded | Discussed — explicitly agreed as a deliberate consequence; the window-change alternative was explicitly rejected | S:95 R:80 A:90 D:95 |
| 2 | Certain | Latch lives in `Sidebar` as refs (latched-key + last-current-key) with a render-time reconcile — no watcher effect, no new state | Discussed — agreed implementation shape; matches the codebase's derive-over-store convention (`orderOverrideRef` precedent) and the memory file's explicit do-not-reintroduce-watcher-effect warning | S:90 R:75 A:90 D:90 |
| 3 | Certain | Suppression is implemented by passing `currentSessionName={null}` down for the latched server; the two o0cz read sites in `ServerGroupInner` are not touched | Discussed — agreed verbatim; keeps memo deps and R6a invariants untouched by construction | S:90 R:75 A:88 D:90 |
| 4 | Certain | Latch set/clear rides alongside the existing raw-map write in `toggleSession`, outside the state updater (StrictMode-safe); expand clears both exception and latch | Discussed — agreed; preserves the documented StrictMode purity constraint at the write path | S:90 R:80 A:90 D:90 |
| 5 | Certain | Rule 1 (o0cz expand-on-entry with completed deferred scroll) is kept unchanged for every entry vector (⌘↑/⌘↓ cycling, session jump, click, deep link) | Discussed — the design brief's first rule; the existing o0cz tests asserting it must keep passing | S:92 R:78 A:90 D:92 |
| 6 | Confident | `change_type` = fix — this repairs a workflow regression user feedback exposed in a just-shipped UX rule (the collapse control became inert on the current session) | Restores broken user-facing behavior rather than adding a capability; taxonomy keyword and intent both land on fix | S:70 R:90 A:80 D:75 |
| 7 | Confident | The latch is not persisted: a page reload/remount clears it, so a reload while sitting in a deliberately-folded current session re-reveals it (reload counts as re-entry under rule 1) | Implied by the agreed ref-based shape (refs never persist) and derive-over-store; not explicitly discussed as a scenario, but the only reading consistent with the design | S:65 R:82 A:78 D:72 |
| 8 | Confident | Test coverage stays at the jsdom unit level in `index.test.tsx` (rewrite + 4 additions); no new Playwright spec | Pure render/state logic with no layout dependency — the o0cz precedent tested the same seam in jsdom; code-quality's e2e SHOULD is satisfied-where-possible by the existing suite shape | S:62 R:85 A:80 D:70 |
| 9 | Confident | Memory update amends the existing o0cz Design Decision entry in place (plus the three prose sites) rather than adding a second DD entry | The brief says "amend"; FKF present-truth style records the current rule, not a transition ledger | S:70 R:85 A:82 D:78 |
| 10 | Confident | Cross-tab/SSE coherence needs no special handling: the latch only suppresses the derived override — if the exception is absent, `collapsed[key] ?? false` is already false and the session renders expanded regardless of the latch | Follows from the read-site expression; the latch gates the override term only, never forces a fold on its own | S:68 R:80 A:82 D:75 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
