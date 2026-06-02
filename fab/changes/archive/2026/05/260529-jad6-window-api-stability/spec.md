# Spec: Window-State API Stability Remediation

**Change**: 260529-jad6-window-api-stability
**Created**: 2026-05-29
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

<!--
  Backend API refactor (predominantly) + one frontend identity fix, consolidating the
  v2.0.3+ stability audit actionables. Seven work items, see intake.md. Requirements use
  RFC 2119 keywords; every requirement has at least one GIVEN/WHEN/THEN scenario.
-->

## Non-Goals

- **Verb consolidation** — `kill`/`select`/`split`/`rename`/`move` stay as distinct endpoints; a generic action-dispatcher was explicitly rejected (weaker per-action validation, fuzzier §I audit surface, worse discoverability). Only the *option setters* (`color`/`url`/`type`) are consolidated, because they share one operation shape.
- **Full-replace `/options` semantics** — the unified options endpoint is partial-merge only. A PUT-style full replace was rejected because it re-introduces the "client clears a field it didn't echo" bug class.
- **`52jc`** — pre-existing failing e2e test (`sidebar-window-sync.spec.ts`, "kill-then-create at same index"); confirmed failing on the pre-#202 baseline, so not a regression from this chain. Tracked separately in the backlog.
- **`fww2`** — orphan tmux-server reaper extension. Separate backlog item, unrelated to the window-state API surface.
- **Index-based positional addressing for `move`** — `MoveWindow` keeps an *index destination* (positional reorder is irreducible). This change only makes the swap sequence atomic; it does not attempt to make reorder ID-addressed end-to-end.
- **Old bookmarked-URL redirect shim** — dropping `$session` from the route is a hard break for URLs of the old `/$server/$session/$window` shape, consistent with the prior `260529-chgz` hard break for index-based URLs (constitution §II — ephemeral URLs, no persistent state). No redirect compatibility layer is added.

---

## Backend: REST Window Selection

### Requirement: Session-scoped REST `/select`

The `POST /api/windows/{windowId}/select` handler (`handleWindowSelect`) SHALL resolve the owning (non-ephemeral) session for `{windowId}` server-side and issue a session-scoped `select-window -t <session>:{windowId}`, MUST NOT issue a bare `select-window -t {windowId}`. The owning session SHALL be resolved via the existing `ResolveWindowSession`, and the scoped select SHALL reuse the existing `SelectWindowInSession`. The session is *disambiguation context derived server-side*; the client MUST NOT send it.

Rationale: a bare window-id target is ambiguous inside a tmux **session group** — group members share window membership but keep independent active-window state, so tmux may activate the window on the wrong member. Since #198 made tmux the source of truth for the sidebar selection, a misdirected select directly causes the wrong-window-highlight symptom.

#### Scenario: Selecting a window in a grouped session

- **GIVEN** a window `@N` belongs to a session that is a member of a tmux session group
- **WHEN** a client issues `POST /api/windows/@N/select`
- **THEN** the backend resolves the owning session `S` for `@N` via `ResolveWindowSession`
- **AND** issues `select-window -t S:@N` (scoped), not a bare `select-window -t @N`
- **AND** returns `200 {"ok":true}`

#### Scenario: Owning session cannot be resolved

- **GIVEN** a window id `@N` that no longer exists on the server
- **WHEN** a client issues `POST /api/windows/@N/select`
- **THEN** the backend surfaces a non-2xx error (the resolve failure), and MUST NOT issue a bare select against the stale id

#### Scenario: Client never supplies the session

- **GIVEN** any select request
- **WHEN** the request body and path are inspected
- **THEN** no session identifier is present in the client-facing contract for `/select` — the session is derived server-side only

---

## Backend: Window ID Decoding

### Requirement: Single `decodeWindowID` helper

Percent-decode (`url.PathUnescape`) followed by `validate.ValidateWindowID` for the `{windowId}` path param SHALL exist in exactly one helper (e.g. `decodeWindowID(r) (string, bool)`) in `api/`. Both `parseWindowID` (`api/windows.go`) and `handleRelay` (`api/relay.go`) MUST obtain their validated window id through this single helper. The duplicated decode+validate blocks MUST be removed.

Behavior MUST be preserved exactly: a malformed or non-decodable id yields a `400` (REST) / `4004`-class rejection (relay) before any tmux call, identical to today.

