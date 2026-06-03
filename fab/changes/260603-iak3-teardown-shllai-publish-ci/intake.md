# Intake: Teardown shll.ai Help-Tree Publish CI (Push → Pull Migration)

**Change**: 260603-iak3-teardown-shllai-publish-ci
**Created**: 2026-06-03
**Status**: Draft

## Origin

This change was initiated one-shot via `/fab-new` with a directive pointing at the
shll.ai help-dump contract spec:

> There's an update in the way we integrate with shll.ai. To understand it read
> https://github.com/sahil87/shll.ai/blob/main/docs/specs/help-dump-contract.md#teardown-directive-paste-to-a-tool-repo-agent .
> Implement the change.

The referenced **Teardown Directive (paste-to-a-tool-repo-agent)** section of the
help-dump contract describes shll.ai inverting its integration model:

- **Before (push model)**: each of the 7 toolkit CLIs (idea, hop, fab-kit, wt, run-kit,
  tu, shll) produced its help JSON in its own release CI and opened an auto-merge PR
  into `sahil87/shll.ai` to publish it. run-kit's slice was added in change
  `260602-a36m-help-dump-shll-ai` and hardened in `260602-2dt9-fix-shllai-help-publish`.
- **After (pull model)**: shll.ai runs a scheduled job that invokes `<tool> help-dump`
  itself and captures the output. The tool repos no longer push.

The directive instructs each tool repo to remove the now-redundant producer/push transport
in a single PR, while **preserving the `help-dump` subcommand** — it is now the single
contract surface shll.ai depends on (shll.ai pulls from it). This intake captures run-kit's
execution of that directive.

No prior `/fab-discuss` or exploration preceded this change; the spec and the current
`release.yml` are the sole inputs. The directive's precondition ("apply only after shll.ai's
pull workflow is live and proven") is taken as satisfied by the user issuing this directive
now (recorded as an Open Question / assumption below).

## Why

1. **Problem it solves** — shll.ai has moved to a pull model. run-kit's release pipeline
   still runs the obsolete push path: it produces `help/run-kit.json` and opens an
   auto-merge PR into `sahil87/shll.ai` via the `SHLLAI_TOKEN` cross-repo write secret
   (`.github/workflows/release.yml`, the final "Publish help tree to shll.ai" step, lines
   ~160–254). Under the pull model this push is redundant work and a redundant attack
   surface — every release still clones an external repo with a write-scoped token and
   opens a PR that shll.ai no longer needs.
2. **Consequence of not fixing** — the release job keeps holding a cross-repo write secret
   (`SHLLAI_TOKEN`) and performing cross-repo writes that duplicate (and can race) what
   shll.ai's scheduled pull now does. Two writers to the same `help/run-kit.json` is exactly
   the multi-repo write race the original push design tried to avoid; once shll.ai pulls,
   the push side is dead weight that only adds risk. Leaving a write-scoped token in the
   repo with no remaining consumer violates least-privilege.
3. **Why this approach** — the directive is prescriptive: remove the four push components
   (producer CI, PR-opening logic, auto-merge wiring, `SHLLAI_TOKEN` usage) in one PR and
   keep `help-dump`. The alternative (keep both push and pull) was rejected by the contract
   author precisely because dual writers race. The transport is what's obsolete; the
   command is the contract surface and stays. This is a pure deletion of one CI step plus a
   secret reference — low-risk, since the step was already explicitly designed to be the
   LAST step and best-effort, so removing it cannot affect the GitHub Release or Homebrew tap.

## What Changes

### 1. Remove the "Publish help tree to shll.ai" step from `release.yml`

`.github/workflows/release.yml` currently ends with a single step (the **final** step in the
`release` job) that does all four push components the directive names. The entire step is
removed — name, `env: SHLLAI_TOKEN`, and the full `run:` block (the `rk help-dump` produce +
`jq empty` validate + `publish_to_shllai()` clone/branch/commit/push + `gh pr create` +
`gh pr merge --auto`).

The step to delete (verbatim, current `release.yml`):

```yaml
      # Placed LAST in the job — after the GitHub Release and Homebrew tap are
      # already published — so the documented "best-effort, can't break the
      # release" guarantee actually holds: any fatal line here runs only once
      # the user-visible release artifacts exist.
      - name: Publish help tree to shll.ai
        env:
          SHLLAI_TOKEN: ${{ secrets.SHLLAI_TOKEN }}
        run: |
          version="${{ steps.version.outputs.version }}"
          mkdir -p help
          dist/rk-linux-amd64/rk help-dump help/run-kit.json
          jq empty help/run-kit.json
          publish_to_shllai() {
            git clone "https://x-access-token:${SHLLAI_TOKEN}@github.com/sahil87/shll.ai.git" /tmp/shll-ai || return 1
            branch="rk-help-dump-${version}"
            ...
            GH_TOKEN="$SHLLAI_TOKEN" gh pr create --repo sahil87/shll.ai ...
            GH_TOKEN="$SHLLAI_TOKEN" gh pr merge "$branch" --repo sahil87/shll.ai --auto --squash ...
          }
          if publish_to_shllai; then
            echo "shll.ai help-tree publish step completed."
          else
            echo "::warning::shll.ai help-tree publish failed ..."
          fi
```

