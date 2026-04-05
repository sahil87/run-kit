# Tasks: Icon Generation Pipeline

**Change**: 260324-v9i1-icon-generation-pipeline
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Rename `app/frontend/public/logo.svg` → `app/frontend/public/icon.svg` (git mv)
- [x] T002 [P] Delete `app/frontend/public/icons/` directory (3 old PNGs)
- [x] T003 [P] Delete `scripts/regenerate-png-logos.sh`
- [x] T004 [P] Create empty `app/frontend/public/generated-icons/` directory

## Phase 2: Core Implementation

- [x] T005 Install `sharp` as devDependency in `app/frontend/` (`pnpm add -D sharp`)
- [x] T006 Create `scripts/generate-icons.sh` — inline Node script using sharp API: copy favicon.svg, generate icon-192.png (20% padding, #0f1117 bg), icon-512.png (20% padding), icon-512-maskable.png (40% padding)
- [x] T007 Run `scripts/generate-icons.sh` and verify all 4 output files exist in `app/frontend/public/generated-icons/`

## Phase 3: Integration

- [x] T008 [P] Update `app/frontend/index.html` — favicon href → `/generated-icons/favicon.svg`, apple-touch-icon href → `/generated-icons/icon-192.png`
- [x] T009 [P] Update `app/frontend/src/components/top-bar.tsx` — change both `src="/logo.svg"` to `src="/icon.svg"`
- [x] T010 [P] Update `app/frontend/public/manifest.json` — all icon paths from `/icons/*` to `/generated-icons/*`
- [x] T011 Add `icons` recipe to `justfile` under `# ─── Assets ───` section, runs `scripts/generate-icons.sh`

## Phase 4: Verification

- [x] T012 Run `cd app/frontend && pnpm exec tsc --noEmit` to verify no type errors
- [x] T013 Run `cd app/frontend && pnpm test` to verify existing tests pass (5 pre-existing failures unrelated to change; 84 passing tests unaffected)

---

## Execution Order

- T001 blocks T006 (script reads icon.svg, must exist first)
- T002, T003, T004 are independent of each other and T001
- T005 blocks T006 (sharp must be installed)
- T006 blocks T007 (script must exist before running)
- T008, T009, T010 are independent of each other
- T012, T013 run after all other tasks
