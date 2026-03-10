package worktree

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

const buildTimeout = 30 * time.Second

// Create creates a new worktree via wt-create.
func Create(name string, branch string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()

	args := []string{"--non-interactive", "--worktree-name", name}
	if branch != "" {
		args = append(args, branch)
	}

	cmd := exec.CommandContext(ctx, "wt-create", args...)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// List lists all worktrees via wt-list.
func List() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt-list")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// Delete deletes a worktree via wt-delete.
func Delete(name string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt-delete", name)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// Open opens a worktree via wt-open.
func Open(name string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), buildTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt-open", name)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
