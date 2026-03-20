---
name: git-pr-review
description: "Process PR review comments — triage and fix feedback from any reviewer (human or Copilot)."
allowed-tools: Bash(git:*), Bash(gh:*)
---

# /git-pr-review

Process GitHub PR review comments on the current branch's PR. Handles feedback from any reviewer — human, Copilot, or other bots. Fully autonomous — no questions, no prompts.

---

## Behavior

### Step 0: Start Review-PR Stage

If an active change resolves (`fab/.kit/bin/fab change resolve 2>/dev/null`), attempt to start the `review-pr` stage:

```bash
fab/.kit/bin/fab status start <change> review-pr git-pr-review 2>/dev/null || true
```

This is best-effort — failures are silently ignored. The `start` command handles both `pending` and `failed` → `active`. If the stage is already `active` or `done`, the call is a no-op (exits non-zero, silently ignored).

### Step 1: Resolve PR

1. Verify `gh` is available: `command -v gh`
   - If missing → print `gh CLI not found.` and STOP
2. Get current branch: `git branch --show-current`
3. Look up PR with `gh pr view --json number,url`, capturing its exit code and any stderr output.
   - If the command fails with a "no pull requests found" error → print `No PR found on this branch.` and STOP.
   - If the command fails for any other reason → print the `gh` error output and STOP.
4. If the command succeeds, capture `{number}` and `{url}` from the response.
5. Get owner/repo: `gh repo view --json nameWithOwner -q '.nameWithOwner'`

### Step 2: Detect Reviews and Route

Check for existing reviews with comments, then route accordingly.

**Phase 1 — Check for existing reviews with comments**:

Fetch all reviews on the PR:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '[.[] | select(.state != "PENDING")] | length'
```

If the count is > 0, check for actual inline comments:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq 'length'
```

If comments exist → proceed directly to Step 3 (Path A: fetch all comments). Skip Phases 2 and 3.

If reviews exist but no inline comments → treat as "no actionable reviews" and fall through to Phase 2.

<!-- Note: This checks for inline review comments only. Review-level body comments
     (e.g., "LGTM but please rename that variable") without inline annotations are
     not detected here. If a reviewer only leaves a body comment, the skill will
     fall through to Copilot request. -->

If no reviews at all → fall through to Phase 2.

**Phase 2 — Request Copilot review (fallback)**:

<!-- API login name discrepancy (empirically confirmed):
     - GET /requested_reviewers response: "login": "Copilot" (type: Bot)
     - GET /reviews response (once submitted): "login": "copilot-pull-request-reviewer[bot]"
     - POST /requested_reviewers request body: reviewers[]=copilot-pull-request-reviewer[bot]
     These are different representations of the same bot across GitHub API endpoints. -->

```bash
gh api repos/{owner}/{repo}/pulls/{number}/requested_reviewers -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

- **Any non-2xx response** (422, 403, 404, network error, or any other failure — i.e., any non-zero exit from `gh api`) → print `No reviews found and Copilot not available — nothing to do.` and STOP. No polling.
- **Success (2xx)** → proceed to Phase 3.

**Phase 3 — Poll for Copilot review completion**:

Poll `GET /reviews` for `copilot-pull-request-reviewer[bot]` every 30 seconds, max 16 attempts (8 minutes total):

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '[.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")] | sort_by(.submitted_at) | if length > 0 then .[-1].id else empty end'
```

If a review ID is returned → capture `{review_id}` and proceed to Step 3 (Path B: Copilot-specific comments).

If timeout (16 attempts, no review) → print `Copilot review did not arrive within 8 minutes.` and STOP.

### Step 3: Fetch Comments

The fetching strategy depends on the detection path from Step 2.

**Path A — Existing reviews found** (human or bot reviews already present):

Fetch all review comments on the PR:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | {id: .id, node_id: .node_id, path: .path, line: .line, body: .body, user: .user.login, in_reply_to_id: .in_reply_to_id}'
```

This captures comments from all submitted reviews regardless of reviewer. Track the set of unique `user` values for the commit message in Step 5. Skip reply comments (`in_reply_to_id` is non-null) — these are conversational follow-ups, not new review findings.

> Note: GitHub's REST API does not expose thread resolution state on individual
> comments. All non-reply comments are processed regardless of whether their
> thread has been marked resolved in the GitHub UI.

**Path B — Copilot just requested and reviewed**:

Fetch comments from the specific Copilot review:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments --jq '.[] | {id: .id, node_id: .node_id, path: .path, line: .line, body: .body, user: .user.login, in_reply_to_id: .in_reply_to_id}'
```

Reply filtering is not needed for Path B — the review-specific endpoint returns only comments from that review, not cross-review replies.

### Step 4: Triage Comments

For each fetched comment:

1. **Classify**: Determine if the comment is **fixable** (identifies a specific code issue with an implied or explicit fix — e.g., "This variable is unused", "Missing null check", "Should use `const` instead of `let`"), **deferrable** (valid concern but out of scope for this PR — e.g., "This whole module needs better error handling"), **skippable** (nitpick, stale reference, or not applicable — e.g., "I'd name this differently", references code already changed), or **informational** (summary, praise, general observation, question without a clear fix action — e.g., "Looks good overall", "Why was this approach chosen?")
2. **Skip** informational comments — no disposition, no reply
3. **Assign disposition intent** to each non-informational comment:
   - **`fix`** — the comment identifies a specific code issue and a fix will be applied
   - **`defer`** — the comment raises a valid concern but it's out of scope for this PR
   - **`skip`** — the comment is a nitpick, stale, or not applicable