This single deletion covers all four directive components at once, because run-kit's push
path was implemented as one self-contained step:

| Directive component | Where it lives in run-kit | Action |
|---------------------|---------------------------|--------|
| 1. Producer CI (walk tree → write JSON in CI) | `rk help-dump help/run-kit.json` + `jq empty` lines in the step | Removed with the step |
| 2. PR-opening logic | `publish_to_shllai()` clone/branch/commit/push + `gh pr create` | Removed with the step |
| 3. Auto-merge wiring | `gh pr merge "$branch" --auto --squash` | Removed with the step |
| 4. `SHLLAI_TOKEN` removal | `env: SHLLAI_TOKEN: ${{ secrets.SHLLAI_TOKEN }}` + its uses | Removed with the step |

After removal, the `release` job's final remaining step is **"Update Homebrew tap"**.

### 2. Preserve `rk help-dump` unchanged — it is now the contract surface

The hidden Cobra subcommand `help-dump` (`app/backend/cmd/rk/help_dump.go`) and its tests
(`app/backend/cmd/rk/help_dump_test.go`) are **NOT** touched. The directive's critical
preservation rule: `<tool> help-dump` is the single contract surface shll.ai depends on
(shll.ai now pulls from it). Post-change, `rk help-dump` MUST still:

- Exit 0 with empty stderr
- Emit valid JSON to stdout (the `captured_at` field is stamped by run-kit but shll.ai
  re-stamps on capture per the contract — its value is not depended upon by shll.ai)
- Keep `schema_version: 1` (the frozen contract `const schemaVersion = 1`)
- Report the built binary's actual version via `displayVersion()` (ldflags `-X main.version`)

No code change is required to preserve these — leaving the file untouched preserves them by
definition. Verification (not modification) confirms it.

### 3. `SHLLAI_TOKEN` secret — confirm no other usage, then it becomes orphaned

Grep across the repo confirms `SHLLAI_TOKEN` is referenced in active code/config **only**
within the one `release.yml` step being removed (other matches are historical: `fab/backlog.md`
and the two archived/in-flight `fab/changes/**` intake & plan artifacts, plus the
`docs/memory` records — none are executable workflow references). After this change there are
zero active references to `secrets.SHLLAI_TOKEN`.

The actual GitHub repository secret named `SHLLAI_TOKEN` lives in repo settings, not in the
git tree — removing it is a GitHub-settings action outside this repo's code. This change
removes all *code* references and documents that the operator SHOULD delete the repo secret
(least-privilege) once the pull model is confirmed live. The code change does not depend on
the secret being deleted; deleting it is a follow-up operational step noted in the PR body.

### 4. Update `docs/memory/run-kit/architecture.md`

Three locations describe the now-removed publish step and must be reconciled during hydrate
(this is recorded as Affected Memory; the actual edit happens at hydrate, not apply):

- The `help-dump` row in the **CLI Subcommands** table (line ~445) ends with "Consumed by the
  release-pipeline shll.ai publish step (see `## Release Flow & CI/CD`)" — update to reflect
  that shll.ai now **pulls** via a scheduled `rk help-dump` invocation (no in-repo publish).
- The **Release Flow & CI/CD** section (lines ~497, ~501) lists "publish help tree to shll.ai"
  as the final CI step and describes it in detail — remove/rewrite to state the push step was
  retired in favor of shll.ai's pull model; the final release step is now "Update Homebrew tap".
- The changelog row (line ~706) for `260602-a36m-help-dump-shll-ai` is historical and stays;
  a new changelog row for this teardown is added at hydrate.

### Out of scope

- shll.ai's site-side pull job (Astro loader / scheduled `rk help-dump` capture) — lives in
  the separate `sahil87/shll.ai` repo, not here.
- Any change to the `help-dump` JSON shape, schema version, or the command's behavior.
- Other toolkit repos' teardowns (idea, hop, fab-kit, wt, tu, shll) — each is its own PR.
- Deleting the `SHLLAI_TOKEN` GitHub repo secret (operational follow-up in repo settings;
  noted in the PR body, not a code change).

