# Plan: E2E Fixed-Port Hardening

**Change**: 260903-u1b8-e2e-fixed-port-hardening
**Intake**: `intake.md`

## Requirements

### E2E Harness: Dead-URL Port Derivation

#### R1: Dead web-tab URLs derive an ephemeral port instead of stamping `:8080`
A shared e2e helper SHALL provide a dead-URL derivation: bind a `net` server on `127.0.0.1:0`, read the assigned ephemeral port, close the listener, and expose the port + `http://localhost:<port>/` URL. Every e2e spec that stamps a dead `http://localhost:8080/` web-tab URL MUST derive it via this helper (resolved once per file in `beforeAll` — `net` listen is callback-based, wrapped in a promise), and every `stubProxyPorts(page, …)` call MUST stub the same derived port the spec stamps. The affected specs are the intake's five — `right-panel.spec.ts`, `present-auto-expand.spec.ts`, `top-bar-overflow.spec.ts`, `code-surface.spec.ts`, `compose-strip.spec.ts` — plus the two same-pattern sites the sweep missed: `surface-layout.spec.ts` and `web-view-lens.spec.ts`.

- **GIVEN** a sibling worktree's app (or any stray process) listens on `:8080`
- **WHEN** any of the seven specs runs
- **THEN** no assertion depends on `:8080`'s occupancy — the stamped port was just released by this run's own reservation bind and is dead by construction

- **GIVEN** `web-view-lens.spec.ts`'s URL-normalization test (types `localhost:8080`, asserts the option holds `/proxy/8080/`)
- **WHEN** the port derives
- **THEN** the test types `localhost:<derived>` and asserts `/proxy/<derived>/` — the normalization pipeline is still exercised end-to-end

### E2E Harness: Code-Stub Port Consolidation

#### R2: One shared code-stub starter with an ephemeral fallback
The four verbatim-duplicated `resolveCodePort()` copies (`code-surface.spec.ts`, `code-folder-latch.spec.ts`, `focus-restore.spec.ts`, `surface-focus-chords.spec.ts`) SHALL be consolidated into the shared helper file as a single `startCodeStub(html)` export: when `RK_CODE_SERVER_PORT` is set it MUST bind exactly that port (the backend forwards the stable `/code/` route to it; an out-of-range value still throws the descriptive error naming the `just test-e2e` path); when unset or empty it MUST bind port `0` and report the actual port from `server.address()` instead of falling back to the fixed `3939`. The per-spec stub HTML (plain-button vs. the focus-grab variant, currently byte-identical across two files) moves into exported builders alongside it.

- **GIVEN** two bare `pnpm exec playwright test` runs on one box, `RK_CODE_SERVER_PORT` unset
- **WHEN** both start their code stubs
- **THEN** each binds its own ephemeral port — no `EADDRINUSE`, no cross-run stub hits

- **GIVEN** the harness (`RK_CODE_SERVER_PORT` set to the derived `E2E_PORT+2`)
- **WHEN** a spec starts its stub
- **THEN** the stub binds that exact port, so the backend's `/code/` forward reaches it — behavior unchanged

- **GIVEN** `code-surface.spec.ts`'s "stub down" describe (asserts the not-running empty state)
- **WHEN** the previous describe's `afterAll` has closed the stub
- **THEN** the unreachable assertion still holds on both the harness path and the ephemeral path

### E2E Harness: Fail-Closed Base Port

#### R3: Playwright reads `E2E_PORT`, never the ambient `RK_PORT`
`scripts/test-e2e.sh` (`run_playwright`, line ~187) and `scripts/pw.sh` (line ~13) SHALL additionally pass `E2E_PORT` into the Playwright env (they already compute it; `RK_PORT` stays in the env for the backend and anything else that reads it). The six Playwright-side base-port reads — `playwright.config.ts:3`, `_boards.ts` `apiBase()`, `session-reorder.spec.ts:91`, `echo-latency.spec.ts:59`, `touch-focus-gate.spec.ts:23`, `mobile-touch-scroll.spec.ts:22` — SHALL read `process.env.E2E_PORT ?? "3333"`. direnv exports `RK_PORT=3000` but never `E2E_PORT`, so the fail-closed `:3333` fallback becomes real on direnv-configured boxes.

