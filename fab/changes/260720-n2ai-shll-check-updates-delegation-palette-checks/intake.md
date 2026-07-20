# Intake: Delegate Update Check to `shll check-updates` + Rework the Update Command Surface

**Change**: 260720-n2ai-shll-check-updates-delegation-palette-checks
**Created**: 2026-07-20

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`), synthesized from a prior design conversation. All major decisions below are settled outcomes of that discussion — not open questions. Raw synthesized input:

> Delegate the toolkit update check to `shll check-updates` and rework the update command surface. Two coupled parts: (A) rework `app/backend/internal/updatecheck` — which today fetches shll.ai/versions.json directly, execs `brew list --versions`, and evaluates the notify policy itself — into a thin caller around ONE exec of `shll check-updates --json`, consuming per-tool verdicts from its JSON; (B) add a `POST /api/updates/check` on-demand endpoint, extend the SSE `update-available` payload to full per-tool verdicts, and rework the palette command surface: two check commands (`run-kit: Check for Updates`, `run-kit: Check for Updates (incl. patches)`) reporting via toast, `run-kit: Update Now` becomes THE single update action, and the qualifying-gated `run-kit: Update to v{X}` entry (with its `updateActionLabel` label-composition logic) is deleted.

The shll side (change 260720-puxw-check-updates-command in the shll repo) is in progress and hasn't shipped; this change implements against the vendored JSON contract (below).

## Why

1. **The pain point**: run-kit currently reimplements the toolkit's update-check logic — manifest HTTP fetch, `brew list --versions` join, and semver threshold evaluation — inside `app/backend/internal/updatecheck/updatecheck.go`. The shll repo is adding `shll check-updates` as the toolkit's single update-check surface (backend selected via `--source released|github` with `released` the default, `--json` for machine consumers, threshold policy behind the surface). Keeping a parallel implementation in run-kit means two places for the notify-policy logic to drift (Constitution III: Wrap, Don't Reinvent — when a toolkit tool does what you need, call it). Separately, there is no on-demand check: users cannot ask "is anything updatable right now?" — the only surfaces are the ambient 6h chip and a force-update that fires blind. The `run-kit: Update to v{X}` palette label is also broken in spirit: it's multi-tool ambiguous (the update is toolkit-scoped, not single-tool) and goes stale between check passes.

2. **If we don't do it**: run-kit's threshold/brew-join logic drifts from shll's canonical implementation as the toolkit evolves (e.g. new notify policies, new tools, changed manifest schema), and every schema change must land twice. The palette keeps a stale, ambiguous dynamic label and no deliberate check affordance.

3. **Why this approach**: one exec of `shll check-updates --json` replaces three code paths (fetch + brew join + threshold eval) with a single subprocess call under run-kit's standard discipline (`exec.CommandContext`, argument slices, context-bound timeout — Constitution I). The check/notify distinction (minor vs. patch) lives purely client-side as filtering over one verdict list, so no second backend and no `--github` plumbing is needed. Rejected alternatives are recorded under Design notes in What Changes.

## What Changes

### Part A — backend delegation (`app/backend/internal/updatecheck/`)

Rework the checker core into a thin caller of `shll check-updates`:

- **Replace** the manifest HTTP fetch (`defaultFetch` → `https://shll.ai/versions.json`), the `brew list --versions` join (`defaultBrewList`, `parseBrewVersions`), and the semver threshold evaluation (`crossesThreshold`, `minorOrMajorIncrease`, `anyIncrease` and the notify-policy constants) with **ONE exec** of `shll check-updates --json` per check pass. Context-bound timeout, `exec.CommandContext` with an argument slice (Constitution I). Consume per-tool verdicts from its JSON. **Delete** the manifest-fetch and brew-join code paths — run-kit no longer carries ANY fallback direct fetch.

- **Keep unchanged**: the 6h `checkInterval`, the 30s `initialCheckDelay`, the in-memory stale-while-revalidate verdict (`Result` guarded by mutex, Constitution II — no database), the changed-set `OnQualify` callback semantics (fire on any Key change, including to empty), `RecheckAfter` (post-remediation re-check), and dev-build suppression (a `"dev"`/unparseable running version never checks).

- **run-kit's own row stays special**: shll can only see the brew-installed version, so consume shll's `latest` + `notify` for the run-kit row but do that one comparison **locally** against the running ldflags version. The local comparison must now produce BOTH verdicts — `update_available` (installed < latest) and `notable` (bump crosses the notify threshold) — since the new incl.-patches view surfaces sub-threshold bumps. Trust shll's verdicts **verbatim** for sibling tools (no re-evaluation).

- **New failure posture (ambient loop)**: when `shll` is not on PATH, exits non-zero, or emits unparseable JSON, the ambient check **skips silently that pass and retains the previous verdict**. No fallback fetch, no error surfaced to clients. (The MANUAL check path surfaces an error — see Part B item 4.)