## Affected Memory

- `run-kit/architecture`: (modify) Update the `help-dump` CLI Subcommands row (drop "Consumed
  by the release-pipeline shll.ai publish step", note shll.ai now pulls via scheduled
  `rk help-dump`); remove/rewrite the **Release Flow & CI/CD** "Publish help tree to shll.ai"
  final-step description (push retired → pull model; final step is now Homebrew tap); add a
  changelog row for this teardown. The historical `260602-a36m-help-dump-shll-ai` changelog
  row is preserved.

## Impact

- **`.github/workflows/release.yml`** — delete the final "Publish help tree to shll.ai" step
  (~95 lines). No other step references `help/`, `SHLLAI_TOKEN`, or shll.ai. The job's last
  step becomes "Update Homebrew tap". `permissions: contents: write` and `concurrency` are
  unaffected (they were never specific to the publish step).
- **`app/backend/cmd/rk/help_dump.go`** — unchanged (verify-only; it is the preserved contract
  surface).
- **`app/backend/cmd/rk/help_dump_test.go`** — unchanged (verify-only; tests must still pass).
- **`docs/memory/run-kit/architecture.md`** — reconciled at hydrate (see Affected Memory).
- **GitHub repo secret `SHLLAI_TOKEN`** — orphaned by this change (no code references remain);
  operator deletes it in repo settings as a follow-up (out of tree).
- **No dependency changes**, no Go module changes, no frontend changes.
- **CI safety**: `ci.yml` does not reference shll.ai/`help-dump`/`SHLLAI_TOKEN` — unaffected.
  Removing the LAST step of the `release` job cannot affect the GitHub Release or Homebrew tap
  (both produced earlier in the job), so the release path is preserved by construction.

## Open Questions

- Has shll.ai's pull workflow been confirmed live and proven? The directive states the
  teardown applies "only after shll.ai's pull workflow is live and proven, preventing a
  stale-help gap if executed prematurely." Issuing this directive is taken as the user's
  confirmation. (Recoverable: if premature, revert is a one-step `git revert`.)
- Should the `SHLLAI_TOKEN` GitHub repo secret deletion be performed as part of this PR's
  merge, or tracked separately? (Defaulting to: note it in the PR body as an operator
  follow-up — secret deletion is a repo-settings action, not a code change.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement the spec's Teardown Directive: remove producer CI, PR-opening logic, auto-merge wiring, and `SHLLAI_TOKEN` usage from `release.yml`; preserve `rk help-dump` | Directive is prescriptive and names exactly these four components + the preservation rule | S:98 R:80 A:95 D:96 |
| 2 | Certain | All four directive components are deletable as one self-contained `release.yml` step (run-kit implemented the whole push path as the single final "Publish help tree to shll.ai" step) | Verified by reading current `release.yml` lines ~160–254 — produce, PR, auto-merge, and `SHLLAI_TOKEN` env all live in that one step | S:95 R:80 A:95 D:95 |
| 3 | Certain | `rk help-dump` (`help_dump.go`) and its tests are NOT modified — preserved as the single contract surface shll.ai pulls from | Directive's explicit "Critical Preservation Rule"; removing only the transport, never the command | S:98 R:85 A:95 D:97 |
| 4 | Certain | `SHLLAI_TOKEN` has no other active usage in the repo — grep confirms only the one workflow step plus historical fab/docs records | Repo-wide grep shows no second executable reference; directive requires confirming this before removal | S:95 R:75 A:92 D:90 |
| 5 | Confident | Deleting the LAST step of the `release` job cannot affect the GitHub Release or Homebrew tap; release path is preserved | The step was deliberately placed last and documented best-effort precisely so it couldn't preempt the release; both artifacts are produced earlier in the job | S:88 R:80 A:90 D:88 |
| 6 | Confident | Deleting the `SHLLAI_TOKEN` GitHub repo secret is an out-of-tree operator follow-up, noted in the PR body, not a code change in this PR | The secret lives in repo settings, not the git tree; the directive's component 4 is satisfied in-tree by removing all code references | S:80 R:75 A:85 D:82 |
| 7 | Confident | `docs/memory/run-kit/architecture.md` is reconciled at hydrate (not apply): the `help-dump` row, the Release Flow CI step description, and a new changelog row | Memory hydration is a hydrate-stage activity per the fab pipeline; apply touches code/CI only | S:85 R:88 A:88 D:85 |
| 8 | Confident | shll.ai's pull workflow is live/proven (the directive's precondition) — taken as satisfied by the user issuing the directive now | Directive gates on this; user invoking the teardown is the signal. Fully reversible via `git revert` if premature | S:72 R:85 A:70 D:78 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
