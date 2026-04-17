# Tasks: Inline Output Peek and Live Activity Previews

**Change**: 260405-7l79-inline-output-peek-live-previews
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] T{NNN} [{markers}] {description with file paths}

  Markers:
    [P] — Parallelizable (different files, no dependencies on other [P] tasks in same phase)

  Grouping philosophy: related edits within one natural unit stay in one task
  (e.g., add helper + its test in the same file). Phases execute sequentially;
  within a phase, [P] tasks can run concurrently.
-->

## Phase 1: Setup & Scaffolding

<!-- Type additions, interface updates, mock plumbing. No behavior yet. -->

- [x] T001 Add `LastLine string \`json:"lastLine,omitempty"\`` field to `tmux.WindowInfo` struct in `app/backend/internal/tmux/tmux.go` (no parsing change — field populated later during enrichment). Run `go build ./...` to confirm compile.

- [x] T002 Add `CapturePaneByWindow(ctx context.Context, session string, windowIndex int, lines int, server string) (string, error)` to the `TmuxOps` interface in `app/backend/api/router.go` and implement it as a pass-through on `prodTmuxOps` (the real impl lands in T005; this task adds interface + stub wired to the tmux package function signature).

- [x] T003 Update `mockTmuxOps` in `app/backend/api/sessions_test.go` to implement `CapturePaneByWindow` (mirror existing mock patterns — function field + default impl returning empty string / configured error). Run `go build ./...` (tests should still compile).

- [x] T004 [P] Add `lastLine?: string` to the `WindowInfo` TypeScript type in `app/frontend/src/api/client.ts`. Run `cd app/frontend && npx tsc --noEmit` to confirm no narrowing regressions in existing consumers.
  <!-- clarified-during-apply: WindowInfo type actually lives in src/types.ts (re-exported by client.ts); added `lastLine?: string` there. -->


## Phase 2: Core Backend

<!-- tmux helpers + SSE enrichment + on-demand capture endpoint. -->

- [x] T005 Implement `CapturePaneByWindow` in `app/backend/internal/tmux/tmux.go`: `exec.CommandContext` with provided ctx, target `fmt.Sprintf("%s:%d", session, windowIndex)`, args `capture-pane -t {target} -p -S -{lines}`, validate session via `internal/validate.ValidateName`, clamp/reject lines outside `[1, 100]`. Leave existing `CapturePane(paneID, lines, server)` untouched.

- [x] T006 Add `StripANSI(s string) string` helper (package-level `var ansiRegex = regexp.MustCompile(...)` compiled once) in `app/backend/internal/tmux/ansi.go` (new file). Strip CSI `\x1b\[[0-9;?]*[a-zA-Z]`, OSC `\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`, other `\x1b[\x40-\x5f].` escapes, and non-printable control characters except `\n` and `\t`. Export for use by sessions + api packages.

- [x] T007 Add `LastLine(s string) string` helper in `app/backend/internal/tmux/ansi.go` (same file as T006 — they form a natural unit): return the last non-empty, non-whitespace line from the input; empty/whitespace-only input returns `""`; trim trailing whitespace on the chosen line.

- [x] T008 Add tests in `app/backend/internal/tmux/tmux_test.go` covering: `StripANSI` (colored prompt, OSC title setter, preserve `\n`/`\t`), `LastLine` (typical, all-blank, single-line, trailing-whitespace), and `CapturePaneByWindow` validation paths (invalid session, out-of-range lines, context timeout with `exec.CommandContext`). Use table-driven tests where possible. Run `cd app/backend && go test ./internal/tmux/...`.

