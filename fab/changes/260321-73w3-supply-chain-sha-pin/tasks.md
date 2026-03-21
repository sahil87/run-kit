# Tasks: Supply Chain Hardening — SHA-Pin GitHub Actions

**Change**: 260321-73w3-supply-chain-sha-pin
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Pin `actions/checkout@v4` to SHA `34e114876b0b11c390a56381ad16ebd13914f8d5` in `.github/workflows/release.yml`
- [x] T002 [P] Pin `actions/setup-go@v5` to SHA `40f1582b2485089dde7abd97c1529aa768e1baff` in `.github/workflows/release.yml`
- [x] T003 [P] Pin `actions/setup-node@v4` to SHA `49933ea5288caeca8642d1e84afbd3f7d6820020` in `.github/workflows/release.yml`
- [x] T004 [P] Pin `pnpm/action-setup@v4` to SHA `fc06bc1257f339d1d5d8b3a19a8cae5388b55320` in `.github/workflows/release.yml`
- [x] T005 [P] Pin `softprops/action-gh-release@v2` to SHA `153bb8e04406b158c6c84fc1615b65b24149a1fe` in `.github/workflows/release.yml`

All tasks completed in commit `1e11d57`.

---

## Execution Order

All tasks are independent ([P]) — no ordering dependencies.
