# Plan: Present Viewer Shell for .md and .excalidraw

**Change**: 260908-krov-present-viewer-shell
**Intake**: `intake.md`

## Requirements

### Backend: Extension-Gated Viewer Shell on /present

#### R1: Viewer-shell gating in servePresentFile
`servePresentFile` (`app/backend/api/present.go` — the shared tail of both `/present/` arms) MUST, strictly after `resolvePresentFile` succeeds (containment passed, file open), sniff the **resolved** file's extension — the extension of the symlink-evaluated path (`file.Name()`), not the requested path. For `.md`, `.markdown`, and `.excalidraw` — when the request does not carry `raw=1` — it SHALL respond `200` with `Content-Type: text/html; charset=utf-8` and the viewer-shell HTML instead of the file bytes.

- **GIVEN** a declared present root containing `notes.md`
- **WHEN** `GET /present/{server}/{roothash}/notes.md` (no `raw` param) arrives on either arm
- **THEN** the response is `200 text/html; charset=utf-8` carrying the viewer shell, not the markdown source
- **AND** the same holds for `.markdown` and `.excalidraw`, case-insensitively

#### R2: `?raw=1` escape hatch
A present request carrying `raw=1` MUST serve the file bytes via the existing `http.ServeContent` path — byte-for-byte today's behavior, on both arms, for every extension. `raw` with any other value (or absent) does not trigger the raw form. There is no content negotiation.

- **GIVEN** a presented `notes.md`
- **WHEN** `GET …/notes.md?raw=1` arrives
- **THEN** the response body is the file's exact bytes with the stdlib-derived MIME type
- **AND** `…/notes.html?raw=1` behaves exactly as `…/notes.html` does today

#### R3: Untouched surfaces
Every extension outside the gated set (`.html` included) MUST serve exactly as today. Containment, the index.html directory rule, 404 posture, and the 308 slash-redirects MUST NOT change; the extension sniff runs only after resolution has fully succeeded, so misses/escapes still 404 before any sniff.

- **GIVEN** the existing containment/404 test matrix in `present_test.go`
- **WHEN** the change lands
- **THEN** every pre-existing row passes unmodified
- **AND** a request for a missing `.md` file is a 404, never a shell

#### R4: Shell asset sourcing (production and dev)
The shell HTML MUST ship through dist → embed.FS and use the embedded assets in production. Through the Vite development server, the shell and its modules MUST come from a mutually compatible source graph even after `just build` has populated both dist and the backend embed directory. Existing built assets MUST NOT make the development viewer blank or stale. No new public route or user configuration is required.

- **GIVEN** `just build` has completed and `just dev` or the e2e rig is started
- **WHEN** a markdown or Excalidraw present URL is opened through Vite
- **THEN** it renders successfully from development assets
- **AND** the production binary still renders from its embedded assets with no Vite dependency

### Frontend: Embedded Viewer Entry

#### R5: `viewer` Vite entry, same-origin and offline
A new Vite entry (`app/frontend/viewer.html` + `app/frontend/src/viewer/`) MUST build into `dist/` and ride the existing dist → `embed.FS` copy. Everything the viewer loads MUST be same-origin embedded build output — no CDN, no remote fonts/scripts — so remote hosts and the desktop shell work offline. Format-specific code (mermaid, excalidraw) MUST live in lazy-loaded chunks.

- **GIVEN** `just build` output
- **WHEN** `dist/viewer.html` is inspected
- **THEN** every script/style/font reference is a same-origin relative or root-relative path into the embedded output
- **AND** mermaid/excalidraw code is absent from the eager entry chunk

