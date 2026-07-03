# Intake: Numeric Window URL — Drop the `%40` from Terminal Route URLs

**Change**: 260703-8mpy-numeric-window-url
**Created**: 2026-07-03

## Origin

Conversational session (dispatched promptless via `/fab-proceed`). The user observed that Terminal window page URLs render as e.g. `http://localhost:3500/testServer/%400` — the `$window` path param is the tmux window ID `@0`, and TanStack Router percent-encodes `@` when building hrefs. Two options were discussed:

1. **Drop the `@` entirely** — map the param at the route boundary so the URL is `/testServer/0`. **← chosen**
2. `pathParamsAllowedCharacters: ['@']` on `createRouter` — would render `/testServer/@0`, keeping the `@`. **Rejected** in favor of the cleaner numeric URL.

> Remove the `%40` from terminal window page URLs. Drop the `@` entirely so the URL becomes `/testServer/0`.

Key decisions from the conversation: centralize the mapping in `app/frontend/src/router.tsx` via a params **stringify** (strip the leading `@`) paired with an idempotent **parse** (prepend `@` only if not already present), so old bookmarked `/testServer/%400` deep links still resolve to window `@0` — never `@@0`.

## Why

1. **Pain point**: Every Terminal page URL exposes a percent-encoded artifact (`/testServer/%400` instead of something readable). The `@` in tmux window IDs (`@0`, `@12`) is an internal tmux prefix, not user-meaningful, and its encoded form `%40` makes URLs ugly to read, share, and type.
2. **Consequence of not fixing**: URLs remain the most visible surface of the app's addressing scheme; the `%40` noise persists in the address bar, bookmarks, logs, and every doc/test that quotes a URL.
3. **Why this approach**: tmux window IDs are always `@` + digits, so stripping the `@` for display is a **lossless, bijective** mapping — `@0 ↔ 0`. Centralizing it in the route definition's params mapping means all existing navigation call sites (which pass `window: "@N"` via route params) and all param consumers (which read `params.window` as `@N`) keep working unchanged. The rejected `pathParamsAllowedCharacters` alternative would only trade `%400` for `@0` — still noisy — and is a router-global setting rather than a route-scoped mapping.

## What Changes

### 1. Terminal route param mapping — `app/frontend/src/router.tsx`

The terminal route (currently lines 47–56, path `/$window` under `/$server`) today has only a pass-through parse using the older API:

```ts
const terminalRoute = createRoute({
  getParentRoute: () => serverLayoutRoute,
  // Route is /$server/$window — the window id (@N) is the only identity in the
  // URL. The owning session is derived from the SSE snapshot, not the URL. Old
  // 3-segment /$server/$session/$window URLs are a hard break (no redirect shim).
  path: "/$window",
  parseParams: (params) => ({
    window: params.window,
  }),
});
```

Replace with a paired parse/stringify mapping:

- **stringify**: strip the leading `@` from the `window` param when building hrefs → `navigate({ params: { window: "@0" } })` renders `/testServer/0`.
- **parse**: prepend `@` to the URL segment — **idempotently** (only if not already present) — so `params.window` consumers keep receiving the `@N` form, AND old bookmarked `/testServer/%400` deep links (segment decodes to `@0`) resolve to `@0`, not `@@0`.

Preferred shape — the modern TanStack Router v1 paired form (installed: `@tanstack/react-router ^1.168.22` supports `params: { parse, stringify }`); the file currently uses the older `parseParams` API, so migrate this route to the paired form if straightforward, else use the legacy `parseParams`/`stringifyParams` pair:

```ts
const terminalRoute = createRoute({
  getParentRoute: () => serverLayoutRoute,
  path: "/$window",
  params: {
    // URL segment "0" (or legacy "@0" from an old bookmark) → param "@0"
    parse: (params) => ({
      window: params.window.startsWith("@") ? params.window : `@${params.window}`,
    }),
    // param "@0" → URL segment "0"
    stringify: (params) => ({
      window: params.window.replace(/^@/, ""),
    }),
  },
});
```

Extract the two mapping functions as exported pure helpers (e.g. `windowIdToUrlSegment` / `urlSegmentToWindowId`) so they are unit-testable; exact naming/placement is an apply-time detail.

**Comment updates in the same file**: the route comment (lines 48–51, "the window id (@N) is the only identity in the URL") and the canonical-page-names comment (~line 68, "`/$server/$window` → Terminal (inherited layout — a specific window @N)") must be updated to reflect the numeric-in-URL form: the URL segment is the window ID's numeric part (`@N` sans `@`); the `@N` form is restored by parse and remains the identity everywhere in code.

`boardRoute` (also using `parseParams`, line 61) is untouched — no mapping needed for board names; migrating its API style is out of scope.