The misleading comment ("chi v5 preserves the encoded form … when `RawPath` is set") SHALL be corrected to state the actual behavior: chi v5 returns the path param *as it appears in the matched route* — for `@` encoded as `%40`, `URLParam` returns the encoded form, so an explicit `PathUnescape` is required. `RawPath` is set by `net/http` only when the decoded path differs from the raw path; the decode here does not depend on whether the server set `RawPath`.

Rationale: this block was copy-pasted; bug #205 was exactly the two paths drifting (the relay never decoded `%40`). One helper eliminates the drift surface.

#### Scenario: REST path decodes through the shared helper

- **GIVEN** a request to `POST /api/windows/%402/kill`
- **WHEN** `parseWindowID` runs
- **THEN** it calls `decodeWindowID`, which percent-decodes `%402` → `@2` and validates it against `^@[0-9]+$`
- **AND** returns the decoded id `@2` with success

#### Scenario: Relay path decodes through the same helper

- **GIVEN** a WebSocket upgrade request to `/relay/%402`
- **WHEN** `handleRelay` resolves the window id
- **THEN** it calls the same `decodeWindowID` helper, producing the identical decode+validate result the REST path produces
- **AND** a malformed id is rejected before any tmux call (no upgrade)

#### Scenario: Decode failure is rejected before tmux

- **GIVEN** a window id segment that fails `url.PathUnescape` or fails `ValidateWindowID`
- **WHEN** either entry point decodes it
- **THEN** the request is rejected (`400` REST / WS close) and no tmux subprocess is spawned

---

## Backend: Atomic Window Move

### Requirement: `MoveWindow` chains swaps atomically

`MoveWindow(windowID, dstIndex, server)` SHALL resolve the source window's current index from `{windowID}` exactly once, then perform the bubble-swap sequence as a **single `\;`-chained tmux invocation** (the same atomic-chaining pattern `CreateWindowWithOptions` already uses), rather than issuing one separate `swap-window` subprocess per adjacent step. No other tmux mutation SHALL be able to interleave between swaps.

The reorder *semantics* (insert-before, index destination) MUST be preserved — only the execution atomicity changes. The destination remains a positional index; positional reorder is irreducible.

Rationale: the current per-step loop re-reads/uses index state across multiple separate invocations, racing concurrent kill/move on the same session.

#### Scenario: Multi-step reorder runs as one invocation

- **GIVEN** a window `@N` at index 4 in a session with windows at indices 0–5
- **WHEN** a client issues `POST /api/windows/@N/move` with `{"targetIndex": 1}`
- **THEN** the backend resolves `@N`'s current index once
- **AND** issues the full chain of `swap-window` steps in a single tmux invocation (`swap-window ... \; swap-window ... \; ...`)
- **AND** the window lands at the target slot with the same insert-before result as before

#### Scenario: Concurrent mutation cannot interleave mid-reorder

- **GIVEN** a reorder of `@N` requiring multiple adjacent swaps
- **WHEN** another mutation (kill/move) is issued against the same session during the reorder
- **THEN** because the swap chain is one atomic tmux invocation, the concurrent mutation observes either the pre-reorder or post-reorder layout — never a partially-swapped intermediate

#### Scenario: Single-step move still works

- **GIVEN** a window adjacent to its target index (one swap needed)
- **WHEN** the move is issued
- **THEN** the single swap executes in one invocation and returns `200 {"ok":true}`

---

## Backend: Dead Code Removal

### Requirement: Remove `KillPane(paneID)`

