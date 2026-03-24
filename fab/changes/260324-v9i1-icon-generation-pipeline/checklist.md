# Quality Checklist: Icon Generation Pipeline

**Change**: 260324-v9i1-icon-generation-pipeline
**Generated**: 2026-03-24
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Single Source SVG: `app/frontend/public/icon.svg` exists with identical content to old `logo.svg`
- [ ] CHK-002 Generation Script: `scripts/generate-icons.sh` exists and produces all 4 output files
- [ ] CHK-003 PNG Background: Generated PNGs have solid `#0f1117` background, not transparent
- [ ] CHK-004 PNG Padding: Standard icons ~20% padding, maskable ~40% padding
- [ ] CHK-005 Favicon Copy: `generated-icons/favicon.svg` is a file copy (not symlink) of `icon.svg`
- [ ] CHK-006 HTML References: `index.html` references `/generated-icons/favicon.svg` and `/generated-icons/icon-192.png`
- [ ] CHK-007 Manifest References: `manifest.json` references `/generated-icons/*` paths
- [ ] CHK-008 Top Bar Logo: `top-bar.tsx` references `/icon.svg`
- [ ] CHK-009 Justfile Recipe: `just icons` recipe exists and runs the generation script

## Behavioral Correctness
- [ ] CHK-010 Old icons directory removed: `app/frontend/public/icons/` does not exist
- [ ] CHK-011 Old script removed: `scripts/regenerate-png-logos.sh` does not exist
- [ ] CHK-012 Old logo removed: `app/frontend/public/logo.svg` does not exist

## Scenario Coverage
- [ ] CHK-013 Script idempotency: Running `scripts/generate-icons.sh` twice produces identical output
- [ ] CHK-014 Type check passes: `pnpm exec tsc --noEmit` succeeds
- [ ] CHK-015 Unit tests pass: `pnpm test` succeeds

## Code Quality
- [ ] CHK-016 Pattern consistency: Script follows existing `scripts/` conventions (shebang, set -euo pipefail)
- [ ] CHK-017 No unnecessary duplication: Single canonical SVG, all variants derived from it
