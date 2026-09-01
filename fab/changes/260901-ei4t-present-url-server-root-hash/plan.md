# Plan: Present URLs Re-Keyed on (Server, Root Hash)

**Change**: 260901-ei4t-present-url-server-root-hash
**Intake**: `intake.md`

## Requirements

### Present Route: Content-Keyed Addressing

#### R1: New route form `/present/{server}/{roothash}/{path}`
The `/present` handler SHALL serve a new content-keyed URL form whose first path segment is the tmux server name (promoted from `?server=` — identity, not plumbing), second segment is a root-hash (R3), and remainder is the path relative to the presented root. The `{server}` segment MUST be validated by the existing `validate.ValidateServerName` shape before any subprocess runs (Constitution I). A slash-less directory form MUST 308-redirect to the trailing-slash form with the query preserved (the existing `/proxy/{port}` rule). A `?server=` query param on the new form is ignored; `?v=` passes through as an inert cache-buster.

- **GIVEN** window @70 on server `runKit` presents root `/home/sahil/reports` in some web-tab slot
- **WHEN** a client GETs `/present/runKit/{hash-of-that-root}/report.html`
- **THEN** `report.html` is served from `/home/sahil/reports` via the existing symlink-resolved containment, regardless of which window or slot declares the root

- **GIVEN** the same declaration
- **WHEN** a client GETs `/present/runKit/{hash}` (directory form, no trailing slash)
- **THEN** the handler 308-redirects to `/present/runKit/{hash}/`, which serves the root's `index.html`

#### R2: Derivation-only, server-wide resolution
Resolution of `{roothash}` MUST be pure per-request derivation (Constitution II/X): a new helper in `internal/tmux` (e.g. `ListDeclaredWebRoots(ctx, server)`) SHALL enumerate every root any window on the server currently declares, via ONE `list-windows -a -F` call with the 8 root slots spelled out (`#{@rk_win_web_1_root}` … `#{@rk_win_web_8_root}` — the `webFamilyFormat` fixed-format trick), deduplicated. No registry, no cache, no disk store; a root stops resolving the moment no live window declares it. The enumeration covers `@rk_win_web_<n>_root` only — the retired `@rk_win_present_root` dual-read stays on the legacy arm (R4).

- **GIVEN** no window on server `runKit` declares root R
- **WHEN** a client GETs `/present/runKit/{hash-of-R}/anything`
- **THEN** the response is 404 with no file touched (the declaration check is the anti-scanning property)

- **GIVEN** two windows both declare root R, and one window is killed
- **WHEN** the same URL is requested again
- **THEN** it still serves (presentation-lived, server-wide; dies only with the last presenter)

#### R3: Root hash — compose 12 hex, accept 8–64, fail closed on ambiguity
The root hash SHALL be a prefix of the lowercase hex sha256 of the ABSOLUTE root directory path. Composition (R5) writes a **12-hex** prefix. The route SHALL accept an incoming hash segment matching `^[0-9a-f]{8,64}$` (gated before any tmux call) and match it as a prefix against the sha256 of each declared root; a match MUST be unique — zero matches or more than one matching root both yield 404 (fail-closed). The hash is an identifier, not a secret (unsalted); it MUST never appear in error bodies alongside a root path.

- **GIVEN** a declared root whose sha256 begins `3f9a2c8e1b77`
- **WHEN** `/present/runKit/3f9a2c8e/x.html` is requested (8-hex prefix of the same hash)
- **THEN** it resolves to that root, provided no other declared root shares the prefix
- **AND** if a second declared root also matches the prefix, the response is 404

#### R4: Legacy slot form preserved verbatim (one release)
The existing slot-keyed form `/present/@N/{n}/{path}?server=` (and its n-less variant) SHALL keep working unchanged for one release. The handler branches on the first path segment's `^@[0-9]+$` shape: matching → today's legacy arm byte-for-byte (slot sniff `^[1-8]$`, n-less → slot 1, `?server=` resolution, the slot-1 `@rk_win_present_root` dual-read, 400 on invalid windowId); non-matching → the new arm (R1). Route registration is unchanged — chi cannot distinguish the two forms (`/present/{seg}/*` either way), so the in-handler sniff is the disambiguator, exactly like the existing n-less sniff.

