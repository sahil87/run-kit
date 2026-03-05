# Quality Checklist: Set Up Vitest Testing Infrastructure

**Change**: 260303-07iq-setup-vitest
**Generated**: 2026-03-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Vitest installed: `vitest` appears in devDependencies and is importable
- [ ] CHK-002 React testing ecosystem: `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` all in devDependencies
- [ ] CHK-003 Vitest config: `vitest.config.ts` exists with React plugin, jsdom env, `@/` alias, setup file, include pattern
- [ ] CHK-004 Setup file: `src/test-setup.ts` imports `@testing-library/jest-dom`
- [ ] CHK-005 Test scripts: `package.json` has `test` and `test:watch` scripts
- [ ] CHK-006 Smoke test: `src/lib/validate.test.ts` tests `validateName` function
- [ ] CHK-007 Config tests: `src/lib/config.test.ts` tests port validation and config resolution
- [ ] CHK-008 Palette tests: `src/components/command-palette.test.tsx` tests rendering and keyboard interaction

## Scenario Coverage

- [ ] CHK-009 Path alias: test imports `@/lib/validate` and resolves correctly
- [ ] CHK-010 jest-dom matchers: `toBeInTheDocument()` works in test files
- [ ] CHK-011 `pnpm test` runs all test files and exits 0
- [ ] CHK-012 validate.test.ts: valid name returns null
- [ ] CHK-013 validate.test.ts: empty name rejected
- [ ] CHK-014 validate.test.ts: forbidden chars rejected
- [ ] CHK-015 validate.test.ts: colon rejected
- [ ] CHK-016 config.test.ts: valid port accepted, invalid port rejected
- [ ] CHK-017 config.test.ts: missing YAML uses defaults
- [ ] CHK-018 command-palette.test.tsx: hidden by default, Cmd+K opens
- [ ] CHK-019 command-palette.test.tsx: filtering, keyboard nav, Escape closes

## Edge Cases & Error Handling

- [ ] CHK-020 config.test.ts: malformed YAML does not throw
- [ ] CHK-021 config.test.ts: partial YAML merges with defaults
- [ ] CHK-022 command-palette.test.tsx: "No results" shown for unmatched query

## Code Quality

- [ ] CHK-023 Pattern consistency: test files follow co-located `.test.{ts,tsx}` convention
- [ ] CHK-024 No unnecessary duplication: shared test setup in `src/test-setup.ts`, not repeated per file
- [ ] CHK-025 Tests verify spec behavior, not implementation details
- [ ] CHK-026 No `exec()` or shell strings in any new code

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
