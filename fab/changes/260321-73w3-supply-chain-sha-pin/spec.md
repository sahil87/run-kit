# Spec: Supply Chain Hardening — SHA-Pin GitHub Actions

**Change**: 260321-73w3-supply-chain-sha-pin
**Created**: 2026-03-21
**Affected memory**: None

## Non-Goals

- Pinning internal org actions (`wvrdz/github-actions@stable`) — org-controlled, not a supply chain vector
- Adding or modifying `permissions:` blocks — `release.yml` already has explicit top-level permissions
- Scoping secrets to step-level — not applicable to this repo's workflow

## CI: SHA-Pinning External GitHub Actions

### Requirement: Immutable Action References

All `uses:` directives referencing external (non-org) GitHub Actions in `.github/workflows/release.yml` SHALL use the full 40-character commit SHA instead of a mutable version tag.

#### Scenario: External action is SHA-pinned

- **GIVEN** an external action reference in `release.yml`
- **WHEN** the workflow file is inspected
- **THEN** the `uses:` value SHALL contain a 40-character hexadecimal commit SHA after the `@` symbol
- **AND** the reference SHALL NOT use a mutable tag (e.g., `v4`, `v5`, `v2`)

#### Scenario: All 5 external actions are pinned

- **GIVEN** the `release.yml` workflow
- **WHEN** all `uses:` directives are enumerated
- **THEN** exactly 5 external action references SHALL be SHA-pinned: `actions/checkout`, `actions/setup-go`, `actions/setup-node`, `pnpm/action-setup`, `softprops/action-gh-release`

### Requirement: Tag Comment Preservation

Each SHA-pinned action reference SHALL include the original version tag as a trailing `# vX` comment on the same line.

#### Scenario: Tag comment is present

- **GIVEN** an SHA-pinned action reference
- **WHEN** the line is inspected
- **THEN** it SHALL end with a comment in the format `# v{N}` where `{N}` is the original major version tag
- **AND** the comment SHALL be separated from the SHA by a single space

### Requirement: Functional Equivalence

The pinned commit SHAs SHALL resolve to the exact same code as the original version tags at the time of pinning. This change SHALL NOT alter any workflow behavior.

#### Scenario: Workflow behavior unchanged

- **GIVEN** the `release.yml` workflow with SHA-pinned actions
- **WHEN** a release tag is pushed
- **THEN** the workflow SHALL execute identically to before the change (same build, same artifacts, same release)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin only external actions | Confirmed from intake #1 — internal `wvrdz/` actions are org-controlled per INFRA-345 scope | S:95 R:90 A:95 D:95 |
| 2 | Certain | Preserve original tags as comments | Confirmed from intake #2 — standard practice for readability | S:95 R:95 A:90 D:95 |
| 3 | Certain | No permissions changes needed | Confirmed from intake #3 — already has explicit `permissions: contents: write` | S:90 R:90 A:95 D:95 |
| 4 | Certain | Only `release.yml` in scope | Confirmed from intake #4 — only workflow file in repo | S:95 R:95 A:95 D:95 |
| 5 | Certain | Non-functional change | SHAs resolve to same code as tags at pinning time | S:95 R:95 A:95 D:95 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