- **GIVEN** a stored pre-change URL `/present/@70/1/report.html?server=runKit`
- **WHEN** it is requested after this change ships
- **THEN** it serves exactly as before (same root read, same containment, same 404 posture)

#### R5: Stored `@rk_win_web_<n>` value adopts the new form
`present.PresentURL` / `Target.URL` SHALL compose the new form for file/dir kinds — `/present/{server}/{roothash}/{name}?v={bust}` (empty `{name}` for directory targets) — dropping the `windowID` and slot parameters from the URL (the root still lands in the slot's `@rk_win_web_<n>_root`). All composition call sites (`api/windows_web.go`, `cmd/rk/present.go`, and any other `PresentURL`/`Target.URL` caller) SHALL be updated; `present.BumpVersion` MUST keep working on the new shape (it keys on the `/present/` path prefix, which is unchanged). Stored form, iframe src, and copyable form thereby become the same string modulo origin and `?v=` — density shifts (`WebRemove`) move the value losslessly with no rewrite arm needed.

- **GIVEN** `rk present ./report.html` runs in a pane of window @70 on server `runKit`
- **WHEN** the add verb composes the slot value
- **THEN** `@rk_win_web_<n>` holds `/present/runKit/{12-hex}/report.html?v={now}` and `@rk_win_web_<n>_root` holds the absolute parent directory

#### R6: Target identity spans both forms; re-present upgrades in place
`webTabURLIdentical`/`presentTargetIdentity` (`internal/tmux/webtabs.go`) SHALL treat a `/present/` URL's identity as its file-path tail (name) with `?v=` excluded — for the new form the (server, roothash) segments are identity inputs; for the legacy form the windowId+name+query-minus-v identity remains — and a stored LEGACY URL and an incoming NEW-form URL for the same target MUST match (cross-form identity: path tail equality, with `WebAdd`'s existing stored-root comparison as the decisive tie-breaker, unchanged). On a cross-form hit, `WebAdd` SHALL REWRITE the stored slot value to the incoming new-form URL (with its fresh `?v=`) instead of `BumpVersion`-ing the legacy value — re-present is the documented upgrade path for old stored URLs. Same-form hits keep today's `BumpVersion` behavior.

- **GIVEN** a window whose slot 2 holds the legacy `/present/@70/2/report.html?server=runKit` with root R
- **WHEN** the same file under root R is presented again
- **THEN** the add is idempotent (returns slot 2, no append) and slot 2's value becomes the new-form URL with a fresh `?v=`

#### R7: Frontend recognizes the new form; display unchanged at rest
`app/frontend/src/lib/web-url.ts` SHALL classify both present forms as kind `present` (`classifyAddress`), and `displayForm`/`webTabTitle` SHALL keep showing the file's basename with ALL plumbing hidden — for the new form the `{server}` and `{roothash}` segments and the `v` param are plumbing; a directory present (empty path tail) SHALL NOT display the raw hash segment (fall back to a sensible label, e.g. the existing empty-basename handling). `toWebAddTarget` passes present-kind addresses through unchanged (both forms).

- **GIVEN** a stored `/present/runKit/3f9a2c8e1b77/report.html?v=123`
- **WHEN** the web tile renders the address bar at rest and the tab strip label
- **THEN** both read `report.html`, exactly as the legacy form displays today

#### R8: Spec and route documentation updated
`docs/specs/ui-state.md` § Web Tabs SHALL be updated where it describes the `/present/{windowId}/{n}/*` handler and the `@rk_win_web_<n>` value form (the relative-URL examples), and the route-registration comments in `api/router.go`/`api/present.go` SHALL describe the two-arm sniff. Memory updates ride hydrate, not apply.

- **GIVEN** the change is applied
- **WHEN** a reader consults `ui-state.md` § Web Tabs
- **THEN** the described present URL shape matches the shipped `(server, roothash)` form, with the legacy form noted as the one-release compat arm

### Non-Goals

