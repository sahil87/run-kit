# Tasks: Disable Mobile Zoom on Input Focus

**Change**: 260323-z46s-disable-mobile-zoom
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Update viewport meta tag in `app/frontend/index.html` — add `maximum-scale=1.0, user-scalable=no` to the existing `<meta name="viewport">` content attribute, preserving all existing directives

## Execution Order

Single task — no dependencies.
