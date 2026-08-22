# Plan: Overnight Stacked Execution of 4vuv → hdjr → dc0t

**Authored**: 2026-05-08
**Author**: planning session with Claude
**Executor**: fab-operator (autonomous, overnight)
**Status**: Plan only — not yet executed

## Goal

Produce **two PRs** overnight via fab-operator's autopilot queue, with no human intervention until morning:

1. **hdjr's PR**: contains 4vuv's pane-boards content (as one operator-cherry-pick commit) + hdjr's relay grouped-sessions implementation. PR base = `main`.
2. **dc0t's PR**: contains 4vuv + hdjr content (transitively, as one operator-cherry-pick commit since hdjr's branch already carries 4vuv) + dc0t's multi-server SessionProvider implementation. PR base = `main`.

PR #186 (4vuv, currently DRAFT) is **not touched** by this plan — it stays open as historical context. The user decides post-morning whether to close it once dc0t lands.

## Execution model

The operator's autopilot queue (`fab operator autopilot start`) is the natural fit:

- Dependency declaration is implicit: `[hdjr, dc0t]` order means dc0t auto-gets `depends_on: [hdjr]`.
- 4vuv is a dependency that's not in the queue (it's already done, just not merged). The operator's `branch_map` mechanism handles this — pre-seed it before starting autopilot.
- The operator cherry-picks `origin/main..<dep-branch>` and squashes into one commit per dependency (operator skill §Dependency Resolution). hdjr's PR ends up with one squash-commit "operator: cherry-pick 4vuv dependency" + hdjr's actual commits. dc0t's PR ends up with one squash-commit "operator: cherry-pick hdjr dependency" (which transitively contains 4vuv) + dc0t's actual commits.
- Each spawned agent runs `/fab-switch <change> && /fab-proceed`, which auto-detects state, runs `/git-branch`, and runs `/fab-fff` (full pipeline through review-pr).

## Branch model (post-execution)

```
main (unchanged during execution; advances only if user merges manually next morning)
 ├─ 260507-4vuv-pane-boards    (existing, unchanged, PR #186 still draft)
 ├─ 260508-hdjr-relay-grouped-sessions-board-panes
 │     │
 │     ├─ 1 squashed commit: "operator: cherry-pick 4vuv-snapshot dependency"
 │     └─ N hdjr commits from /fab-fff apply stage
 │     PR: open, base=main, contains 4vuv content + hdjr work
 │
 └─ 260508-dc0t-multiserver-session-provider
       │
       ├─ 1 squashed commit: "operator: cherry-pick hdjr-snapshot dependency"  (transitively carries 4vuv)
       └─ M dc0t commits from /fab-fff apply stage
       PR: open, base=main, contains 4vuv + hdjr + dc0t work
```

## Prerequisites (do BEFORE handing off to operator)

These must be done by Claude or the user before the operator session starts. The operator does not perform these steps itself.

### P1. Commit pending intake artifacts

The hdjr and dc0t intakes/status files are currently uncommitted in the working tree. The operator's cherry-pick reads them from git history, so they must be committed first.

```bash
cd /Users/sahil/code/sahil87/run-kit
git add fab/changes/260508-hdjr-relay-grouped-sessions-board-panes/
git add fab/changes/260508-dc0t-multiserver-session-provider/
git add fab/plans/sahil/
git commit -m "chore(fab): draft hdjr and dc0t intakes + execution plan"
```

