# Intake: Install-Composition Policy A Binary-Half Audit

**Change**: 260814-mx8e-install-policy-a-binary-audit
**Created**: 2026-08-14

## Origin

One-shot `/fab-new` from backlog item `[mx8e]` (fab/backlog.md:64, from the 08-14 memory-distillation batch, relocated from `docs/memory/run-kit/toolkit-standards.md` by `/docs-distill-memory` in PR #602):

> [mx8e] 2026-08-14: Audit install-composition Policy A (binary half) for run-kit — verify sibling-probe coverage at runtime and the actionable per-formula install hints in binary output (e.g. app/backend/cmd/rk/upgrade.go's non-brew `brew install sahil87/tap/run-kit` hint). Policy A conformance is currently unclaimed; the docs half (Policy B) already PASSes.

The dispatcher's framing (verbatim constraints): *"This is an AUDIT — findings may become follow-up backlog work rather than one shipped fix; do not force a code change if the audit concludes conformance already holds. When done, tick the box [x] in fab/backlog.md (id mx8e) and record the audit finding in the item note."*

## Why

1. **The pain point**: run-kit's constitution (§ Toolkit Standards, v1.7.0) binds it to the shll toolkit's published standards. The `install-composition` standard has two halves; the docs half (Policy B) was audited and PASSes (`260720-ec6i-install-docs-policy-b`), but the binary half (Policy A — probe siblings at runtime, degrade with an actionable install hint, no sibling `depends_on` in the tap formula) has **no audit on record**. `docs/memory/run-kit/toolkit-standards.md` carries an explicit "Requirement: Policy A's binary half is unaudited" section marking the conformance claim as unclaimed.

2. **The consequence of not doing it**: an unprobed sibling call turns another tool's absence into run-kit's crash — the standard's named failure mode ("the whole toolkit becomes only as reliable as its least-installed member"). Until audited, run-kit cannot claim install-composition conformance, and any real probe gap ships silently. The conformance memory file also stays permanently split (one half PASS, one half unclaimed), which every future re-audit inherits.

3. **Why an audit rather than a fix**: nothing is known to be broken — a preliminary scan (below) shows probes already exist at several seams. The correct move is to measure against the standard's own "Verifying conformance" checklist and either record a PASS or file precise follow-up backlog items per gap. Forcing a code change on an already-conformant surface would be work without a defect.

## What Changes

This is an **audit-only change**: it produces a conformance verdict and records it. No production code is modified unless the audit itself is impossible without it (not expected). Findings that require code changes become new `fab/backlog.md` items, not fixes in this change.

### Audit procedure (binding rules from the conformance memory)

Both are standing requirements in `docs/memory/run-kit/toolkit-standards.md`:

1. **Audit against a HEAD build, never the installed brew binary**: `just build` → `bin/rk` (source `app/backend/cmd/rk/`). The installed brew `rk` lags the tree and false-negatives surfaces adopted at HEAD.
2. **Enumerate the standards set at runtime**: re-run `shll standards` and `shll standards install-composition` for the authoritative text at audit time (never work from memory or the website), and **pin the shll version** (`shll version`) the audit was measured at — the prior Policy B audit pinned `shll v0.1.12`. If `shll standards` fails, run `shll update` once; if it still fails, STOP and report.

### Audit checklist (Policy A's own "Verifying conformance" section, binary half)

From `shll standards install-composition` (verified present at intake time):

1. **Formula check**: the run-kit tap formula (`sahil87/tap/run-kit`) declares no `depends_on` on a sibling toolkit formula. Read-only check — via `brew info --json=v2 run-kit` or reading the tap repo (`sahil87/homebrew-tap`). The seven toolkit formulas: shll, wt, idea, hop, tu, fab-kit, run-kit.
2. **Probe coverage**: every runtime sibling invocation sits behind a probe — `exec.LookPath` in Go, `command -v` in shell/skill code. Never assume a sibling is installed.
3. **Graceful degradation with an actionable hint**: every missing-sibling path skips with an actionable install hint — the standard's verbatim example: `wt is not installed. Install it: brew install sahil87/tap/wt` — never a crash.

Note the Policy A/B boundary the audit must respect: per-formula `brew install sahil87/tap/<tool>` hints are **mandated in binary output** (Policy A) and **prohibited in docs** (Policy B). A hint string in Go source is conformance, not a Policy B violation.

### Sibling-invocation inventory to audit (preliminary scan, to be re-swept during apply)

Toolkit siblings run-kit's binary invokes are `wt`, `fab`, and `shll`. Known seams from an intake-time grep of `app/backend/`:

| Sibling | Call sites | Probe observed at intake |
|---------|-----------|--------------------------|
| `wt` | `cmd/rk/riff.go:288` (LookPath), `internal/riff/riff.go:411,751` (exec), `internal/wt/wt.go:52,90` (exec) | riff CLI entry probes; whether `internal/wt`'s exec paths and riff's internal wt/fab execs are probe-covered (or covered upstream) is the audit's question |
| `fab` | `internal/riff/riff.go:346`, `internal/sessions/sessions.go:130` (exec) | no LookPath visible at these sites at intake — verify whether absence degrades gracefully (exec error handled + hint) or crashes |
| `shll` | `internal/updatecheck/updatecheck.go:497` (LookPath), `api/update.go:41` (`lookShllFn` = LookPath, with documented shll-ABSENT degrade path) | probes present; verify the degrade messages carry actionable hints |

Also in scope: shell/skill code the repo ships (`scripts/`, `docs/site/skill*.md` recipes) for `command -v` probes on sibling invocations. Out of Policy A scope: non-toolkit binaries (`tmux`, `gh`, `brew`, `lsof`, `ss`, `code-server`) — the standard governs *sibling toolkit formulas* only.

The illustrative hint the backlog names — `cmd/rk/upgrade.go:240-242`, printing `run-kit v%s was not installed via Homebrew.` + `brew install sahil87/tap/run-kit` on a non-brew install — is a **self**-install hint rather than a missing-**sibling** hint; the audit assesses it as the backlog frames it (the Policy-A-mandated actionable-hint pattern in binary output) and checks the true sibling paths (`wt`/`fab`/`shll` absence) for equivalent hints.

### Deliverables

1. **Audit report** written to the change folder (`fab/changes/260814-mx8e-install-policy-a-binary-audit/`), following the `260717-c424` precedent: the report lives in the change folder and is lifted into the PR body at ship — no committed copy under `docs/` (drift, no consumer).
2. **Memory update (hydrate)**: `docs/memory/run-kit/toolkit-standards.md` — replace the "Requirement: Policy A's binary half is unaudited" section with the audited Policy A posture (verdict, mechanism summary, shll version pin), alongside the existing Policy B PASS.
3. **Backlog bookkeeping**: tick `[x]` on `[mx8e]` in `fab/backlog.md` and append the audit finding to the item note. Any nonconformance found becomes a **new** backlog item (per the `260717-c424` deferral convention: gaps go to fab/backlog.md, referenced from the report by backlog id).

### Non-goals

- No production code changes (probe additions, hint rewording) in this change — those are follow-up backlog items if found.
- No re-audit of Policy B (docs half) — it PASSes and is untouched.
- No re-audit of the other seven standards (help-dump, readme-extraction, skill, principles, update, version, shell-init) — out of scope.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) Replace the "Policy A's binary half is unaudited" requirement with the audited Policy A conformance posture — verdict per checklist item (formula, probes, hints), shll version pin, and any deferred-gap backlog references.

## Impact

- **Read**: `app/backend/cmd/rk/` (upgrade.go, riff.go, doctor.go), `app/backend/internal/{riff,wt,sessions,updatecheck}/`, `app/backend/api/update.go`, `scripts/`, `docs/site/skill*.md`; the sahil87/tap formula (external, read-only); `bin/rk` HEAD build behavior.
- **Write**: the change-folder audit report, `fab/backlog.md` (tick + note, possibly new items), and at hydrate `docs/memory/run-kit/toolkit-standards.md`.
- **No API, frontend, or runtime behavior changes.** Test suites unaffected (no code change expected); the HEAD build itself is exercised read-only.

## Open Questions

- None — the backlog item, the standard's own conformance checklist, and the conformance memory's audit rules fully determine scope and procedure.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is Policy A's binary half only (runtime sibling probes + missing-sibling hints + formula `depends_on` check); Policy B is not re-audited | Backlog item and toolkit-standards memory state both halves' status explicitly | S:90 R:90 A:95 D:95 |
| 2 | Certain | Audit-only: findings are recorded, never forced into code fixes here; nonconformance becomes follow-up backlog items | Dispatcher instruction verbatim ("do not force a code change"); matches the 260717-c424 deferral convention | S:90 R:85 A:90 D:90 |
| 3 | Certain | Audit against a HEAD build (`just build` → `bin/rk`), never the installed brew rk | Standing requirement in toolkit-standards memory with a worked false-negative scenario | S:85 R:90 A:95 D:95 |
| 4 | Certain | Re-run `shll standards install-composition` at audit time and pin the `shll version` in the recorded posture | Standing requirement in toolkit-standards memory; prior audits pinned v0.0.23 / v0.1.12 | S:85 R:90 A:95 D:90 |
| 5 | Certain | Sibling set = toolkit-roster tools rk invokes (`wt`, `fab`, `shll`); non-toolkit binaries (tmux, gh, brew, lsof, ss, code-server) are out of Policy A scope | Standard text governs "sibling toolkit formulas"; the seven-formula roster is enumerated in the standard's scope clause | S:70 R:85 A:85 D:80 |
| 6 | Confident | The formula check (no sibling `depends_on` in sahil87/tap/run-kit) is included even though the formula lives in the tap repo — read-only verification, any fix deferred to the tap | The standard's "Verifying conformance" checklist lists it first; Policy A "binds all seven tap formulas" | S:60 R:80 A:75 D:70 |
| 7 | Confident | Report lives in the change folder and is lifted into the PR body at ship; no committed copy under docs/ | 260717-c424 Design Decision ("report lives in the PR body", "no parallel in-repo copy — drift, no reader") | S:65 R:75 A:85 D:75 |
| 8 | Confident | upgrade.go's non-brew `brew install sahil87/tap/run-kit` self-hint is assessed in scope as the illustrative Policy-A binary-output hint, and the true missing-sibling paths (wt/fab/shll absent) are checked for equivalent hints | Backlog names it as the example; the standard's hint clause targets missing *siblings*, so both readings are audited | S:70 R:80 A:70 D:65 |
| 9 | Confident | change_type = docs (outputs are a report, backlog edits, and memory updates; no production code) | Audit deliverables are documentation artifacts; verified/overridden at Step 6 | S:60 R:90 A:80 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
