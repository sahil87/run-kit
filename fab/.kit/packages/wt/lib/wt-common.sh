#!/usr/bin/env bash
#
# wt-common.sh - Shared functions for worktree management
#
# Source this file from wt-* commands:
#   source "$(dirname "$0")/../lib/wt-common.sh"

# ============================================================================
# Constants
# ============================================================================

# Exit codes
readonly WT_EXIT_SUCCESS=0
readonly WT_EXIT_GENERAL_ERROR=1
readonly WT_EXIT_INVALID_ARGS=2
readonly WT_EXIT_GIT_ERROR=3
readonly WT_EXIT_RETRY_EXHAUSTED=4
readonly WT_EXIT_BYOBU_TAB_ERROR=5
readonly WT_EXIT_TMUX_WINDOW_ERROR=6

# Default retry count for name collisions
readonly WT_DEFAULT_RETRIES=10

# Init script path (configurable via WORKTREE_INIT_SCRIPT env var)
WORKTREE_INIT_SCRIPT="${WORKTREE_INIT_SCRIPT:-fab/.kit/worktree-init.sh}"

# Colors (disabled if NO_COLOR is set)
if [[ -z "${NO_COLOR:-}" ]]; then
    readonly WT_RED=$'\033[0;31m'
    readonly WT_YELLOW=$'\033[0;33m'
    readonly WT_GREEN=$'\033[0;32m'
    readonly WT_BOLD=$'\033[1m'
    readonly WT_RESET=$'\033[0m'
else
    readonly WT_RED=''
    readonly WT_YELLOW=''
    readonly WT_GREEN=''
    readonly WT_BOLD=''
    readonly WT_RESET=''
fi

# Adjectives for random worktree naming (~50 adjectives)
WT_ADJECTIVES=(
    "swift" "calm" "bold" "keen" "warm" "cool" "bright" "quick"
    "brave" "noble" "wise" "kind" "fair" "proud" "sharp" "clear"
    "vivid" "agile" "sleek" "smart" "crisp" "fresh" "prime" "rapid"
    "witty" "zesty" "lucid" "happy" "sunny" "quiet" "eager" "alert"
    "nimble" "deft" "lively" "merry" "jolly" "golden" "silver" "amber"
    "cosmic" "stellar" "lunar" "solar" "rustic" "urban" "alpine" "arctic"
)

# Nouns (animals) for random worktree naming (~50 nouns)
WT_NOUNS=(
    "fox" "owl" "wolf" "bear" "hawk" "lynx" "puma" "orca"
    "falcon" "raven" "eagle" "crane" "heron" "finch" "robin" "sparrow"
    "otter" "beaver" "badger" "ferret" "marten" "stoat" "mink" "weasel"
    "tiger" "lion" "panther" "jaguar" "leopard" "cheetah" "cougar" "bobcat"
    "dolphin" "whale" "seal" "walrus" "penguin" "puffin" "pelican" "albatross"
    "cobra" "viper" "python" "mamba" "gecko" "iguana" "turtle" "tortoise"
)

# ============================================================================
# Error Handling
# ============================================================================

# Print error message in what/why/fix format and exit
# Usage: wt_error <what> <why> [fix]
wt_error() {
    local what="$1"
    local why="$2"
    local fix="${3:-}"

    echo "${WT_RED}Error:${WT_RESET} $what" >&2
    echo "  ${WT_BOLD}Why:${WT_RESET} $why" >&2
    if [[ -n "$fix" ]]; then
        echo "  ${WT_BOLD}Fix:${WT_RESET} $fix" >&2
    fi
    exit "$WT_EXIT_GENERAL_ERROR"
}