#### R6: Markdown rendering with lazy mermaid
`.md`/`.markdown` documents MUST render client-side as styled HTML. A ` ```mermaid ` fence MUST render as a diagram in the page, and the mermaid chunk MUST load only when the document actually contains such a fence.

- **GIVEN** a markdown document with headings, lists, a table, and a relative image
- **WHEN** it is presented
- **THEN** the page shows rendered HTML and the image resolves (the shell sits at the document's own URL, so relative `src`/`href` work)
- **AND** a document with no mermaid fence never loads the mermaid chunk; one with a fence renders an SVG diagram

#### R7: Excalidraw rendering via static exportToSvg
`.excalidraw` documents MUST render as a static SVG produced by the Excalidraw `exportToSvg` utility — no editor implementation in the downloaded graph, no interactivity, no write-back. The utility call MUST have an explicit typed boundary and a pinned compatible dependency. All renderer assets, including fonts needed by CJK scenes, MUST remain embedded/same-origin; CDN fallbacks are not an accepted exception to R5. Verify the actual package exports and bundled assets rather than assuming the registry latest tag identifies the best stable release.

- **GIVEN** an `.excalidraw` scene JSON with shapes and text
- **WHEN** it is presented
- **THEN** the page shows a static SVG rendering of the scene
- **AND** no excalidraw editor chrome or canvas interactivity is present

#### R8: Theming and chrome
The viewer MUST theme light/dark via `prefers-color-scheme` only (the iframe cannot see the app's three-mode toggle), be monospace-friendly, and carry minimal chrome — the document is the page.

- **GIVEN** an OS dark preference
- **WHEN** a document is presented
- **THEN** the viewer renders dark without any app-theme plumbing

#### R9: Inline error state
Fetch or parse failures MUST render an inline error state containing a link to the `?raw=1` form — never a blank frame.

- **GIVEN** a presented `.md` whose raw fetch fails or an `.excalidraw` file with invalid JSON
- **WHEN** the viewer boots
- **THEN** an inline error message with a working `?raw=1` link is shown

#### R10: Raw fetch with preserved query
The shell MUST fetch the document at `location.pathname` with the existing query parameters preserved (the legacy arm's `server` identity param and the shared `v` cache-buster) and `raw=1` set. The shell normally decides the format from the URL extension. For a contained symlink whose URL extension differs from its resolved file extension, backend-derived format information MUST take precedence so the correct renderer is selected at the same copyable URL. This resolves the intake's resolved-extension gate versus URL-extension detection ambiguity without a new route or a write path.

- **GIVEN** a legacy-form URL `/present/@7/notes.md?server=dev&v=3`
- **WHEN** the shell fetches its document
- **THEN** it requests `/present/@7/notes.md?server=dev&v=3&raw=1` (order irrelevant), so the legacy arm still resolves its root

### Frontend: Address-Bar Plumbing

#### R11: `raw` hidden plumbing param
`PRESENT_PLUMBING_PARAMS` in `app/frontend/src/lib/web-url.ts` MUST include `raw`, so `displayForm` hides it in the address bar alongside `server` and `v`. No other change to classification, normalization, or the allowlist.

- **GIVEN** the stored address `/present/dev/{hash}/notes.md?raw=1&v=2`
- **WHEN** `displayForm` renders it
- **THEN** it shows `notes.md` — neither `raw` nor `v` surfaces

### Non-Goals

- Write-back / editing of any kind — read-only decided at intake; excalidraw write-back parked as its own change
- Content negotiation (Accept-header) — `?raw=1` is the only raw form
- Additional formats (`.csv`, `.json`, …) — creep resistance; the gated set is exactly `.md`, `.markdown`, `.excalidraw`
- Any change to `.html` serving, routing, containment, or 404 behavior
- Sanitization as a security boundary — `/present` already serves same-origin-scripting `.html`; the tmux socket is the trust boundary

### Design Decisions

#### Viewer shell served at the document's own URL
**Decision**: The extension-gated shell response replaces the file bytes at the content-keyed `/present/{server}/{roothash}/{path}` URL; no `/view?src=` indirection.
**Why**: One copyable, restart-surviving address per document; relative links/images in rendered markdown resolve for free; no new route (Constitution IV).
**Rejected**: A separate viewer route taking the document as a param — breaks relative resolution and doubles the address space.
*Introduced by*: 260908-krov-present-viewer-shell

#### Static exportToSvg over the interactive excalidraw viewer
**Decision**: `.excalidraw` renders to static SVG via the excalidraw utils `exportToSvg` export in a lazy chunk.
**Why**: Read-only scope; the editor bundle is heavy and adds interactivity nobody asked for; upgrade path stays open.
**Rejected**: Full `@excalidraw/excalidraw` editor/viewer embed — weight and scope.
*Introduced by*: 260908-krov-present-viewer-shell

## Tasks

### Phase 1: Setup

- [x] T001 Add viewer dependencies to `app/frontend` (markdown renderer, mermaid, excalidraw utils package); inspect the installed packages' actual export APIs and font assets and record the findings-driven choices in `## Assumptions` <!-- R5 R6 R7 -->
- [x] T002 [P] Add `raw` to `PRESENT_PLUMBING_PARAMS` in `app/frontend/src/lib/web-url.ts` and cover it in `app/frontend/src/lib/web-url.test.ts` <!-- R11 -->

