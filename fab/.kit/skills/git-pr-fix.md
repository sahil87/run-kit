---
name: git-pr-fix
description: "Wait for Copilot review comments on the current PR, then triage and fix them."
allowed-tools: Bash(git:*), Bash(gh:*)
---

# /git-pr-fix

Wait for GitHub Copilot review comments on the current PR, triage them, and fix actionable ones. Fully autonomous — no questions, no prompts.

---

## Behavior

### Step 1: Resolve PR

1. Verify `gh` is available: `command -v gh`
   - If missing → print `gh CLI not found.` and STOP
2. Get current branch: `git branch --show-current`
3. Look up PR with `gh pr view --json number,url`, capturing its exit code and any stderr output.
   - If the command fails with a "no pull requests found" error → print `No PR found on this branch.` and STOP.
   - If the command fails for any other reason → print the `gh` error output and STOP.
4. If the command succeeds, capture `{number}` and `{url}` from the response.
5. Get owner/repo: `gh repo view --json nameWithOwner -q '.nameWithOwner'`

### Step 2: Wait for Copilot Review

Poll the reviews API for a review from `copilot-pull-request-reviewer[bot]`:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")'
```

**Two detection modes**:

- **Standalone mode** (default): Check once. If no Copilot review found → print `No Copilot review found — skipping.` and STOP. No polling.
- **Wait mode** (when `{wait}` is set — see Step 6 of `/git-pr`): Poll every 30 seconds, max 12 attempts (6 minutes total). If review arrives → proceed. If timeout → print `Copilot review did not arrive within 6 minutes.` and STOP.

On the first poll, if `gh api` returns a non-zero exit code → print the error and STOP.

When a review is found, capture its `{review_id}` from the `.id` field.

### Step 3: Fetch and Triage Comments

Fetch inline comments from the Copilot review:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments --jq '.[] | {path: .path, line: .line, body: .body}'
```

For each comment:

1. **Classify**: Determine if the comment is **actionable** (identifies a specific code issue with an implied or explicit fix) or **informational** (summary, praise, general observation, question without a clear fix action)
2. **Skip** informational comments
3. **For actionable comments**:
   - Read the file at `{path}`
   - Understand the issue described in `{body}`
   - If `{line}` is non-null, focus on that area of the file
   - If `{line}` is null, locate the issue from context in the body
   - Apply a targeted fix — do NOT make unrelated changes beyond what the comment addresses

Print: `{N} comments triaged: {A} actionable, {I} skipped`

If all comments are informational → print `No actionable comments.` and STOP.

### Step 4: Commit and Push

After all actionable comments are processed:

1. Check for modifications: `git status --porcelain`
2. If no modifications (fixes already applied or no changes needed) → print `No actionable comments.` and STOP
3. Stage only the specific modified files: `git add {file1} {file2} ...` (NOT `git add -A`)
4. Commit: `git commit -m "fix: address copilot review feedback"`
5. Push: `git push`
6. If commit or push fails → run `git reset` to clear any staged changes, then print the error and STOP (no partial state)

Print: `✓ Fixed {N} copilot comment(s) across {M} file(s)`

---

## Rules

- Fully autonomous — never ask questions, never present options
- Fail fast — if any step fails, report the error and stop immediately
- No partial commits — if the commit or push fails, no changes are left staged
- Targeted fixes only — do not modify code beyond what each comment addresses
- Idempotent — re-running after fixes finds no new modifications and exits cleanly
