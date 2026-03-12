# Intake: Cleanup Old Implementation

**Change**: 260312-n11e-cleanup-old-implementation
**Created**: 2026-03-12
**Status**: Draft

## Origin

> Phase 4 of the run-kit reimplementation plan (docs/specs/project-plan.md). After Phases 1-3 deliver the new `app/` implementation, this phase removes the old code and updates documentation.

## Why

1. **Dead code removal** — `packages/` and `e2e/` are superseded by `app/backend/`, `app/frontend/`, and `app/frontend/tests/e2e/`. Keeping both creates confusion about which is authoritative.
2. **Clean repo** — no stale references to old paths in docs, scripts, or config files.

## What Changes

### Deletions

- `packages/` — old Go backend (`packages/api/`) and old Vite frontend (`packages/web/`)
- `e2e/` — old Playwright tests (now at `app/frontend/tests/e2e/`)
- `dev.sh` — replaced by `just dev`
- Root `playwright.config.ts` — config now at `app/frontend/playwright.config.ts`

### Updates

- `pnpm-workspace.yaml` — update to `["app/frontend"]` (if not already done in Phase 1)
- Root `package.json` — remove old scripts referencing `packages/`
- `docs/memory/run-kit/architecture.md` — update all path references from `packages/` to `app/`
- `docs/memory/run-kit/ui-patterns.md` — update path references
- `docs/specs/architecture.md` — final alignment if any decisions changed during implementation

### Verification

- `just verify` must pass (check + test + build)
- `git grep packages/` returns zero matches in non-archived files
- `git grep "e2e/"` returns zero matches except `app/frontend/tests/e2e/`

## Affected Memory

- `run-kit/architecture`: (modify) Final path updates, remove references to `packages/` and `dev.sh`
- `run-kit/ui-patterns`: (modify) Update component file path references

## Impact

- **Repository structure** — significant deletion of old code
- **No functional changes** — all functionality already lives in `app/`

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete `packages/` entirely | Discussed — old implementation replaced by `app/` | S:95 R:70 A:95 D:95 |
| 2 | Certain | Delete `e2e/` directory | Discussed — tests moved to `app/frontend/tests/e2e/` | S:95 R:75 A:95 D:95 |
| 3 | Certain | Delete `dev.sh` | Discussed — replaced by `just dev` | S:95 R:85 A:95 D:95 |
| 4 | Confident | Update memory files with new paths | Standard post-implementation cleanup; paths must be accurate | S:80 R:85 A:85 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