`KillPane` SHALL be removed from `internal/tmux/tmux.go`, from the `TmuxOps` interface (`api/router.go`), from the `prodTmuxOps` wrapper (`api/router.go`), and from the test mock (`api/sessions_test.go`). `KillPane` has zero call sites — the only pane id the API produces (`/split`'s `pane_id`) is never sent to a kill endpoint; `/close-pane` kills via the *window* id through `KillActivePane`. Removing it MUST NOT change any endpoint behavior.

After removal, `KillActivePane`'s silent-success contract (errors swallowed because the pane may already be dead) SHALL be documented as the canonical pane-kill contract (the comment MUST NOT reference the now-deleted `KillPane`).

Rationale: tightens the `TmuxOps` interface surface (constitution §IV — Minimal Surface Area) and removes the "which kill do I call?" ambiguity.

#### Scenario: Build succeeds with no `KillPane` references

- **GIVEN** the backend after removal
- **WHEN** `go build` / `go test` compiles the `api` and `internal/tmux` packages
- **THEN** there are zero references to `KillPane` anywhere in the backend
- **AND** the build succeeds

#### Scenario: Pane-kill behavior is unchanged

- **GIVEN** a window with an active pane
- **WHEN** a client issues `POST /api/windows/{windowId}/close-pane`
- **THEN** the pane is killed via `KillActivePane` exactly as before
- **AND** errors remain silently swallowed (pane may already be dead)

---

## Backend: Consolidated Window Options Endpoint

### Requirement: Unified partial-merge `/options` endpoint

A single endpoint `POST /api/windows/{windowId}/options` SHALL replace the three separate option-setter routes (`POST /color`, `PUT /url`, `PUT /type`). Its body shape is:

```
{ "options": { "@color": "5", "@rk_url": "https://…", "@rk_type": null } }
```

Each value in the `options` object is a JSON string (the set value) or JSON `null` (unset). The body decodes to a `map[string]*string` shape: a present key with a string pointer is a set; a present key with `null` is an unset; an absent key is untouched. `@color`'s numeric `0–15` range is validated against the string after parsing it as an integer (a non-numeric `@color` string → `400`), preserving the old handler's effective contract even though the wire value is now a string.
<!-- clarified: value typing — old /color took JSON int, /url & /type took JSON strings; the unified body uses a uniform string|null map (example shows "@color":"5") since one map cannot mix native int and string values. @color is integer-parsed+range-checked server-side. Verified against handleWindowColor (Color *int, 0-15), handleWindowUrlUpdate (URL string), handleWindowTypeUpdate (RkType string) in windows.go. -->

Semantics (partial-merge, mandatory):

- Only keys **present** in the `options` object SHALL be touched; absent keys SHALL be left untouched.
- A present key with a non-null value SHALL set that option (`set-option -w -t {windowId} <key> <value>`).
- A present key with an explicit `null` value SHALL unset that option (`set-option -wu -t {windowId} <key>`).
- The entire merge SHALL execute as **one atomic `\;`-chained tmux invocation**, reusing/extracting the chained-`set-option` primitive that `CreateWindowWithOptions` already uses.

Per-key validation SHALL be preserved from the old handlers. **All keys SHALL be validated before any tmux subprocess is spawned** — if any key fails validation, the endpoint returns `400` and issues zero tmux calls (no partial application), which is what makes the "issues no tmux call" scenarios below well-defined alongside the atomic-merge guarantee.
<!-- clarified: validation ordering — made the validate-all-then-execute order explicit. The "no tmux call" rejection scenarios (out-of-range color, empty url, unknown key) and the single-atomic-invocation guarantee together imply validation must fully precede execution; stated so the implementer cannot validate-and-apply per key. -->

- `@color`: value MUST be a string parseable as an integer in `0–15` (when setting); non-numeric or out-of-range → `400`.
- `@rk_url`: value MUST be non-empty after trim (when setting); empty → `400`.
- `@rk_type`: an empty (`""`) or `null` value means unset (`-wu`); any non-empty string sets the type. No value-format/enum validation is applied to a non-empty `@rk_type` — this preserves the old `handleWindowTypeUpdate` behavior exactly (it set whatever non-empty string it received), so it is intentional, not a missing rule.
<!-- clarified: @rk_type has no set-value validation in the old handler (handleWindowTypeUpdate sets any non-empty RkType verbatim); noted as preserved-by-design so review does not flag it as a dropped validation rule. -->
- An unknown option key (not one of `@color`/`@rk_url`/`@rk_type`) SHALL be rejected with `400` (the endpoint MUST NOT pass arbitrary client-controlled option names to tmux — constitution §I; the allowlist bounds the surface).

The three old routes (`/color`, `/url`, `/type`) and their handlers (`handleWindowColor`, `handleWindowUrlUpdate`, `handleWindowTypeUpdate`) SHALL be removed. `handleWindowCreate` SHALL delegate its inline `@rk_type`/`@rk_url` option-setting to the same chained primitive rather than constructing the options map ad hoc.

The frontend client (`setWindowColor`, `updateWindowUrl`, `updateWindowType`) SHALL be updated to call the unified endpoint; the three old client functions' call sites SHALL route through the new contract.

#### Scenario: Set color only, leave url/type untouched

- **GIVEN** an iframe window `@N` with an existing `@rk_url`
- **WHEN** a client posts `{"options": {"@color": "5"}}` to `/api/windows/@N/options`
- **THEN** `@color` is set to `5` via the chained `set-option` and `@rk_url` is left unchanged
- **AND** the response is `200 {"ok":true}`

#### Scenario: Explicit null unsets a key

- **GIVEN** a window `@N` with `@color` set
- **WHEN** a client posts `{"options": {"@color": null}}`
- **THEN** the backend runs `set-option -wu -t @N @color`
- **AND** `@color` becomes unset (window color cleared)

#### Scenario: Multi-key merge is one atomic invocation

- **GIVEN** a window `@N`
- **WHEN** a client posts `{"options": {"@rk_url": "https://x", "@rk_type": "iframe"}}`
- **THEN** both options are applied in a single `\;`-chained tmux invocation
- **AND** the SSE poll never observes the window with only one of the two options set

#### Scenario: Out-of-range color rejected

- **GIVEN** a request `{"options": {"@color": "99"}}`
- **WHEN** validation runs
- **THEN** the endpoint returns `400` and issues no tmux call

#### Scenario: Empty url rejected

- **GIVEN** a request `{"options": {"@rk_url": ""}}`
- **WHEN** validation runs
- **THEN** the endpoint returns `400` and issues no tmux call

#### Scenario: Unknown option key rejected

- **GIVEN** a request `{"options": {"@evil": "x"}}`
- **WHEN** validation runs
- **THEN** the endpoint returns `400` and the unrecognized key is never passed to tmux

#### Scenario: Old routes are gone

- **GIVEN** the router after this change
- **WHEN** a client issues `POST /api/windows/@N/color`, `PUT /api/windows/@N/url`, or `PUT /api/windows/@N/type`
- **THEN** the route is not registered (the only window-option mutation is `POST /options`)

#### Scenario: Window creation reuses the chained primitive

- **GIVEN** the "New Iframe Window" flow creating a window with `@rk_type=iframe` and an `@rk_url`
- **WHEN** `handleWindowCreate` runs
- **THEN** it sets the window's options via the same chained `set-option` primitive used by `/options`, atomically at creation, with no separate inline option-map construction path

---

## Backend: Uniform POST Verb (Constitution §IX)

### Requirement: All mutating routes use POST

Every mutating API endpoint SHALL use `POST`. No route SHALL use `PUT`, `PATCH`, or `DELETE`. The five routes currently registered with `.Put(` SHALL be migrated to `POST`:

1. `PUT /api/sessions/order` → `POST /api/sessions/order`
2. `PUT /api/windows/{windowId}/url` → folded into `POST /api/windows/{windowId}/options` (removed, not migrated)
3. `PUT /api/windows/{windowId}/type` → folded into `POST /api/windows/{windowId}/options` (removed, not migrated)
4. `PUT /api/settings/theme` → `POST /api/settings/theme`
5. `PUT /api/settings/server-color` → `POST /api/settings/server-color`

The CORS `AllowedMethods` allowlist SHALL be `[GET, POST, OPTIONS]` (drop `PUT`).

The corresponding frontend client functions SHALL switch from `PUT` to `POST`: `setSessionOrder`, `setThemePreference`, `setServerColor` (and the options-related `updateWindowUrl`/`updateWindowType` via the new `/options` contract). Request/response bodies are otherwise unchanged.

This requirement implements constitution principle **§IX (Uniform HTTP Verb)**, already ratified at version 1.3.0 (2026-05-29). The migrations bring existing code into conformance.

#### Scenario: Session order migrates to POST

- **GIVEN** the frontend persisting sidebar session order
- **WHEN** `setSessionOrder(order)` is called
- **THEN** it issues `POST /api/sessions/order` with body `{"order":[...]}`
- **AND** the backend handler accepts it on the POST route and returns `200 {"ok":true}`
- **AND** the SSE `event: session-order` broadcast behavior is unchanged

#### Scenario: Theme preference migrates to POST

- **GIVEN** the theme system persisting a preference
- **WHEN** `setThemePreference(theme)` is called
- **THEN** it issues `POST /api/settings/theme` with body `{"theme":"..."}`
- **AND** the backend returns `{"status":"ok"}` (or `400` on empty theme, as before)

#### Scenario: Server color migrates to POST

- **GIVEN** the server-color setter
- **WHEN** `setServerColor(server, color)` is called
- **THEN** it issues `POST /api/settings/server-color` with body `{"server":"...","color":N}`
- **AND** the backend persists it exactly as the former PUT did

#### Scenario: CORS rejects PUT

- **GIVEN** the running server
- **WHEN** a CORS preflight asks for method `PUT`
- **THEN** `PUT` is not in `AllowedMethods` (`[GET, POST, OPTIONS]`)

#### Scenario: No PUT routes remain

- **GIVEN** the router after this change
- **WHEN** the route table is enumerated
- **THEN** there are zero `.Put(`, `.Patch(`, or `.Delete(` registrations

---

## Frontend: Window Identity Keyed on `@N`

### Requirement: Click-intent and URL-match key on window id alone

The frontend SHALL key window click-intent and URL-match logic on the stable window id `@N` alone and MUST NOT AND the session name into the identity.

- `pendingClickRef` SHALL hold the window id only (drop the `session` field), or its `urlMatchesPending` comparison SHALL compare `windowId` only.
- `urlMatchesPending` SHALL be true when `pending.windowId === <url window id>`, regardless of whether the SSE snapshot reports the window under a session name that string-matches the (now-removed) URL `$session`.

Rationale: today `urlMatchesPending` compares `pending.session === sessionName && pending.windowId === windowParam`. After a rename, or a cross-session move where `@N` survives but the session name changed, the session comparison goes false and releases the pending-click suppression early — bouncing the selection. `@N` alone would have matched.

#### Scenario: Selection survives a session rename

- **GIVEN** a pending click on window `@N` whose owning session is then renamed
- **WHEN** the next SSE snapshot reports `@N` under the new session name
- **THEN** `urlMatchesPending` stays true (it compares `@N` only)
- **AND** the pending-click suppression is NOT released early — the selection does not bounce

#### Scenario: Selection survives a cross-session move

- **GIVEN** a pending click on window `@N` that is moved to a different session (`@N` preserved)
- **WHEN** the SSE snapshot reports `@N` under the new session
- **THEN** `urlMatchesPending` stays true and the click intent holds

#### Scenario: Normal same-session click is unaffected

- **GIVEN** a click on window `@N` in a stable session
- **WHEN** the SSE snapshot confirms `@N` active
- **THEN** `urlMatchesPending` is true and behavior is identical to today

---

## Frontend: Route Shape Drops `$session`

### Requirement: Route is `/$server/$window`

The terminal route SHALL be `/$server/$window` (window = `@N`); the `$session` segment SHALL be removed from the route shape. The session name SHALL be derived server-side / from the active window's SSE snapshot wherever it was previously read from the URL `$session` segment.

Touched surfaces:

- **TanStack Router route definition** (`app/frontend/src/router.tsx`): `path: "/$session/$window"` under the server layout → `path: "/$window"` (yielding `/$server/$window`); `parseParams` drops `session`.
- **`app.tsx`**: every `navigate({ to: "/$server/$session/$window", params: {server, session, window} })` → `navigate({ to: "/$server/$window", params: {server, window} })`. `pendingClickRef` no longer needs `session`. Breadcrumbs derive the session name from the active window's snapshot rather than the URL param. Mount-time alignment and URL-writeback effects compare/write `window` only.
- **Deep-link handling**: a deep link to `/$server/@N` SHALL resolve the owning session server-side (for breadcrumb display) and align tmux to `@N` exactly as the old deep-link path did.
- **Breadcrumbs / dropdowns**: session-name display reads from the SSE-derived active window's session, not the URL.

Old `/$server/$session/$window` URLs are a hard break (no redirect shim — consistent with the prior index-based URL break; constitution §II).

This requirement fully eliminates the dual-identifier bug class from the frontend identity section above — there is no `$session` left to AND against.

> **Doc-lag note (for hydrate, not a spec blocker)**: constitution §IV (Minimal Surface Area) still textually lists the route as `/$session/$window`. After this change the canonical shape is `/$server/$window`. The §IV wording SHALL be reconciled during the hydrate stage; it is not a requirement of this spec to amend the constitution text.
<!-- clarified: noted the known constitution §IV doc-lag (it describes the old "/$session/$window" route) so the hydrate stage reconciles it; flagged as non-blocking per the change's scope. -->


#### Scenario: Deep link resolves session server-side

- **GIVEN** a fresh tab opened at `/$server/@7` (no session segment)
- **WHEN** the route mounts and the first SSE snapshot arrives
- **THEN** the owning session for `@7` is derived from the snapshot for breadcrumb display
- **AND** tmux is aligned to `@7` via the existing mount-time alignment (now comparing window id only)

#### Scenario: URL writeback uses window id only

- **GIVEN** tmux switches the active window to `@9` (external `select-window` or `rk riff`)
- **WHEN** the SSE-derived `activeWindow` changes
- **THEN** the writeback navigates to `/$server/@9` (no session param)
- **AND** all tabs on that server converge on `@9` per multi-client convergence

#### Scenario: Breadcrumb shows the derived session

- **GIVEN** the terminal route `/$server/@N` mounted
- **WHEN** breadcrumbs render
- **THEN** the session name shown comes from `@N`'s active-window snapshot, not from a URL segment

#### Scenario: Old session-bearing URL is a hard break

- **GIVEN** a bookmarked `/$server/oldsession/@N`
- **WHEN** it is opened
- **THEN** it does not match the new `/$server/$window` route (no redirect shim); a not-found / server-dashboard fallback renders, consistent with the documented hard-break policy

---

## Test Companion Docs

### Requirement: `.spec.md` companions updated alongside `.spec.ts`

Any Playwright `*.spec.ts` under `app/frontend/tests/` that is added or modified by this change (e.g. specs covering window select, the route shape, options, or session-rename selection behavior) MUST ship an updated sibling `*.spec.md` in the same commit, per constitution Test Companion Docs. Unit tests (`*_test.go`, `*.test.ts`/`*.test.tsx`) are exempt.

#### Scenario: Route-shape e2e gets a companion update

- **GIVEN** an e2e spec is changed to exercise `/$server/$window`
- **WHEN** the change is committed
- **THEN** the matching `.spec.md` is updated in the same commit documenting what each touched `test()` proves and its steps

---

## Design Decisions

1. **Session as derived disambiguation context (backend) vs. not-in-identity (URL)**: REST `/select` *derives* the owning session server-side for group disambiguation (it must, to pick the right group member), while the URL drops `$session` entirely. These are consistent: the client never sends a session; the backend derives it only where tmux semantics require it.
   - *Why*: group-member active-window state is per-member, so a scoped target is mandatory for correctness; meanwhile `@N` is globally unique so the client-facing identity needs nothing more.
   - *Rejected*: keeping `$session` in the URL "but ignoring it in matching" (intake Q8 fallback) — moot once `$session` is dropped, and it leaves the dual-identifier footgun in the route shape.

2. **`POST /options` with partial-merge, not PUT/PATCH full-replace**: the consolidation collapses three routes into one verb+path, with merge intent in the body contract.
   - *Why*: constitution §IX mandates POST-only; partial-merge avoids the "client clears a field it didn't echo" regression that full-replace caused.
   - *Rejected*: PATCH (violates §IX); full-replace PUT (re-introduces the cleared-field bug class).

3. **Option-key allowlist on `/options`**: the endpoint accepts only `@color`/`@rk_url`/`@rk_type`.
   - *Why*: passing arbitrary client-supplied option names to `tmux set-option` widens the injection/abuse surface (constitution §I); per-key validation also needs the key set to be closed.
   - *Rejected*: passing through any `@`-prefixed key — unvalidated surface, no per-key validation possible.

4. **Atomic chaining for `MoveWindow`, but index destination retained**: only the execution becomes atomic; addressing stays positional.
   - *Why*: positional reorder is irreducible (there is no stable id for "slot 3"); the race is in the multi-invocation loop, which chaining fixes without changing semantics.
   - *Rejected*: an ID-addressed reorder API — no meaningful destination identity exists for a position.

5. **Hard break for old URLs (no redirect shim)**: `/$server/$session/$window` URLs stop resolving.
   - *Why*: matches the precedent set by `260529-chgz` (index→`@N`); URLs are ephemeral bookmarks (constitution §II), and a shim would carry the dual-identifier shape forward.
   - *Rejected*: a redirect layer mapping old shape → new — adds persistent-ish compatibility state for a deliberately ephemeral surface.

## Assumptions

<!-- Spec-stage assumptions. Starting point is intake.md's table; each row notes its
     relationship to the intake. New spec-level assumptions appended. Scores required. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Window identity is the stable tmux `@N`; index/`session` are not identity | Confirmed from intake #1; verified `validate.ValidateWindowID` is `^@[0-9]+$` and the whole window API is `@N`-keyed | S:95 R:80 A:95 D:95 |
| 2 | Certain | Verbs stay distinct endpoints — only option setters consolidate | Confirmed from intake #2; non-goal restated; dispatcher explicitly rejected | S:95 R:70 A:90 D:90 |
| 3 | Certain | `/options` is partial-merge, never full-replace; `null` value unsets | Confirmed from intake #3; matches existing `Set/UnsetWindowOption` semantics | S:95 R:60 A:90 D:90 |
| 4 | Certain | REST `/select` resolves owning session and targets `<session>:@N` via `SelectWindowInSession` | Upgraded from intake Confident #4: the approach is fully determined by existing code — verified `ResolveWindowSession` + `SelectWindowInSession` already exist and the relay already uses the scoped form, so this is a mechanical re-route, not a design choice | S:95 R:65 A:95 D:95 |
| 5 | Certain | `KillPane(paneID)` is dead and safe to delete (4 mechanical spots) | Upgraded from intake Confident #5: verified by grep that the only references are the definition, the `TmuxOps` interface, the `prodTmuxOps` wrapper, and the test mock — zero call sites is a fact, deletion is purely mechanical | S:95 R:80 A:95 D:90 |
| 6 | Confident | `MoveWindow` race fixed by resolving index once + single `\;`-chained swap invocation | Confirmed from intake #6; verified current code loops separate `swap-window` invocations and `CreateWindowWithOptions` already chains with `";"` | S:80 R:60 A:85 D:75 |
| 7 | Certain | `decodeWindowID` extraction is a pure dedupe, no behavior change | Upgraded from intake Confident #7: verified both call sites perform byte-identical `PathUnescape`+`ValidateWindowID`; extracting one helper is a deterministic refactor with provably no behavior change | S:95 R:80 A:95 D:95 |
| 8 | Certain | `$session` dropped from the route shape; identity is `@N` only | Confirmed from intake #8/#10; verified route param is `$window` under server layout in `router.tsx` | S:95 R:55 A:85 D:90 |
| 9 | Certain | Change type is `refactor` | Confirmed from intake #9; dominant verb is restructure/consolidate/dedupe | S:95 R:70 A:80 D:90 |
| 10 | Certain | POST-only for all mutations; migrate the 5 PUT routes; CORS → `[GET, POST, OPTIONS]` | Confirmed from intake #11; verified exactly 5 `.Put(` routes and current CORS includes `PUT`; §IX already ratified at 1.3.0 | S:95 R:55 A:90 D:90 |
| 11 | Confident | `/options` accepts only the allowlisted keys `@color`/`@rk_url`/`@rk_type`; unknown keys → `400` | New (spec-level): bounding the option-name surface is required by §I and to keep per-key validation closed; no signal anyone wants arbitrary option pass-through | S:80 R:65 A:90 D:80 |
| 12 | Confident | `handleWindowCreate` delegates `@rk_type`/`@rk_url` setting to the shared chained primitive (no separate inline path) | New (spec-level): intake item 5 states this; verified `handleWindowCreate` currently builds the opts map inline — extracting the primitive removes the duplicate construction | S:80 R:75 A:85 D:80 |
| 13 | Confident | Frontend session-name display derives from the active window's SSE snapshot once `$session` leaves the URL | New (spec-level): the breadcrumb/dropdown previously read the URL `$session`; the snapshot already carries session names, so derivation is available | S:80 R:60 A:80 D:75 |
| 14 | Confident | `/options` body is a uniform `{string\|null}` map; `@color` is integer-parsed+range-checked from its string value; all keys validate before any tmux call | Clarified (spec-level): one heterogeneous map can't mix native JSON int and string, and the body example already shows `"@color":"5"`; old handlers (`Color *int`, `URL string`, `RkType string`) are preserved in effect. Validate-all-then-execute is implied by the no-tmux-call rejection scenarios + atomic-merge guarantee | S:85 R:65 A:90 D:80 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