- `Web: Copy link` palette affordance / `shareForm(url, origin)` — explicit follow-up
- `?web=<n>` one-shot route intent param — explicit follow-up
- Any durable present registry or link lifetime beyond the last presenter (Constitution II forbids the store)
- Migration sweep for stored legacy URLs — re-present is the upgrade path (R6); the compat arm covers the rest for one release

### Design Decisions

#### Content-keyed present addressing
**Decision**: Key present URLs on (tmux server, sha256-prefix of the absolute root, relative path) — `/present/{server}/{roothash}/{path}` — instead of (window, slot).
**Why**: The artifact's identity is the presented root + relative path; window and slot are presenter plumbing. Slot-keying is a live bug class (verified: `WebRemove` shifts stored URLs verbatim, so a shifted present tab reads the wrong slot's root). Content-keying survives renumber, swap, re-present, and window kill while any presenter remains.
**Rejected**: Stable per-tab ids (breaks the dense indexed family + tick enumeration); path-in-URL (leaks filesystem layout); content hash (breaks re-present-is-refresh); window-scoped hash (dies with the window, presenter still in identity).
*Introduced by*: 260901-ei4t-present-url-server-root-hash

#### Derivation-only resolution, no presented-roots store
**Decision**: Resolve the hash per request by enumerating every window's `@rk_win_web_<n>_root` options in one `list-windows -a -F` call; no maintained list.
**Why**: Constitution II/X — the declared-root set is derivable from tmux; a maintained array would be a second source of truth with a GC hole (windows die outside rk's sight, leaving stale entries servable for the server's lifetime).
**Rejected**: A server-scoped array option of presented paths.
*Introduced by*: 260901-ei4t-present-url-server-root-hash

#### Upgrade-on-re-present, not dual identity forever
**Decision**: A cross-form identity hit in `WebAdd` rewrites the stored legacy value to the new form; the legacy route arm lives exactly one release.
**Why**: Old stored URLs converge to the new form through ordinary use; no sweep, no permanent dual-form parsing burden in identity/display code.
**Rejected**: Carrying both forms indefinitely (permanent parse surface), or a one-shot migration sweep of stored values (external writers can stamp legacy values mid-session, where a sweep cannot see them).
*Introduced by*: 260901-ei4t-present-url-server-root-hash

## Tasks

### Phase 1: Backend primitives

- [x] T001 Add `RootHash(root string) string` to `app/backend/internal/present/present.go` — lowercase-hex sha256 of the absolute root, 12-char prefix (exported const for the length); unit tests in `internal/present` <!-- R3 -->
- [x] T002 Add `ListDeclaredWebRoots(ctx, server string) ([]string, error)` to `app/backend/internal/tmux/webtabs.go` — one `list-windows -a -F` call over the 8 spelled-out root slots (reuse the `webFamilyFormat` construction), deduplicated, empty slots skipped; unit tests with the existing exec seam <!-- R2 -->

### Phase 2: Core implementation

- [x] T003 Re-shape `present.PresentURL` and `Target.URL` in `app/backend/internal/present/present.go` to compose `/present/{server}/{roothash}/{name}?v={bust}` (empty name for dirs; drop the windowID and slot parameters); verify `BumpVersion` on the new shape; update composition call sites `app/backend/api/windows_web.go` and `app/backend/cmd/rk/present.go` (and any other caller found by grep); update `internal/present` tests <!-- R5 -->
- [x] T004 Update `presentTargetIdentity`/`webTabURLIdentical` in `app/backend/internal/tmux/webtabs.go` to recognize both forms with cross-form matching on the path tail (root tie-break unchanged in `WebAdd`); on a cross-form hit, `WebAdd` rewrites the slot to the incoming new-form value instead of `BumpVersion`; unit tests covering legacy↔new idempotency and the rewrite <!-- R6 -->
- [x] T005 Extend `handlePresent` in `app/backend/api/present.go` with the two-arm sniff: first segment `^@[0-9]+$` → today's legacy arm byte-for-byte; otherwise the new arm — `validate.ValidateServerName` gate (400 on shape violation), hash-segment gate `^[0-9a-f]{8,64}$` (400), `ListDeclaredWebRoots` + unique prefix match (0 or >1 matches → 404), then the existing `resolvePresentFile` containment and the trailing-slash 308 redirect; update the `api/router.go` route comments (registration itself unchanged) <!-- R1, R3, R4 -->