4. **For `fix` comments**:
   - Read the file at `{path}`
   - Understand the issue described in `{body}`
   - If `{line}` is non-null, focus on that area of the file
   - If `{line}` is null, locate the issue from context in the body
   - Apply a targeted fix — do NOT make unrelated changes beyond what the comment addresses
   - Record a brief description of the change for the reply

Print: `{N} comments triaged: {F} fix, {D} defer, {S} skip, {I} informational (no reply)`

If all comments are informational → print `No actionable comments.` and STOP.

### Step 5: Commit and Push

After all `fix` comments are processed:

1. Check for modifications: `git status --porcelain`
2. If no modifications → print `No changes needed.` and proceed to Step 5.5 (do NOT stop here)
3. Stage only the specific modified files: `git add {file1} {file2} ...` (NOT `git add -A`)
4. Generate commit message based on reviewer source:
   - Comments from `copilot-pull-request-reviewer[bot]` only: `fix: address copilot review feedback`
   - Comments from a single human reviewer: `fix: address review feedback from @{username}`
   - Comments from multiple reviewers: `fix: address PR review feedback`
5. Commit: `git commit -m "<message>"`
6. Push: `git push`
7. If commit or push fails → run `git reset` to clear any staged changes, then print the error and STOP (no partial state)

Print: `Fixed {N} comment(s) across {M} file(s)`

### Step 5.5: Post Replies

After Step 5 (whether or not code was pushed), post reply comments for each comment that received a disposition. This step also runs when no code changes were made (all deferred/skipped) — the communication loop must close regardless.

**Deduplication**: Before posting replies, do a fresh fetch of all review comments to capture any existing disposition replies (Step 3 excludes replies, so those results cannot be used here):

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | select(.in_reply_to_id != null) | {id: .id, in_reply_to_id: .in_reply_to_id, body: .body}'
```

For each comment about to receive a reply, check if any fetched reply (where `in_reply_to_id` matches the target comment's `id`) starts with `Fixed —`, `Deferred —`, or `Skipped —`. If a disposition reply already exists, skip that comment.

**For each comment with a disposition** that passes deduplication:

1. Compose reply text based on disposition intent (replies use past-tense to confirm the outcome):
   - `fix` → `Fixed — {description}. ({sha})` where `{sha}` is the short (7-char) commit SHA and `{description}` is the brief change summary recorded during triage
   - `defer` → `Deferred — {reason}.`
   - `skip` → `Skipped — {reason}.`

2. Post reply via REST API:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{number}/comments \
     -f body="{reply_text}" \
     -F in_reply_to={comment_id}
   ```

**Error handling**: Reply posting is best-effort. If a reply POST fails for a specific comment, log the error and continue to the next comment. A failed reply does not cause the skill to abort or mark the stage as failed.

Print: `Replied to {N} comment(s): {F} fix, {D} defer, {S} skip`

### Step 6: Update Review-PR Stage

If an active change was resolved in Step 0:

1. **On success** (comments processed and pushed, or no actionable comments): Call `fab/.kit/bin/fab status finish <change> review-pr git-pr-review 2>/dev/null || true`.
2. **On failure** (no PR found, processing error): Call `fab/.kit/bin/fab status fail <change> review-pr git-pr-review 2>/dev/null || true`.
3. **On no reviews** (Copilot unavailable, Copilot timeout, or no reviews at all): Call `fab/.kit/bin/fab status finish <change> review-pr git-pr-review 2>/dev/null || true` — a successful no-op outcome.

All statusman calls are best-effort — failures silently ignored to avoid blocking the PR review workflow.

### Phase Sub-State Tracking

When an active change is resolved, update `stage_metrics.review-pr.phase` at key points during the workflow. Phase values track the skill's progress through its steps:

| Phase | When set |
|-------|----------|
| `waiting` | After requesting Copilot review (Step 2, Phase 2 success) |
| `received` | Reviews detected or Copilot review arrived (Step 2, Phase 1 hit or Phase 3 success) |
| `triaging` | Before classifying comments (Step 4 start) |
| `fixing` | Before applying fixes (Step 4, `fix` comments found) |
| `pushed` | After commit and push (Step 5 success) |
| `replying` | Before posting reply comments (Step 5.5 start) |

Phase updates are written via `yq -i ".stage_metrics.\"review-pr\".phase = \"<phase>\"" <status_file>`. Best-effort — failures silently ignored.

The `reviewer` field is set when reviews are detected: `yq -i ".stage_metrics.\"review-pr\".reviewer = \"<login>\"" <status_file>`. For Copilot: `copilot-pull-request-reviewer[bot]`. For humans: `@{username}` (first reviewer found).

---

## Rules

- Fully autonomous — never ask questions, never present options
- Fail fast — if any step fails, report the error and stop immediately
- No partial commits — if the commit or push fails, no changes are left staged
- Targeted fixes only — do not modify code beyond what each comment addresses
- Idempotent — re-running after fixes finds no new modifications and exits cleanly; re-running after replies skips already-replied comments
- Human reviews take priority — if any reviewer has commented, skip Copilot request
- Best-effort replies — failed reply POSTs do not abort the skill or mark the stage as failed

---

## Disposition Reference

Triage assigns an **intent** (action verb); replies confirm the **outcome** (past-tense).

| Intent (triage) | Description | Reply (outcome) |
|-----------------|-------------|-----------------|
| `fix` | Code will be changed to address the comment | `Fixed — {description}. ({sha})` |
| `defer` | Valid concern, out of scope for this PR | `Deferred — {reason}.` |
| `skip` | Nitpick, stale, or not applicable | `Skipped — {reason}.` |

Informational comments (praise, summaries, questions without code implications) receive no reply.