- **GIVEN** a shell with ambient `RK_PORT=3000` (direnv) and a live dev server on `:3000`
- **WHEN** `pnpm exec playwright test` runs bare (no harness)
- **THEN** Playwright targets `:3333` and connects to nothing — it never mutates the live dev server's state

- **GIVEN** a harness run (`just test-e2e` or `just pw`)
- **WHEN** Playwright starts
- **THEN** `E2E_PORT` carries the derived base port and behavior is identical to today

### E2E Harness: Doc Accuracy

#### R4: Stale port docstrings updated
`server-reorder.spec.ts`'s file-header comment (line ~24) still names the retired shared `:3020` rig and the `RK_PORT ?? 3020` read; it SHALL be updated to the derived-triple + `E2E_PORT` reality. `_web-tile.ts`'s `stubProxyPorts` doc example ("present-auto-expand's 8080 AND 8081") is stale — that spec stamps one URL now — and SHALL be refreshed to the derived-port reality. Header comments in every touched spec MUST stay accurate (constitution § Test Intent Comments: same-commit updates, no history narration).

- **GIVEN** the migrated specs
- **WHEN** a reviewer reads any touched file header
- **THEN** the described setup (derived dead port, `E2E_PORT`, shared stub helper) matches the code

### Non-Goals

- `RK_PORT` itself is untouched for the backend/dev rig — `scripts/e2e-env.sh` derivation, the `bash -c "RK_PORT=$E2E_PORT … just dev"` backend launch, and the justfile dev convention all keep it (intake assumption 5).
- No production code, API, or backend change; `RK_CODE_SERVER_PORT` semantics on the backend are unchanged.
- No consolidation of `session-reorder.spec.ts`'s inline base-URL expression onto `_boards.ts` `apiBase()` beyond the env-var switch (separate cleanup, not this fix).

### Design Decisions

#### Dead URL via reserve-then-release ephemeral bind
**Decision**: `reserveDeadPort()` binds `127.0.0.1:0`, reads the assigned port, closes the listener, and returns it; specs stamp `http://localhost:<port>/`.
**Why**: A just-released ephemeral port is unbound at use time for the assertion window, needs no port-block bookkeeping, and no run-kit component binds ephemeral-range listeners the specs would hit.
**Rejected**: A reserved derived port (e.g. `E2E_PORT+3`) — adds triple→quad bookkeeping across `e2e-env.sh`, the kill/step logic, and docs for a URL that only needs to be dead.
*Introduced by*: 260903-u1b8-e2e-fixed-port-hardening

#### New `_ports.ts` helper file
**Decision**: The dead-URL and code-stub helpers live in a new `app/frontend/tests/e2e/_ports.ts`, not in `_tmux.ts`.
**Why**: `_tmux.ts` is tmux-scoped by name; port plumbing is a distinct concern, and the helper tree already splits by concern (`_boards.ts`, `_web-tile.ts`, `_ready.ts`). Resolves the intake's Tentative assumption 4.
**Rejected**: Extending `_tmux.ts` — muddies its scope for zero import savings.
*Introduced by*: 260903-u1b8-e2e-fixed-port-hardening

