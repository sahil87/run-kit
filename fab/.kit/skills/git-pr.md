---
name: git-pr
description: "Autonomously commit, push, and create a GitHub PR — no prompts, no questions."
allowed-tools: Bash(git:*), Bash(gh:*)
---

# /git-pr

Autonomously ship local changes to a GitHub PR. No questions, no prompts — just execute.

---

## Behavior

### Step 0: Resolve PR Type

Determine the PR type before gathering state. The type controls the PR title prefix and body template.

**Valid types**: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`

**Resolution chain** (evaluated in order, first match wins):

1. **Explicit argument**: If the user invoked `/git-pr {type}` where `{type}` is one of the 7 valid types (case-insensitive), normalize to lowercase and use it. If the argument is not a valid type, ignore it and fall through to step 2.

2. **Read from `.status.yaml`**: Run `fab/.kit/scripts/lib/changeman.sh resolve 2>/dev/null`. If resolution succeeds, read `change_type` from `fab/changes/{name}/.status.yaml`. If non-null and one of the 7 valid types (`feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`), use it. Fall through if resolution fails, `change_type` is null, or `change_type` is not a valid type.

3. **Infer from fab change intake**: If `changeman.sh resolve` succeeded (from step 2) and `fab/changes/{name}/intake.md` exists, read the intake content and pattern-match (case-insensitive). Keyword lists are evaluated in order — first match wins:
   - Contains any of: "fix", "bug", "broken", "regression" → type = `fix`
   - Contains any of: "refactor", "restructure", "consolidate", "split", "rename" → type = `refactor`
   - Otherwise → type = `feat`

4. **Infer from diff**: Collect changed file paths by running each command and taking the first non-empty result: (a) `git diff --name-only HEAD`, (b) `git diff --name-only --cached`, (c) `git diff --name-only @{u}..HEAD` (only if upstream exists). This covers uncommitted, staged, and committed-but-unpushed changes.

   If **no files** are returned (empty diff — clean working tree and no unpushed commits), default to `chore`.

   Otherwise, analyze the changed file paths:
   - All files in `.github/` or CI config files → type = `ci`
   - All files in `docs/` or non-code `.md` files → type = `docs`
   - All files in test directories or test files → type = `test`
   - Otherwise → type = `chore`

Store the resolved `type` (always lowercase) and the resolution source (`explicit`, `status`, `intake`, `diff`) for use in Step 3c.

This step MUST NOT ask questions or present options. If resolution is ambiguous, default to `chore`.

### Step 1: Gather State

Run these commands to understand the current situation:

```bash
git branch --show-current
git status --porcelain
git log --oneline -5
git log --oneline @{u}..HEAD 2>/dev/null || echo "NO_UPSTREAM"
gh pr view --json number,state,url 2>/dev/null || echo "NO_PR"
```

If an active change is resolved (via `changeman.sh resolve`), read issues via `fab/.kit/scripts/lib/statusman.sh get-issues fab/changes/{name}/.status.yaml` and capture the output (one ID per line, may be empty).

Determine:
- **branch** — current branch name
- **has_uncommitted** — whether `git status --porcelain` has output
- **has_unpushed** — whether there are commits ahead of upstream (or no upstream at all)
- **has_pr** — whether a PR already exists
- **issues** — the issue IDs from `statusman.sh get-issues` (space-joined), or empty if none

### Step 1b: Branch Mismatch Nudge

If there is an active change (resolve via `fab/.kit/scripts/lib/changeman.sh resolve 2>/dev/null`), compare the current branch against the change name.

A match is: (1) exact string equality between current branch and change name, or (2) the change name appears as a substring of the current branch.

If there is **no match** and the current branch is **not** `main`/`master`, show a non-blocking nudge before proceeding:

```
Note: branch '{current_branch}' doesn't match active change '{change_name}'.
Run /git-branch to switch, or continue if this is intentional.
```

Then proceed to Step 2 normally. If resolution fails or there is no active change, skip this step silently.

### Step 2: Branch Guard

If the current branch is `main` or `master`, STOP immediately.

If there is an active change (from Step 1b), enhance the message:

```
Cannot create PR from main/master branch.
Tip: run /git-branch to switch to the change's branch first.
```

If there is no active change:

```
Cannot create PR from main/master branch.
```

Do NOT run any git operations.

### Step 3: Execute Pipeline

Run each step in order, skipping steps that aren't needed.

**If nothing to do** (no uncommitted changes, no unpushed commits, PR exists):
```
/git-pr — already shipped

  ✓ pr — {existing PR URL}

