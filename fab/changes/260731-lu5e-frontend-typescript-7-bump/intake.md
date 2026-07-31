# Intake: Frontend TypeScript 7 Bump

**Change**: 260731-lu5e-frontend-typescript-7-bump
**Created**: 2026-07-31

## Origin

Promptless dispatch (fab-proceed create-intake subagent, `{questioning-mode} = promptless-defer`), synthesized from a live conversation in which the migration was empirically pre-verified on 2026-07-31.

> Migrate the frontend from TypeScript 6 to TypeScript 7 (native Go compiler). Bump `app/frontend/package.json` devDependency `typescript` from `^6.0.3` to `^7.0.2`, run `pnpm install` to update `pnpm-lock.yaml`, and fix the stale "TypeScript 5.7+" line in `fab/project/context.md`. Keep the change minimal — no tsconfig changes, no new TS-API-dependent tooling.

Key facts verified in the originating session (all empirical, 2026-07-31):

- TypeScript 7.0 (the native Go-port compiler, formerly `tsgo`) went GA on 2026-07-08 and ships as standard `tsc` in the `typescript` npm package.
- TypeScript 7.0.2 `tsc --noEmit` was run against `app/frontend` with its real tsconfig — **zero errors**; wall time 0.6s vs 5.0s on TS 6.0.3 (~8× faster; 2.7s vs 8.5s CPU).
- `app/desktop/package.json` is already on `"typescript": "^7.0.2"` and uses `tsc` for real emit — this change converges the repo on one TS major. (Re-verified during intake: `app/frontend/package.json:44` pins `^6.0.3`; `app/desktop/package.json:24` pins `^7.0.2`.)
- The only `tsc` consumer in the frontend is the `tsc --noEmit` step in the `build` script (`tsc --noEmit && vite build`). Vite/esbuild does the transpile, Vitest uses the Vite transform, Playwright self-transpiles.
- There are NO TypeScript-API consumers anywhere in `app/` or `scripts/` — no typescript-eslint, no ts-node, no router codegen, no programmatic `import "typescript"`. The known TS 7 ecosystem caveat (stable programmatic API lands in 7.1; typescript-eslint blocked until then) therefore does not apply to this repo.

## Why

1. **Problem**: The frontend is pinned to TypeScript 6.0.3 while `app/desktop` already runs TypeScript 7.0.2 — two TS majors in one repo. The frontend typecheck (`tsc --noEmit`, the first half of every `build`) takes 5.0s on TS 6 vs 0.6s on TS 7 (~8× faster wall, ~3× less CPU), a tax paid on every production build and every code-quality verification pass.
2. **If not fixed**: The repo stays split across TS majors (divergent language behavior and diagnostics between frontend and desktop), and every build/typecheck cycle keeps paying the 8× speed penalty for no benefit.
3. **Why this approach**: TS 7 is GA in the standard `typescript` npm package, and the migration was already proven green empirically — zero type errors on the real tsconfig, no config changes needed, no blocked tooling in the dependency graph. A caret bump plus lockfile refresh is the entire migration surface; anything larger (tsconfig rework, tooling swaps) would be gold-plating.

## What Changes

### 1. `app/frontend/package.json` — typescript devDependency bump

Change the `typescript` entry in `devDependencies` (currently line 44):

```diff
-    "typescript": "^6.0.3",
+    "typescript": "^7.0.2",
```

Then run `pnpm install` from `app/frontend/` to update `pnpm-lock.yaml`. Expected lockfile delta: the `typescript` resolution moves from 6.0.3 to a 7.0.x release; no other dependency changes are intended.

No tsconfig changes: current options (`moduleResolution: bundler`, `jsx: react-jsx`, `paths`, `allowJs`, `isolatedModules`) are all supported by TS 7 and were verified in the pre-check.

### 2. `fab/project/context.md` — fix stale TS version line

The Frontend section (`## Frontend — app/frontend/`, line 41) currently reads:

```markdown
- **Language**: TypeScript 5.7+
```

Update it to reflect TypeScript 7, e.g.:

```markdown
- **Language**: TypeScript 7 (native Go compiler)
```

### Non-changes (explicit scope exclusions)

- `app/desktop/package.json` — untouched (already `^7.0.2`).
- `app/frontend/tsconfig*.json` — untouched (verified compatible).
- No TS-API-dependent tooling (typescript-eslint, ts-node, etc.) is added.
- Build script stays `tsc --noEmit && vite build` — the `tsc` binary simply resolves to the TS 7 native compiler.

## Affected Memory

None — implementation-only tooling bump. No `docs/memory/` file pins the frontend TypeScript version (verified by grep: `desktop-shell.md` mentions `typescript` as an app/desktop devDependency without a version pin, which this change does not touch). No spec-level behavior changes.

## Impact

- **Files**: `app/frontend/package.json` (1 line), `app/frontend/pnpm-lock.yaml` (typescript resolution), `fab/project/context.md` (1 line).
- **Systems**: frontend typecheck/build path only. Runtime bundle output is unaffected (Vite/esbuild transpiles; `tsc` is check-only in this package).
- **Dependencies**: `typescript` 6.0.3 → 7.0.x. No transitive tooling depends on the TypeScript programmatic API.
- **Verification** (agreed in the originating conversation, matching `fab/project/code-quality.md` gates): `just test` (backend + frontend + e2e) and `just build`. The typecheck itself is already proven green on TS 7.0.2.

## Open Questions

None — the migration surface was fully enumerated and empirically verified in the originating session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bump to `^7.0.2` (caret range) in `app/frontend/package.json` devDependencies; no tsconfig changes | Explicit in the change description; TS 7.0.2 `tsc --noEmit` empirically verified zero-errors against the real tsconfig; matches app/desktop's existing pin style | S:95 R:95 A:100 D:100 |
| 2 | Certain | Migration surface is the single `tsc --noEmit` build step — no TS-API consumers exist to break | Verified in the originating session: no typescript-eslint/ts-node/codegen/programmatic imports in `app/` or `scripts/`; Vite/Vitest/Playwright do not invoke `tsc` | S:95 R:90 A:100 D:100 |
| 3 | Certain | Leave `app/desktop` untouched | Already on `^7.0.2` (verified at `app/desktop/package.json:24`); touching it would be scope creep | S:90 R:95 A:100 D:95 |
| 4 | Certain | Verification = `just test` + `just build` | Explicitly agreed in the originating conversation and identical to the code-quality.md verification gates | S:95 R:90 A:95 D:95 |
| 5 | Certain | Change type is `chore` (dependency/tooling bump) | Matches the change-types taxonomy for dependency bumps; description says "likely chore" | S:90 R:95 A:95 D:95 |
| 6 | Certain | `context.md` line becomes "TypeScript 7 (native Go compiler)" — exact wording is agent's choice | Description mandates fixing the stale "5.7+" line but not the exact replacement text; trivially reversible one-line doc edit with an obvious default | S:85 R:95 A:90 D:80 |
| 7 | Certain | No new tests required; existing gates (typecheck, `just test`, `just build`) cover the change | code-quality.md requires tests for "features and bug fixes" — a toolchain version bump changes no behavior to test; the typecheck IS the test | S:70 R:85 A:85 D:80 |

7 assumptions (7 certain, 0 confident, 0 tentative, 0 unresolved).