### Phase 2: Core Implementation

- [x] T003 Backend gate in `app/backend/api/present.go`: resolved-extension sniff + `raw=1` check in `servePresentFile`; shell sourcing per R4 (embed → dist → inline dev fallback) <!-- R1 R2 R3 R4 -->
- [x] T004 [P] Viewer shell bootstrap: `app/frontend/viewer.html` + `app/frontend/src/viewer/main.ts` (format detect from URL extension, raw fetch per R10, error state per R9, theming per R8) <!-- R5 R8 R9 R10 -->
- [x] T005 Markdown renderer `app/frontend/src/viewer/markdown.ts` with lazy mermaid on ` ```mermaid ` fences <!-- R6 -->
- [x] T006 Excalidraw renderer `app/frontend/src/viewer/excalidraw.ts` via `exportToSvg` static SVG, same-origin font handling <!-- R7 -->
- [x] T007 Add the `viewer` entry to `app/frontend/vite.config.ts` (`rollupOptions.input`) with format chunks staying lazy <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Go sniff-table tests in `app/backend/api/present_test.go`: extensions (`.md`/`.markdown`/`.excalidraw`/`.html`/`.txt`/uppercase) × raw param × both arms, plus shell-sourcing seams <!-- R1 R2 R3 R4 -->
- [x] T009 Viewer unit tests (`app/frontend/src/viewer/*.test.ts`): format detection, raw-URL construction with preserved query, error state <!-- R9 R10 -->
- [x] T010 Playwright e2e `app/frontend/tests/e2e/present-viewer.spec.ts`: fixture `.md` present URL renders the shell (heading visible, mermaid fence rendered); `?raw=1` returns the markdown source <!-- R6 R7 -->
- [x] T011 Run `just test` (backend + frontend + e2e); fix failures <!-- R4 R5 -->
- [x] T012 Run `just build`; verify the production binary serves the embedded shell for a gated extension and raw bytes for `?raw=1` <!-- R4 R5 -->

### Rework cycle 1: Correct rendering and offline contracts

- [x] T013 Correct shell/asset selection in `app/backend/api/present.go` and `app/frontend/vite.config.ts` so Vite source viewing works after a production build; retain embedded production behavior and test both paths <!-- R4 R5 -->
- [x] T014 Replace the editor-bearing import in `app/frontend/src/viewer/excalidraw.ts` with a typed utility-only path, inspect and pin the actual package version, cover offline/CJK assets, and remove superseded font assets/dependencies; correct assumptions 2 and 6 to accurate final decisions <!-- R5 R7 -->
- [x] T015 Convey resolved format for cross-format symlinks in `app/backend/api/present.go` and `app/frontend/src/viewer/`, add regression coverage, and put title decoding within the error boundary <!-- R1 R9 R10 -->
- [x] T016 Remove unused `hasMermaidFence` from `app/frontend/src/viewer/markdown.ts` and keep Mermaid loading gated on parsed fences; cover any changed behavior without duplicating implementation-only tests <!-- R6 -->
- [x] T017 Verify rework with relevant Go/frontend tests, `just build`, then `just test-e2e tests/e2e/present-viewer.spec.ts`; check offline requests, utility-only built graph, production render/raw behavior, and light/dark at narrow and desktop widths; record results and remaining proven baseline failures in this plan <!-- R1 R4 R5 R6 R7 R8 R9 R10 -->

Rework verification evidence (T017):
- `go test ./...` — all green except the PROVEN pre-existing baseline `rk/cmd/rk TestCodeExecPrintsResultJSON` (installed code-bridge v3.19.0 vs bundled v3.19.30; reproduced on the stashed clean tree by review; diff touches no cmd/rk code). New coverage: `TestPresentDevProxyShellSource` (proxied requests always get the source shell even when the seam errors; direct requests consult embed→dist→inline) and `TestPresentFormatHeader` (11 rows incl. cross-format aliases).
- `npx tsc --noEmit` clean; `pnpm vitest run src/viewer src/lib/web-url.test.ts` — 42 passed (format-header precedence + unrecognized-verdict fallback covered).
- `just build` exit 0; the built lazy excalidraw graph is utility-only (no UIOptions/canvasActions/react strings in `dist/assets/prod-*.js`; the 19MB chunk is the utils bundle's inlined font data, reachable only via two dynamic imports from the eager entry).
- `just test-e2e tests/e2e/present-viewer.spec.ts` — 6/6 passed, run in the POST-BUILD worktree (dist + populated `app/backend/build/frontend`), the exact state that failed 2/4 pre-rework.
- Same spec against the PRODUCTION binary (`dist/rk serve`, `E2E_TMUX_SERVER=rkverify`) — 6/6 passed: embedded-shell markdown+mermaid render, raw=1 source, excalidraw static SVG from the embedded utility chunk, cross-format alias render, light/dark × 375px/1440px, ungated passthrough. Both runs asserted zero foreign-origin requests (offline contract).
- Remaining proven baseline failures: `legacy-scope-sweep.spec.ts` (e2e, reproduced on stashed baseline) and `TestCodeExecPrintsResultJSON` (Go, same). Neither intersects this diff.
- Full `just test` was not re-run this cycle per dispatch instruction (avoid re-running the 12-minute suite to reconfirm known baselines).

## Execution Order

- T001 blocks T005/T006 (package API inspection decides the imports)
- T003 (backend) is independent of T004–T007 (frontend); the two tracks may interleave
- T007 blocks a meaningful `just build` but not unit tests
- T008–T010 follow their implementation tasks; T011 and T012 are the closing gates, in that order

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `GET` for a presented `.md`, `.markdown`, or `.excalidraw` file without `raw=1` returns `200 text/html; charset=utf-8` carrying the viewer shell, on both `/present/` arms
- [x] A-002 R2: `?raw=1` on any present target returns the exact file bytes via `http.ServeContent`, both arms, any extension
- [x] A-003 R3: All pre-existing `present_test.go` rows pass unmodified; other extensions serve as before; misses/escapes still 404 before any sniff
- [x] A-004 R4: Both renderer formats work through Vite before and after `just build`; production serves the embedded viewer with no Vite dependency
- [x] A-005 R5: Every viewer code/font asset stays embedded and same-origin, including CJK scenes, with no CDN fallback; format chunks are lazy
- [x] A-006 R6: A presented markdown document renders headings/lists/tables; relative images resolve; a ` ```mermaid ` fence renders as SVG and no mermaid code loads without one
- [x] A-007 R7: Excalidraw renders static SVG via a typed utility-only import graph, with no editor implementation downloaded
- [x] A-008 R8: Viewer renders correctly under light and dark `prefers-color-scheme` with minimal chrome
- [x] A-009 R9: A failed fetch or unparseable document renders an inline error with a working `?raw=1` link
- [x] A-010 R10: The shell's raw fetch preserves the original query params and adds `raw=1` (legacy `server=` keeps resolving)
- [x] A-011 R11: `displayForm` hides `raw` for present-kind addresses; no other web-url behavior changes

### Behavioral Correctness

- [x] A-012 R2: `?raw=1` output is byte-identical to the pre-change response for the same file (headers included, modtime-driven validators intact)
- [x] A-013 R1: Resolved-extension gating and renderer selection agree for contained cross-format symlinks; raw=1 remains byte-identical

### Scenario Coverage

- [x] A-014 R1: `present_test.go` carries the extensions × raw-param × both-arms sniff table and passes
- [x] A-015 R6: The focused viewer browser spec passes after a production build, including rendered markdown/Mermaid and exact raw source

### Edge Cases & Error Handling

- [x] A-016 R3: A missing `.md` file is a 404 (no shell); a `.md` behind an escaping symlink is a 404
- [x] A-017 R6: A markdown document with no mermaid fence renders without loading the mermaid chunk
- [x] A-018 R9: An `.excalidraw` file containing invalid JSON shows the inline error state, not a blank frame

### Code Quality

- [x] A-019: New behavior is covered by tests at each layer (Go unit, Vitest unit, Playwright e2e where UI-visible)
- [x] A-020: Frontend code uses type narrowing over `as` casts (guards/discriminated unions) — shape guard precedes the one residual library-boundary cast (`excalidraw.ts:27`, noted as nice-to-have)
- [x] A-021: The gated extension set and param name are named constants, not magic strings — backend constants (`presentRawParam`, `presentViewerExtensions`); frontend literals in `format.ts` noted as nice-to-have
- [x] A-022: No duplicated utilities — shell sourcing reuses the `spa.go` embed seams; no reimplemented containment
- [x] A-023: Comments state constraints only — no narration, no change-ID citations in code
- [x] A-024 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [x] A-025 No unnecessary duplication: Existing utilities reused where applicable

### Security

- [x] A-026 R3: The extension sniff runs strictly after symlink-resolved containment succeeds; no shell or file bytes are reachable outside the declared root

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The prior cycle's candidate (`hasMermaidFence`) was removed in T016; the cycle-1 `public/fonts/<Family>/` copies and `EXCALIDRAW_ASSET_PATH` wiring never existed outside this change and are already gone from the diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | markdown-it as the markdown renderer (over marked) | Intake defers the choice to apply; markdown-it's default fence output (`code.language-mermaid`) makes fence interception a DOM pass; easily swapped later | S:55 R:85 A:75 D:70 |
| 2 | Confident | `exportToSvg` comes from the pinned `@excalidraw/utils@0.1.4` (exact pin, `-E`) — the utility-only package: ESM root export, lean dependency set (no React/radix/editor), fully self-contained 19.6MB prod bundle. The registry `latest` dist-tag misleadingly points at `0.1.3-test32`; 0.1.4 is the current stable. Its d.ts references uninstalled sibling type packages, so the call's compile-time contract is a locally declared typed adapter (`ExcalidrawUtils`/`ExcalidrawSceneInput` in `src/viewer/excalidraw.ts`) over the pinned runtime | Cycle-1's "deprecated stub" claim was wrong (no deprecated flag; 0.1.4 exists). The intake's "no editor bundle" is now literal: the built lazy graph contains zero editor code (verified: no UIOptions/canvasActions/react strings in the excalidraw chunk graph); the 19.6MB is font data, loaded only for .excalidraw URLs, and no hard size budget exists in the intake | S:50 R:70 A:60 D:55 → resolved by inspection (rework cycle 1) |
| 3 | Confident | Dev/prod shell topology is signaled by the `X-Rk-Dev-Proxy` header that vite.config.ts's `/present` proxy entry sets: proxied requests always get the inline source shell (booting the viewer from Vite's module graph), non-proxied requests get embed → dist → inline sourcing. Built assets existing in the worktree can no longer blank or stale the dev viewer | Cycle-1 keyed shell sourcing on build-artifact presence, which flips post-`just build` dev rigs to a built shell whose hashed `/assets/*` references die on Vite's SPA fallback (review must-fix, e2e-proven). The header is an explicit topology marker — no version-sentinel coupling, no user configuration (R4) | S:55 R:80 A:75 D:65 |
| 4 | Certain | The raw fetch preserves ALL existing query params (not only `v`) and sets `raw=1` | The legacy arm needs `server=` to resolve its root; preserving the whole query is a strict superset of the intake's `v` mention and cannot break the content-keyed arm | S:70 R:90 A:90 D:85 |
| 5 | Confident | Shell response carries `Cache-Control: no-cache` (mirroring the SPA HTML policy), no ETag ceremony | Presented documents change under a stable URL; the shell is cheap and must not pin stale viewer code | S:50 R:85 A:75 D:70 |
| 6 | Confident | Excalidraw fonts ride the utils bundle itself: 0.1.4 inlines every family — including the CJK Xiaolai unicode-range subsets — as base64 woff2 data URIs, and `exportToSvg` embeds the used fonts into the SVG with zero network fetches. The cycle-1 `public/fonts/<Family>/` copies + `EXCALIDRAW_ASSET_PATH` mechanism are removed as superseded | The intake's offline/all-assets-same-origin constraint admits no CDN fallback; the cycle-1 "CJK scenes fall back to CDN" exception was false. The SVG is inlined into the DOM (not an `<img>`), so page theming applies | S:45 R:75 A:60 D:55 → resolved by inspection (rework cycle 1) |
| 7 | Confident | The backend conveys the resolved format via an `X-Present-Format` response header (read off the shell's raw=1 fetch) rather than a body marker or new route; the client falls back to URL-extension detection when the header is absent (older backend) | The gate keys on the resolved extension, so a contained cross-format symlink (alias.txt → scene.excalidraw) must render with the resolved format at the same copyable URL (R10); a header on the already-fetched raw response adds no route and no second request | S:55 R:80 A:70 D:65 |

7 assumptions (1 certain, 6 confident, 0 tentative).

<!-- Rework cycle 1: orchestrator selected Revise Requirements. The review's treatment of editor code and CDN fallback as nonblocking is superseded by the explicit intake constraints: no editor bundle, all assets same-origin/offline. The final implementation and assumptions must meet those constraints. -->