Nothing to do.
```
Before stopping, attempt to record the existing PR URL per Steps 4–4c (silently, no errors). Then STOP.

**Otherwise**, print the header and execute:

```
/git-pr — shipping to PR
```

#### 3a. Commit (if has_uncommitted)

1. Stage all changes: `git add -A`
2. Read `git log --oneline -5` for commit message style
3. Read `git diff --stat HEAD` for change scope
4. Generate a concise commit message matching the repo's existing style
   - Subject line only (unless changes warrant a body)
   - Do NOT include "Co-Authored-By" lines
5. Commit: `git commit -m "<message>"`
6. If commit fails → report error and STOP

Print: `  ✓ commit — "<commit subject>"`

#### 3b. Push (if has_unpushed or just committed)

1. Check if upstream exists: `git rev-parse --abbrev-ref @{u} 2>/dev/null`
2. If no upstream: `git push -u origin $(git branch --show-current)`
3. If upstream exists: `git push`
4. If push fails → report the git error output and STOP

Print: `  ✓ push   — origin/<branch>`

#### 3c. Create PR (if no PR exists)

1. Verify `gh` is available: `command -v gh`
   - If missing → print `gh CLI not found — cannot create PR` and STOP

2. **Derive PR title**: Compute `{pr_title}` where:
   - **Fab-linked** (type is `feat`, `fix`, or `refactor` AND intake exists): `{title}` = first `# ` heading from `intake.md`, stripping `Intake: ` prefix if present
   - **Lightweight** (type is `docs`, `test`, `ci`, or `chore`, OR no intake): `{title}` = commit message subject line from `git log -1 --format=%s`

   If `issues` (from Step 1) is non-empty: `{pr_title}` = `{type}: {issues} {title}` (e.g., `feat: DEV-123 DEV-456 Add OAuth support`), where `{issues}` is space-joined.
   If `issues` is empty: `{pr_title}` = `{type}: {title}`.

   The `{pr_title}` variable (already prefixed) is used as-is in step 4's `gh pr create --title`.

3. **Generate PR body** using the template tier matching the resolved type:

   **Tier 1 — Fab-Linked** (type is `feat`, `fix`, or `refactor` AND `changeman.sh resolve` succeeds AND `intake.md` exists):

   First, construct blob URLs:
   - `{owner_repo}` = `gh repo view --json nameWithOwner -q '.nameWithOwner'`
   - `{branch}` = `git branch --show-current`
   - Intake URL = `https://github.com/{owner_repo}/blob/{branch}/fab/changes/{name}/intake.md`
   - Spec URL = `https://github.com/{owner_repo}/blob/{branch}/fab/changes/{name}/spec.md` (only if `spec.md` exists)

   Then read `.status.yaml` from the change directory to extract:
   - `{confidence_score}` = `confidence.score` (e.g., `3.5`)
   - `{pipeline_stages}` = stage names from `progress` map whose value is `done`, joined with ` → `, in fixed order: intake, spec, tasks, apply, review, hydrate

   Then generate the body:
   ```
   ## Summary
   {1-3 sentences derived from intake's ## Why section}

   ## Changes
   {bulleted list of subsection headings from intake's ## What Changes section}

   ## Context
   | Field | Detail |
   |---|---|
   | Type | {type} |
   | Change | `{change_name}` |
   | Confidence | {confidence_score} / 5.0 |
   | Pipeline | {pipeline_stages} |
   | Intake | [{change_name}/intake.md]({intake_url}) |
   | Spec | [{change_name}/spec.md]({spec_url}) |
   ```

   If `spec.md` does not exist, omit the Spec row entirely.

   **Tier 2 — Lightweight** (type is `docs`, `test`, `ci`, or `chore`, OR no fab change, OR intake missing):

   ```
   ## Summary
   {1-3 sentences auto-generated from commit messages or git diff --stat}

   ## Context
   | Field | Detail |
   |---|---|
   | Type | {type} |

   No design artifacts — housekeeping change.
   ```

