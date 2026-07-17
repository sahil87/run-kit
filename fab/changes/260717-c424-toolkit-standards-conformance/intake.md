# Intake: Toolkit Standards Conformance

**Change**: 260717-c424-toolkit-standards-conformance
**Created**: 2026-07-18

## Origin

One-shot `/fab-new` invocation with a complete task directive:

> Task: Bring this repo and its tool into conformance with the sahil87 toolkit standards.
>
> Precondition: `shll standards` runs on this machine (if the subcommand is missing, run `shll update`; if it still fails, stop and report — do not proceed from memory or the website). This repo's constitution carries the Toolkit Standards article; this task is the conformance work it mandates.
>
> 1. Enumerate at runtime: run `shll standards`, then `shll standards <name>` for every listed entry. The list is authoritative — do not assume which standards exist or what they require.
> 2. Audit this repo against each standard. For mechanical contracts (machine help output, README/docs-site structure), execute the standard's own verification checklist verbatim. For the principles, assess each numbered principle against the tool's actual behavior — prompts and TTY handling, stdout/stderr separation, --json/--dry-run/--yes coverage, exit codes and error wording, idempotency, output volume.
> 3. Fix what is proportionate here: all mechanical-contract violations, and principle gaps that are small and additive (a missing flag, a misrouted stream, an unhelpful error). Larger gaps that would restructure the tool are NOT for this change — record each as a draft change or issue per this repo's convention and reference it.
> 4. Deliverable: one fab change whose PR body contains a conformance report — one section per standard with PASS or the gaps found, each gap dispositioned as fixed here (with the commit) or deferred to <ref>. Include the shll version audited against (`shll version`'s shll row), since standards are versioned with the shll release. Tests green; if the command tree changed, re-verify the machine-help contract afterward.
>
> Note on the "skill" standard specifically: if this repo has not yet implemented a `<tool> skill` subcommand, that is a known, deferred gap (per the toolkit's phased per-repo adoption — no seven-repo flag-day) — report it as "deferred, not yet adopted" rather than treating it as an in-scope fix for this change.

Key facts established during intake (2026-07-18, this machine):

- **Precondition passes**: `shll standards` exits 0. No `shll update` was needed.
- **Runtime enumeration** (context capture — apply re-runs it as the authoritative list):

  ```
  principles         foundation   The ten toolkit CLI principles every tool is built against
  help-dump          binary       Machine-readable help contract every tool must emit
  readme-extraction  repo         README + docs/site structure standard for toolkit repos
  skill              binary+repo  Agent skill bundle standard: docs/site/skill.md served by `<tool> skill`
  ```

- **shll version to pin in the report**: `shll v0.0.23` (from `shll version`'s shll row).
- **The skill standard is already adopted at HEAD**: `app/backend/cmd/rk/skill.go` and `docs/site/skill.md` exist (PR #381, change `260717-agst-rk-skill-agent-setup-hooks-only`). The task's "deferred, not yet adopted" contingency does NOT apply — the skill standard is audited in full.
- **The installed `rk` binary is stale**: linuxbrew `rk` reports v3.7.2 and rejects `rk skill` (`unknown command "skill" for "run-kit"`). The audit MUST run against a HEAD build (`just build` → `bin/rk`), never the installed binary.

## Why

1. **The constitution mandates this.** Constitution § Toolkit Standards (v1.6.0, amended 2026-07-18, landed via PR #379) binds run-kit to the sahil87 toolkit standards enumerated by `shll standards`: "This tool is part of the sahil87 toolkit and MUST conform to the toolkit's published standards." The article was ratified without the accompanying conformance audit — this change is that audit plus the proportionate fixes.
2. **Without it, the binding is a dead letter.** The CLI surface, help output, README, and docs/site were all authored before the standards existed (or before the article bound them). Unaudited, the repo silently drifts from the published contracts: machine-help consumers (other toolkit tooling parsing the help dump) break, agents relying on the skill bundle or scriptability principles (stream separation, exit codes, `--json`) hit inconsistencies, and the docs-site structure diverges from what shll.ai renders.
3. **One change with a pinned, auditable report — not piecemeal fixes.** Standards are versioned with the shll release, so a conformance claim is only meaningful against a named version (v0.0.23). A single PR whose body is the per-standard report makes the claim checkable and gives future audits a baseline diff. Deferring restructural gaps (rather than fixing everything now) keeps the change reviewable and honors the toolkit's phased-adoption posture.

## What Changes

### 1. Runtime enumeration (apply's first step)

Apply re-runs the precondition and enumeration verbatim — the intake capture above is context, not the source of truth:

```sh
shll standards                 # authoritative list — audit exactly these entries
shll standards <name>          # full text of each standard, for every listed entry
shll version                   # pin the shll row (v0.0.23 at intake) in the report
```

If `shll standards` fails at apply time: run `shll update` once; if it still fails, STOP and report — do not proceed from memory or the website (task precondition, verbatim).

### 2. Audit — one pass per standard, method by kind

**Audit target**: a HEAD build of the repo's tool — `just build` producing `bin/rk` (canonical command name `run-kit`, alias `rk`; source `app/backend/cmd/rk/`). Never the installed brew binary (v3.7.2 — predates `rk skill` and would false-negative).

- **Mechanical contracts** (`help-dump`, `readme-extraction`, `skill`): execute each standard's own verification checklist **verbatim** — whatever commands/checks the standard text prescribes, run them as written against `bin/rk`, `README.md`, and `docs/site/`.
- **Principles** (`principles` — the ten toolkit CLI principles): assess each numbered principle against the tool's actual behavior. Dimensions named by the task: prompts and TTY handling, stdout/stderr separation, `--json`/`--dry-run`/`--yes` coverage, exit codes and error wording, idempotency, output volume. Evidence = running the built binary and reading `app/backend/cmd/rk/` handlers, not assumption.

### 3. Fixes — proportionality rule

- **In scope (fix here)**: ALL mechanical-contract violations (help-dump output shape, README/docs-site structure, skill-bundle serving), and principle gaps that are small and additive — a missing flag, a misrouted stream (stdout↔stderr), an unhelpful error message, a missing non-zero exit.
- **Out of scope (defer)**: any gap whose fix would restructure the tool (e.g., a global output-format overhaul, reworking a command's interaction model). Each deferred gap is recorded as a `fab/backlog.md` entry (the repo's convention) and referenced from the report as `deferred to [<id>]`.

### 4. Deliverable — conformance report in the PR body

One fab change (this one). The PR body carries the report:

```markdown
## Conformance Report — sahil87 toolkit standards @ shll v0.0.23

### principles
PASS | gaps:
- <gap> — fixed here (<commit sha>)
- <gap> — deferred to [<backlog id>]

### help-dump
...one section per enumerated standard...

### readme-extraction
...

### skill
...
```

Every gap found in the audit appears with exactly one disposition: `fixed here (<commit>)` or `deferred to <ref>`. The shll version row pins which standards revision the claim is made against.

### 5. Verification

- Tests green via `just` recipes (never direct `go test`/`pnpm`/`playwright` — project convention): `just test-backend` for CLI-surface changes, escalating to `just test` before ship.
- If the audit's fixes changed the command tree (new flag, new subcommand, renamed anything): re-execute the `help-dump` standard's verification checklist afterward as the final apply step.

## Affected Memory

- `run-kit/toolkit-standards`: (new) The toolkit-standards conformance posture — constitution binding, audited shll version (v0.0.23), per-standard status, deferred gaps and their backlog refs, and the audit-against-HEAD-build rule.
- `run-kit/architecture`: (modify) Only if fixes alter the CLI/API surface (new flags, stream reroutes) — update the affected command descriptions; skip if fixes turn out doc-only.
- `run-kit/agent-state`: (modify) The `rk agent-setup` consent flow changed materially (review cycle 1): `--yes`/`--dry-run` flags added, and the silent non-TTY EOF-decline (exit 0) is replaced by a refusal naming `--yes` (stderr, non-zero exit, `term.IsTerminal` detection). The file's interactive-only consent description (diff + y/N read; "agent-setup is interactive so the user sees the error") is stale. <!-- added in review cycle 2 — reviewer-flagged memory drift -->

## Impact

- **CLI surface**: `app/backend/cmd/rk/` (root command, subcommand handlers, help output) — principle and help-dump fixes land here.
- **Docs**: `README.md`, `docs/site/*.md` — readme-extraction and skill structure fixes.
- **Backlog**: `fab/backlog.md` — new entries for deferred gaps.
- **Tests**: `app/backend/cmd/rk/*_test.go` (e.g., `root_test.go`) — updated/added alongside CLI fixes per code-quality policy (new/changed behavior MUST include tests).
- **No frontend impact expected** (audit scope is the CLI + repo docs); no database, no API-shape changes anticipated unless a principle gap implicates a server-side stream.

## Open Questions

- None — the task directive fully specifies precondition handling, audit method, fix proportionality, deferral convention, and the deliverable format; all decision points graded Certain/Confident below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Audit target is a HEAD build (`just build` → `bin/rk`), not the installed brew `rk` v3.7.2 | Verified at intake: installed binary rejects `rk skill`, which exists at HEAD — auditing it would false-negative on an adopted standard | S:85 R:90 A:95 D:90 |
| 2 | Certain | The tool in scope is this repo's CLI (`rk`/`run-kit`) only; other toolkit repos are out of scope | Task says "this repo and its tool"; sibling tools (shll, wt, fab-kit…) live in their own repos with their own conformance work | S:90 R:90 A:90 D:90 |
| 3 | Certain | The standards set is whatever `shll standards` enumerates at apply time; the intake capture (principles, help-dump, readme-extraction, skill @ v0.0.23) is context only | Task mandates runtime enumeration as authoritative — "do not assume which standards exist or what they require" | S:95 R:90 A:95 D:95 |
| 4 | Certain | Precondition treated as satisfied — `shll standards` verified exit 0 at intake (shll v0.0.23); apply still re-checks and stops per the task rule if it breaks | Verified by running it during intake; the task's stop-and-report rule is preserved verbatim for apply | S:90 R:95 A:100 D:95 |
| 5 | Certain | The skill standard is audited in full — its "deferred, not yet adopted" contingency is moot because `rk skill` + `docs/site/skill.md` exist at HEAD (PR #381) | Verified in source at intake (`app/backend/cmd/rk/skill.go`, `docs/site/skill.md`); the task's note is explicitly conditional on non-adoption | S:85 R:85 A:95 D:90 |
| 6 | Confident | Deferred gaps are recorded as `fab/backlog.md` entries (referenced from the report by backlog id), not GitHub issues or draft changes | Task allows "draft change or issue per this repo's convention"; the repo's visible convention is fab/backlog.md (freshly committed on main); a draft change remains available for any gap already shaped as a change | S:60 R:90 A:70 D:65 |
| 7 | Confident | Proportionality boundary: mechanical violations = all fixed; principle gaps fixed only when additive and few-file (flag, stream, error wording, exit code); anything redesigning a command's behavior or global output model = deferred | Task defines the rule; applying it to specific gaps found during audit is judgment, easily revisited per-gap at review | S:80 R:75 A:70 D:60 |
| 8 | Confident | The conformance report lives in the PR body only — no committed report artifact under docs/, unless a standard's own checklist requires one | Task places the report in the PR body explicitly; committing a parallel copy invites drift with no consumer named for it | S:75 R:85 A:75 D:70 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
