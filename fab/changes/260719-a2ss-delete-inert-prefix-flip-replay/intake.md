# Intake: Delete Inert WindowHeading Prefix-Flip Replay Machinery

**Change**: 260719-a2ss-delete-inert-prefix-flip-replay
**Created**: 2026-07-20

## Origin

Backlog item `[a2ss]` (fab/backlog.md:30), worked by a backlog-cleanup agent in one-shot mode:

> [a2ss] 2026-07-19: Delete the inert WindowHeading prefix-flip replay machinery (prevPrefixRef + prefix-keyed effect, top-bar.tsx ~:1053/:1108) — inert since the sole call site passes the constant WINDOW_PREFIX. (relocated from docs/memory/run-kit/ui-patterns.md by /docs-distill-memory)

Validity was verified in-session before intake creation (line numbers have drifted since the note was written — current locations below):

- `prevPrefixRef` is declared at `top-bar.tsx:1400` (with its explanatory comment at :1394-1399), and the prefix-keyed effect lives at `top-bar.tsx:1451-1461`.
- The **sole** JSX call site is `top-bar.tsx:871-876`, which passes `prefix={WINDOW_PREFIX}` — a module constant `const WINDOW_PREFIX = "Window:"` (`top-bar.tsx:1233`). A repo-wide search (grep plus a NUL-safe perl sweep covering the NUL-joined `session-tiles.tsx`) found no other `<WindowHeading` usage — remaining hits are comments and a test `describe` label.
- The lens-following prefix (`Terminal:`/`Web:`/`Chat:`) was retired by change `260714-uco1` — the test suite documents this (`top-bar.test.tsx:182-183`: "the lens-following `Terminal:`/`Web:`/`Chat:` prefix was retired") and asserts a static `Window:` prefix in every lens. No test passes a `prefix=` prop directly or exercises a prefix flip.

Since the `prefix` prop is a compile-time constant, `prefix !== prevPrefixRef.current` can never be true after mount — the effect body is unreachable. The claim holds exactly as written.

## Why

1. **Problem**: `WindowHeading` carries a ref (`prevPrefixRef`) and a `useEffect` whose entire purpose is to replay the boot sweep when the page-type prefix flips on a lens switch (`Terminal:` ↔ `Web:`). Change `260714-uco1` made the prefix a static constant (`Window:` in every lens), so the effect's condition can never fire — it is dead machinery kept alive only syntactically.
2. **Consequence of not fixing**: the component's comments actively mislead — the `prefix` prop's docstring still says it "follows the active lens (spec R4)" and that "a prefix change (a tty↔web view switch) replays the sweep", describing retired behavior. Future readers reason about a replay path that cannot execute, and the ref/effect add noise to an already-subtle animation choreography (mount/name/identity effects with carefully documented double-play guards).
3. **Why this approach**: delete the ref and the effect; correct the stale docstring. Keep the `prefix` prop itself — it is genuinely used for rendering (the boot sweep runs over `prefix + " " + name` via `useBootSweep(prefix, name, ...)`), only the flip-*replay* machinery is inert.

## What Changes

### Remove the inert machinery — `app/frontend/src/components/top-bar.tsx`

1. **Delete the `prevPrefixRef` declaration and its comment block** (currently :1394-1400):

```tsx
// Track the displayed prefix so a lens switch (tty↔web changes `Terminal:`↔
// `Web:` with the SAME window name) replays the boot sweep and re-seeds the
// sweep cells — otherwise `useBootSweep`'s `cells` state (seeded once from
// `rest()`) would stay stale and the heading would show the old prefix. Seeded
// with the initial prefix so the mount replay is owned by the name effect
// alone (no double-play on mount).
const prevPrefixRef = useRef<string>(prefix);
```

2. **Delete the prefix-keyed effect and its comment** (currently :1451-1461):

```tsx
// Lens switch: the page-type prefix flipped (`Terminal:`↔`Web:`) with the
// same window name. Replay the sweep (or, while editing, resolve to rest) so
// the heading re-seeds `sweep.cells` to the new prefix — the same one-effect
// mechanism as the name change, keyed on the prefix instead.
useEffect(() => {
  if (prefix !== prevPrefixRef.current) {
    prevPrefixRef.current = prefix;
    if (!editingRef.current) sweep.play();
    else sweep.resolve();
  }
}, [prefix, sweep]);
```

3. **Correct the stale `prefix` prop docstring** (currently :1358-1360). It reads:

```tsx
/** Page-type prefix (`Terminal:` / `Web:`) — follows the active lens (spec
 *  R4). The boot sweep runs over `prefix + " " + name`, so a prefix change
 *  (a tty↔web view switch) replays the sweep just like a name change. */
```

Replace with a docstring reflecting present truth: the prefix is the static `Window:` constant in every lens (260714-uco1 retired the lens-following prefix); the boot sweep renders over `prefix + " " + name`. No replay-on-change claim.

### Explicitly out of scope

- The `prefix` prop and `WINDOW_PREFIX` constant stay — they feed `useBootSweep(prefix, name, ...)` rendering and the `HeadingPrefix`/caret composition (260714-uco1).
- The name-keyed effect (:1442-1449), identity-change guard (:1421-1431), and all other sweep choreography are untouched.
- No test changes expected: no test passes `prefix=` or exercises a flip. Existing sweep/rename tests must keep passing unchanged.

## Affected Memory

None — `docs/memory/run-kit/ui-patterns.md` no longer describes the prefix-flip replay (the claim was relocated to the backlog by /docs-distill-memory, which is where this item came from), and grep confirms no memory file references `prevPrefixRef` or a prefix-flip replay. Implementation-only cleanup.

## Impact

- `app/frontend/src/components/top-bar.tsx` — one ref, one effect, ~18 lines removed; one docstring corrected.
- No behavior change: the deleted code path was unreachable.
- Verification: `cd app/frontend && pnpm exec tsc --noEmit` (compile-proves `prevPrefixRef` had no other readers) and `just test-frontend` (the WindowHeading sweep/rename suite in `top-bar.test.tsx` must pass unchanged).

## Open Questions

None — the backlog item is fully specified and the inertness claim was re-verified against current code before intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The prefix-keyed effect is unreachable (inert) | Sole call site passes the module constant `WINDOW_PREFIX`; verified via grep + NUL-safe perl sweep that no other call site exists; 260714-uco1 retired the lens-following prefix (documented in the test suite) | S:90 R:90 A:95 D:95 |
| 2 | Certain | Keep the `prefix` prop and `WINDOW_PREFIX` constant | They actively feed `useBootSweep` rendering and the caret composition — only the flip-replay machinery is dead | S:85 R:90 A:95 D:90 |
| 3 | Confident | Also correct the stale prop docstring (lens-following claim) in the same change | The docstring describes the exact behavior being deleted; leaving it would recreate the misleading-comment problem the deletion solves; trivially reversible | S:70 R:95 A:90 D:85 |
| 4 | Certain | No test edits needed | No test passes `prefix=` or covers a flip; verified by grepping `top-bar.test.tsx` for `prefix=` (zero hits) and replay-related test names | S:85 R:95 A:90 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