#### `startCodeStub(html)` takes the page body; HTML builders exported beside it
**Decision**: The shared starter accepts the stub HTML as an argument; `_ports.ts` also exports the two body builders (plain button; focus-grab with a delay parameter) so the byte-identical focus-grab copy in `focus-restore` / `surface-focus-chords` collapses to one.
**Why**: The four specs share port resolution + listen mechanics verbatim but differ in body; parameterizing the body is the smallest seam that removes all the duplication the sweep flagged.
**Rejected**: Four thin per-spec wrappers around a port-only helper — leaves the listen/error plumbing and the focus-grab HTML duplicated.
*Introduced by*: 260903-u1b8-e2e-fixed-port-hardening

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/tests/e2e/_ports.ts`: `reserveDeadPort(): Promise<{ port: number; url: string }>` (bind `net` server on `127.0.0.1:0`, read `server.address()`, close, resolve); `startCodeStub(html: string): Promise<{ server: http.Server; port: number }>` (bind validated `RK_CODE_SERVER_PORT` when set — keep the descriptive out-of-range error; bind port `0` when unset/empty and read the actual port); exported stub-body builders `plainCodeStubHtml()` and `focusGrabCodeStubHtml(grabDelayMs)`. JSDoc each export in the helper tree's style. <!-- R1, R2 -->

### Phase 2: Core Implementation

- [x] T002 Migrate the seven dead-URL specs off the fixed `:8080`: `right-panel.spec.ts`, `present-auto-expand.spec.ts`, `top-bar-overflow.spec.ts`, `code-surface.spec.ts` (the `stampWebTab(id, "http://localhost:8080/")` site), `compose-strip.spec.ts`, `surface-layout.spec.ts`, `web-view-lens.spec.ts` — each resolves `reserveDeadPort()` once in `beforeAll`, stamps the derived URL, and passes the derived port to its `stubProxyPorts` calls (incl. the second-page calls at `surface-layout.spec.ts:1041,1087`); `web-view-lens.spec.ts`'s typed-input test types `localhost:<derived>` and asserts `/proxy/<derived>/`; refresh `_web-tile.ts`'s stale "8080 AND 8081" doc example. <!-- R1 -->
- [x] T003 [P] Consolidate the four code-stub specs onto `_ports.ts`: delete the local `resolveCodePort()`/`startStub()` in `code-surface.spec.ts`, `code-folder-latch.spec.ts`, `focus-restore.spec.ts`, `surface-focus-chords.spec.ts`; import `startCodeStub` + the matching body builder; specs that need the port read it from the started stub's return, not a constant; update the four file-header comments. <!-- R2 -->
- [x] T004 [P] Fail-closed base port: add `E2E_PORT="$E2E_PORT"` to the Playwright env in `scripts/test-e2e.sh` (`run_playwright`) and `scripts/pw.sh` (keep `RK_PORT` passing as-is); switch the six reads — `app/frontend/playwright.config.ts:3`, `_boards.ts` `apiBase()`, `session-reorder.spec.ts:91`, `echo-latency.spec.ts:59`, `touch-focus-gate.spec.ts:23`, `mobile-touch-scroll.spec.ts:22` — to `process.env.E2E_PORT ?? "3333"`; update the adjacent comments (`_boards.ts` apiBase JSDoc, pw.sh header). <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Doc polish + verification: update `server-reorder.spec.ts`'s stale `:3020`/`RK_PORT` file-header docstring to the derived-triple + `E2E_PORT` reality; sweep every touched file header for accuracy (constitution § Test Intent Comments); verify no functional `8080`/`3939`/`RK_PORT` read remains under `app/frontend/tests/e2e/` + `playwright.config.ts` (grep); run `cd app/frontend && npx tsc --noEmit`, then `just test-e2e`. <!-- R4 -->

## Execution Order

- T001 blocks T002 and T003 (both import `_ports.ts`)
- T004 is independent of T001–T003
- T005 last (verifies the union)

## Acceptance

### Functional Completeness

- [x] A-001 R1: No spec under `app/frontend/tests/e2e/` stamps or stubs a literal `8080`; all seven dead-URL specs derive via `reserveDeadPort()` and stub the same derived port they stamp
- [x] A-002 R2: Exactly one code-stub port resolution + listen implementation exists (`_ports.ts`); the four specs import it and no local `resolveCodePort`/`startStub` copy remains
- [x] A-003 R3: `playwright.config.ts` and the five spec/helper sites read `E2E_PORT ?? "3333"`; `test-e2e.sh` and `pw.sh` pass `E2E_PORT` into the Playwright env

### Behavioral Correctness

- [x] A-004 R3: Harness runs are behavior-identical — `E2E_PORT` carries the same derived value `RK_PORT` carried before, and the backend launch env is untouched
- [x] A-005 R2: With `RK_CODE_SERVER_PORT` set, the stub binds exactly that port (the backend `/code/` forward still reaches it); with it unset, the stub binds port 0 and the spec reads the actual port from the return value

### Scenario Coverage

- [x] A-006 R1: `web-view-lens.spec.ts`'s URL-normalization test still types a raw `localhost:<port>` and asserts the normalized `/proxy/<port>/` option value using the derived port
- [x] A-007 R2: `code-surface.spec.ts`'s "stub down" describe still proves the not-running empty state

### Edge Cases & Error Handling

- [x] A-008 R2: An out-of-range `RK_CODE_SERVER_PORT` still throws the descriptive error (naming the `just test-e2e` run path) rather than surfacing as missing-content failures
- [x] A-009 R3: With `E2E_PORT` unset and ambient `RK_PORT` set (the direnv case), the Playwright base port is `3333` — fail-closed, connects to nothing

### Removal Verification

- [x] A-010 R2: No `3939` literal remains under `app/frontend/tests/e2e/`

### Code Quality

- [x] A-011 Pattern consistency: `_ports.ts` follows the helper tree's conventions (underscore-prefixed name, JSDoc'd exports, typed returns)
- [x] A-012 No unnecessary duplication: the four `resolveCodePort` copies and the two byte-identical focus-grab HTML bodies are each down to one definition
- [x] A-013 Test intent comments: every touched spec's header/JSDoc reflects the new setup in the same commit; no history narration or change-ID citations added to code comments
- [x] A-014 Tests green: `npx tsc --noEmit` clean and `just test-e2e` passes on the derived rig

## Notes

- **T005 e2e evidence** (apply-time runs on this box's derived rig): full suite 347 passed / 6 failed / 1 skipped. The 6 failures touch no surface this change modifies. Isolated re-run: the 3 `row-flyout` coarse-pointer tests pass (full-suite load flakes). The remaining 3 (`boards-multi-server`, `legacy-color-sweep`, `legacy-scope-sweep`) fail **identically on pristine HEAD** (verified: temp WIP commit → detach to the pre-change commit → same 3 failures, same tests) — pre-existing in this environment, not introduced here. All specs that read the changed surfaces pass.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change removes fixed-port assumptions and consolidates helpers without leaving existing code redundant: the duplicated code it targeted (the four local `resolveCodePort`/`startStub` copies, the second byte-identical focus-grab HTML body, and top-bar-overflow's `VIEW_URL` constant) was deleted in the diff itself, and the `RK_PORT` pass-through in `scripts/test-e2e.sh`/`scripts/pw.sh` is deliberately retained for non-Playwright child-env readers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Extend the dead-URL migration to `surface-layout.spec.ts` and `web-view-lens.spec.ts` (intake listed five specs) | Same stamp+stub pattern, same hazard; the intake's Origin is "remove fixed-port assumptions from e2e specs" — leaving two same-pattern sites keeps the hazard alive <!-- assumed: seven-spec scope — sweep missed two same-pattern 8080 sites --> | S:70 R:85 A:85 D:75 |
| 2 | Confident | New `_ports.ts` file rather than extending `_tmux.ts` | Resolves the intake's Tentative #4 with its own inline lean (`_tmux.ts` is tmux-scoped by name); helper tree already splits by concern | S:60 R:90 A:80 D:70 |
| 3 | Confident | `startCodeStub(html)` parameterizes the stub body; the two body variants become exported builders | Smallest seam covering all four specs; also removes the annotated byte-identical focus-grab duplication | S:65 R:85 A:80 D:70 |
| 4 | Certain | Harness scripts keep passing `RK_PORT` alongside the new `E2E_PORT` | Intake assumption 5 + What-Changes area 3 say it verbatim: `RK_PORT` stays for anything else that reads it | S:90 R:90 A:95 D:90 |
| 5 | Confident | `reserveDeadPort` returns `{port, url}` so stamp sites and `stubProxyPorts` consume one resolution | Both consumers need the same value; two calls could yield two ports and desync the stub from the stamp | S:70 R:90 A:85 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
