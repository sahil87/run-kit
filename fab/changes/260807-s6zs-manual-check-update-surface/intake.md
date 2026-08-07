# Intake: Persist Manual Update-Check Results onto the Top-Bar Update Surface

**Change**: 260807-s6zs-manual-check-update-surface
**Created**: 2026-08-07

## Origin

Synthesized from a `/fab-discuss` conversation and dispatched via `/fab-proceed` (promptless create-intake dispatch). The user's decision, verbatim from the discussion synthesis:

> **Problem**: The top-right overflow menu's ⟳ "Check for updates" button runs the incl.-patches check (`runUpdateCheck(true)` in `top-bar-overflow-menu.tsx` → `checkForUpdates("github")` → POST `/api/updates/check {"source":"github"}` → daemon execs `shll check-updates --json --source github`). When it finds updates, the ONLY result is an ephemeral bottom-right toast (with an "Update Now" action). Once the toast times out, the information is gone — the persistent top-bar update surface (the in-bar `UpdateChip` and the overflow-menu version-row update surface) stays dark, because it is fed exclusively by the ambient 6h released-manifest checker via the SSE `update-available` event.
>
> **Decision — frontend-only change, backend untouched**: The backend's side-channel contract is deliberate and stays intact. The fix lives entirely in the frontend: hold the manual check result in context state, light the persistent update surfaces when EITHER feed shows, route manual-fed clicks to `forceUpdateNow()`, reuse the composite-key dismissal, clear on SSE key change.
>
> **Alternative rejected**: backend caching of the github verdict in a separate slot + SSE broadcast to all tabs. Rejected because it grows the API/SSE surface and reopens the argv-scoping question the side-channel design closed. User explicitly accepted the resulting tradeoff: the manual result is tab-local — a page reload before updating forgets it (user re-clicks ⟳).

## Why

1. **Pain point**: A user who clicks the overflow menu's ⟳ "Check for updates" and sees "3 tools updatable" in the toast has ~5 seconds to act. If they dismiss the toast, switch tabs, or simply read it too slowly, the information evaporates — the persistent `UpdateChip` (top-bar L3 right cluster) and the overflow-menu version-row update surface stay dark, because both are fed exclusively by `SessionContext.updateAvailable`, which only the ambient 6h released-manifest checker's SSE `update-available` event populates. The manual github-source check is deliberately a **side channel**: `handleUpdatesCheck` (`app/backend/api/update.go`) never writes the github verdict into the cached checker verdict, because the github backend has no notify policy — caching it would wipe a legit released-manifest chip and starve the scoped `shll update` argv (`Snapshot().Matched`). So today the manual result has no persistent home at all.

