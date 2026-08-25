# Intake: Recovery Dismiss All

**Change**: 260821-f2b7-recovery-dismiss-all
**Created**: 2026-08-21

## Origin

Backlog item `[f2b7]` (2026-08-20), design direction 1, refined in a `/fab-discuss` session (2026-08-20/21):

> Recovery section drowns in scratch-server debris (found on first live use of 4psk/#679: 15 offers, all test/probe servers — rk-e2e-*, rk-spike-*, echotest, agyprobe). Restore all is unusable and there is no bulk dismiss. Design directions: (1) Dismiss all beside Restore all; …

Conversational mode. The user reviewed all three backlog design directions with the agent and decided: ship direction 1 (this change) as the immediate, permanently-useful backstop, and direction 3b (`@rk_ephemeral` — sibling changes `zelc`/`hbmh`/`l1qe`) as the root-cause fix. Direction 2 (name-pattern grouping/exclusion) was **rejected**: half the observed debris (`echotest`, `agyprobe`) matches no derivable pattern, and heuristics risk false-positives on real servers.

This change is **independent** of the ephemeral stack — it branches off `main` and can run in parallel with `260821-zelc-ephemeral-option-snapshot-reap`.

## Why

1. **Pain**: After a reboot, the Host Overview RECOVERY zone (shipped in `260820-4psk-host-recovery-section`, PR #679) offered 15 servers — all scratch/test debris. The only dismissal affordance is the per-row `×`; clearing the section takes 15 clicks, and `Restore all` would spawn 15 junk tmux servers.
2. **Consequence if unfixed**: The recovery section is unusable exactly when it matters (post-reboot triage), and `Restore all` stays a footgun with no symmetric bulk exit.
3. **Why this approach**: Even after the root-cause siblings ship, existing lingering snapshots remain on disk and adoption gaps (agents that never set `@rk_ephemeral`) will still leak the occasional offer. A bulk dismiss is the cheap, always-useful escape hatch — and it mirrors the already-shipped `Restore all` mechanics one-for-one, so it inherits proven patterns rather than inventing new ones.

## What Changes

### 1. `dismissAll` in the recovery hook — `app/frontend/src/components/recovery-section.tsx`

Add `dismissAll: () => Promise<void>` to the `RecoveryState` type (currently at line 27-34) and implement it in `useRecoveryOffers()` mirroring the existing `restoreAll` exactly (lines 81-87):

```ts
const dismissAll = useCallback(async () => {
  // No bulk endpoint exists — sequential per-server POSTs; a failed server
  // toasts (inside dismiss) and does not block the rest.
  for (const offer of offersRef.current) {
    await dismiss(offer.server);
  }
}, [dismiss]);
```

**No new backend endpoint.** Each iteration calls the existing `dismiss(server)` → `POST /api/recovery/dismiss` (api/recovery.go:110). Backend dismiss is idempotent and cheap — a single atomic file rename to an audited tombstone (`Store.Dismiss`, internal/snapshot/store.go:343). This mirrors `restoreAll`'s documented no-bulk-endpoint decision and keeps the change frontend-only. Iterate via `offersRef.current` (the existing stale-closure guard, line 41-43), and include `dismissAll` in the returned `useMemo` object (lines 102-105).

### 2. "Dismiss all" heading control

In `RecoverySection` (line 245), the `SectionHeading` `side` slot currently renders `Restore all ({N})` when `offers.length > 1` (lines 264-273). Render **both** buttons in that slot under the same `> 1` gate — `Restore all ({N})` first, then `Dismiss all`, sharing the existing button classes. No confirmation dialog: consistent with the per-row `×` and `Restore all` (neither confirms), and a dismissal is not data loss — the store's rolling history files survive; only the UI offer path closes (the latest becomes a never-re-offered audited tombstone).

### 3. Palette parity (Constitution V)

`app/frontend/src/lib/palette-recovery.ts` registers `recovery-restore-all` ("Restore all previous servers", >1-offer gate) and per-server dismiss verbs. Add:

- id `recovery-dismiss-all`, label `Dismiss all previous servers`, same `offers.length > 1` gate, `onSelect` → `dismissAll`.
- Extend the handlers type (`onRestoreAll` at line 24) with `onDismissAll`.
- Wire in `app/frontend/src/components/host-overview-page.tsx` (the existing registration block at lines 120-129) with `onDismissAll: () => void recovery.dismissAll()`.

### 4. Tests

- **Unit**: extend the existing recovery-section and palette-recovery unit tests (colocated `.test.tsx`/`.test.ts`) — hook loop behavior (all offers dismissed sequentially, one failure doesn't block the rest), button render gate, palette registration gate.
- **e2e**: extend the existing host-recovery Playwright spec under `app/frontend/tests/e2e/` with a dismiss-all scenario (multiple offers → click Dismiss all → section disappears), and update the sibling `.spec.md` in the same commit (Constitution: Test Companion Docs).
- Run via `just test-frontend` / `just test-e2e "<spec>"` — never direct playwright (project convention).

## Affected Memory

- `run-kit/layout-snapshots`: (modify) recovery reader section — bulk dismiss rides the existing per-server `Store.Dismiss`, no new endpoint
- `run-kit/ui/keyboard-and-palette`: (modify) route-scoped recovery verbs gain `recovery-dismiss-all`
- `run-kit/ui/routes-and-shell`: (modify) host recovery zone — heading now carries the Restore all / Dismiss all pair

## Impact

Frontend-only: `recovery-section.tsx`, `palette-recovery.ts`, `host-overview-page.tsx`, plus their unit tests and the host-recovery e2e spec + `.spec.md`. No Go changes, no API changes, no new routes (Constitution IV untouched). Independent of the `@rk_ephemeral` sibling stack — PR bases on `main`.

## Open Questions

*(none — all decisions resolved in the discussion session)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sequential client-side loop over the existing per-server dismiss POST; no bulk backend endpoint | Discussed — mirrors `restoreAll`'s shipped precedent verbatim; dismiss is idempotent + cheap | S:90 R:85 A:95 D:90 |
| 2 | Confident | No confirmation dialog on Dismiss all | Consistent with per-row `×` and Restore all (no confirms anywhere in the section); history files survive on disk so it is not data loss | S:70 R:85 A:80 D:65 |
| 3 | Certain | Both bulk buttons gate on `offers.length > 1`, sharing the SectionHeading side slot | Existing Restore-all gate reused; a single offer keeps per-row controls sufficient | S:85 R:90 A:90 D:85 |
| 4 | Confident | Palette id `recovery-dismiss-all` / label "Dismiss all previous servers" | Parallel naming with shipped `recovery-restore-all`; palette-recovery.ts doc comment establishes the pattern | S:75 R:90 A:85 D:80 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
