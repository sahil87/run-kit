# Plan: Frontend TypeScript 7 Bump

**Change**: 260731-lu5e-frontend-typescript-7-bump
**Intake**: `intake.md`

## Requirements

### Frontend Toolchain: TypeScript 7 Bump

#### R1: Frontend typescript devDependency moves to TS 7
The `typescript` entry in `app/frontend/package.json` `devDependencies` MUST be `^7.0.2` (caret range, matching `app/desktop`'s existing pin style), and `app/frontend/pnpm-lock.yaml` MUST be refreshed via `pnpm install` so the `typescript` resolution moves from 6.0.3 to a 7.0.x release. No other dependency changes SHALL be introduced, and `app/frontend/tsconfig*.json` SHALL remain untouched.

- **GIVEN** `app/frontend/package.json` pins `"typescript": "^6.0.3"` (line 44)
- **WHEN** the devDependency is changed to `^7.0.2` and `pnpm install` is run from `app/frontend/`
- **THEN** `pnpm-lock.yaml` resolves `typescript` to a 7.0.x release
- **AND** the lockfile delta contains no other dependency changes

#### R2: Project context doc reflects TypeScript 7
The `- **Language**: TypeScript 5.7+` line in the `## Frontend — app/frontend/` section of `fab/project/context.md` (line 41) MUST be updated to reflect TypeScript 7 (the native Go compiler).

- **GIVEN** `fab/project/context.md` line 41 reads `- **Language**: TypeScript 5.7+`
- **WHEN** the stale line is corrected
- **THEN** it reads `- **Language**: TypeScript 7 (native Go compiler)`

#### R3: Verification gates stay green on TS 7
With TS 7 installed, the frontend typecheck (`tsc --noEmit`) MUST pass with zero errors, and the project gates `just test` (backend + frontend + e2e) and `just build` MUST succeed. Tests SHALL be run only via `just` recipes (port isolation), never raw `go test`/`pnpm test`/`playwright test`.

- **GIVEN** the bumped dependency is installed in `app/frontend/node_modules`
- **WHEN** `./node_modules/.bin/tsc --noEmit` is run from `app/frontend/`, followed by `just test` and `just build` from the repo root
- **THEN** the typecheck reports zero errors and both `just` gates succeed
- **AND** any e2e failure matching a known pre-existing flaky signature on main (max-update-depth console errors in window-heading/window-switch-transition/sync-latency; window-heading "◀ ▶ arrows" forward-nav timeout; multi-server-sidebar:70) is judged against that signature rather than attributed to this check-only compiler bump

### Non-Goals

- `app/desktop/package.json` — already on `^7.0.2`; touching it would be scope creep
- `app/frontend/tsconfig*.json` changes — current options verified compatible with TS 7
- Adding TS-API-dependent tooling (typescript-eslint, ts-node, codegen) — none exists in the repo and TS 7's programmatic API lands in 7.1
- Build script changes — stays `tsc --noEmit && vite build`; the `tsc` binary simply resolves to the TS 7 native compiler

## Tasks

### Phase 1: Setup

- [x] T001 Bump `typescript` devDependency from `^6.0.3` to `^7.0.2` in `app/frontend/package.json` <!-- R1 -->
- [x] T002 Run `pnpm install` from `app/frontend/` to refresh `pnpm-lock.yaml`; verify the delta is limited to the typescript resolution <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 [P] Update `fab/project/context.md` line 41 (`## Frontend — app/frontend/` section) from `- **Language**: TypeScript 5.7+` to `- **Language**: TypeScript 7 (native Go compiler)` <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Run the frontend typecheck: `cd app/frontend && ./node_modules/.bin/tsc --noEmit` — MUST report zero errors on TS 7 <!-- R3 -->
- [x] T005 Run `just test` (backend + frontend + e2e) from the repo root; triage any e2e failure against the known pre-existing flaky signatures before attributing it to the bump <!-- R3 -->
- [x] T006 Run `just build` from the repo root — MUST succeed <!-- R3 --> <!-- rework-note: the change-relevant half (tsc --noEmit && vite build on TS 7, plus dist→embed copy) succeeded; the recipe then fails at scripts/build.sh:19 `cat VERSION` — pre-existing on main since ea750837 (PR #193) deleted the VERSION file, unrelated to this change. Go compile of cmd/rk with the TS-7-built embedded frontend verified manually (CGO_ENABLED=0 go build ./cmd/rk → OK). -->

## Execution Order

- T001 blocks T002 (install reads the bumped manifest)
- T002 blocks T004–T006 (gates run against the installed TS 7)
- T003 is independent, can run alongside T001–T002

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/frontend/package.json` devDependencies pin `"typescript": "^7.0.2"` and `pnpm-lock.yaml` resolves typescript to a 7.0.x release — verified: `package.json:44` reads `"typescript": "^7.0.2"`; lockfile importer specifier `^7.0.2` / version `7.0.2`; installed binary reports `Version 7.0.2`
- [x] A-002 R2: `fab/project/context.md` Frontend section reads `- **Language**: TypeScript 7 (native Go compiler)` (no stale `5.7+` remains) — verified at `context.md:41`; repo-wide grep finds no remaining live `5.7+`/TS-6 claim (only archived change artifacts, correctly untouched)

### Behavioral Correctness

- [x] A-003 R3: `./node_modules/.bin/tsc --noEmit` in `app/frontend/` exits 0 with zero type errors under TS 7 — re-verified at review: exit 0, zero diagnostics, 0.593s wall / 577% CPU. CI's exact `npx tsc --noEmit` invocation also resolves to 7.0.2 and exits 0. `strace` confirms `tsc` execs the native Go binary (`@typescript/typescript-linux-x64@7.0.2/lib/tsc`), so the native compiler is genuinely in use

### Scenario Coverage

- [x] A-004 R3: `just test` (backend + frontend + e2e) passes, with any e2e failure triaged against the known-flaky-on-main signatures — apply ran the full `just test` green (T005, 1 iteration, no rework). Review re-ran the scoped gate `just test-frontend`: 118 files / 2071 tests passed. Full e2e deliberately not re-run at review (already green at apply; the suite is a 3-shard SSE/tmux-contended gate)
- [x] A-005 R3: the change-relevant build steps pass — `pnpm build` (`tsc --noEmit && vite build`) exits 0 with the typecheck half running the TS 7 binary. The full `just build` recipe was NOT verified end-to-end: it fails at `scripts/build.sh:19` (`cat "$REPO_ROOT/VERSION"`) because `VERSION` was deleted by `ea750837` (PR #193, tag-driven release port) — a pre-existing failure on main, independent of this change

### Edge Cases & Error Handling

- [x] A-006 R1: The `pnpm-lock.yaml` delta is limited to the typescript resolution — no other dependency versions change — verified by enumerating every added/removed lockfile key. The 215/-14 line count is fully explained: 20 new `@typescript/typescript-{platform}@7.0.2` optional deps (TS 7 ships per-platform native Go binaries) plus mechanical peer-dep re-keying of the 3 snapshots that take `typescript` as a peer (`msw`, `vitest`, `@vitest/mocker` — same versions, only the `(typescript@6.0.3)` → `(typescript@7.0.2)` hash segment changes). Zero foreign packages, zero unrelated version bumps

### Code Quality

- [x] A-007 Pattern consistency: the caret pin style (`^7.0.2`) matches the existing `app/desktop/package.json` typescript pin — verified byte-identical: `app/frontend/package.json:44` and `app/desktop/package.json:24` both read `"typescript": "^7.0.2"`. The repo is now converged on one TS major
- [x] A-008 No unnecessary duplication: no new tooling, scripts, or config duplicated — the change is confined to the manifest, lockfile, and one doc line — verified: the working tree touches exactly 3 files (`package.json`, `pnpm-lock.yaml`, `context.md`); no new scripts, config, or dependencies
- [x] A-009 No scope creep: `app/desktop/`, `tsconfig*.json`, and the build script are untouched (intake's explicit scope exclusions hold) — verified via `git status`: `app/desktop/`, `app/frontend/tsconfig*.json`, `scripts/`, and `justfile` all clean. The `build` script still reads `tsc --noEmit && vite build`
- [x] A-010 **N/A**: Tests-for-changes principle — a check-only compiler bump changes no runtime behavior to test. `tsc` never emits in this package (Vite/esbuild transpiles, Vitest uses the Vite transform, Playwright self-transpiles), so the typecheck IS the test; existing gates (2071 unit tests, e2e, typecheck) are the coverage. Matches intake assumption 7 and `code-quality.md`'s scoping of the rule to "features and bug fixes"

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use the intake's suggested wording verbatim for the context.md line: `TypeScript 7 (native Go compiler)` | Intake assumption 6 delegates exact wording to the agent with this as the offered default; one-line doc edit, trivially reversible | S:85 R:95 A:95 D:90 |
| 2 | Certain | Run the typecheck via `./node_modules/.bin/tsc --noEmit` (local binary) rather than `npx tsc` | Guarantees the project-pinned TS 7 binary is exercised, not a globally cached tsc; equivalent intent to code-quality.md's `npx tsc --noEmit` gate | S:80 R:95 A:95 D:90 |
| 3 | Confident | A `just test` e2e failure matching a known-flaky-on-main signature does not fail the change; it is reported with reasoning, not bisected | Dispatch instructions enumerate the known signatures and state a check-only compiler bump cannot change runtime behavior (Vite/esbuild transpiles, tsc never emits); judgment call on live test output keeps this below Certain | S:75 R:70 A:80 D:75 |

3 assumptions (2 certain, 1 confident, 0 tentative).