2. **Consequence of not fixing**: The ⟳ check affordance (PR #529 pointed it at the incl.-patches github source precisely because the shll.ai manifest lags ~1 day behind a just-cut release) answers "is anything updatable right now?" — but the answer is throwaway. The user must re-run the check to re-see it, and the natural mental model ("the chip lights when updates exist") silently fails for manually-discovered updates.

3. **Why this approach**: Frontend-only context state preserves the deliberate backend side-channel contract (no cached-verdict pollution, no argv-scoping regression, no API/SSE surface growth). The accepted tradeoff — manual result is tab-local, forgotten on reload — is proportionate: re-clicking ⟳ takes one click, and the ambient feed remains the durable cross-tab channel.

## What Changes

Frontend-only. No Go/backend changes. All files under `app/frontend/src/`.

### 1. `contexts/session-context.tsx` — manual-check result state

- Add context state holding the latest manual check result: the **updatable tool set** plus the echoed `source` (`"released"`/`"github"`) from `UpdateCheckResult`. Shape reuses the existing `UpdateTool` row contract (`UpdateCheckTool` from `api/client.ts` is structurally compatible: `{tool, current, latest, updateAvailable, notable}`).
- Expose a setter through the context (e.g. `applyManualCheckResult(tools, source)` — exact name is the implementer's choice) that `use-update-check.ts` calls. Setting with an **empty updatable set clears** any previously-held manual result (a fresh verdict supersedes a stale one).
- Compute the manual composite key client-side over the manual tool set: **sorted `tool@latest` pairs, comma-joined** — mirroring backend `computeKey` (`app/backend/internal/updatecheck/updatecheck.go:531-541`) so the existing localStorage `runkit-update-dismissed` (`UPDATE_DISMISSED_KEY`, `session-context.tsx:37`) dismissal machinery works unchanged for the manual-fed chip.
- **Clearing**: a `useEffect`/callback seam clears the manual state when the ambient SSE composite `key` (from `applyUpdateAvailable`) **changes** after the manual result was stored — the update-consumed signal, mirroring `use-update-click.ts`'s R13 completion signal. Tab reload naturally discards the state (plain React state, no persistence — deliberate, per the accepted tradeoff).

### 2. `hooks/use-update-check.ts` — persist result in addition to the toast

- In `runUpdateCheck`'s `.then`, after composing the toast, ALSO push the updatable tool subset + echoed `source` into the new context seam. **The toast stays** — this is in addition to, not a replacement for, the existing `composeCheckToast` + "Update Now" action-slot flow.
- The persisted subset is the same "updatable" filter `composeCheckToast` reports (`includePatches` → rows with `updateAvailable`; default → rows with `notable`), so the chip and the toast can never disagree about what was found.

### 3. `useUpdateNotification()` (in `session-context.tsx`) — merged two-feed derivation

- The hook currently derives `{qualifies, showChip, tools, key, singleRunKit, latest, current, …}` from `updateAvailable` alone (`session-context.tsx:1141-1205`). Extend it to a merged derivation:
  - **Ambient-first precedence**: when the ambient feed qualifies (today's `qualifies`/`showChip` logic), behavior is byte-identical to today — the manual feed changes nothing while the ambient chip is live.
  - **Manual fallback**: when the ambient feed does not show but a manual result with tools is held, the hook surfaces the manual feed: `tools` = manual updatable set, `key` = client-computed manual composite key, `singleRunKit`/`latest`/`current` derived by the same rules, `showChip` gated by the same composite-key dismissal (`manualKey !== updateDismissedKey`) and the same `!isDev` guard.
  - Expose which feed is lit (e.g. a `manualOnly: boolean` or `feed: "ambient" | "manual"` field) so click routing can branch.
- Because both persistent surfaces — the in-bar `UpdateChip` (`top-bar.tsx:2319`) and the overflow-menu version row (`top-bar-overflow-menu.tsx`, `asUpdateSurface` at line 317) — plus both palette mounts (AppShell in `app.tsx`, board in `board-page.tsx`) consume this one hook, the merge happens in exactly one place and the surfaces cannot drift. `asUpdateSurface = tools.length > 0 && (updateOverflowed || (qualifies && !showChip))` picks up the manual feed with no per-surface changes beyond what the hook returns.

### 4. `hooks/use-update-click.ts` — click routing by feed

- `triggerUpdate` currently always calls `updateNow()` (scoped `POST /api/update {}` → `shll update <matched…>`). Change: when the surface is lit from the **manual feed only**, trigger `forceUpdateNow()` (existing `triggerForceUpdate` in `api/client.ts` — `POST /api/update {"force":true}` → full-roster `shll update`) — exactly what the toast's "Update Now" action runs today. The ambient feed's scoped click path is unchanged when the ambient feed is the one lit.
- The R13 `updating`-clearing seam (`key !== clickKeyRef.current`) keys on the hook's effective `key`, which for a manual-fed click is the manual composite key; the manual state itself clears on ambient-key change (§1), which flows through as an effective-key change.

### 5. Dismissal (`✕` / palette `run-kit: Dismiss Update Notice`)

- `dismissUpdate()` currently writes `updateAvailable.key` (`session-context.tsx:390-398`) and no-ops on an empty key. Make the dismissal write the **effective displayed key** (manual composite key when the manual feed is lit), so the existing chip `✕` and `buildUpdateActions` palette dismiss entry work unchanged against the manual-fed chip. A later manual check finding a different tool set produces a different key and re-shows the chip — same re-show semantics as the ambient feed.

### 6. Tests (per code-quality.md — new behavior needs unit tests, Vitest, colocated)

- **Context state**: manual result set/supersede/clear-on-empty; clear on ambient key change; tab-local (no persistence writes).
- **Chip render-precedence**: ambient-lit unchanged; manual-lit when ambient dark; ambient wins when both present; `!isDev` and dismissal gates on the manual feed.
- **Click routing**: manual-fed → `forceUpdateNow()`; ambient-fed → `updateNow()`; failure toast unchanged.
- **Dismissal key**: client-side key composition (sorted `tool@latest`, comma-joined — including sort-order and multi-tool cases) and `✕` writing the manual key.
- Existing suites to extend rather than duplicate: `session-context` tests, `use-update-check.test.tsx`, `update-chip.test.tsx`, `top-bar-overflow-menu.test.tsx`, `palette-update.test.ts` (only if `lib/palette-update.ts` gains the key helper — see Assumptions #9).

### Constraints (binding)

- **No backend/Go changes** — the side-channel contract in `handleUpdatesCheck` stays intact.
- TypeScript, React 19, Vitest unit tests colocated with source.
- Both palette mounts (AppShell in `app.tsx` and `board-page.tsx`) consume the shared hooks — behavior must not drift between them (the merge lives in `useUpdateNotification`/`use-update-click.ts`/`use-update-check.ts`, never per-mount).
- Respect existing anti-drift extractions: `use-update-check.ts` (check→toast flow), `use-update-click.ts` (chip/menu-row click), `lib/palette-update.ts` (`composeCheckToast`, `updateChipToolSummary`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Update Notification — the context state gains the tab-local manual-check feed; `useUpdateNotification` becomes a merged two-feed derivation (ambient-first); `use-update-click` routes manual-fed clicks to `forceUpdateNow()`; dismissal covers the client-computed manual composite key; document the accepted tab-local/reload-forgets tradeoff and the rejected backend-caching alternative.

## Impact

- **Frontend only**: `app/frontend/src/contexts/session-context.tsx`, `hooks/use-update-check.ts`, `hooks/use-update-click.ts`; possibly `lib/palette-update.ts` (shared key-composition helper) and no-or-minimal edits to `components/top-bar.tsx` / `components/top-bar-overflow-menu.tsx` (both should light purely via the hook's merged output). Colocated `.test.ts(x)` files for each touched module.
- **No API/SSE surface change**; no new routes, chrome, or localStorage keys (`runkit-update-dismissed` is reused).
- **Behavioral compatibility**: with no manual check run, every surface behaves byte-identically to today (ambient-only path untouched).

## Open Questions

- None — the discussion resolved the architecture (frontend-only, ambient-first, force-update routing, composite-key dismissal, SSE-key-change clearing) and explicitly accepted the tab-local tradeoff. Implementation-level choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend-only; backend side-channel contract (`handleUpdatesCheck` never caches the github verdict) stays intact | Discussed — user explicitly chose frontend-only and rejected the backend-caching alternative | S:95 R:70 A:95 D:95 |
| 2 | Certain | Manual-fed click triggers `forceUpdateNow()` (POST `/api/update {"force":true}`, full-roster); ambient-fed click keeps the scoped `updateNow()` path unchanged | Discussed — mirrors the toast's existing "Update Now" action; both endpoints already exist in `api/client.ts` | S:95 R:80 A:90 D:90 |
| 3 | Certain | Manual result is tab-local React state — a page reload before updating forgets it (user re-clicks ⟳) | Discussed — user explicitly accepted this tradeoff when rejecting the SSE-broadcast alternative | S:95 R:85 A:95 D:95 |
| 4 | Certain | Manual dismissal key = sorted `tool@latest` pairs comma-joined, computed client-side, written to the existing localStorage `runkit-update-dismissed` | Discussed — mirrors backend `computeKey` (updatecheck.go:531) verbatim; keeps the ✕/palette dismissal machinery unchanged | S:90 R:85 A:95 D:90 |
| 5 | Certain | Manual state clears when the ambient SSE composite `key` changes (update consumed — R13 signal) and naturally on daemon restart via tab reload | Discussed — named explicitly in the decision; mirrors `use-update-click.ts`'s existing completion signal | S:90 R:80 A:85 D:85 |
| 6 | Certain | Manual-fed chip reuses the existing presentation rules: `singleRunKit` → `⬆ v{latest}`, else count form `⬆ updates (N)`, aria via shared `updateChipToolSummary` | "Render when EITHER feed has tools" implies the same chip; single presentation source is the module's stated anti-drift invariant | S:65 R:85 A:90 D:80 |
| 7 | Confident | Persisted manual subset = the same "updatable" filter `composeCheckToast` reports (incl.-patches → `updateAvailable` rows; default → `notable` rows), so chip and toast never disagree | Not discussed at this granularity, but the toast is the stated model for the manual result; any other subset would show a chip contradicting the toast | S:70 R:80 A:85 D:75 |
| 8 | Confident | Ambient-first precedence when both feeds are lit: ambient `showChip` wins wholesale (tools, key, click routing); manual fills in only when the ambient feed does not show | Description states the ambient click path is "unchanged when the ambient feed is the one lit"; ambient is the durable, policy-driven feed | S:75 R:80 A:80 D:70 |
| 9 | Confident | The two-feed merge lives inside `useUpdateNotification` (one derivation), with the feed indicator exposed for `use-update-click` routing; per-surface components change minimally or not at all | The constraint "both palette mounts must not drift" plus the existing single-hook architecture make the hook the only merge point that guarantees it | S:75 R:75 A:85 D:75 |
| 10 | Confident | A manual check returning zero updatable tools clears any previously-held manual result (fresh verdict supersedes) | Not discussed; standard freshness semantics — keeping a stale positive after a clean re-check would show a lying chip | S:60 R:85 A:80 D:70 |
| 11 | Confident | The chevron attention badge (`showBadge = updateOverflowed && tools.length > 0`) may light for a manual-fed overflowed chip via the merged `tools` — no badge-specific carve-out added | Not discussed; the manual check is a deliberate user action so ambient-attention semantics are acceptable, and dismissal still silences it; trivially carved out later if unwanted | S:40 R:85 A:60 D:50 |
| 12 | Confident | Accepted residual: a manual-fed **siblings-only sub-threshold** update (force path, no daemon restart, R17 re-check re-broadcasts an unchanged/empty ambient key) gets no completion signal — `updating…`/manual chip persist until reload; no new completion machinery is added | Same accepted-residual envelope as `use-update-click.ts`'s existing failed-upgrade residual; run-kit-in-scope (the common github-source case) restarts the daemon and reloads the tab, discarding the state | S:45 R:75 A:70 D:60 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
