---
name: git-branch
description: "Create or switch to the git branch matching the active (or specified) change."
allowed-tools: Bash(git:*)
---

# /git-branch [change-name]

Create or check out a git branch named `{change-name}` for the active or specified change. When an explicit argument doesn't match any change, falls back to creating a standalone branch with the literal name. Does not modify fab state.

---

## Arguments

- **`<change-name>`** *(optional)* — target a specific change. If omitted, uses the active change resolved via `.fab-status.yaml`. Supports full folder names, partial slug matches, or any substring (resolved via `fab change resolve`).

---

## Behavior

### Step 1: Check Git Repo

Verify inside a git repository:

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1
```

If not in a git repo:

```
Not inside a git repository.
```

STOP.

### Step 2: Resolve Change Name

If `<change-name>` provided:

```bash
fab/.kit/bin/fab change resolve "<change-name>"
```

If not provided, resolve from `.fab-status.yaml`:

```bash
fab/.kit/bin/fab change resolve
```

If resolution fails:

- **If no argument was provided**: display changeman's stderr and STOP.
- **If an explicit argument was provided**: enter **standalone fallback** — use the raw argument as a literal branch name. Print:

```
No matching change found — using standalone branch '{name}'
```

Set `standalone = true` and proceed to Step 3.

### Step 3: Derive Branch Name

**If standalone**: use the raw argument as-is — no prefix, no transformation:

```
branch_name = {raw_argument}
```

**Otherwise** (change resolved): use the change name directly:

```
branch_name = {resolved_change_name}
```

### Step 4: Context-Dependent Action

Get the current branch:

```bash
git branch --show-current
```

Check if the target branch already exists locally:

```bash
git rev-parse --verify "{branch_name}" >/dev/null 2>&1
```

**If already on the target branch**: No git operation.

```
Branch: {branch_name} (already active)
```

STOP.

**If the target branch exists but is not current**: Switch to it.

```bash
git checkout "{branch_name}"
```

Report: `Branch: {branch_name} (checked out)`

STOP.

**If on `main` or `master`**: Auto-create the branch without prompting.

```bash
git checkout -b "{branch_name}"
```

**If on any other branch**: Check upstream tracking to decide action:

```bash
upstream=$(git config "branch.$(git branch --show-current).remote" 2>/dev/null || true)
```

- **No upstream** (local-only branch) — rename the current branch:

```bash
git branch -m "{branch_name}"
```

- **Has upstream** (branch has been pushed) — create a new branch, leaving the current one intact:

```bash
git checkout -b "{branch_name}"
```

### Step 5: Report

```
Branch: {branch_name} (created|checked out|renamed from {old_branch}|created, leaving {old_branch} intact|already active)
```

---

## Output

```
Branch: {branch_name} (created|checked out|renamed from {old_branch}|created, leaving {old_branch} intact|already active)
```

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Not in a git repo | Report and stop |
| Change name resolution fails (no argument) | Display changeman's error and stop |
| Change name resolution fails (explicit argument) | Standalone fallback — use literal argument as branch name |
| `git checkout` fails (e.g., uncommitted conflicts) | Report the git error. No fab state modified. |

---

## Key Properties

| Property | Value |
|----------|-------|
| Advances stage? | No |
| Idempotent? | Yes — checking out an already-active branch is a no-op |
| Modifies `.fab-status.yaml`? | No |
| Modifies `.status.yaml`? | No |
| Modifies git state? | Yes — may create, checkout, or rename a branch |
| Requires config/constitution? | No |
