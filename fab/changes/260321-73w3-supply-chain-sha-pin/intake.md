# Intake: Supply Chain Hardening — SHA-Pin GitHub Actions

**Change**: 260321-73w3-supply-chain-sha-pin
**Created**: 2026-03-21
**Status**: Draft

## Origin

> INFRA-345: Supply Chain Hardening — SHA-pin all external GitHub Actions in release.yml to commit SHAs for immutable references.

Linear: INFRA-345 — "Supply chain hardening: SHA-pin GitHub Actions, scope secrets, harden permissions"
One-shot description. Code changes already committed on branch `fix/supply-chain-hardening`.

## Why

Two major supply chain attacks in early 2026 prompted an org-wide posture assessment:

1. **Shai-Hulud 2.0** (Nov 2025) — npm worm compromised PostHog + 754 packages via `preinstall` hooks. Exfiltrated AWS/GCP/Azure creds, npm tokens, GitHub PATs.
2. **Trivy Tag Poisoning** (Mar 2026) — TeamPCP force-pushed 75/76 version tags in `aquasecurity/trivy-action`. Payload dumped runner process memory and exfiltrated CI secrets.

Assessment found **0/358 GitHub Action references were SHA-pinned** across the org (all used mutable tags). Mutable version tags (e.g., `@v4`) can be force-pushed by compromised maintainers, replacing trusted code with malicious payloads. SHA-pinning makes action references immutable — a force-pushed tag no longer affects us.

## What Changes

### SHA-Pin All External GitHub Actions in `release.yml`

Every `uses:` line referencing an external action by version tag has been replaced with the full 40-character commit SHA. The original tag is preserved as a trailing comment for readability and upgrade tracking:

```yaml
# Before
uses: actions/checkout@v4
# After
uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
```

**5 actions pinned** in `.github/workflows/release.yml`:

| Action | Original Tag | SHA |
|--------|-------------|-----|
| `actions/checkout` | `v4` | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
| `actions/setup-go` | `v5` | `40f1582b2485089dde7abd97c1529aa768e1baff` |
| `actions/setup-node` | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `pnpm/action-setup` | `v4` | `fc06bc1257f339d1d5d8b3a19a8cae5388b55320` |
| `softprops/action-gh-release` | `v2` | `153bb8e04406b158c6c84fc1615b65b24149a1fe` |

Internal actions (`wvrdz/github-actions@stable`) are left unchanged — they are org-controlled and not a supply chain risk.

This is a non-functional change — the pinned SHAs resolve to the exact same code the tags pointed to at time of pinning.

## Affected Memory

None — no memory files affected. This is a CI-only change with no impact on application behavior or architecture.

## Impact

- **File**: `.github/workflows/release.yml` (only file changed)
- **CI/CD**: Release workflow. No functional change — same action code executes, now referenced immutably.
- **Risk**: Minimal. SHA-pinning is safe and non-functional. The workflow already has top-level `permissions: contents: write`.

## Open Questions

None — all decisions are deterministic.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pin only external actions | Internal `wvrdz/` actions are org-controlled, per INFRA-345 scope | S:95 R:90 A:95 D:95 |
| 2 | Certain | Preserve original tags as comments | Standard practice for readability and upgrade tracking | S:95 R:95 A:90 D:95 |
| 3 | Certain | No permissions changes needed | `release.yml` already has explicit `permissions: contents: write` at top level | S:90 R:90 A:95 D:95 |
| 4 | Certain | Only `release.yml` in scope | run-kit has only one workflow file | S:95 R:95 A:95 D:95 |
| 5 | Certain | Change type is `fix` (security hardening) | Linear title and context indicate security fix | S:90 R:95 A:90 D:90 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
