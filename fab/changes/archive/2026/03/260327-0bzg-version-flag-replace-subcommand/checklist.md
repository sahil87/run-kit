# Quality Checklist: Replace `rk version` Subcommand with `--version` / `-v` Flag

**Change**: 260327-0bzg-version-flag-replace-subcommand
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Version via global flag: `rk --version` prints version string
- [ ] CHK-002 Short flag: `rk -v` prints version string

## Behavioral Correctness
- [ ] CHK-003 Output format: Output matches `rk version {version}` (Cobra default template)
- [ ] CHK-004 Dev default: Without ldflags, `rk --version` prints `rk version dev`

## Removal Verification
- [ ] CHK-005 Subcommand removed: `version.go` deleted, `versionCmd` no longer registered
- [ ] CHK-006 Subcommand tests removed: `version_test.go` deleted
- [ ] CHK-007 No dead references: No remaining references to `versionCmd` in codebase

## Scenario Coverage
- [ ] CHK-008 `--version` flag test exists in `root_test.go`
- [ ] CHK-009 `TestRootCmdHasSubcommands` no longer expects `version`

## Code Quality
- [ ] CHK-010 Pattern consistency: Uses Cobra's built-in `Version` field, not custom flag handling
- [ ] CHK-011 No unnecessary duplication: No version string defined in multiple places

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