- [x] T009 Extend `FetchSessions` in `app/backend/internal/sessions/sessions.go` to piggyback pane capture after `fetchPaneMapCached` returns: parallel goroutine pool sized `min(len(windows), 16)` (use a semaphore channel), per-window `context.WithTimeout(ctx, 3*time.Second)`, call `CapturePaneByWindow(..., 3, server)`, apply `tmux.StripANSI` then `tmux.LastLine`, assign to `sd.windows[j].LastLine`. Capture failures log at `slog.Debug` and leave `LastLine = ""` — must not abort the enrichment. Ensure the pool drains before the function returns (wg.Wait or equivalent).
  <!-- clarified-during-apply: extracted enrichLastLines helper with a package-level `capturePaneFn` var (defaults to tmux.CapturePaneByWindow) to enable tests to stub the subprocess call; mirrors the pattern used for paneMapCache. -->

- [x] T010 Add tests in `app/backend/internal/sessions/sessions_test.go` for the new enrichment path: happy path (all windows get `LastLine`), per-window timeout isolation (one window errors, others populate), empty `LastLine` on whitespace capture. Mock the tmux call via whatever existing injection pattern `sessions_test.go` uses. Run `cd app/backend && go test ./internal/sessions/...`.

- [x] T011 Add `handleWindowCapture` in `app/backend/api/windows.go`: validate session via `validate.ValidateName`, parse index via `parseWindowIndex`, parse `lines` query param (default 3, clamp `[1, 100]`, reject non-integer with 400), derive `server` via `serverFromRequest(r)`, call `s.tmux.CapturePaneByWindow(ctx, ...)` with `context.WithTimeout(r.Context(), 3*time.Second)`, apply `tmux.StripANSI`, split on `\n`, drop trailing empty lines, respond with `{"content": ..., "lines": [...]}`. Map errors: validation → 400, tmux error → 500, deadline → 504 `{"error":"capture timeout"}`.
  <!-- clarified: place in api/windows.go to co-locate with peer window handlers (handleWindowKill/Rename/Select/Split/Move/Color live there alongside parseWindowIndex). -->


- [x] T012 Register the new route in `app/backend/api/router.go`: `r.Get("/api/sessions/{session}/windows/{index}/capture", s.handleWindowCapture)`. Locate alongside existing window routes.

- [x] T013 Add handler tests in `app/backend/api/windows_test.go`: default lines=3, explicit lines=5, clamp lines=1000→100, non-integer lines→400, invalid session→400, shell-injection session→400 (no subprocess), 200 happy path verifies stripped content + lines array, 504 on simulated timeout. Use `mockTmuxOps.captureByWindow` hook (add a function field + default impl per the existing mock pattern in `sessions_test.go` lines 29-117). Run `cd app/backend && go test ./api/...`.
  <!-- clarified: co-locate tests in api/windows_test.go alongside handleWindowKill/Rename/Select tests; mockTmuxOps lives in sessions_test.go and is shared. -->
  <!-- clarified-during-apply: chi does not percent-decode path params before routing, so the shell-injection test uses plaintext `bad$session` (contains a raw forbidden char) rather than URL-encoded bytes. -->



## Phase 3: Core Frontend

<!-- API client fn, WindowRow toggle + expanded block + styling. -->

- [x] T014 Export `capturePane(session: string, index: number, lines: number): Promise<{ content: string; lines: string[] }>` from `app/frontend/src/api/client.ts`. URL-encode `session`, append the standard `withServer` query string, use `throwOnError` helper on non-2xx, do NOT route through `deduplicatedFetch`. Add unit test in `app/frontend/src/api/client.test.ts` covering success shape and 500 error mapping.

- [x] T015 In `app/frontend/src/components/sidebar/window-row.tsx`: render last-line preview beneath the window-name row when `win.lastLine` is a non-empty string. Styling: `text-xs text-text-secondary truncate min-w-0`. No placeholder / reserved space when `lastLine` is empty or undefined. Type narrow with `if (win.lastLine)` — no `as` casts.

- [x] T016 In `app/frontend/src/components/sidebar/window-row.tsx`: add the expand/collapse chevron toggle button inside the existing `absolute right-2` hover-reveal cluster (before kill/color buttons in visual order). Use `\u25B8` (collapsed) / `\u25BE` (expanded). Apply the same `opacity-0 group-hover:opacity-100 coarse:opacity-100` pattern. Set `aria-expanded`, dynamic `aria-label` (`Expand output peek for {window.name}` / `Collapse...`), call `stopPropagation` on click so window selection is not triggered.

