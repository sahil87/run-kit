# Intake: Proxy HTML Rewrite Content-Length Fix

**Change**: 260730-op63-proxy-content-length-fix
**Created**: 2026-07-30

## Origin

Backlog item `[op63]` (2026-07-30), invoked via `/fab-new op63` (one-shot):

> fix /proxy blank-iframe bug: api/proxy.go makeModifyResponse rewrites //localhost:{port} and //127.0.0.1:{port} in proxied text/html (body shrinks) but only sets resp.ContentLength, never the Content-Length HEADER that httputil.ReverseProxy copies to the client -> browser aborts with ERR_CONTENT_LENGTH_MISMATCH and the iframe renders blank; plain curl -w %{http_code} shows 200 so it masks the bug (only a full-body read / exit-18 exposes it). Fix: set or delete the Content-Length header alongside the field in ALL branches of makeModifyResponse (plain, gzip re-encode, gzip-fallback); add regression test asserting header == rewritten body length for HTML containing a http://127.0.0.1:NNNN literal. Live daemons carry the bug until updated (found on v3.12.6, 2026-07-30)

The bug was verified against the current source before this intake was written — the code matches the backlog description exactly.

## Why

1. **Problem**: Iframe proxy windows (`/proxy/{port}/*`, the web-view lens for local dev servers) render **blank** whenever the proxied HTML contains `localhost:{port}` / `127.0.0.1:{port}` literals that the rewrite shrinks. `makeModifyResponse` in `app/backend/api/proxy.go` replaces those literals with shorter `/proxy/{port}` paths and updates `resp.ContentLength` (the struct field), but never touches `resp.Header["Content-Length"]`. `httputil.ReverseProxy` copies the *header map* verbatim to the client, so the client receives the original (larger) `Content-Length` with a shorter body. Browsers abort the response with `ERR_CONTENT_LENGTH_MISMATCH` and the iframe stays blank.

2. **Consequence if unfixed**: the entire iframe/web-view display path — including the Visual Display Recipe agents use to show HTML to users — silently fails for any page whose HTML embeds loopback URL literals. The failure is diagnostically nasty: `curl -w %{http_code}` reports 200 (headers arrive fine; only a full body read hits the truncation, surfacing as curl exit 18), so smoke checks pass while browsers show nothing.

3. **Why this approach**: the root cause is precisely a stale header, so the fix is at the source — keep the header in sync with the rewritten body in **all** branches that replace the body. Alternatives like disabling rewriting or switching to chunked-only responses would change proxy semantics far more than the bug warrants.

## What Changes

### `app/backend/api/proxy.go` — sync the `Content-Length` header in `makeModifyResponse`

Three branches replace `resp.Body` with the rewritten bytes and set `resp.ContentLength`; each must also set the header to the same value:

1. **Plain (non-gzip) branch** (currently lines 116–119): body is rewritten uncompressed → `Content-Length` = `len(rewritten)`.
2. **Gzip re-encode success branch** (currently lines 112–115): `rewritten` is reassigned to the re-compressed bytes (`buf.Bytes()`) before the body swap → `Content-Length` = compressed length.
3. **Gzip-fallback branch** (currently lines 105–111, on `gz.Write` error): falls back to uncompressed rewritten bytes and already does `resp.Header.Del("Content-Encoding")` → `Content-Length` = uncompressed `len(rewritten)`.

Concrete shape (identical in each branch, after `rewritten` holds the final wire bytes):

```go
resp.Body = io.NopCloser(bytes.NewReader(rewritten))
resp.ContentLength = int64(len(rewritten))
resp.Header.Set("Content-Length", strconv.Itoa(len(rewritten)))
```

Notes:
- **Set, not Del**: the backlog allows "set or delete"; setting is chosen — it is deterministic (no reliance on the HTTP server falling back to chunked encoding) and keeps behavior identical across HTTP versions. `strconv` is already imported.
- The header is set **unconditionally** in all three branches (not only when the body shrank) — correctness of `header == body length` is unconditional, and it also repairs upstream responses that arrived with no `Content-Length` at all (chunked upstream).
- The early pass-through returns (`non-text/html`, gzip reader creation failure, body read failure) do not modify the body and therefore stay untouched.

### `app/backend/api/proxy_test.go` — regression tests

Extend the existing table/cases (same package, Go stdlib `testing`, matching the file's current style) to assert, for **each of the three branches**, that after `makeModifyResponse` runs on HTML containing a `http://127.0.0.1:NNNN` literal (so the body shrinks):

- `resp.Header.Get("Content-Length")` equals the exact byte length of the final wire body (read `resp.Body` fully and compare against `len`), and
- `resp.ContentLength` equals the same value.

Branch coverage: plain HTML, gzip round-trip (header must equal the *re-compressed* length), and the gzip-fallback path if practically forceable — if the fallback (`gz.Write` error on an in-memory `bytes.Buffer`) cannot be triggered without restructuring, cover it by construction review and test the two reachable branches (see Assumptions #4). The existing tests (`TestModifyResponseHTMLRewrite`, `TestModifyResponseGzipHTML`) can gain the header assertions; a stale-header-specific test should start from a `resp` that carries the **original** `Content-Length` header (as a real upstream response would) to prove the fix overwrites it.

## Affected Memory

- `run-kit/architecture`: (modify) — the `/proxy/{port}/*` endpoint row (§ API surface) and the path-based-reverse-proxy Design Decision describe `ModifyResponse` HTML rewriting; add the Content-Length header-sync discipline (header + field updated together in every body-replacing branch).

## Impact

- **Code**: `app/backend/api/proxy.go` (one function, three branches — a few lines), `app/backend/api/proxy_test.go` (assertions/cases). Backend only; no frontend, no API-surface, no route changes.
- **Behavior**: proxied HTML responses now carry an accurate `Content-Length`; browsers stop aborting; iframe web-view windows render. Non-HTML and pass-through paths unchanged.
- **Deployment**: live daemons carry the bug until updated (observed on v3.12.6) — fix lands in the next release; no migration or config change. Rollout itself is out of scope for this change.
- **Tests**: `go test ./...` in `app/backend` (via `just test-backend`).

## Open Questions

- None — the backlog entry specifies the defect, the fix locus, and the regression-test contract; the source read confirms all of it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = update the `Content-Length` header alongside `resp.ContentLength` in all three body-replacing branches of `makeModifyResponse` | Backlog prescribes exactly this; source read confirms the three branches and the missing header write | S:95 R:90 A:95 D:90 |
| 2 | Certain | Tests extend `app/backend/api/proxy_test.go` (same package, stdlib `testing`, existing style) | code-quality.md test strategy + the file already exists with the relevant test functions | S:85 R:95 A:100 D:95 |
| 3 | Confident | `Header.Set` (explicit length) over `Header.Del` (chunked fallback) | Backlog allows either ("set or delete"); Set is deterministic across HTTP versions and trivially assertable in tests | S:75 R:85 A:80 D:65 |
| 4 | Confident | Gzip-fallback branch gets the same header line but its test coverage is best-effort (branch is hard to trigger: `gz.Write` to a `bytes.Buffer` practically never fails); the two reachable branches get full regression tests | Forcing the fallback would require restructuring production code for testability — disproportionate for a 3-line fix | S:70 R:85 A:80 D:70 |
| 5 | Certain | Live-daemon rollout ("daemons carry the bug until updated") is deployment context, not a task in this change | Backlog states it as an observation; run-kit releases ship via the normal build/brew pipeline | S:70 R:90 A:85 D:80 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