### 2. No call-site or consumer changes (verified in session)

All navigation call sites go through route params — `navigate({ to: "/$server/$window", params: { server, window: windowId } })` at `app/frontend/src/app.tsx` (~lines 389, 466, 484, 841, 866, 1140) and `app/frontend/src/components/board/board-page.tsx` (~line 380). With the mapping centralized in router.tsx, none of them change; `params.window` consumers (e.g. `app.tsx:183`) continue to receive the `@N` form via parse.

**Top-bar breadcrumb hrefs need no change** (verified this session): `app/frontend/src/components/top-bar.tsx` (~lines 140–152) builds `href: `/${encodeURIComponent(server)}/${encodeURIComponent(w.windowId)}`` strings, but these are **internal tokens**, not rendered anchors — `BreadcrumbDropdown` items are `<button>`s whose click calls `onNavigate(item.href)`, and `handleDropdownNavigate` (top-bar.tsx ~lines 154–167) decodes the window segment back to `@N` and calls the app-level `onNavigate(windowId)`, which navigates via route params. The tokens never reach the URL bar, and the encode/decode round-trip is self-consistent.

### 3. Backend unaffected (verified in session)

The Go server never parses the SPA page path; API routes decode `{windowId}` via `decodeWindowID` (`app/backend/api/windows.go:109`), and API client calls pass `@N` IDs separately from the page URL (the `%40` matches in `app/frontend/src/api/client.test.ts` are API paths like `/api/windows/%400/rename` — unrelated to the page URL and unchanged).

### 4. E2E assertion updates (mechanical) + `.spec.md` companions

Hard-coded `%40`/encoded-form assertions must switch to the numeric segment form (e.g. `windowId.slice(1)` or a `\d+` pattern):