- **JSON contract** (settled on the shll side — **vendor as a test fixture**; expect `schema: 1`, tolerate unknown fields):

  ```json
  {
    "schema": 1,
    "source": "released",
    "tools": [
      { "name": "run-kit", "formula": "run-kit",
        "installed": "3.8.1", "latest": "3.8.2",
        "notify": "minor", "update_available": true, "notable": false }
    ]
  }
  ```

  Semantics: `update_available` = installed < latest; `notable` = the pending bump crosses the tool's notify threshold. A tool is listed only when both installed and latest resolve — an unresolvable tool never matches (same posture as today's checker). Exit codes: `0` = check ran (verdicts in JSON regardless of pending updates), `1` = check itself failed, `2` = usage error — so **"skip on non-zero" is the caller rule**.

- **Sequencing**: the shll change (260720-puxw-check-updates-command) hasn't shipped. Implement against the vendored contract fixture; the PR can merge, but the **PR body must note** the feature goes live only once a shll release with `check-updates` is out. Until then the not-on-PATH path keeps the checker silent, which is safe.

### Part B.1 — on-demand check endpoint

New endpoint **`POST /api/updates/check`** (Constitution IX: mutating = POST), registered in `app/backend/api/router.go` alongside the existing `POST /api/update` (router.go:546):