- [x] T017 Lift peek-expanded state to the sidebar container. In `app/frontend/src/components/sidebar/index.tsx`, add an `expandedPeeks` state (`Set<string>` keyed by `${session}:${windowId}` — stable window id, NOT index, to survive reorder). Pass `isExpanded` and `onToggleExpand` props to `WindowRow`. State is in-memory React only — no `localStorage`, no URL, no backend persistence.

- [x] T018 In `app/frontend/src/components/sidebar/window-row.tsx`: render the expanded peek block below the window row when `isExpanded`. Styling: `font-mono text-xs text-text-secondary bg-bg-card px-2 py-1`, each line in its own element with CSS truncation. Local state machine: `idle | loading | ready | error`; on first expand, call `capturePane(session, index, 3)`; while in-flight show `Loading\u2026` in `text-text-secondary`; on error show `Unable to load output` (no toast). On collapse, discard state.

- [x] T019 In `app/frontend/src/components/sidebar/window-row.tsx`: wire SSE-driven re-fetch via `useEffect` keyed on `[isExpanded, win.lastLine]`. Trigger a new `capturePane` call ONLY when expanded AND `win.lastLine` changed to a non-empty, different value (previous-value ref). Do NOT re-fetch when `lastLine` transitions to empty/undefined. Single-flight guard: if a request is in flight, mark a "stale" flag and re-issue after the current one settles (no overlapping fetches, no `setInterval`).

## Phase 4: Integration & Edge Cases

<!-- Wire everything together, verify cross-cutting behavior. -->

- [x] T020 Add component tests in `app/frontend/src/components/sidebar/window-row.test.tsx`: renders `lastLine` when set, omits element when empty/undefined, toggle flips chevron + `aria-expanded` + does not select window, peek block shows `Loading\u2026` then resolved lines, error state renders `Unable to load output`, multiple simultaneous expansions maintained independently, page-reload-equivalent (remount) collapses all.

- [x] T021 Verify `previousJSON` SSE dedup still collapses identical ticks with the new `lastLine` field. Add a new test case in `app/backend/api/sse_test.go`: two consecutive ticks with identical `lastLine` across all windows produce one broadcast, not two. Also cover: a single window's `lastLine` change produces a broadcast.
  <!-- clarified: `previousJSON` is `map[string]string` storing full marshalled session JSON (sse.go:38, 161) — `lastLine` dedup is naturally part of the same JSON object comparison, no separate shape needed. Build the fixture by constructing two `[]tmux.SessionData` slices that differ only in one window's `LastLine`, then marshal via the existing hub codepath. -->


