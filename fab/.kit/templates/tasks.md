# Tasks: {CHANGE_NAME}

**Change**: {YYMMDD-XXXX-slug}
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] {ID} [{markers}] {Description with file paths}

  Markers (optional, combine as needed):
    [P]   — Parallelizable (different files, no dependencies on other [P] tasks in same group)

  IDs are sequential: T001, T002, ...
  Include exact file paths in descriptions.
  Each task should be completable in one focused session.

  Tasks are grouped by phase. Phases execute sequentially.
  Within a phase, [P] tasks can execute in parallel.
-->

## Phase 1: Setup

<!-- Scaffolding, dependencies, configuration. No business logic. -->

- [ ] T001 {setup task with file path}
- [ ] T002 [P] {parallel setup task}
- [ ] T003 [P] {parallel setup task}

## Phase 2: Core Implementation

<!-- Primary functionality. Order by dependency — earlier tasks are prerequisites for later ones. -->

- [ ] T004 {implementation task referencing specific file path}
- [ ] T005 {task that depends on T004}
- [ ] T006 [P] {independent task}

## Phase 3: Integration & Edge Cases

<!-- Wire components together. Handle error states, edge cases, validation. -->

- [ ] T007 {integration task}
- [ ] T008 {error handling task}

## Phase 4: Polish

<!-- Documentation, cleanup, performance. Only include if warranted by the change scope. -->

- [ ] T009 {polish task}

---

## Execution Order

<!-- Summary of dependencies between tasks. Only include non-obvious dependencies. -->

- T004 blocks T005
- T006 is independent, can run alongside T004-T005
