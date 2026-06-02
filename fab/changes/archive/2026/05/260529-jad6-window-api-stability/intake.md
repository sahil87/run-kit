# Intake: Window-State API Stability Remediation

**Change**: 260529-jad6-window-api-stability
**Created**: 2026-05-29
**Status**: Draft

## Origin

> Backend window-state API stability remediation — consolidate actionables from the v2.0.3+ stability audit. Created after a `/fab-discuss` session investigating a "major drop in stability since v2.0.3." The audit traced the regression to a four-PR chain (#198 → #202 → #204 → #205) that rewrote window identity (mutable `session:index` → stable tmux `@N`) and state ownership (URL-driven → tmux-as-source-of-truth via control mode), shipped incrementally and not fully converged.

The session proceeded through three lenses, each producing actionables:

1. **Correctness/escaping audit** of the Go window-state API surface (handlers, ID parsing, validation, tmux layer).
2. **Minimal-parameter audit** — does each endpoint require only the data it needs?
3. **De-duplication audit** — are any endpoints/functions redundant?

Key conversational decisions:
- **Verbs are NOT consolidated.** `kill`/`select`/`split`/`rename`/`move` each map to a distinct tmux command with distinct failure modes; a generic action-dispatcher was explicitly rejected (same branch count, worse discoverability, weaker per-action validation, fuzzier §I audit surface).
- **Option setters ARE consolidatable** — `color`/`url`/`type` are one operation shape (`set-option -w -t @N <@opt>`). Agreed to merge, but **only with partial-merge semantics** (full-replace PUT was rejected as it would re-introduce the "client clears a field it didn't echo" bug class).
- **The minimal-parameter audit found the backend window surface already minimal** (#204 removed the redundant `session`+`index` identity). The surviving "two identifiers ANDed together" anti-pattern lives in the **frontend** (`$session` + `$window`), which is the unfinished half of `xao8`.
- **De-duplication found no true HTTP-route duplicates**, but one dead function in the tmux layer (`KillPane` by paneID).

## Why

Since v2.0.3 the window-state subsystem became unstable. The root is that v2.0.4–v2.1.0 is effectively one large, *unfinished* refactor of window identity and state ownership, landed across four PRs. PR #202's own commit message and backlog item `xao8` admit it "fixed the symptom, not the root." The remaining defects manifest as: the sidebar highlighting the wrong window, click→terminal bounce-back, and orphan/socket accumulation.

If we don't finish the convergence:
- The wrong-window-highlight bug persists (REST `/select` uses a group-ambiguous bare target).
- The decode-logic duplication that *already caused* bug #205 can drift again.
- The frontend's `session`+`index` identity keeps amplifying every window-sync edge case (rename, cross-session move, index reuse).
- Dead code (`KillPane`) keeps inviting "which kill do I call?" mistakes.

This change collects the audit's actionables into one remediation so the convergence is completed deliberately (through spec/review gates) rather than improvised. The work is predominantly **backend API refactor**, with one **frontend identity fix** (item 3, the `xao8` root cause).

## What Changes

### 1. Fix REST `/select` group-member disambiguation (must-fix — likely live bug)

`POST /api/windows/{windowId}/select` → `handleWindowSelect` → `tmux.SelectWindow(@N)` runs a **bare** `select-window -t @N`. The code itself documents (`tmux.go` `SelectWindowInSession`) that a bare window-id target is ambiguous inside a tmux **session group**: group members share window membership but keep independent active-window state, so tmux may set the active window on the wrong member. The relay correctly uses the session-scoped `SelectWindowInSession` (`-t <ephemeral>:@N`); the REST path does not.

Because #198 made tmux the source of truth for the sidebar selection, a misdirected select is a direct cause of the **wrong-window-highlight** symptom.

**Change**: route REST `/select` through a session-scoped target. Resolve the owning (non-ephemeral) session for `@N` (reuse `ResolveWindowSession`), then `select-window -t <session>:@N`. Here the session is *context for disambiguation*, not part of identity — distinct from item 3.

### 2. Extract a single `decodeWindowID` helper (dedupe; prevents #205-class drift)

`parseWindowID` (`api/windows.go`) and `handleRelay` (`api/relay.go`) each independently do percent-decode (`url.PathUnescape`) + `validate.ValidateWindowID`. This block was copy-pasted; bug #205 was exactly the two paths drifting (the relay never decoded `%40`).

**Change**:
- Extract one helper (e.g. `decodeWindowID(r) (string, bool)`) and call it from both `parseWindowID` and `handleRelay`.
- Fix the misleading comment ("chi v5 preserves the encoded form … when RawPath is set") — chi preserves it by default; `RawPath` is only set by net/http when decoded ≠ raw. State the actual behavior.

### 3. Address `xao8` root cause — key window identity purely on `@N` (frontend + backend)

`xao8` (existing backlog item) is the root of the recurring window-sync bug class. After #204 the route `/$server/$session/$window` carries `$window` = the **globally-unique `@N`**, making `$session` redundant in the identity. The frontend still ANDs both:
- `app.tsx` `pendingClickRef = { session, windowId }` and the writeback's `urlMatchesPending` compares **both** `session` and `windowId`. If the SSE snapshot reports the window under a session name that doesn't string-match the URL `$session` (after rename, or cross-session move where `@N` survives but session changed), `urlMatchesPending` goes false, releasing the pending-click suppression early and **bouncing the selection**. `@N` alone would have matched.

**Backend half** — `MoveWindow` (`tmux.go`) is the only window op still positional: it resolves `@N` → current index, then bubbles via adjacent `swap-window` in a loop, re-reading/using the index across multiple separate tmux invocations. This **races concurrent kill/move** on the same session.

**Change**:
- **Frontend**: key click-intent (`pendingClickRef`) and URL-match logic on `@N` alone; stop ANDing `session`. (Whether to drop `$session` from the route shape entirely is an open question — see below.)
- **Backend**: tighten `MoveWindow`'s index-resolution race — resolve the index once and chain the `swap-window` sequence in a single `\;`-chained tmux invocation (same atomic-chaining pattern `CreateWindowWithOptions` already uses), so no other mutation can interleave between swaps.

### 4. Delete dead code `KillPane(paneID)` (de-dup; tightens interface surface)

`tmux.KillPane(paneID)` has a body identical to `KillActivePane(windowID)` (both `kill-pane -t <target>`, both swallow errors) but **zero call sites** — referenced only by its own definition, the `TmuxOps` interface (`router.go`), the `prodTmuxOps` wrapper, and a test mock (`sessions_test.go`). The only pane ID the API produces (`/split`'s `pane_id`) is never sent back to a kill endpoint; `/close-pane` kills via the *window* ID through `KillActivePane`.

**Change**: remove `KillPane` from `tmux.go`, the `TmuxOps` interface, the `prodTmuxOps` wrapper, and the test mock (~4 mechanical spots). Tightens the `TmuxOps` interface surface (constitution §IV — Minimal Surface Area). Once removed, document `KillActivePane`'s silent-success contract as the canonical one.

### 5. Consolidate the three `@`-option setters into one partial-merge endpoint

`POST /windows/{id}/color`, `PUT /windows/{id}/url`, `PUT /windows/{id}/type` are 3 routes but **1 operation shape**: `set-option -w -t @N <@opt> <value>` (or unset). They differ only in which `@`-option and their validation.

**Change**: collapse into one endpoint:

```
POST /api/windows/{windowId}/options   ←  { "options": { "@color": "5", "@rk_url": "...", "@rk_type": null } }
```

- **POST verb (resolved, see item 6 below)**: the endpoint is `POST`, not PATCH/PUT. Merge intent lives in the endpoint contract + docs, not the HTTP verb.
- **Partial-merge semantics (mandatory)**: only keys present in the request are touched; absent keys untouched; explicit `null` value = unset (`set-option -wu`). Full-replace was explicitly rejected.
- Per-key validation preserved (`@color` ∈ 0–15; `@rk_url` non-empty; `@rk_type` empty→unset).
- Backed by the existing chained `set-option` primitive (reuse/extract from `CreateWindowWithOptions`) so the whole merge is one atomic tmux invocation.
- Lets `handleWindowCreate` stop special-casing `@rk_type`/`@rk_url` inline (it can delegate to the same primitive).
- Update the frontend client (`setWindowColor`, `updateWindowUrl`, `updateWindowType`) to call the unified endpoint, and remove the three old routes/handlers.

### 6. Migrate all mutating routes to POST + add constitution principle (resolved from Q11)

**Decision**: POST is the only mutating verb. The "an app needs PUT/PATCH/DELETE" convention is rejected as a house style — fewer verb shapes = fewer ways to get a call wrong, serving the same minimal-surface goal as the rest of this change.

Currently **5 routes use `PUT`**: `windows/{id}/url`, `windows/{id}/type` (both folded into the new POST `/options`), plus `sessions/order`, `settings/theme`, `settings/server-color`. Scope decision (confirmed): **migrate all 5 to POST** so the API is uniformly POST/GET.

**Change**:
- New `/options` endpoint is `POST` (item 5).
- Migrate `PUT /sessions/order` → `POST`, `PUT /settings/theme` → `POST`, `PUT /settings/server-color` → `POST` (handlers + frontend client calls: `setSessionOrder`, `setThemePreference`, `setServerColor`).
- CORS `AllowedMethods` drops `PUT`: `[GET, POST, OPTIONS]`.
- Constitution principle **IX. Uniform HTTP Verb** (POST-only for mutations; CORS `[GET, POST, OPTIONS]`) — **ratified 2026-05-29, version 1.2.0 → 1.3.0** (already applied to `constitution.md` at draft time per user request). This change implements that already-live rule: the 5 PUT→POST migrations bring existing code into conformance, and code review will enforce §IX going forward.

### 7. Drop `$session` from the route shape (resolved from Q8 + Q10)

The route `/$server/$session/$window` carries `$session` redundantly — `@N` is globally unique and the session is **derivable server-side** from `@N` via `ResolveWindowSession` (already how the relay works). Q8 (keep `$session` in URL but ignore it in matching) was a fallback that becomes moot once `$session` is dropped entirely.

**Change**: route shape becomes `/$server/$window` (window = `@N`). Breadcrumbs derive the session name from the active window's snapshot. This fully eliminates the dual-identifier bug class from item 3 (there's no `$session` left to AND-against). Touches: TanStack route definitions, breadcrumbs, deep-link handling, `pendingClickRef`, the URL writeback effect.

> **Note on items 1 vs 7**: REST `/select` still *derives* the owning session server-side for group disambiguation (item 1). The client never sends it. "Session as derived disambiguation context" (backend, item 1) and "session not in client-facing identity" (URL, item 7) are consistent.

### Out of scope (noted, not included)

- **`52jc`** — pre-existing failing e2e test (`sidebar-window-sync.spec.ts`, "kill-then-create at same index"); confirmed failing on the pre-#202 baseline, so not a regression from this chain. Already tracked in backlog; remains a separate fix.
- **`fww2`** — orphan tmux-server reaper extension. Separate backlog item, unrelated to the window-state API surface.

## Affected Memory

- `run-kit/architecture.md`: (modify) — REST `/select` now session-scoped; window identity fully `@N`-keyed end-to-end; `MoveWindow` atomic-chained; option-setter endpoints consolidated.
- `run-kit/ui-patterns.md`: (modify) — frontend window identity keys on `@N` only (drop `session` from click-intent/URL-match); unified window-options client call.

## Impact

**Backend**:
- `app/backend/api/windows.go` — `handleWindowSelect`, `parseWindowID`, new `POST /options` handler, `handleWindowCreate` simplification; remove `color`/`url`/`type` handlers.
- `app/backend/api/relay.go` — use shared `decodeWindowID`.
- `app/backend/api/sessions.go` / settings handlers — migrate `handleSessionOrderPut`, `handlePutTheme`, `handlePutServerColor` from PUT to POST.
- `app/backend/api/router.go` — route changes (add `POST /options`, remove 3 option routes; migrate all 5 PUT routes to POST); CORS `AllowedMethods` → `[GET, POST, OPTIONS]`; `TmuxOps` interface (remove `KillPane`, possibly add a session-scoped select / options-merge method).
- `app/backend/internal/tmux/tmux.go` — `MoveWindow` atomic chaining; remove `KillPane`; session-scoped select helper for REST; options-merge primitive.
- Tests: `windows_test.go`, `relay_test.go`, `tmux_test.go`, `sessions_test.go` (mock), settings/theme tests, plus the `.spec.ts`/`.spec.md` companions for any e2e touching select/options/route shape.

**Frontend**:
- `app/frontend/src/app.tsx` — `pendingClickRef`/writeback key on `@N`; route shape `/$server/$window`; breadcrumbs derive session from snapshot.
- `app/frontend/src/api/client.ts` — unified options call; migrate `setSessionOrder`, `setThemePreference`, `setServerColor` to POST; drop redundant `session` args where applicable.
- TanStack Router route definitions — `/$server/$session/$window` → `/$server/$window`; deep-link handling.

**Constitution touchpoints**:
- §I (Security First — all new/changed tmux calls stay `exec.CommandContext` + argv, no shell)
- §IV (Minimal Surface Area — fewer routes, tighter `TmuxOps`, dropped URL segment)
- **NEW §IX (Uniform HTTP Verb — POST-only for mutations)** — added by this change; version bump 1.2.0 → 1.3.0
- Test Companion Docs (`.spec.md` updates for any `.spec.ts` changes)

## Open Questions

_All intake open questions resolved (2026-05-29):_

- ~~Drop `$session` from the route shape?~~ **Resolved: yes, drop it** (item 7). Session is derivable from `@N` server-side; the heavier route reshape is accepted because it fully eliminates the dual-identifier class.
- ~~Items 1 vs 3 conflict?~~ **Resolved: no conflict.** Backend derives session from `@N` for `/select` disambiguation; client never sends it.
- ~~PATCH vs PUT for `/options`?~~ **Resolved: POST-only** (item 6). All 5 PUT routes migrate to POST; CORS drops PUT; new constitution principle IX records the rule.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Window identity is the stable tmux `@N`; index/`session` are not identity | Established by #204 and `validate.ValidateWindowID` (`^@[0-9]+$`); confirmed across the audit | S:95 R:80 A:95 D:95 |
| 2 | Certain | Verbs (kill/select/split/rename/move) stay as distinct endpoints — NOT collapsed into a dispatcher | Discussed — explicitly rejected: same branch count, weaker §I audit surface, worse discoverability | S:95 R:70 A:90 D:90 |
| 3 | Certain | Option-setter consolidation uses partial-merge, never full-replace | Discussed — full-replace re-introduces the "clears unsent field" bug class; user agreed on partial-merge | S:95 R:60 A:90 D:90 |
| 4 | Confident | REST `/select` should resolve the owning session server-side and target `<session>:@N` | Mirrors the relay's `SelectWindowInSession`; `ResolveWindowSession` already exists; bare target is documented as group-ambiguous | S:80 R:65 A:85 D:80 |
| 5 | Confident | `KillPane(paneID)` is dead and safe to delete | Confirmed zero call sites (grep: only def + interface + wrapper + mock); identical to `KillActivePane` | S:90 R:75 A:90 D:85 |
| 6 | Confident | `MoveWindow` race fixed by resolving index once + single `\;`-chained swap invocation | Reuses the existing atomic-chaining pattern from `CreateWindowWithOptions`; positional reorder is irreducible so index stays a destination | S:75 R:55 A:80 D:70 |
| 7 | Confident | `decodeWindowID` extraction is a pure dedupe with no behavior change | Both call sites already do identical decode+validate; #205 proves drift risk | S:85 R:80 A:90 D:85 |
| 8 | Certain | `$session` dropped from the route shape; identity is `@N` only (supersedes the keep-but-ignore fallback) | Clarified — user confirmed; Q8 was a fallback to Q10 and is moot once `$session` leaves the URL | S:95 R:55 A:80 D:90 |
| 9 | Certain | Change type is `refactor` | Clarified — user confirmed; dominant verb is restructure/consolidate/dedupe | S:95 R:70 A:80 D:90 |
| 10 | Certain | Drop `$session` from the route shape entirely (`/$server/$window`) | Clarified — user confirmed; session is derivable from `@N` server-side, so nothing is lost | S:95 R:55 A:85 D:90 |
| 11 | Certain | POST-only for all mutating endpoints; migrate all 5 PUT routes to POST; record as constitution principle IX | Clarified — user chose POST-only over PATCH/PUT and chose constitution amendment as the rule's home | S:95 R:50 A:90 D:90 |

11 assumptions (7 certain, 4 confident, 0 tentative, 0 unresolved).
