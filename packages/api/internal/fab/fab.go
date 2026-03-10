package fab

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const tmuxTimeout = 10 * time.Second

// GetStatus returns the fab progress line for a worktree. Returns "" if no active change.
func GetStatus(worktreePath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), tmuxTimeout)
	defer cancel()

	scriptPath := filepath.Join(worktreePath, "fab/.kit/scripts/lib/statusman.sh")
	cmd := exec.CommandContext(ctx, "bash", scriptPath, "progress-line")
	cmd.Dir = worktreePath

	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// GetCurrentChange returns the current active change name for a worktree. Returns "" if none.
func GetCurrentChange(worktreePath string) string {
	data, err := os.ReadFile(filepath.Join(worktreePath, "fab/current"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// ListChanges returns raw changeman output for a worktree.
func ListChanges(worktreePath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), tmuxTimeout)
	defer cancel()

	scriptPath := filepath.Join(worktreePath, "fab/.kit/scripts/lib/changeman.sh")
	cmd := exec.CommandContext(ctx, "bash", scriptPath, "list")
	cmd.Dir = worktreePath

	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