- Runs one immediate checker pass **inline** (the same code path the 6h loop uses — `checkOnce`), updates the cached verdict, broadcasts the SSE event, AND **returns the fresh verdict synchronously in the response** so the client can report without waiting on SSE.
- No in-flight lock needed beyond what the checker already has (mirrors `/api/update`'s no-lock posture).
- The `~1-2s` exec latency is acceptable for a synchronous response; the exec timeout keeps it bounded (Code-review rule: API routes must not block > 5s without timeouts — the exec timeout is the bound).

### Part B.2 — SSE payload extension

The SSE `update-available` payload (`app/backend/api/sse.go`, `broadcastUpdateAvailable` / `updateAvailableTool`) is **extended to carry the full per-tool verdict list** — both `update_available` and `notable` per tool — not just the matched/notable set, so the client can filter either view (default check = notable only; incl.-patches check = all `update_available`).

### Part B.3 — palette command surface (`app/frontend/src/lib/palette-update.ts`)

Final surface:

- **`run-kit: Check for Updates`** — POSTs `/api/updates/check`, reports tools where `notable` is true via info toast; "All tools up to date" when none.
- **`run-kit: Check for Updates (incl. patches)`** — same POST, reports every tool where `update_available` is true, annotating sub-threshold rows, e.g. `tu v0.9.1 → v0.9.2 (patch — below notify threshold)`.
- **`run-kit: Update Now`** — the existing force-update maintenance entry, unchanged behavior, but it becomes **THE single update action**: POSTs `/api/update` with `force:true` (full-roster `shll update`; idempotent, picks up patch-only bumps the scoped match set would skip).
- **DELETE** the qualifying-gated `run-kit: Update to v{X}` palette entry and its label-composition logic — `updateActionLabel` in `palette-update.ts` (the three label shapes: single run-kit, single sibling, N tools) and the `buildUpdateActions` update entry.
- **`run-kit: Dismiss Update Notice`** and **`run-kit: Restart Daemon`** stay unchanged.
- **Dev-build suppression extends to the two new check entries**: hidden when the version is the `dev` sentinel, same gating pattern as the maintenance entries today (`buildMaintenanceActions`' `DEV_VERSION` check).

### Part B.4 — check-result reporting (toast)

Via the existing toast system (`app/frontend/src/components/toast.tsx` — bottom-right, 4s, info/error variants, optional action button):

- Info toast with the per-tool summary (reuse `updateChipToolSummary`-style composition where it fits).
- When something is updatable, the toast's **action slot carries "Update Now"** (triggers the same update flow as the palette entry).
- When shll is missing or the check fails, the **MANUAL check shows an error toast** (e.g. "Update check unavailable — shll not found") — a deliberate invocation deserves an honest answer, while the ambient loop stays fail-silent.
- Rejected: a "checking…" intermediate toast — the endpoint responds synchronously (~1-2s exec), single result toast.

### Part B.5 — chip behavior (unchanged, policy-driven)

The top-bar update chip is **unchanged** and stays policy-driven: a patch-only finding produces a toast only — no chip, no persistent state, nothing to dismiss. A manual check that finds a notable update **lights the chip immediately** (shared verdict — manual and ambient paths converge on one cached state; the endpoint's SSE broadcast is what converges them).

### Design notes — rejected alternatives (from the design discussion)

- **A 2×2 command matrix** (check×threshold, update×threshold): rejected — the update axis has only one real action (brew installs the manifest latest regardless); the minor/patch distinction exists only on the check/notify axis.
- **`Update to v{X}` dynamic label**: rejected for multi-tool ambiguity (update is toolkit-scoped) and verdict staleness; static "Update Now" wins — version detail lives in check results and the chip summary (`updateChipToolSummary`).
- **Plumbing the `github` backend through the daemon**: rejected — both check commands use shll's default `released` backend; the difference between them is purely client-side filtering over one exec. `--source github` stays a shll-side debugging surface. run-kit passes NO backend flag at all (plain `shll check-updates --json`) — `released` is the default, so the invocation is valid against every shll version carrying `check-updates` and decoupled from backend-flag evolution (the original `--released`/`--github` bools are being consolidated into `--source`).
- **Modal/dialog for check results**: rejected — toast + palette keeps it keyboard-first (Constitution V).

### Out of scope

- The unified toolbar update button ([Update Now | check-again] with promote/demote placement derived from verdict state) — explicitly deferred to a later change. This change only keeps the existing chip behavior working on the new verdict shape.

## Affected Memory

- `run-kit/architecture`: (modify) Update-checker section — the checker becomes a thin `shll check-updates --json` exec caller (manifest fetch + brew join + threshold eval deleted); new `POST /api/updates/check` endpoint; new fail-silent-retain posture; extended SSE `update-available` verdict payload.
- `run-kit/ui-patterns`: (modify) Update chip / palette section — the two new check commands + toast reporting, `Update Now` as the single update action, deletion of the `Update to v{X}` dynamic-label entry.

## Impact

- **Backend**:
  - `app/backend/internal/updatecheck/updatecheck.go` + `updatecheck_test.go` — core rewrite (fetch/brew/threshold code deleted; one-exec seam + vendored JSON fixture; run-kit-row local comparison producing both verdicts; test seams reworked from fetch/brew stubs to a check-exec stub).
  - `app/backend/api/update.go` — new `handleUpdatesCheck` (or sibling file); existing `handleUpdate` unchanged in behavior.
  - `app/backend/api/router.go` — register `POST /api/updates/check` (existing `POST /api/update` at :546).
  - `app/backend/api/sse.go` — `updateAvailableTool` / `broadcastUpdateAvailable` payload extension (per-tool `update_available` + `notable`).
  - `app/backend/api/tmuxctl_bridge.go` — `SetUpdateChecker` seam (verdict type ripple).
- **Frontend**:
  - `app/frontend/src/lib/palette-update.ts` + `palette-update.test.ts` — delete `buildUpdateActions`' update entry + `updateActionLabel`; add the two check actions; extend dev gating.
  - `app/frontend/src/contexts/session-context.tsx` — `UpdateTool` verdict shape gains `update_available`/`notable`; `updateNow` unchanged; SSE parse of the extended payload.
  - `app/frontend/src/hooks/use-update-click.ts` — completion-signal semantics must keep working against the reshaped verdict.
  - `app/frontend/src/app.tsx` — toast wiring for check results (existing toast system in `src/components/toast.tsx`).
- **Docs/specs**: `docs/specs/api.md` (new endpoint + SSE payload), memory files per Affected Memory.
- **Tests**: Go tests for the exec seam / verdicts / failure posture (vendored fixture), frontend unit tests for the new palette builders + toast composition; e2e where feasible per code-quality.md.
- **Change type**: feat. (Explicitly pinned — refresh seams must not flip this to fix.)

## Open Questions

- None — all major decisions were settled in the design conversation; residual implementation details are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend check delegates to ONE exec of `shll check-updates --json`; manifest-fetch, brew-join, and threshold-eval code paths are deleted with no fallback direct fetch | Discussed — settled requirement; Constitution III (wrap, don't reinvent) | S:95 R:60 A:95 D:95 |
| 2 | Certain | JSON contract vendored as a test fixture: `schema: 1`, tolerate unknown fields; exit codes 0=ran/1=failed/2=usage, caller rule = skip on non-zero | Discussed — contract settled on the shll side and reproduced verbatim in intake | S:95 R:75 A:90 D:95 |
| 3 | Certain | Keep 6h cadence, 30s initial delay, stale-while-revalidate verdict, changed-set `OnQualify` callback, `RecheckAfter`, and dev-build suppression unchanged | Discussed — explicitly listed as keep-unchanged | S:95 R:80 A:95 D:95 |
| 4 | Certain | run-kit row compared locally against running ldflags version using shll's `latest`+`notify`, producing BOTH `update_available` and `notable`; sibling-tool verdicts trusted verbatim | Discussed — settled; shll cannot see the running (non-brew-visible) version | S:95 R:70 A:90 D:90 |
| 5 | Certain | Ambient failure posture: shll missing / non-zero / unparseable JSON ⇒ skip pass silently, retain previous verdict; manual check surfaces an error toast instead | Discussed — settled dual posture (ambient fail-silent, manual fail-loud) | S:95 R:75 A:90 D:90 |
| 6 | Certain | New `POST /api/updates/check` runs one inline checker pass, updates cache, broadcasts SSE, and returns the fresh verdict synchronously; no extra in-flight lock | Discussed — settled; Constitution IX (POST for mutations) | S:95 R:70 A:95 D:90 |
| 7 | Certain | SSE `update-available` payload extended to the full per-tool verdict list (`update_available` + `notable` per tool), not just the matched set | Discussed — settled; enables client-side filtering for both check views | S:90 R:65 A:90 D:90 |
| 8 | Certain | Palette surface: add `Check for Updates` + `Check for Updates (incl. patches)`; `Update Now` (POST `/api/update` `force:true`) is THE single update action; DELETE `Update to v{X}` entry + `updateActionLabel`; Dismiss/Restart unchanged | Discussed — settled final surface incl. rejected 2×2 matrix and dynamic label | S:95 R:75 A:95 D:95 |
| 9 | Certain | Check results report via the existing toast system (info toast + per-tool summary; "Update Now" in the action slot when something is updatable); no modal, no intermediate "checking…" toast | Discussed — settled; Constitution V (keyboard-first) | S:95 R:85 A:95 D:90 |
| 10 | Certain | Chip unchanged and policy-driven: patch-only finding ⇒ toast only (no chip/persistent state); manual notable finding lights the chip immediately via the shared verdict | Discussed — settled convergence of manual and ambient paths on one cached state | S:90 R:75 A:90 D:90 |
| 11 | Certain | Dev-build suppression extends to the two new check palette entries (hidden on the `dev` sentinel, same pattern as maintenance entries) | Discussed — settled | S:90 R:90 A:95 D:95 |
| 12 | Certain | Sequencing: implement against the vendored fixture now; PR may merge, but PR body must note the feature goes live only with a shll release carrying `check-updates` (not-on-PATH keeps the checker silent until then) | Discussed — settled rollout posture | S:90 R:80 A:90 D:90 |
| 13 | Certain | Out of scope: the unified toolbar update button (promote/demote placement) — deferred to a later change; this change only keeps the existing chip working on the new verdict shape | Discussed — explicit scope exclusion | S:95 R:90 A:95 D:95 |
| 14 | Confident | The run-kit row keeps its `selfBrew` gate (a non-brew/go-install daemon's own row never matches — it cannot self-update via brew remediation); sibling rows come from shll regardless | Not restated in the discussion, but "run-kit's row stays special" + existing posture in `computeMatched`; trivially reversible | S:60 R:85 A:85 D:80 |
| 15 | Confident | Dismissal `Key` and chip qualification stay computed from the NOTABLE set only (matched = notable), preserving today's dismissal semantics; the full verdict list rides alongside | "Chip is unchanged and stays policy-driven" implies notable-set semantics; reversible mapping detail | S:65 R:80 A:85 D:80 |
| 16 | Confident | The `shll check-updates` exec timeout is a named constant of 30s (network fetch + brew reads behind one subprocess; aligns with the constitution's 30s build-op tier), replacing the separate 10s fetch/brew timeouts | Constitution's Process Execution rule gives the tiering; exact value is a reversible constant | S:45 R:95 A:80 D:70 |
| 17 | Confident | `POST /api/updates/check` response: 200 with the verdict JSON (same per-tool shape as the SSE payload) on success; 502 `{"error":"..."}` when the check itself fails (shll missing / non-zero / unparseable) so the client can raise the error toast | Response shape not specified beyond "returns the fresh verdict synchronously"; 502 = upstream-tool failure, one obvious mapping; easily changed | S:50 R:90 A:75 D:65 |
| 18 | Confident | On a suppressed checker (dev/unparseable version), `POST /api/updates/check` returns 409 `{"error":...}` (mirrors `/api/update`'s dev-posture 409); the palette hides the entries on dev anyway, so this is a defensive contract | Endpoint behavior for suppressed checkers not discussed; mirrors the sibling handler's convention; low blast radius | S:40 R:90 A:70 D:60 |
| 19 | Confident | The toast's "Update Now" action slot is gated the same as the palette `Update Now` entry (brew install && not dev); when the daemon can't update, the toast reports results without the action button | Follows directly from "triggers the same update flow" + existing `buildMaintenanceActions` gating | S:55 R:90 A:80 D:75 |
| 20 | Confident | The transitional `Current`/`Latest` compat fields on the verdict (kept for not-yet-reloaded clients) are retained through this change and removed later | Existing code comments mark them transitional; removing them is a separate concern; trivially reversible | S:40 R:90 A:75 D:60 |

20 assumptions (13 certain, 7 confident, 0 tentative, 0 unresolved).
