package tmux

// The tmux subprocess runner core. Every tmux invocation that follows the
// stderr-in-error convention routes through Run/RunOutput — internal/daemon,
// internal/riff, and cmd/rk delegate here instead of hand-copying the
// exec.CommandContext + capture-stderr + wrap-trimmed-stderr idiom.
//
// Deliberately NOT part of the core:
//   - Timeouts: the ctx is caller-owned. Each call site keeps its own budget
//     (Constitution §I keeps timeouts at call sites).
//   - Socket targeting: callers build their own argv prefix (`-L`/`-S`/bare) —
//     the targeting flavors are documented per-site semantics, never unified.

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// RunOpts carries optional per-invocation overrides for the tmux runner core.
type RunOpts struct {
	Env []string // nil inherits the process environment
	Dir string   // "" inherits the process CWD
}

// Run executes `tmux <args...>` via exec.CommandContext (explicit argv slice,
// never shell strings). On non-zero exit the returned error carries tmux's
// trimmed stderr appended ("%w: %s") so callers can pattern-match diagnostic
// text; when stderr is empty the bare error is returned.
func Run(ctx context.Context, args []string, opts RunOpts) error {
	cmd := newRunCmd(ctx, args, opts)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return wrapStderr(err, stderr.String())
	}
	return nil
}

// RunOutput executes `tmux <args...>` returning raw stdout on success; on
// failure the error carries trimmed stderr per the same convention as Run
// (stdout is excluded from the error text).
func RunOutput(ctx context.Context, args []string, opts RunOpts) ([]byte, error) {
	cmd := newRunCmd(ctx, args, opts)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, wrapStderr(err, stderr.String())
	}
	return out, nil
}

// newRunCmd builds the exec.Cmd shared by Run/RunOutput, applying the
// RunOpts inheritance semantics (nil Env / empty Dir inherit the process's).
func newRunCmd(ctx context.Context, args []string, opts RunOpts) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	if opts.Env != nil {
		cmd.Env = opts.Env
	}
	cmd.Dir = opts.Dir
	return cmd
}

// wrapStderr wraps err with the trimmed stderr text ("%w: %s"), falling back
// to the bare error when trimmed stderr is empty.
func wrapStderr(err error, stderr string) error {
	if msg := strings.TrimSpace(stderr); msg != "" {
		return fmt.Errorf("%w: %s", err, msg)
	}
	return err
}
