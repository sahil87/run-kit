# Intake: Fix shll.ai help-tree publish — run-kit.json never lands

**Change**: 260602-2dt9-fix-shllai-help-publish
**Created**: 2026-06-03
**Status**: Draft

## Origin

User ran `/fab-discuss` then `/fab-new` describing the build-time help-dump feature. Gap
analysis revealed the *producer* side of that feature was already shipped and merged
(PR #230, commit `afbaeb8`, archived change `260602-a36m-help-dump-shll-ai`): the hidden
`rk help-dump` Cobra command (`app/backend/cmd/rk/help_dump.go`) emits a valid help tree,
and `.github/workflows/release.yml` has a `Publish help tree to shll.ai` step.

The user then asked the decisive question conversationally:

> Great - but why don't I see any run-kit.json or rk.json over here:
> https://github.com/sahil87/shll.ai/tree/main/help

Investigation (this session) established the answer with hard evidence rather than theory:

- `sahil87/shll.ai` `help/` currently contains **only `wt.json`** — no `run-kit.json`
  (verified via `gh api repos/sahil87/shll.ai/contents/help`).
- **No PR was ever opened** from an `rk-help-dump-*` branch (verified via `gh pr list`).
- `v2.1.8` *was* tagged on the help-dump commit and the Release workflow run
  (`26816371162`) completed "success" — so the publish step **did execute**.
- Reading that run's log for the publish step surfaced the smoking gun:

  ```
  cp: cannot create regular file '/tmp/shll-ai/help/run-kit.json': No such file or directory
  help/run-kit.json unchanged since last release — nothing to publish.
  shll.ai help-tree publish step completed.
  ```

This is therefore **not** a duplicate of the original feature, **not** an external/transient
hiccup, and **not** the wt.json contract-diff task — it is a genuine CI bug in **this repo's**
`release.yml`. Interaction mode: investigative within a single `/fab-new` session; the framing
("fix the publish, the producer is fine") was confirmed by the evidence above before this
intake was written.

## Why

**Problem.** The help-dump feature is functionally inert end-to-end: rk emits the JSON, but it
never reaches `sahil87/shll.ai`, so the landing site's "Command reference" for the run-kit tool
page has no data to render. The user observed the missing file directly.

**Root cause (three compounding defects in the `Publish help tree to shll.ai` step of
`.github/workflows/release.yml`, lines ~187–236):**

1. **Missing destination directory guard (the blocker).** Line 193 runs
   `cp help/run-kit.json /tmp/shll-ai/help/run-kit.json` with no prior `mkdir -p
   /tmp/shll-ai/help`. When the freshly-cloned shll.ai working tree does not already contain a
   `help/` directory at that commit, `cp` fails with `No such file or directory`. This is the
   step that physically prevents the file from ever being staged.

2. **Unguarded `cp` + neutralized `set -e` (the propagation gap).** The `cp` is not
   `|| return 1`-guarded. The job shell is `bash -e`, but `set -e` is *suppressed inside a
   function whose return value is consumed by a condition* — and `publish_to_shllai` is invoked
   exactly that way: `if publish_to_shllai; then …`. So a failing `cp` does **not** abort the
   function; execution falls through to the next line.

3. **Failure masked as success (the silencer).** After the failed copy, the guard at
   lines 199–202 runs `git status --porcelain help/run-kit.json`, finds no change (because
   nothing was copied), prints **"unchanged since last release — nothing to publish"** and
   `return 0`. The outer `if` then logs **"shll.ai help-tree publish step completed."** A hard
   copy failure is thus reported as a clean no-op. Nobody noticed for an entire release.

**Consequence if not fixed.** Every future release silently no-ops the publish. `run-kit.json`
never appears on shll.ai; the run-kit tool page's command reference stays empty; and the
"best-effort, can't break the release" design — which is correct in intent — actively *hides*
the very failure it was meant to tolerate, so there is no signal to act on. This also blocks
the broader 7-tool rollout for run-kit's slice.

**Why this approach.** The fix splits failures into two classes and treats them differently
(decided via clarify):

- **Internal defects** (the dump binary missing, `help-dump` erroring, invalid JSON, the `cp`
  failing because the source/destination is wrong) are real bugs in *this* repo's build and
  MUST **fail the release loudly** — no more function-swallowed false "completed." This is the
  user's explicit choice: maximum signal so a silent miss can never recur.
- **External hiccups** (shll.ai unreachable, `SHLLAI_TOKEN` scope, repo-level auto-merge
  disabled, a same-version re-run whose branch already exists) stay **best-effort**: logged,
  PR left open for manual merge, release unaffected.

Concretely: (a) create the destination dir before copying, (b) make produce+copy hard failures
(propagate non-zero so the job fails), and (c) keep the clone/PR/merge interactions tolerant.
Because internal failures now fail the job, the "is the file unchanged" no-diff path is only
ever reached on a genuinely successful produce+copy — the silencer is structurally removed.

## What Changes

### `.github/workflows/release.yml` — `Publish help tree to shll.ai` step

The step splits into an **internal phase (must fail the release on error)** and an **external
phase (best-effort)**:

1. **Guarantee the destination directory exists before copy.** Add `mkdir -p
   /tmp/shll-ai/help` immediately before the `cp` (line ~193). Idempotent; safe whether or not
   shll.ai already has `help/`.

2. **Make produce + copy hard failures that fail the job.** The dump/validate lines
   (`rk help-dump …`, `jq empty …`) already run under `bash -e` outside the function, so they
   abort the job on error — keep that. Move the **`cp` into the same fatal class**: it must
   *not* sit inside a function whose non-zero return is swallowed by `if publish_to_shllai`.
   Either guard it with an explicit `|| { echo "::error::…"; exit 1; }`, or hoist the
   produce+copy out of the best-effort function so `set -e` applies. A failed copy now fails the
   Release job (user decision: fail loudly on internal defect).
   <!-- clarified: internal defects fail the release; only external (clone/PR/merge) stays best-effort -->

3. **Keep the clone/PR/merge interactions best-effort.** The `git clone`, `gh pr create`, and
   `gh pr merge --auto` calls remain tolerant (`|| return 1` / `|| echo …`) so an unreachable
   shll.ai, a missing auto-merge setting, or a pre-existing same-version branch logs a warning
   and leaves any PR open — never failing the already-published release.

4. **The "unchanged → nothing to publish" no-diff guard stays, but is now only reachable on a
   genuinely successful produce+copy.** Because the copy is fatal (step 2), a
   missing-source/missing-dest can never again be misreported as "unchanged." A true no-op
   (identical tree to last release) still returns cleanly — that is a legitimate skip, not a
   failure.

5. **Strengthen observability.** Echo the resolved source/destination paths and a post-copy
   `ls -l /tmp/shll-ai/help/run-kit.json` so any future failure is greppable in the run log.
   With the fatal-copy change this is belt-and-suspenders, but cheap and worth keeping.

The **producer** (`app/backend/cmd/rk/help_dump.go`, `rootCmd` wiring in `root.go`, and the
`mkdir -p help && rk help-dump help/run-kit.json && jq empty` lines at ~176–178) is **not
changed** — it is already correct and tested (`help_dump_test.go`).

### Validation strategy

CI YAML changes are not exercised by `go test`/`vitest`/Playwright. Verification is necessarily
manual/observational against a real (or re-dispatched) release:

- Re-run the logic locally against a clone of shll.ai to confirm `cp` now succeeds and the diff
  is detected.
- On the next tagged release (or a `workflow_dispatch` re-run of the Release workflow on the
  current tag), confirm a PR is opened into `sahil87/shll.ai` from `rk-help-dump-<version>` and
  `help/run-kit.json` appears after merge.
<!-- assumed: no automated test asserts release.yml behavior; the repo has no CI-workflow test
     harness and the constitution's test mandate targets app code (Go/TS), not GH Actions YAML.
     Confirmed by repo layout — tests live beside Go/TS source, none cover .github/. -->

## Affected Memory

Implementation-only CI fix — no spec-level behavior change to the documented system. The
help-dump *contract* and producer are unchanged; only the broken delivery mechanism is repaired.
No memory file create/modify/remove is required.

<!-- assumed: architecture.md already documents the release pipeline at a level that does not
     enumerate the publish step's internal shell logic, so this fix does not invalidate any
     recorded behavior. If hydrate later finds a stale claim, it can amend then. -->

## Impact

- **File touched**: `.github/workflows/release.yml` only (single step, ~5–10 lines).
- **No app code** (`app/backend/`, `app/frontend/`) touched.
- **Cross-repo**: `sahil87/shll.ai` is the *consumer*; this change does not modify it. It relies
  on the existing `SHLLAI_TOKEN` secret (contents + pull-request write) already configured.
- **Release safety**: the step stays LAST in the job and stays best-effort for *external*
  failures (shll.ai unreachable, auto-merge disabled). Only *internal* produce/copy failures
  change from "silent success" to "logged warning + non-zero function return."
- **Backfill question**: the already-released `v2.1.8` tree was never published. Re-dispatching
  the Release workflow on `v2.1.8`, or letting the next release carry it, will backfill.

## Open Questions

_Both prior open questions resolved via `/fab-new` clarify:_

- **Backfill `v2.1.8`?** → No. Land the fix; the **next release publishes** `run-kit.json`. No
  manual re-dispatch and no auto-backfill baked into the fix. (`<!-- clarified: next release
  publishes -->`)
- **Best-effort vs release-failing for internal defects?** → **Fail the release loudly** on
  internal defects (missing binary, dump error, invalid JSON, failed copy). External hiccups
  (shll.ai unreachable, auto-merge off, branch exists) stay best-effort. (`<!-- clarified: fail
  loud on internal, tolerate external -->`)

No remaining open questions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the `cp` to a non-existent `/tmp/shll-ai/help/` + masked failure, not the producer | Verified directly from the v2.1.8 release run log (`26816371162`): `cp: cannot create regular file … No such file or directory` followed by false "nothing to publish" | S:98 R:90 A:95 D:95 |
| 2 | Certain | The producer (`rk help-dump`) is correct and out of scope | `help_dump.go` + `help_dump_test.go` exist and merged; the binary emitted JSON that passed `jq empty` in CI before the `cp` | S:95 R:85 A:95 D:90 |
| 3 | Certain | `run-kit.json` is absent on shll.ai and no publish PR was ever opened | `gh api …/contents/help` shows only `wt.json`; `gh pr list --repo sahil87/shll.ai` shows no `rk help tree` PR | S:98 R:95 A:95 D:95 |
| 4 | Confident | Fix = `mkdir -p` dest + fatal produce/copy + best-effort clone/PR/merge | Surgical, matches the homebrew-tap token-clone pattern; smallest change that closes all three defects and honors the internal/external failure split | S:88 R:80 A:88 D:80 |
| 5 | Confident | No memory file change needed (implementation-only CI fix) | architecture.md documents the pipeline at a coarser grain than this shell step; contract unchanged | S:80 R:75 A:85 D:80 |
| 6 | Confident | No automated test will assert this (GH Actions YAML has no test harness here) | Repo tests cover Go/TS app code only; constitution test mandate targets app behavior | S:82 R:80 A:88 D:78 |
| 7 | Certain | No backfill in scope — next release publishes `run-kit.json` | Clarified by user: land the fix, let the next tagged release emit the tree; no manual re-dispatch, no auto-backfill | S:95 R:80 A:90 D:90 |
| 8 | Certain | Internal defects FAIL the release; external hiccups stay best-effort | Clarified by user: fail loudly on internal (missing binary / dump error / invalid JSON / failed copy), tolerate external (unreachable / auto-merge off / branch exists) | S:95 R:70 A:88 D:85 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