4. Create PR: `gh pr create --title "{pr_title}" --body "<body>"` (where `{pr_title}` is the already-prefixed title from step 2)
   - If PR creation fails → report the error and STOP
   - Fall back to `gh pr create --fill` if body generation fails for any reason (silent fallback)
5. Get the PR URL: `gh pr view --json url -q '.url'`

Print: `  ✓ pr     — <PR URL>`

**If PR already exists** (from Step 1), just print: `  ✓ pr     — <existing PR URL> (existing)`

### Step 4: Record PR URL

After the PR URL is known (from step 3c or from the existing PR in step 1), attempt to record it in the active change's `.status.yaml`:

1. Resolve the active change: `fab/.kit/scripts/lib/changeman.sh resolve 2>/dev/null`
2. If resolution succeeds (exit 0), derive the status file path: `fab/changes/{name}/.status.yaml`
3. Call: `fab/.kit/scripts/lib/statusman.sh add-pr <status_file> <pr_url>`
4. If resolution fails (exit non-zero) or `changeman.sh` is not found, skip silently — do not print any error or warning

This step MUST NOT block or fail the PR workflow. Any error from changeman or statusman is silently ignored.

### Step 4b: Commit and Push Status Update

If Step 4 successfully recorded a PR URL (changeman resolved and statusman add-pr ran):

1. Stage the status file: `git add fab/changes/{name}/.status.yaml`
2. Check for changes: `git diff --cached --quiet`
3. If changes exist: commit (`git commit -m "Record PR URL in .status.yaml"`) and push (`git push`). If commit or push fails → report the error and STOP.
4. If no changes (already committed): skip commit+push silently

Print (if committed): `  ✓ status — committed and pushed .status.yaml`

If Step 4 was skipped (no active change, changeman not found), skip this step silently.

### Step 4c: Write PR Sentinel

If Step 4 successfully resolved the change directory:

1. Write the sentinel: `echo "$PR_URL" > "$change_dir/.pr-done"`

This file is gitignored and never committed. It provides a race-free filesystem signal that all git operations are complete. Write is unconditional — happens in both orchestrated and manual flows.

If Step 4 was skipped, skip this step silently.

### Step 5: Report

Print:
```

Shipped.
```

---

## Rules

- Fully autonomous — never ask questions, never present options
- Fail fast — if any step fails, report the error and stop immediately
- Skip steps that are already done (no uncommitted → skip commit, PR exists → skip create)
- Always operate on CWD — no repo detection
- No merge support — stop at PR creation

---

## PR Type Reference

| Type | Description | Fab Pipeline? | Template Tier |
|------|-------------|---------------|---------------|
| `feat` | New feature or capability | Yes | 1 (fab-linked) |
| `fix` | Bug fix | Yes | 1 (fab-linked) |
| `refactor` | Restructure without behavior change | Yes | 1 (fab-linked) |
| `docs` | Documentation-only changes | No | 2 (lightweight) |
| `test` | Adding/fixing tests only | No | 2 (lightweight) |
| `ci` | CI/CD and build system changes | No | 2 (lightweight) |
| `chore` | Maintenance, cleanup, housekeeping | No | 2 (lightweight) |

Derived from [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), consolidated: `style` → `refactor`, `perf` → `feat`/`refactor`, `build` → `ci`.