(The deletion of `fab/plans/performance-improvements.md` showing in `git status` is **not** introduced by this work — it predates this session. Leave it alone for now or add it to the same commit at user's discretion.)

### P2. Verify clean state

After P1:

```bash
test -z "$(git status --short)" || { echo "Working tree dirty"; exit 1; }
test "$(git branch --show-current)" = "260507-4vuv-pane-boards" || { echo "Wrong branch"; exit 1; }
just test-frontend && just test-backend
```

### P3. Push the 4vuv branch to origin

The operator's cherry-pick uses `origin/main..<dep-branch>`. The dep-branch must be visible to the operator's worktrees, which means it should exist on `origin`. PR #186 already pushed it, but verify:

```bash
git fetch origin
git rev-parse origin/260507-4vuv-pane-boards >/dev/null 2>&1 || git push -u origin 260507-4vuv-pane-boards
```

## Operator session startup

The user runs (in a separate terminal, in the repo root):

```bash
cd /Users/sahil/code/sahil87/run-kit
fab operator
```

This opens a tmux tab named `operator` and the agent reads `_preamble.md` + `fab-operator/SKILL.md` + `.fab-operator.yaml`.

When the operator says `Operator ready.`, the user gives it the prompt below in **a single message**:

---

## Operator instruction (paste verbatim into the operator pane)

```
Pre-seed branch_map for 4vuv dependency resolution, then start an autopilot queue
that produces two PRs overnight.

Step 1 — pre-seed branch_map:
  In .fab-operator.yaml, add to branch_map:
    4vuv: 260507-4vuv-pane-boards
  (Note: 4vuv is the change ID for fab/changes/260507-4vuv-pane-boards/.
  Verify by checking that change folder's .status.yaml `id:` field. If the ID is
  different, use the actual id.)

Step 2 — start autopilot queue with hdjr and dc0t in order:
  fab operator autopilot start hdjr dc0t

  This implies:
    - hdjr.depends_on = []  (queue starting point)
    - dc0t.depends_on = [hdjr]  (implicit chaining per autopilot queue rules)

  But hdjr also depends on 4vuv. Set this explicitly BEFORE autopilot dispatch
  reaches hdjr. After autopilot start, but before first dispatch tick:

    Edit .fab-operator.yaml's monitored.<hdjr-id>.depends_on (will be created
    when hdjr is enrolled) — actually, the autopilot queue creates monitored
    entries lazily. Better approach: when autopilot is about to dispatch hdjr,
    intercept and set its depends_on before spawning. The cleanest expression is:

    fab operator autopilot start hdjr --base 4vuv dc0t

    Per skill §Dependency Declaration path 3, --base 4vuv on hdjr explicitly sets
    hdjr.depends_on = [4vuv]. The implicit chaining rule then sets
    dc0t.depends_on = [hdjr], which transitively covers 4vuv via cherry-pick
    squash-commit.

Step 3 — autopilot lifecycle:
  - For hdjr: operator creates worktree, cherry-picks 4vuv (resolved via
    branch_map), spawns agent in that worktree with
    `/fab-switch 260508-hdjr-relay-grouped-sessions-board-panes && /fab-proceed`,
    enrolls in monitored set.
  - Operator's loop monitors hdjr's progress. When hdjr reaches review-pr stage
    (PR open, /git-pr-review running), autopilot dispatches dc0t.
  - For dc0t: operator creates worktree, cherry-picks hdjr's branch (transitively
    carries 4vuv), spawns agent with
    `/fab-switch 260508-dc0t-multiserver-session-provider && /fab-proceed`,
    enrolls in monitored set.
  - Both agents run /fab-fff to completion (review-pr stage = PR open + review
    cycle complete).

Step 4 — auto-answer policy:
  - For Confident-grade SRAD questions hit during /fab-clarify (auto-mode invoked
    from /fab-fff): accept Default-plan wording from the intake. This is the
    operator's standard auto-answer behavior.
  - For Tentative or Unresolved: halt and surface to user (per skill §Confirmation
    Tiers, recoverable tier).
  - If a /fab-fff rework loop exhausts its budget: halt and surface.
  - If a cherry-pick conflicts: abort, do not spawn (skill §3 bounded retries).

Step 5 — completion criteria for overnight:
  Stop the autopilot queue when both changes have reached review-pr DONE state
  (PR open, AI review complete). Do NOT auto-merge — the morning user merges
  manually.

  The operator should:
    - Report each PR's URL as it opens.
    - Keep the loop running until both are at review-pr DONE.
    - On completion, send a single summary message: "Autopilot complete:
      hdjr → <PR URL>, dc0t → <PR URL>. Both review-pr DONE. Ready for merge."

Confirm this plan back to me, then proceed.
```

---

## What the operator will do (sequence)

For each dispatch, the operator's cherry-pick logic (skill §Dependency Resolution) runs in the new worktree:

```bash
# In the hdjr worktree, after wt create
git cherry-pick --no-commit origin/main..origin/260507-4vuv-pane-boards
git commit -m "operator: cherry-pick 4vuv dependency"
```

```bash
# In the dc0t worktree, after wt create — hdjr's branch is now origin-pushed
git cherry-pick --no-commit origin/main..origin/260508-hdjr-relay-grouped-sessions-board-panes
git commit -m "operator: cherry-pick hdjr dependency"
```

Then the spawned agent runs `/fab-proceed` which runs `/git-branch` (already aligned by the worktree branch name) → `/fab-fff` which runs spec → tasks → apply → review → hydrate → ship → review-pr.

## Halt conditions (operator surfaces, does NOT proceed past)

| # | Condition | Operator action |
|---|-----------|-----------------|
| 1 | Cherry-pick conflict during dependency resolution | Abort cherry-pick, do not spawn, log to operator pane, escalate |
| 2 | `/fab-fff` produces Tentative/Unresolved during auto-clarify | The agent itself halts and asks; operator's question-detection sees the prompt and surfaces it |
| 3 | Test failure during apply stage rework | `/fab-fff` retries via auto-rework; if budget exhausted, halts |
| 4 | Pane death | Operator reports gone (skill §3, no auto-respawn for autopilot) |
| 5 | Stuck agent (idle for > 1 nudge) | Surface manual investigation message |
| 6 | `branch_map` lookup fails for 4vuv | Skill §Dependency Resolution step 1 says: log "{change}: dependency {dep} branch not found. Escalating." Do not spawn. |

In all halt cases, the morning user sees the operator's escalation message and intervenes.

## Decision log

These decisions are committed by accepting this plan:

- **Two PRs (not one)**: hdjr gets its own PR; dc0t gets its own PR. Each carries its dependencies via cherry-pick squash. Reviewers see one consolidated dep-commit per PR rather than 13 individual 4vuv commits.
- **fab-operator with autopilot queue**: chosen over a hand-rolled multi-pane shell script because the operator already implements: dependency resolution via cherry-pick, monitored set, auto-nudge for stuck agents, auto-answer for Confident questions, branch_map for non-merged deps. Reusing the operator is materially less risk than rolling our own orchestration.
- **`--base 4vuv` flag**: chosen over editing `.fab-operator.yaml` manually because the flag is the operator's canonical declaration mechanism (skill §Dependency Declaration path 3).
- **Stop at review-pr DONE, not merged**: the morning user controls what lands on main. Auto-merge is explicitly NOT in scope.
- **PR #186 (4vuv) untouched**: stays open as draft. Closing/keeping is a morning decision.
- **Single squash dep-commit per PR**: this is the operator's default cherry-pick squash behavior; matches the user's preference for clean diffs.

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | hdjr's `/fab-fff` apply produces backend tests that fail (e.g., the new `NewGroupedSession` helper fails in CI tmux) | `/fab-fff` auto-rework retries; if stuck, operator escalates. Morning user investigates. |
| 2 | dc0t's apply produces frontend test failures from the `useSessionContext` migration | Same — auto-rework, escalate if stuck. dc0t intake §16 lists the 9 consumer files; spec stage must scope migration carefully. |
| 3 | dc0t's cherry-pick of hdjr branch conflicts with main's recent advances (e.g., another PR merged to main during overnight execution) | Operator aborts cherry-pick on conflict (§3, bounded retry 0). Morning user resolves. Mitigation: minimize main churn during overnight execution (don't merge other PRs from another machine while this is running). |
| 4 | Auto-clarify in `/fab-fff` upgrades a Confident to Tentative based on spec-stage analysis | Halts and asks. Acceptable — surface to morning user. |
| 5 | hdjr's `rk-relay-*` filter (intake §10) is implemented in `/api/sessions` but missed in the SSE event stream | dc0t's spec stage will catch this when it tries to aggregate sessions and gets ephemerals. Either dc0t fails review and morning user fixes, or hdjr's spec was written tightly enough to avoid. |
| 6 | Autopilot queue dispatches dc0t too early (before hdjr is review-pr DONE, e.g., at hydrate) | Skill §autopilot dispatch logic dispatches the next when the previous is done OR dependency-satisfied. Implicit chaining = depends_on hdjr; dc0t spawns when hdjr's branch is accessible (origin-pushed at hdjr's ship stage). This means dc0t may start before hdjr's review-pr completes. That's actually OK — they're independent PRs after that point. The operator continues monitoring both. |
| 7 | hdjr's PR is created before dc0t's cherry-pick of hdjr happens | This is the **expected order** — hdjr ships → branch on origin → dc0t cherries from origin/<hdjr-branch>. The operator's autopilot dispatch waits for this implicitly via the dependency check. |
| 8 | The `4vuv` change ID assumption in the operator instruction is wrong | Operator instruction includes verification step ("check fab/changes/260507-4vuv-pane-boards/.status.yaml `id:` field"). |
| 9 | User runs `git push` or `git pull` from another shell during execution | Will conflict with operator's git operations. Mitigation: don't touch the repo from another shell overnight. |
| 10 | `gh pr create` in `/git-pr` fails because credentials expired overnight | `/git-pr` halts; operator surfaces. Morning user re-auths gh and resumes. |

## Time estimate

- Prerequisites (P1–P3): 5 minutes
- Operator startup + queue start: 2 minutes
- hdjr `/fab-fff` (small backend fix, high confidence): 30–90 minutes
- dc0t `/fab-fff` (frontend refactor, medium confidence, 9-file migration): 90–240 minutes
- AI review cycles for both: 20–60 minutes total

Total wall time: 2.5–6 hours autonomous. Comfortably overnight.

## Out of scope (explicit)

- Auto-merge of either PR.
- Closing PR #186 (4vuv).
- Pushing tags to origin.
- Cross-server window drag-and-drop in dc0t (per dc0t intake §5).
- New e2e test for multi-window-same-session board case (per hdjr intake §13 — should-fix, not blocking).
- Any reactive change to other branches/PRs that land on main during overnight execution.

## Morning user's checklist

When the operator reports "Autopilot complete:":

1. Read both PR URLs.
2. Open hdjr's PR. Sanity-check the diff: it should show 4vuv's content as one squash + hdjr's commits. Approve and merge if it looks right.
3. After hdjr merges, dc0t's PR base auto-updates to a smaller diff (just dc0t commits, since main now has 4vuv + hdjr content). Verify.
4. Open dc0t's PR. Sanity-check the diff. Approve and merge.
5. Decide PR #186's fate: close with a "consolidated upstream" comment or rebase if you want it tracked separately.
6. Tear down operator: `fab operator stop` (or just close the tmux tab — autopilot state in `.fab-operator.yaml` is recoverable).

## Re-execution notes

If the plan needs to be re-run (e.g., overnight halt, morning fix, retry):

- The fab change folders survive — same intakes, same drafts.
- Operator autopilot queue can be re-started with the same command if both worktrees + branches were torn down. If not, manually clean: `wt delete <hdjr-wt>`, `wt delete <dc0t-wt>`, `git branch -D 260508-hdjr-...`, `git branch -D 260508-dc0t-...`, `git push origin --delete <hdjr-branch>`, `git push origin --delete <dc0t-branch>`, `gh pr close <hdjr-PR>`, `gh pr close <dc0t-PR>`. Then re-run prerequisites and operator instruction.