- [x] T022 Cross-phase verification gates: run in order — `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `cd app/frontend && pnpm test`. Fix any regressions surfaced. Do NOT use `pnpm test` / `go test` individually in day-to-day flow; the `just` recipes are canonical, but these gates match `code-quality.md` §Verification step order.

## Phase 5: Polish

<!-- E2e coverage + perf sanity. Docs are out of scope unless user flags it. -->

- [x] T023 Add a Playwright e2e test in `app/frontend/tests/e2e/sidebar-peek.spec.ts` (new file) covering: window row shows a last-line preview when SSE delivers content, toggle expands the peek block and it renders the fetched lines, clicking toggle again collapses it, a second window's expansion is independent. Run `just test-e2e` once the backend/frontend passes locally. Use `just pw test sidebar-peek` for iteration.

- [x] T024 Manual perf sanity: with 5+ sessions and 10+ windows, confirm SSE tick latency remains under the 2.5s `ssePollInterval` (observe via existing backend logs or a quick `time` measurement around `FetchSessions`). If the 16-concurrency semaphore or 3s per-window timeout needs adjustment, document the tuned values inline with a comment in `sessions.go`.
  <!-- clarified-during-apply: measured via a throwaway cmd/perf harness on 5 sessions × 3 windows (15 total); avg FetchSessions latency 8ms — well under 2.5s budget. Defaults (16 concurrency, 3s timeout) retained; no tuning required. -->


---

## Execution Order

Non-obvious dependencies only (intra-phase [P] ordering is free):

- **T002 blocks T003** — mock must implement the interface after the interface gains the method.
- **T005 blocks T008, T009, T011** — the tmux wrapper must exist before tests, enrichment callers, and the handler consume it.
- **T006 and T007 block T008, T009, T011** — `StripANSI` and `LastLine` are used by both enrichment and the handler response shaping.
- **T009 blocks T010, T021** — enrichment behavior precedes its tests and SSE dedup verification.
- **T011 blocks T012, T013** — handler exists before route registration and handler tests.
- **T014 blocks T018, T019, T020** — frontend peek fetch/test paths need the client function.
- **T017 blocks T018, T019, T020** — `isExpanded` / `onToggleExpand` props must be wired before `WindowRow` consumes them.
- **T001 + T009 block any frontend SSE consumer assumption** — without `LastLine` on the Go struct and populated during enrichment, the frontend tests that assert `win.lastLine` render paths are fragile.
- **T022** runs after all Phase 1-4 tasks. **T023** requires T011 + T012 + T015-T019 wired and T022 green.

---

## Requirement Traceability

| Phase | Spec requirements satisfied |
|---|---|
| Phase 1 | SSE payload extension (`lastLine` type field, Go struct field); `TmuxOps` interface + mock update (assumption #13) |
| Phase 2 | `CapturePaneByWindow` + validation + context timeout; `StripANSI`; `LastLine`; SSE enrichment piggyback (per-window 3s timeout, 16-goroutine pool); on-demand `GET /api/sessions/{session}/windows/{index}/capture` (default/clamp/validation/timeout mapping) |
| Phase 3 | Frontend `capturePane` client fn; always-visible last-line preview row; peek expand/collapse toggle (a11y, hover-reveal); expanded peek block (loading/error states); multi-expansion state keyed by `${session}:${windowId}`; event-driven re-fetch on `lastLine` change with single-flight guard |
| Phase 4 | Cross-cutting: component tests, SSE dedup verification with new field, full verification gate |
| Phase 5 | E2e coverage; perf sanity vs. 2.5s `ssePollInterval` budget |

---

## Risk & Attention Flags

- **T009 (enrichment piggyback)** — concurrency/timeout interaction is the riskiest task. Ensure goroutines never leak on ctx cancellation and that `wg.Wait` happens before returning sessions. A badly-scoped context here can cause intermittent empty `lastLine` or zombie subprocesses under load.
- **T019 (SSE-driven re-fetch)** — the "empty transition does not re-fetch" rule plus single-flight is a small state machine; easy to regress. Add explicit tests in T020 for: (a) non-empty→non-empty triggers re-fetch, (b) non-empty→empty does NOT, (c) rapid change during in-flight triggers exactly one trailing re-fetch.
- **T017 key stability** — the spec mandates keying by `windowId` not index (survives reorder). If the current `WindowInfo` does not carry a stable id, T017 may need to derive one from `${session}:${paneId}` or similar; flag during apply if so.
- **Resolved — SSE fixture for `lastLine`**: `previousJSON` is a `map[string]string` of full marshalled session JSON (`sse.go:38, 161`); the `lastLine` field is compared as part of the same JSON object. No new fixture shape required — T021 builds two `[]tmux.SessionData` slices differing only in one window's `LastLine` and asserts dedup via the existing hub codepath.
- **Resolved — file for `handleWindowCapture`**: `api/windows.go` already hosts peer handlers (`handleWindowKill/Rename/Select/Split/Move/Color/UrlUpdate/TypeUpdate/Keys`) and the shared `parseWindowIndex`. T011 co-locates there; T013 tests co-locate in `windows_test.go`.
