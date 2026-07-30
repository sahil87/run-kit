# Plan: Proxy HTML Rewrite Content-Length Fix

**Change**: 260730-op63-proxy-content-length-fix
**Intake**: `intake.md`

## Requirements

### Backend: Proxy Content-Length Header Sync

#### R1: Content-Length header MUST match the rewritten wire body in every body-replacing branch
In `app/backend/api/proxy.go` `makeModifyResponse`, every branch that replaces `resp.Body` with rewritten bytes MUST set the `Content-Length` header (`resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))`) to the exact byte length of the final wire body, alongside the existing `resp.ContentLength` field update. The header MUST be set unconditionally in all three branches — plain (non-gzip), gzip re-encode success (compressed length), and gzip-fallback (uncompressed length, alongside the existing `Content-Encoding` delete). Early pass-through returns (non-`text/html`, gzip reader creation failure, body read failure) MUST remain untouched.

- **GIVEN** an upstream `text/html` response whose body contains `http://127.0.0.1:{port}` or `//localhost:{port}` literals and carries the original (larger) `Content-Length` header
- **WHEN** `makeModifyResponse(port)` rewrites the body (body shrinks)
- **THEN** `resp.Header.Get("Content-Length")` equals the exact byte length of the final `resp.Body` contents
- **AND** `resp.ContentLength` equals the same value (stale upstream header overwritten)

- **GIVEN** an upstream gzip-encoded `text/html` response containing loopback URL literals
- **WHEN** the rewrite re-compresses the body
- **THEN** `Content-Length` (header and field) equals the *re-compressed* byte length

#### R2: Regression tests assert header == exact final wire-body length
`app/backend/api/proxy_test.go` MUST gain assertions (same package, stdlib `testing`, existing file style) that, after `makeModifyResponse` runs on shrinking HTML, `resp.Header.Get("Content-Length")` and `resp.ContentLength` both equal the byte length of the fully-read final body — for the plain branch and the gzip re-encode branch. A stale-header test MUST start from a response carrying the original upstream `Content-Length` header to prove the fix overwrites it. Gzip-fallback branch coverage is best-effort (branch is practically untriggerable without restructuring — covered by construction review per intake Assumption 4).

- **GIVEN** a `*http.Response` with `Content-Type: text/html`, a body containing a `http://127.0.0.1:NNNN` literal, and the original `Content-Length` header set to the pre-rewrite length
- **WHEN** the test runs `makeModifyResponse(port)` and reads `resp.Body` fully
- **THEN** the test asserts `resp.Header.Get("Content-Length") == strconv.Itoa(len(finalBody))` and `resp.ContentLength == int64(len(finalBody))`

### Non-Goals

- Rollout of live daemons carrying the bug — deployment context, not a task (intake Assumption 5)
- Frontend, route, or API-surface changes — backend-only fix
- Restructuring `makeModifyResponse` to force the gzip-fallback branch in tests — disproportionate for a 3-line fix

## Tasks

### Phase 2: Core Implementation

- [x] T001 Set `resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))` alongside `resp.ContentLength` in all three body-replacing branches of `makeModifyResponse` in `app/backend/api/proxy.go` (plain, gzip re-encode success, gzip-fallback) <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Add/extend regression tests in `app/backend/api/proxy_test.go`: header + field == exact final wire-body length for the plain branch (starting from a response carrying the stale original upstream `Content-Length` header) and the gzip re-encode branch (header == re-compressed length); run `cd app/backend && go test ./api/...` then full `go test ./...` <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: All three body-replacing branches in `makeModifyResponse` set the `Content-Length` header to the final wire-body length alongside `resp.ContentLength`; early pass-through returns are unchanged

### Behavioral Correctness

- [x] A-002 R1: A stale upstream `Content-Length` header (original pre-rewrite length) is overwritten with the rewritten length — header and field agree with the actual body bytes

### Scenario Coverage

- [x] A-003 R2: Tests assert `resp.Header.Get("Content-Length")` and `resp.ContentLength` equal the exact byte length of the fully-read final body for the plain branch (from a stale-header starting response) and the gzip branch (re-compressed length)

### Edge Cases & Error Handling

- [x] A-004 R1: Gzip-fallback branch sets the uncompressed length header next to its existing `Content-Encoding` delete (verified by construction review; branch untriggerable in tests without restructuring)

### Code Quality

- [x] A-005 Pattern consistency: New code follows the existing `makeModifyResponse` branch structure and the test file's existing stdlib-`testing` style
- [x] A-006 No unnecessary duplication: Reuses the already-imported `strconv`; no new helpers or imports beyond what the fix needs
- [x] A-007 Tests cover the changed behavior (code-quality.md: bug fixes MUST include tests covering the changed behavior)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds three header-sync lines to existing branches and makes no existing code redundant. (Noted, not recommended for deletion here: the gzip re-encode-failure fallback at `app/backend/api/proxy.go:104-111` is practically unreachable — `gzip.Writer.Write` into a `bytes.Buffer` cannot fail — but it is correct defensive code and now carries the header fix, so removing it is out of scope for this fix.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `Header.Set` with explicit length in all three branches (not `Del`) | Intake Assumption 3 already decided Set over Del; deterministic across HTTP versions, trivially assertable | S:90 R:85 A:95 D:90 |
| 2 | Confident | Gzip-fallback branch verified by construction review only; plain + gzip branches get full regression tests | Intake Assumption 4: forcing `gz.Write` failure on a `bytes.Buffer` would require restructuring production code — disproportionate | S:75 R:85 A:80 D:70 |

2 assumptions (1 certain, 1 confident, 0 tentative).
