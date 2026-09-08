# Plan: Address Bar Defaults Path Input to Present Targets

**Change**: 260908-ewud-address-bar-path-targets
**Intake**: `intake.md`

## Requirements

### Frontend: Address-input decision ladder (`lib/web-url.ts`)

#### R1: Submit routing ladder
`lib/web-url.ts` SHALL export a pure submit router (new function `routeAddressSubmit(input: string)`)
returning a discriminated union with three arms — `{ kind: "write", url }` (today's slot-write/draft
lanes), `{ kind: "add", target, fallback? }` (the new backend path/port lanes; `fallback` carries the
`https://…` form for the dotted-single-segment lane), and `{ kind: "reject" }` — evaluating lanes in
this order:

1. Absolute `http(s)` URL with a host, or root-relative path (single leading `/`) → `write` with the
   input passed through (today's behavior, unchanged).
2. Bare loopback `localhost:{port}[{path}]` / `127.0.0.1:{port}` / `[::1]:{port}` → `write` with the
   `/proxy/{port}…` form (today's `normalizeAddressInput` mapping, unchanged). Additionally, bare
   `:NNNN` (colon + digits only) → `add` with the raw input as target (a backend port target).
3. Input containing `/` (and not scheme-bearing `scheme://`, not root-relative) or leading `./` →
   `add` with the raw input as target (a backend path target; no frontend rewriting).
4. Single segment matching today's bare-domain shape (`README.md`, `example.com`, `example.com:8080`;
   no `/`) → `add` with the raw input as target AND `fallback: "https://{input}"`.
5. Everything else (bare words, explicit non-http(s) schemes — with or without `//`, e.g. `ftp://x`,
   `file:/etc/passwd`, `mailto:user/docs` — scheme-relative `//`, empty) → `reject`. The one
   colon-bearing shape that is NOT scheme-rejected is colon-then-digits (the `example.com:8080`
   domain:port form, lane 4). At the COMPONENT level, blank Enter is a silent no-op (no POST, no
   inline error — today's behavior preserved); the router's `reject` for empty input is a
   unit-level contract only.

- **GIVEN** the input `docs/wiki/foo.html` **WHEN** routed **THEN** the result is
  `{ kind: "add", target: "docs/wiki/foo.html" }` with no fallback.
- **GIVEN** the input `README.md` **WHEN** routed **THEN** the result is
  `{ kind: "add", target: "README.md", fallback: "https://README.md" }`.
- **GIVEN** the input `:3000` **WHEN** routed **THEN** the result is `{ kind: "add", target: ":3000" }`.
- **GIVEN** the inputs `https://example.com`, `/present/srv/abc123def0/x.html`, `localhost:3000/docs`
  **WHEN** routed **THEN** each yields the exact `write` value today's
  `normalizeAddressInput` + `isAllowedUrl` pipeline produces.
- **GIVEN** the inputs `ftp://x`, `//host/x`, `foo`, `mailto:a@b.com`, `""` **WHEN** routed **THEN**
  each yields `reject` (today's inline-reject set, unchanged).

`normalizeAddressInput` and `isAllowedUrl` keep their existing exported contracts (other callers and
the backend-mirror role are untouched); the router MAY compose them internally.

### Frontend: Address-bar submit routing (`components/iframe-window.tsx`)

#### R2: Path lanes submit through the add verb (append-or-focus)
`handleSubmit` SHALL branch on the router result. `write` keeps today's flow verbatim (selected draft
→ materialize via `onAddTab`; else slot write via `onWriteUrl` with the same-URL no-op). `add` SHALL
submit through `onAddTab(target)` — with a selected draft, through the existing draft-materialize
path; without one, as an append-or-focus: on success select the returned index via `onSelectTab`,
leave edit mode, and never write the active slot (`onWriteUrl` MUST NOT be called for `add`-lane
input).

- **GIVEN** a window with one web tab and no draft **WHEN** `docs/foo.html` is submitted and the
  backend resolves it **THEN** a present tab for it is appended (or the existing tab for the same
  target is focused via the add verb's idempotent `{ index, existed }`) and the current tab's stored
  address is unchanged.
- **GIVEN** the same submit repeated **WHEN** the add verb returns `existed: true` **THEN** the
  existing tab is selected and no duplicate appears.

#### R3: Backend 400 surfaces inline; dotted-single lane falls back to `https://`
An `add`-lane rejection SHALL surface the server's error text (the `ApiError` message —
`addWebTab` already rejects with the response body's `error` verbatim) in the address bar's existing
`role="alert"` inline error slot, keeping the input editable for retry. When the route carries a
`fallback` and the rejection is an `ApiError` with `status === 400` (target does not exist), the
submit SHALL NOT show an error and instead re-route the `fallback` URL through the `write` flow
(draft → materialize, else slot write) — the `README.md`-exists-vs-not fork.

- **GIVEN** `docs/nope.md` submitted (no such file) **WHEN** the backend answers 400
  `target "docs/nope.md" does not exist` **THEN** that text renders in the inline error slot and no
  tab is added.
- **GIVEN** `example.com` submitted (no such file) **WHEN** the backend answers 400 **THEN** the
  submit retries as `https://example.com` through today's write flow with no visible error.
- **GIVEN** `README.md` submitted where the file exists under the window's worktree **THEN** a
  present tab appears and no `https://readme.md` external tab is created.

### Non-Goals

- Backend changes of any kind — `handleWindowWebAdd`, `present.ParseTargetWithOrigins`, `/present`
  routing, and containment are untouched (intake assumption 1).
- `classifyAddress`, `displayForm`, `webTabTitle`, `toProxySrc`, stored slot values: untouched.
- Preferring `@rk_win_code_root` over pane cwd as resolution base — parked per intake.
- Bare `example.com/path` (slash-bearing, no scheme) keeping its old `https://` rewrite — intake
  assumption 3 makes slash-bearing input always a path; a scheme-bearing URL is the unambiguous form.

### Design Decisions

#### New router function over widening `normalizeAddressInput`
**Decision**: Add `routeAddressSubmit` as a new pure export; `normalizeAddressInput`/`isAllowedUrl`
keep their current contracts.
**Why**: The new lanes need a three-way outcome (write/add/reject) plus a fallback payload — a shape
change, not a normalization tweak; existing callers of the two current helpers stay valid.
**Rejected**: Returning sentinel strings from `normalizeAddressInput` — stringly-typed, and the
submit handler would still need a second classification pass.
*Introduced by*: 260908-ewud-address-bar-path-targets

#### 400-status check, not message matching, for the domain fallback
**Decision**: The dotted-single-segment fallback fires on `ApiError.status === 400`; every other
rejection (409 family cap, network) surfaces inline.
**Why**: `throwOnError` already throws `ApiError` carrying the HTTP status; the add verb's 400 for a
stat-decided target means "does not exist". Matching response text would be brittle against wording
changes.
**Rejected**: Substring-matching `does not exist` in the error message.
*Introduced by*: 260908-ewud-address-bar-path-targets

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `routeAddressSubmit` (discriminated union `AddressSubmitRoute`) to
  `app/frontend/src/lib/web-url.ts` implementing the five-lane ladder (R1), composing the existing
  `parseHttpUrl`/loopback/bare-domain machinery; export the type and function. <!-- R1 -->
- [x] T002 Unit tests in `app/frontend/src/lib/web-url.test.ts`: every lane of R1 (path, `./`, dotted
  single segment with fallback, `:NNNN`), the reject set (`ftp://x`, `//x`, bare word, `mailto:`,
  empty), and regression rows asserting today's passing inputs (absolute http(s), root-relative
  `/present/…` and `/proxy/…`, bare loopback `host:port`, bare-domain→https equivalence via the lane-4
  fallback) produce unchanged outcomes. <!-- R1 -->
- [x] T003 Rewire `handleSubmit` in `app/frontend/src/components/iframe-window.tsx` to branch on
  `routeAddressSubmit`: `write` keeps today's flow; `add` submits via `onAddTab` (draft-materialize
  when a draft is selected, else append-or-focus with `onSelectTab` on success); rejection surfaces
  `ApiError` text in the existing `submitError` slot; a 400 on a `fallback`-bearing route re-routes
  the https form through the write flow (import `ApiError` from `@/api/client`). <!-- R2, R3 -->

### Phase 2: Integration & Edge Cases

- [x] T004 e2e rows in `app/frontend/tests/e2e/web-tabs.spec.ts` (real-tmux rig, existing `_tmux.ts`
  helpers): paste a repo-relative path into the address bar → a present tab appears; paste the same
  path again → the existing tab focuses (no duplicate); paste a nonexistent path → the backend's
  error text renders in the inline `role="alert"` slot. Carry Proves/Steps intent comments per the
  constitution. <!-- R2, R3 -->
- [x] T005 Verification gates scoped to the change: `cd app/frontend && npx tsc --noEmit`, the
  `web-url` unit suite, and the touched e2e spec via `just pw test web-tabs`. <!-- R1, R2, R3 -->
- [x] T006 Rework (review cycle 1): broaden the lane-5 scheme guard in
  `app/frontend/src/lib/web-url.ts` to reject `scheme:` forms without `//` (`file:/etc/passwd`,
  `mailto:user/docs`; colon-then-digit domain:port exempt) with unit rows; add component tests in
  `app/frontend/src/components/iframe-window.test.tsx` covering the path-add success, the
  `README.md` exists/not-exists fork (`ApiError` 400 → https write, no error), the inline 400 error,
  and the blank-Enter silent no-op (re-exporting the real `ApiError` through the client mock);
  refresh the stale `onWriteUrl`/`onAddTab`/edit-mode comments. <!-- R1, R3 --> <!-- rework: cycle-1 must-fix — scheme-guard hole, missing fork coverage; A-007 reworded to today's silent blank-Enter no-op -->
- [x] T007 Rework (review cycle 2): narrow the scheme-guard exemption in
  `app/frontend/src/lib/web-url.ts` — a colon-bearing input is exempt from the scheme reject ONLY
  when the whole input matches the bare-domain `host.tld:port[/path]` shape (`BARE_DOMAIN_RE`);
  digit-leading scheme payloads (`file:1/etc/passwd`, `mailto:123/docs`, `ftp:21/folder`) reject.
  Regression rows added in `web-url.test.ts`. <!-- R1 --> <!-- rework: cycle-2 must-fix — colon-digit exemption leaked digit-leading schemes into the path lane -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `routeAddressSubmit` exists in `lib/web-url.ts`, returns the three-arm union, and
  every R1 lane (including `:NNNN` and the dotted-single fallback payload) is unit-covered.
- [x] A-002 R2: Path-shaped submits POST through the add verb only — no `onWriteUrl` call and no
  in-place navigation for `add`-lane input; success selects the returned index.

### Behavioral Correctness

- [x] A-003 R1: Regression rows prove scheme-bearing URLs, root-relative paths, and bare loopback
  `host:port` route exactly as today (same normalized values, same accept/reject verdicts).
- [x] A-004 R3: A backend 400 body renders verbatim in the address bar's inline error; a
  `fallback`-bearing 400 silently retries as `https://…` through the write flow.

### Scenario Coverage

- [x] A-005 R2: e2e proves paste-path→present-tab and re-paste→focus (idempotent, no duplicate) on
  the real-tmux rig.
- [x] A-006 R3: The `README.md` fork is covered — exists → present tab (e2e or unit at the routing
  seam), not-exists → https fallback (unit) — so pasted `README.md` never lands on Moldova.

### Edge Cases & Error Handling

- [x] A-007 R1: Reject set unchanged or tightened — bare words, non-http(s) schemes (with or
  without `//`), and scheme-relative `//` reject inline with no POST; blank Enter is a silent
  no-op (no POST, no inline error), matching today's behavior.

### Code Quality

- [x] A-008 Pattern consistency: the router follows `web-url.ts`'s pure/DOM-free/never-throws module
  contract with colocated tests; component changes follow existing submit-handler idioms.
- [x] A-009 No unnecessary duplication: the ladder composes the existing loopback/bare-domain
  regexes and `isAllowedUrl` rather than re-implementing them; type narrowing (discriminated union,
  `instanceof ApiError`) over `as` casts.
- [x] A-010 New behavior carries tests (unit ladder rows + e2e), per code-quality.md.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New `routeAddressSubmit` export (three-arm union) instead of widening `normalizeAddressInput` | The new lanes need write/add/reject + a fallback payload; existing helper contracts stay intact for other callers | S:70 R:90 A:85 D:75 |
| 2 | Confident | Domain fallback fires on `ApiError.status === 400`, not message text | Client already throws status-bearing `ApiError`; the add verb's 400 for a stat-decided target means does-not-exist; text-matching is brittle | S:65 R:85 A:85 D:75 |
| 3 | Confident | Non-draft path-add success selects the returned index and exits edit mode (mirrors draft materialization UX) | Append-or-focus semantics from the intake; the materialize path already establishes the blur/select idiom | S:70 R:90 A:85 D:80 |
| 4 | Confident | e2e rows extend `web-tabs.spec.ts` rather than a new spec file | The spec already seeds real tmux web-tab families and owns the strip/add-verb surface | S:60 R:95 A:85 D:75 |
| 5 | Confident | Bare `:NNNN` matches colon+digits exactly (no trailing path) | Intake wording is "colon+digits"; the CLI's `:port` form carries no path | S:60 R:90 A:80 D:80 |

5 assumptions (0 certain, 5 confident, 0 tentative).
