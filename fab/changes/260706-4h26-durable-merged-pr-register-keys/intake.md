# Intake: Durable Merged-PR Dot + 3-Char Register Keys

**Change**: 260706-4h26-durable-merged-pr-register-keys
**Created**: 2026-07-06

## Origin

> Durable merged-PR dot + 3-char register keys: replace the D2 grace-window (branchPRMergedGrace/wentNegativeAt in prstatus_branch.go) with state-all branch→PR derivation — precedence open (most recent) > merged (most recent), closed-unmerged never owns the dot — so a merged PR's purple/orange done-square is stateless and restart-proof (observed bug: #318's window decayed to a green done-square after merge because the 10-min in-memory grace expired/was wiped by rk restart); and normalize the PANE panel register keys to fixed-width 3-char (output→out, agent→agt) matching tmx/cwd/git, per the revised spec on PR #316

Conversational follow-up to `260706-y1ar-status-pyramid-ui-surfacing` (merged as
PR #318). The user observed both defects live minutes after merging: the y1ar
pipeline window's dot showed a **green** done-square where a **purple** merged-PR
done-square was expected, and the PANE panel's `output`/`agent` register keys
broke the 3-char column vocabulary. The design authority is
`docs/specs/status-pyramid.md` on PR #316, **already revised this session** to
carry both targets: § facts item 6 "Merged-PR durability is derived, not
remembered" **[target — D2 revised]**, the D2 row in § Open Decisions, and the
3-char register-key note in § Row Minimalism **[target — follow-up PR]**.

## Why

1. **Merged purple decays to green (observed in production).** y1ar resolved D2
   with a `--state open` lookup plus a 10-minute **in-memory** grace window
   (`branchPRMergedGrace` / `wentNegativeAt`, `app/backend/internal/prstatus/prstatus_branch.go`).
   Two independent defeat paths, both hit immediately: the grace expires after
   10 minutes, and any rk restart (e.g. deploying the very build being
   verified) wipes the clock. Either way `prNumber` vanishes → the ladder falls
   to the fab tier → green done-square. The user's learned expectation —
   merged = purple square — silently broke minutes after merging #318.
2. **Remembering violates the project's own grain.** Deriving merged-ness from
   `gh` at request time is stateless, restart-proof, and Constitution-II-clean;
   the grace clock was hidden mutable state bolted on to compensate for an
   artificially narrowed query. The fix *deletes* machinery.
3. **Register keys break the column.** The PANE panel's vocabulary is
   fixed-width 3-char (`tmx`/`cwd`/`git`/`fab`) but y1ar added `output` and
   `agent` — misaligned and visually noisy at sidebar width.

## What Changes

### 1. State-all branch→PR derivation (`app/backend/internal/prstatus/prstatus_branch.go`)

- The branch lookup drops `--state open` and queries **all states** (e.g.
  `gh pr list --head <branch> --state all --json number,url,state,isDraft,updatedAt,...`
  — or whatever field set the current query uses, plus `state`/`updatedAt`).
- **Selection precedence** (per revised spec D2): an **open** PR (most recently
  updated) always wins; else the most recent **merged** PR; else the most
  recent **closed** PR (derived for the register/tip — the frontend ladder
  already excludes `closed` from dot ownership via `prOwnsDot`, giving the
  green fab fallback / gray floor). Branch-reuse edge covered by open>merged.
- **Delete the grace machinery**: `branchPRMergedGrace`, `wentNegativeAt`, the
  negative-stamp retention logic, and their tests — replaced by tests for the
  precedence rule and the merged-durability behavior (a merged PR keeps
  serving after simulated restart, i.e. from a cold collector with the same
  gh responses).
- Existing polling cadence, per-(repo,branch) caching, and gh-absent
  degradation are unchanged. The viewer-wide collector (which already queries
  OPEN/MERGED/CLOSED for known URLs) is unchanged.
- Frontend requires **no ladder change** — `statusDotState`/`prOwnsDot` already
  map merged→done-square (purple fab / orange ad-hoc) and exclude closed; the
  bug is purely that derivation stopped supplying merged PRs.

### 2. 3-char register keys (`app/frontend/src/components/sidebar/status-panel.tsx`)

- The L0 register prefix `output` → **`out`**; the L1 register prefix `agent` →
  **`agt`**. `tmx`/`cwd`/`git`/`fab` unchanged; the PR register keeps its `PR`
  prefix (2-char, same NBSP-padded advance alignment the panel already uses).
- Update the register-view unit tests and the `pane-register-panel` e2e spec
  (+ its `.spec.md` companion) for the new prefixes.
- Check `docs/site/status-dot.md` for any register-key or grace-window wording
  that this change invalidates (the y1ar rewrite may mention the D2 grace) and
  align it.

## Affected Memory

- `run-kit/architecture`: (modify) rewrite the § Branch→PR Derivation D2
  subsection — grace-window machinery replaced by state-all + precedence rule
- `run-kit/ui-patterns`: (modify) register-key vocabulary (out/agt), D2 note in
  the § Status Dot section if it references the grace window

## Impact

- **Backend**: `internal/prstatus/prstatus_branch.go` + its tests. No API
  surface change (same WindowInfo PR fields; `prState` may now be "merged"/
  "closed" from the branch path — the frontend already handles all three).
- **Frontend**: `status-panel.tsx` prefixes + tests; `pane-register-panel`
  e2e + `.spec.md`.
- **Docs**: `docs/site/status-dot.md` alignment pass; spec on #316 already
  carries the targets (flip its two `[target — follow-up PR]` markers to
  `[current]` in a #316 commit AFTER this change merges — not in this PR).
- **Tests**: `just test-backend`, `just test-frontend`, targeted
  `just test-e2e "pane-register-panel"`.
- **Depends on**: #318 merged (it is). Branch from current origin/main.

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace grace-window with state-all derivation, precedence open (most recent) > merged (most recent); closed derived but never owns the dot | User-confirmed after live observation of the decay bug; encoded in the revised spec D2 on #316 this session | S:90 R:80 A:90 D:90 |
| 2 | Certain | Register keys: `output`→`out`, `agent`→`agt`; `PR` stays (2-char, padded); tmx/cwd/git/fab unchanged | Explicit user instruction ("convert all keys to 3 digits (output -> out) etc.") | S:85 R:90 A:90 D:85 |
| 3 | Confident | Grace machinery (`branchPRMergedGrace`, `wentNegativeAt`) deleted outright, not kept as fallback | The state-all query makes it redundant; keeping dead retention logic contradicts minimal surface | S:70 R:75 A:85 D:80 |
| 4 | Confident | Closed PRs are still derived (register/tip) rather than filtered out server-side | Spec row 10/D1: derivation universal; frontend `prOwnsDot` already excludes closed from ownership | S:65 R:80 A:85 D:75 |
| 5 | Confident | No frontend ladder changes needed; fix is derivation-side only (plus the key prefixes) | Verified this session: `prOwnsDot` maps merged→owned/done and excludes closed; the ladder was starved of data, not wrong | S:70 R:75 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