- `app/frontend/tests/e2e/pr-status-sidebar.spec.ts:54-55` — `BOUND_WINDOW_URL = `/${SERVER}/%401``, `SCRATCH_WINDOW_URL = `/${SERVER}/%402`` → `/1`, `/2` (these are `page.goto` targets; using the new form also exercises the new URLs directly)
- `app/frontend/tests/e2e/multi-server-sidebar.spec.ts:92-94` — comment + `toHaveURL(new RegExp(`/${TMUX_SERVER_B}/%40\\d+(?:$|[/?#])`))` → numeric pattern
- `app/frontend/tests/e2e/sidebar-window-sync.spec.ts:172-174` — the pre-click `not.toContain(`/${encodeURIComponent(target.windowId)}`)` guard must target the new segment form to keep its regression-guard value; `:178-188` and `:245-251` — comments + `toHaveURL(...encodeURIComponent(target.windowId)...)` → numeric form
- `app/frontend/tests/e2e/session-tiles.spec.ts:102-105` — `toHaveURL(...encodeURIComponent(windowId)...)` → numeric form *(discovered during intake verification — not in the original discussion list)*
- `app/frontend/tests/e2e/status-dot-tip.spec.ts:143` — comment only (`/default/%401`)

Per the constitution's **Test Companion Docs** rule, the matching `.spec.md` companions mentioning the URL form must be updated in the same commit: `pr-status-sidebar.spec.md` (lines 34, 38, 50, 54), `multi-server-sidebar.spec.md` (line 52), `sidebar-window-sync.spec.md` (line 20). `status-dot-tip.spec.md` does not mention the encoded form (verified — no `%40` match).

**Old-form deep links in `echo-latency.spec.ts` and `mobile-touch-scroll.spec.ts`** (`page.goto(`${BASE}/${TMUX_SERVER}/${encodeURIComponent(windowId)}`)` — several sites each) are left unchanged: they resolve via the idempotent parse (that is the back-compat contract under test) and assert no URL form, so they double as incidental back-compat coverage.

### 5. Tests for the new mapping

Per `fab/project/code-quality.md` ("New features and bug fixes MUST include tests covering the added/changed behavior"):

- **Unit tests** for the extracted parse/stringify helpers: `@0` → `0` (stringify), `0` → `@0` (parse), and idempotency `@0` → `@0` (parse of an already-prefixed segment — the old-bookmark case, must NOT yield `@@0`).
- **E2E**: the updated assertions in §4 cover the new URL form end-to-end (click-navigation writes `/server/N`); at least one old-form encoded deep link (`/%40N`) must remain exercised and shown to resolve — the pr-status-sidebar `goto` targets may move to the new form, but the echo-latency/mobile-touch-scroll old-form `goto` sites (kept as-is) plus the idempotent-parse unit case cover it.

## Affected Memory

- `run-kit/ui-patterns`: (modify) URL structure / route table documents "The router percent-encodes `@` in the path segment (`@2` → `%402`)" and the `@N`-in-URL identity contract (lines ~13, ~24, ~32); update to the numeric-segment form (`/$server/N` in the address bar, `@N` restored by parse, old `%40N` deep links still resolve).
- `run-kit/architecture`: (modify) line ~19 says "The window segment is the stable tmux window ID (`@N` …), not the mutable window index" — now wrong for the address bar (the segment is the bare numeric part of the ID; `@N` remains the param/API identity, restored by parse). *(Added during review cycle 2 — should-fix: file was outside the original hydrate scope.)*
- `run-kit/tmux-sessions`: (modify) lines ~9 and ~157 describe the URL segment as `@N` ("window = stable `@N`", "leaving `@N` as the only window identity in the URL"); post-change the URL carries `N` and `@N` is the parse-restored param form. *(Added during review cycle 2 — should-fix: file was outside the original hydrate scope.)*

## Impact

- **Frontend only**: `app/frontend/src/router.tsx` (~15 lines — the terminal route params mapping + two comments), possibly a small helpers module + unit test file for the mapping functions.
- **Tests**: 5 e2e `.spec.ts` files (4 with assertion changes, 1 comment-only) + 3 `.spec.md` companions.
- **No backend changes**, no API surface change, no new routes — the same `/$server/$window` route and fixed route set (Constitution IV intact: presentation-only change to how the param is serialized).
- **Compatibility**: old bookmarked `/server/%40N` URLs keep resolving (idempotent parse); newly generated URLs are `/server/N`. tmux window IDs are always `@`+digits, so the mapping is lossless.

## Open Questions

- None — the approach, mechanism, back-compat behavior, and test scope were decided in the originating conversation and verified against the codebase during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop the `@` from the URL entirely (`/testServer/0`), not `pathParamsAllowedCharacters: ['@']` | Discussed — user explicitly chose dropping `@` over the allowed-characters alternative | S:95 R:70 A:95 D:95 |
| 2 | Certain | Centralize the mapping at the route boundary in `router.tsx` (params stringify strips `@`, parse prepends it); zero call-site changes | Discussed — user specified this mechanism; all nav sites verified to go through route params | S:95 R:80 A:90 D:90 |
| 3 | Certain | Parse is idempotent (prepend `@` only if absent) so old `/%40N` bookmarks resolve to `@N`, never `@@N` | Discussed — user mandated back-compat via idempotent parse | S:95 R:85 A:95 D:95 |
| 4 | Confident | Use the modern paired `params: { parse, stringify }` API for the terminal route (installed v1.168.22 supports it), falling back to legacy `parseParams`/`stringifyParams` only if the paired form proves non-straightforward | User stated the modern form is preferred if straightforward; apply verifies coexistence with the file's remaining `parseParams` usage | S:80 R:90 A:70 D:75 |
| 5 | Confident | `boardRoute` keeps its legacy `parseParams` unchanged — scope is the terminal route only | Not discussed; minimal-scope inference — board names need no mapping and API-style migration is unrelated churn | S:60 R:90 A:85 D:70 |
| 6 | Confident | E2E updates rewrite encoded-form assertions to the numeric form (incl. `session-tiles.spec.ts:102-105` and the `not.toContain` guard at `sidebar-window-sync.spec.ts:172-174`, both discovered during intake verification) and update the 3 `.spec.md` companions in the same commit | Constitution Test Companion Docs rule mandates companions; exact pattern shape (`slice(1)` vs `\d+`) is an apply-time detail | S:70 R:90 A:75 D:75 |
| 7 | Confident | Leave old-form `page.goto(...%40N...)` deep links in `echo-latency.spec.ts` / `mobile-touch-scroll.spec.ts` unchanged as incidental back-compat coverage | They assert no URL form and resolve via the idempotent parse; updating them would remove the only e2e exercise of the old-bookmark path | S:55 R:95 A:80 D:70 |
| 8 | Confident | Extract the parse/stringify mapping as exported pure helpers and add unit tests (strip, prepend, idempotency) | code-quality.md mandates tests for changed behavior; helper extraction is the agent-chosen testable shape | S:70 R:90 A:80 D:70 |
| 9 | Certain | Backend untouched — Go never parses the SPA page path; API `{windowId}` decoding (`app/backend/api/windows.go:109`) and API-client `%40` paths are a separate, unchanged surface | Verified in session and re-verified during intake | S:90 R:95 A:95 D:95 |
| 10 | Certain | `top-bar.tsx` breadcrumb `href` strings stay unchanged — they are internal tokens consumed by menu `<button>`s via `handleDropdownNavigate` (decode → `onNavigate(@N)` → route-params navigate), never rendered in the URL bar | Verified this session by reading `top-bar.tsx:137-167` and `breadcrumb-dropdown.tsx:139-152` | S:75 R:90 A:90 D:85 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