### Phase 3: Frontend, tests, integration

- [x] T006 Update `app/frontend/src/lib/web-url.ts` (`classifyAddress`, `displayForm`, `webTabTitle`, `toWebAddTarget`) for the new present shape — basename display with server/hash/v plumbing hidden, dir-form fallback label, present passthrough in `toWebAddTarget`; extend `web-url.test.ts` <!-- R7 -->
- [x] T007 Extend `app/backend/api/present_test.go` with a new-arm table: resolution via a declared root, prefix-length variants, ambiguity → 404, undeclared root → 404, bad server segment → 400, bad hash segment → 400, dir redirect + index.html, containment regression, and a legacy-arm regression row proving R4 verbatim behavior <!-- R1, R2, R3, R4 -->
- [x] T008 Update e2e specs and helpers that stamp or assert present URL shapes — `app/frontend/tests/e2e/web-tabs.spec.ts`, `web-view-lens.spec.ts`, `present-auto-expand.spec.ts`, `web-tile-chrome.spec.ts`, and the `_tmux.ts`/`_web-tile.ts` helpers — to the new-form stored values, keeping (or adding) one legacy-form case that proves the compat arm serves; update intent comments per the constitution's Test Intent rule <!-- R4, R5, R7 -->

### Phase 4: Docs

- [x] T009 Update `docs/specs/ui-state.md` § Web Tabs — the `/present/{windowId}/{n}/*` handler description and the `@rk_win_web_<n>` relative-URL value form — to the `(server, roothash)` shape with the one-release legacy note <!-- R8 -->

## Execution Order

- T001 and T002 are independent ([P] in effect); T003 depends on T001; T004 depends on T003 (incoming new-form URLs); T005 depends on T001+T002; T006–T008 depend on the backend shape being final (T003–T005); T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `/present/{server}/{roothash}/{path}` serves a declared root's file through the existing containment, with the server segment validated before any subprocess and the dir form 308-redirecting to trailing slash
- [x] A-002 R2: Resolution derives the declared-root set per request via one `list-windows -a -F` call; no new state store, no cache; undeclared root → 404
- [x] A-003 R3: Composition writes a 12-hex prefix; the route accepts 8–64 hex and requires a unique prefix match; zero or multiple matches → 404
- [x] A-004 R5: File and dir presents store the new-form URL (with `?v=`) in `@rk_win_web_<n>`, root in `_<n>_root`; `BumpVersion` still refreshes it
- [x] A-005 R7: `web-url.ts` classifies both forms as `present`; display/title show the basename with server/hash/v hidden

### Behavioral Correctness

- [x] A-006 R6: Re-presenting a target stored in the legacy form is idempotent (same slot) and rewrites the slot to the new form with a fresh `?v=`; same-form re-present keeps the `BumpVersion` path
- [x] A-007 R2: A present URL keeps serving after the declaring window is killed while another window declares the same root, and 404s once no window declares it

### Scenario Coverage

- [x] A-008 R4: A stored pre-change `/present/@N/{n}/{path}?server=` URL serves unchanged through the legacy arm (Go test table row + one e2e case)
- [x] A-009 R1: The R1 GIVEN/WHEN/THEN pair (slot-independence and dir redirect) is exercised by `api/present_test.go`

### Edge Cases & Error Handling

- [x] A-010 R3: Malformed server or hash segments are rejected 400 before any tmux call; ambiguous prefixes fail closed 404; error bodies never pair a hash with a root path
- [x] A-011 R1: Containment regression rows (escaping symlink, `..` traversal) still 404 on the new arm — `resolvePresentFile` reused verbatim

### Code Quality