# Print error and exit with specific code
# Usage: wt_error_with_code <code> <what> <why> [fix]
wt_error_with_code() {
    local code="$1"
    local what="$2"
    local why="$3"
    local fix="${4:-}"

    echo "${WT_RED}Error:${WT_RESET} $what" >&2
    echo "  ${WT_BOLD}Why:${WT_RESET} $why" >&2
    if [[ -n "$fix" ]]; then
        echo "  ${WT_BOLD}Fix:${WT_RESET} $fix" >&2
    fi
    exit "$code"
}

# ============================================================================
# Rollback Stack
# ============================================================================

# LIFO rollback stack for multi-step operations.
# Commands are pushed with wt_register_rollback and executed in reverse order
# by wt_rollback. Call wt_disarm_rollback on success to prevent cleanup.
WT_ROLLBACK_STACK=()

# Push a rollback command onto the stack
# Usage: wt_register_rollback "git worktree remove --force /path"
wt_register_rollback() { WT_ROLLBACK_STACK+=("$1"); }

# Execute all rollback commands in reverse order (LIFO).
# Disables set -e so that individual command failures do not prevent
# subsequent rollback entries from executing.
wt_rollback() {
    local old_e
    old_e=$(set +o | grep errexit)
    set +e
    for ((i=${#WT_ROLLBACK_STACK[@]}-1; i>=0; i--)); do
        eval "${WT_ROLLBACK_STACK[$i]}" 2>/dev/null
    done
    eval "$old_e"
}

# Clear the rollback stack (call on successful completion)
wt_disarm_rollback() { WT_ROLLBACK_STACK=(); }

# ============================================================================
# Signal Handling
# ============================================================================

# Signal handler for INT/TERM — runs rollback and exits with code 130.
# Commands with multi-step destructive operations should set:
#   trap wt_cleanup_on_signal INT TERM
wt_cleanup_on_signal() {
    echo "" # newline after ^C
    wt_rollback
    exit 130
}

# ============================================================================
# Hash-Based Stash
# ============================================================================

# Create a stash commit and return its hash. Uses git stash create (hash-based)
# instead of git stash push (index-based) for concurrency safety.
# The hash is stored in the reflog for recovery via `git stash list`.
# Args: $1 = descriptive message
# Stdout: stash hash (empty if no changes)
wt_stash_create() {
    local msg="${1:-wt: stash}"
    git add -A >/dev/null 2>&1
    local hash
    hash=$(git stash create "$msg")
    if [[ -n "$hash" ]]; then
        git stash store "$hash" -m "$msg" 2>/dev/null
        git reset --hard HEAD >/dev/null 2>&1
        git clean -fd >/dev/null 2>&1
        echo "$hash"
    fi
}

# Apply a stash by hash. No-op if hash is empty.
# Args: $1 = stash hash
wt_stash_apply() {
    local hash="$1"
    if [[ -n "$hash" ]]; then
        git stash apply "$hash" 2>/dev/null
    fi
}

# ============================================================================
# Branch Name Validation
# ============================================================================

# Validate a branch name against git ref naming rules.
# Returns 0 if valid, 1 if invalid.
# Args: $1 = branch name
wt_validate_branch_name() {
    local branch="$1"
    [[ -z "$branch" ]] && return 1
    # Reject invalid git ref characters and patterns
    if [[ "$branch" =~ [[:space:]~^:?*\[] ]] || \
       [[ "$branch" == *".."* ]] || \
       [[ "$branch" == *".lock" ]] || \
       [[ "$branch" == "."* ]] || \
       [[ "$branch" == *"/."* ]]; then
        return 1
    fi
    return 0
}

# ============================================================================
# Menu Helper
# ============================================================================

# Display a numbered menu and get user choice
# Args: $1 = prompt, $2 = default choice (optional, 0 for cancel), $3... = menu options
# Returns: selected option number via $WT_MENU_CHOICE
# Option 0 is always "Cancel" and added automatically
# If default is provided, empty input selects that option
wt_show_menu() {
    local prompt="$1"
    shift

    local default_choice=""
    # Check if first arg is a number (default choice) or empty (no default)
    if [[ -z "$1" ]]; then
        shift
    elif [[ "$1" =~ ^[0-9]+$ ]]; then
        default_choice="$1"
        shift
    fi

    local options=("$@")

    echo "$prompt"
    local i=1
    for opt in "${options[@]}"; do
        local default_marker=""
        if [[ "$default_choice" == "$i" ]]; then
            default_marker=" ${WT_GREEN}(default)${WT_RESET}"
        fi
        echo "  ${WT_BOLD}$i)${WT_RESET} $opt$default_marker"
        ((i++))
    done

    local cancel_marker=""
    if [[ "$default_choice" == "0" ]]; then
        cancel_marker=" ${WT_GREEN}(default)${WT_RESET}"
    fi
    echo "  ${WT_BOLD}0)${WT_RESET} Cancel$cancel_marker"
    echo ""

    while true; do
        # Flush any pending input
        read -t 0.1 -n 10000 discard 2>/dev/null || true

        if [[ -n "$default_choice" ]]; then
            printf "Choice [%s]: " "$default_choice"
        else
            printf "Choice: "
        fi
        read -r choice

        # Handle empty input
        if [[ -z "$choice" ]]; then
            if [[ -n "$default_choice" ]]; then
                WT_MENU_CHOICE="$default_choice"
                return 0
            else
                WT_MENU_CHOICE=0
                return 0
            fi
        fi

        # Validate numeric input
        if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
            echo "Invalid choice. Please enter a number."
            continue
        fi

        # Check if choice is in valid range
        if ((choice < 0 || choice > ${#options[@]})); then
            echo "Invalid choice. Please enter a number between 0 and ${#options[@]}."
            continue
        fi

        WT_MENU_CHOICE="$choice"
        return 0
    done
}

# ============================================================================
# Git Repository Detection
# ============================================================================

# Validate we're in a git repository
wt_validate_git_repo() {
    if ! git rev-parse --is-inside-work-tree &>/dev/null; then
        wt_error_with_code "$WT_EXIT_GIT_ERROR" \
            "Not a git repository" \
            "This command requires a git repository" \
            "Navigate to a git repository and try again"
    fi
}

# Get repository context (root, name, worktrees directory)
# Sets: WT_REPO_ROOT, WT_REPO_NAME, WT_WORKTREES_DIR
# Always uses the MAIN repo root, even when run from a worktree
wt_get_repo_context() {
    local git_common_dir
    git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || {
        wt_error_with_code "$WT_EXIT_GENERAL_ERROR" \
            "Not a git repository" \
            "This command must be run from within a git repository" \
            "Navigate to a git repository and try again"
    }

    # Convert to absolute, symlink-resolved path (ensures match with git worktree list output)
    git_common_dir=$(cd "$git_common_dir" && pwd -P)

    # Derive main repo root by stripping /.git suffix
    WT_REPO_ROOT="${git_common_dir%/.git}"
    WT_REPO_NAME=$(basename "$WT_REPO_ROOT")
    WT_WORKTREES_DIR="$(dirname "$WT_REPO_ROOT")/${WT_REPO_NAME}.worktrees"
}

# Check if we're inside a worktree (not the main repo)
# Returns: 0 if in worktree, 1 if in main repo
wt_is_worktree() {
    local git_dir common_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
    [[ "$git_dir" != "$common_dir" ]]
}

# Get the default branch (main or master)
wt_get_default_branch() {
    local default_branch

    # Try origin/HEAD first
    default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

    # Fallback to checking main/master existence
    if [[ -z "$default_branch" ]]; then
        if git show-ref --verify --quiet refs/heads/main 2>/dev/null; then
            default_branch="main"
        elif git show-ref --verify --quiet refs/heads/master 2>/dev/null; then
            default_branch="master"
        else
            default_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || default_branch="main"
        fi
    fi

    echo "$default_branch"
}

# Check if branch exists locally
wt_branch_exists_locally() {
    local branch="$1"
    git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null
}

# Check if branch exists on remote
wt_branch_exists_remotely() {
    local branch="$1"
    git ls-remote --heads origin "$branch" 2>/dev/null | grep -q "$branch"
}

# ============================================================================
# Change Detection
# ============================================================================

# Check for uncommitted changes (staged or unstaged)
wt_has_uncommitted_changes() {
    ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null
}

# Check for untracked files
wt_has_untracked_files() {
    [[ -n $(git ls-files --others --exclude-standard 2>/dev/null) ]]
}

# Check if branch has unpushed commits
wt_has_unpushed_commits() {
    local branch="$1"
    local upstream
    upstream=$(git rev-parse --abbrev-ref "${branch}@{upstream}" 2>/dev/null) || return 1
    [[ -n $(git log "${upstream}..${branch}" --oneline 2>/dev/null) ]]
}

# Get count of unpushed commits
wt_get_unpushed_count() {
    local branch="$1"
    local upstream
    upstream=$(git rev-parse --abbrev-ref "${branch}@{upstream}" 2>/dev/null) || { echo "0"; return; }
    git rev-list --count "${upstream}..${branch}" 2>/dev/null || echo "0"
}

# ============================================================================
# OS Detection
# ============================================================================

# Detect operating system
wt_detect_os() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux)  echo "linux" ;;
        *)      echo "unknown" ;;
    esac
}

# Detect if running inside a byobu session
wt_is_byobu_session() {
    if [[ -n "${BYOBU_TTY:-}" || -n "${BYOBU_BACKEND:-}" || -n "${BYOBU_SESSION:-}" ]]; then
        return 0
    fi
    if [[ -n "${TMUX:-}" && -n "${BYOBU_CONFIG_DIR:-}" ]]; then
        return 0
    fi
    return 1
}

# Detect if running inside a plain tmux session (not byobu)
wt_is_tmux_session() {
    if [[ -n "${TMUX:-}" ]] && ! wt_is_byobu_session; then
        return 0
    fi
    return 1
}

# ============================================================================
# Random Name Generation
# ============================================================================

# Generate a random adjective-noun combo (e.g., "swift-fox", "calm-owl")
wt_generate_random_name() {
    local adj_index=$((RANDOM % ${#WT_ADJECTIVES[@]}))
    local noun_index=$((RANDOM % ${#WT_NOUNS[@]}))
    echo "${WT_ADJECTIVES[$adj_index]}-${WT_NOUNS[$noun_index]}"
}

# Derive worktree name from branch name
# Extracts the last segment after any slashes (feature/login → login)
wt_derive_worktree_name() {
    local branch="$1"
    local name="${branch##*/}"
    name="${name//[^a-zA-Z0-9_-]/-}"
    echo "$name"
}

# ============================================================================
# Worktree Operations
# ============================================================================

# Ensure worktrees directory exists
wt_ensure_worktrees_dir() {
    if [[ ! -d "$WT_WORKTREES_DIR" ]]; then
        mkdir -p "$WT_WORKTREES_DIR" || {
            wt_error_with_code "$WT_EXIT_GENERAL_ERROR" \
                "Cannot create worktrees directory" \
                "Failed to create directory at $WT_WORKTREES_DIR" \
                "Check permissions on $(dirname "$WT_WORKTREES_DIR")"
        }
    fi
}

# Check if worktree name would collide with existing worktree
wt_check_name_collision() {
    local name="$1"
    local wt_path="$WT_WORKTREES_DIR/$name"
    [[ -d "$wt_path" ]]
}

# Create a new worktree with rollback registration
# Args: $1 = worktree path, $2 = branch name, $3 = "new" if creating new branch
wt_create_worktree() {
    local wt_path="$1"
    local branch="$2"
    local mode="${3:-existing}"

    if [[ "$mode" == "new" ]]; then
        git worktree add -b "$branch" "$wt_path" 2>/dev/null || {
            wt_error_with_code "$WT_EXIT_GIT_ERROR" \
                "Failed to create worktree" \
                "git worktree add failed for branch '$branch' at '$wt_path'" \
                "Check if the branch already exists or if there are permission issues"
        }
        wt_register_rollback "git worktree remove --force '$wt_path'"
        wt_register_rollback "git branch -D '$branch'"
    else
        git worktree add "$wt_path" "$branch" 2>/dev/null || {
            wt_error_with_code "$WT_EXIT_GIT_ERROR" \
                "Failed to create worktree" \
                "git worktree add failed for branch '$branch' at '$wt_path'" \
                "The branch may already be checked out in another worktree"
        }
        wt_register_rollback "git worktree remove --force '$wt_path'"
    fi
}

# Fetch a remote branch and set up tracking
wt_fetch_remote_branch() {
    local branch="$1"
    git fetch origin "$branch:$branch" 2>/dev/null || {
        wt_error_with_code "$WT_EXIT_GIT_ERROR" \
            "Failed to fetch remote branch '$branch'" \
            "git fetch origin $branch failed" \
            "Verify the branch exists on origin with 'git ls-remote origin $branch'"
    }
}

# Print worktree creation success message
wt_print_success() {
    local name="$1"
    local path="$2"
    local branch="$3"

    echo "Created worktree: $name"
    echo "Path: $path"
    echo "Branch: $branch"
}

# Create worktree for a specified branch (local, remote, or new)
wt_create_branch_worktree() {
    local branch="$1"
    local name="$2"

    wt_ensure_worktrees_dir

    local wt_path="$WT_WORKTREES_DIR/$name"

    if wt_branch_exists_locally "$branch"; then
        wt_create_worktree "$wt_path" "$branch" "existing"
    elif wt_branch_exists_remotely "$branch"; then
        wt_fetch_remote_branch "$branch"
        wt_create_worktree "$wt_path" "$branch" "existing"
    else
        wt_create_worktree "$wt_path" "$branch" "new"
    fi

    wt_print_success "$name" "$wt_path" "$branch"

    WT_PATH="$wt_path"
}

# Run init script in the newly created worktree if it exists
# Args: $1 = worktree path, $2 = mode ("force" to skip prompt, "" to prompt)
wt_run_worktree_setup() {
    local wt_path="$1"
    local mode="${2:-}"
    local init_script="$wt_path/$WORKTREE_INIT_SCRIPT"

    if [[ -f "$init_script" ]]; then
        if [[ "$mode" == "force" ]]; then
            echo "Running worktree init..."
            (cd "$wt_path" && bash "$init_script")
            echo "Worktree init complete."
        else
            echo ""
            printf "Initialize worktree? [Y/n] "
            read -r answer

            if [[ -z "$answer" || "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
                echo "Running worktree init..."
                (cd "$wt_path" && bash "$init_script")
                echo "Worktree init complete."
            fi
        fi
    fi
}

# ============================================================================
# Worktree Listing
# ============================================================================

# List all worktrees as tab-separated path\tbranch lines
wt_list_worktrees() {
    git worktree list --porcelain 2>/dev/null | awk '
        /^worktree / { path = substr($0, 10) }
        /^branch / { branch = substr($0, 8); gsub(/refs\/heads\//, "", branch); print path "\t" branch }
        /^detached/ { print path "\t(detached)" }
    '
}

# Get worktree path by name (basename match)
# Returns: path on stdout, exit 0 if found, 1 if not
wt_get_worktree_path_by_name() {
    local name="$1"

    while IFS=$'\t' read -r path branch; do
        if [[ "$(basename "$path")" == "$name" ]]; then
            echo "$path"
            return 0
        fi
    done < <(wt_list_worktrees)

    return 1
}