- [x] A-012 Pattern consistency: new code follows the surrounding handler/webtabs idioms (seam vars for tmux reads, table-driven tests, chained `SetWindowOptions`)
- [x] A-013 No unnecessary duplication: the new arm reuses `resolvePresentFile`/`containedIn` and the `webFamilyFormat` construction rather than reimplementing them
- [x] A-014 All subprocess calls use `exec.CommandContext` with timeouts via the existing `internal/tmux` helpers; no shell strings
- [x] A-015 New behavior is covered by tests at every layer touched (Go unit + handler table, frontend unit, e2e)

### Security

- [x] A-016 R1: Path validation precedes subprocess execution on the new arm (Constitution I); the symlink-resolved containment check is unchanged and covered by regression tests

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `handleWindowWebAdd`'s pre-add `webTabFamilyFn` read (`app/backend/api/windows_web.go:104` pre-change) — removed by the change itself: its only consumer was slot composition (`len(fam.Tabs)+1`), which the content-keyed form drops.
- `app/frontend/vite.config.ts:59-62` — the `/present` proxy comment still describes the route as `/present/{windowId}/*` serving from `@rk_win_present_root`; stale doc (the proxy itself stays correct).
- `app/backend/cmd/rk/skill/display.md:82` — the `@rk_win_web_<n>_root` bullet still describes the route as `/present/<windowId>/<n>/...`; stale doc of the re-keyed form.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Hash length: compose 12 hex; route accepts 8–64 hex as a unique prefix (ambiguous → 404) | Resolves intake #14 (deferred): 12 hex = 48 bits over a ≤ dozens-of-roots domain; prefix acceptance keeps session-era 8-hex examples valid; fail-closed per intake #13 <!-- assumed: 12-hex composed / 8–64 accepted prefix match — collision domain is tiny and fail-closed covers the residue --> | S:45 R:80 A:70 D:55 |
| 2 | Confident | Cross-form re-present rewrites the stored slot to the new form (upgrade-on-re-present) instead of BumpVersion-ing the legacy value | Intake says old URLs "keep serving until re-presented" — the rewrite is what makes re-present the upgrade path; root tie-break logic already exists in WebAdd | S:55 R:70 A:75 D:60 |
| 3 | Certain | Route registration unchanged; the two-arm split is an in-handler sniff on the first segment's `^@` shape | chi cannot distinguish `/present/{a}/*` shapes; the existing n-less sniff is the established mechanism for exactly this | S:70 R:90 A:90 D:85 |
| 4 | Confident | New-arm error posture: malformed server/hash segments → 400 (mirrors legacy invalid-windowId), everything else → 404 | Consistent with the handler's existing 400-shape / 404-everything split | S:50 R:85 A:80 D:70 |
| 5 | Certain | `ListDeclaredWebRoots` enumerates `@rk_win_web_<n>_root` only; the retired `@rk_win_present_root` dual-read stays on the legacy arm | Stated in intake § 4 ("rides along on the legacy arm unchanged"); external writers stamp only slot-1 legacy values | S:80 R:75 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative).

### Apply-time additions (graded in-line, folded in)

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 6 | Certain | Identity shapes: legacy form → `l\n<windowId>\n<query-minus-v>\n<path-tail>`; new form → `n\n<server>\n<hash>\n<query-minus-v>\n<path-tail>` — form prefix keeps same-form identity comparison on the full shape; path-tail on the final field drives cross-form matching | Without the form prefix, same-windowId hashes (legacy) and server+hash (new) could squash to one identity; reordering query before path-tail keeps the tail-extraction helper (identityTail) uniform across forms | S:85 R:70 A:80 D:60 |
| 7 | Confident | e2e legacy-compact row lives in web-tabs.spec.ts (one case); web-view-lens.spec.ts and present-auto-expand.spec.ts required no changes (they stamp only `@rk_win_web_1` / `/proxy/…` — never /present/); web-tile-chrome.spec.ts stamps `@rk_win_web_1_root` (the NEW declaration) instead of `@rk_win_present_root` so the new arm resolves | Constitution § Test Integrity + intake § What Changes § 4 (R4 one release) — the legacy arm keeps one test, the spec's role in the matrix is the compat row, and the new spec-case proves the new form renders/serves | S:60 R:75 A:60 D:50 |

7 assumptions (3 certain, 4 confident, 0 tentative).
