package mcp

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Executor runs one tool call as an argv child process of the rk binary
// (docs/specs/mcp.md Principle 8: argv exec, never in-process re-entry — Cobra
// flag globals are not re-entrant). Exe is injectable so tests run against
// stub executables; rk mcp fills os.Executable().
type Executor struct {
	Exe string
}

// Outcome is one tool call's subprocess result. ExitCode is -1 when the
// process could not be started or was killed before exiting (see TimedOut).
type Outcome struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
	TimedOut bool
}

// waitDelay bounds the cleanup of a child that ignores the deadline kill —
// cmd.Run returns even if the child wedges after the kill signal.
const waitDelay = 2 * time.Second

// Run executes Exe with argv under a fresh timeout context. Every argv element
// is a separate slice entry — no joining, no quoting, no shell (Constitution
// I). stdin is plumbed only when non-empty. The child inherits the server's
// environment minus TMUX/TMUX_PANE: no own-pane default may reach a tool
// (docs/specs/mcp.md § Target rule — an ssh session started inside tmux would
// otherwise leak one).
func (e Executor) Run(ctx context.Context, argv []string, stdin string, timeout time.Duration) Outcome {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, e.Exe, argv...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	cmd.Env = withoutTmuxEnv(os.Environ())
	cmd.WaitDelay = waitDelay
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := Outcome{
		Stdout:   stdout.Bytes(),
		Stderr:   stderr.Bytes(),
		ExitCode: 0,
	}
	if err != nil {
		out.ExitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			out.ExitCode = exitErr.ExitCode()
		}
	}
	out.TimedOut = errors.Is(ctx.Err(), context.DeadlineExceeded)
	return out
}

// withoutTmuxEnv drops the tmux own-pane variables from an environment list.
func withoutTmuxEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		if strings.HasPrefix(kv, "TMUX=") || strings.HasPrefix(kv, "TMUX_PANE=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// BuildArgv assembles a tool call's argv from the row and its validated
// arguments: the command path, then flags in Args order, then positionals by
// slot, then literals in Args order (so capture yields
// `mux capture -L <server> -l <lines> <target> --json`). Booleans map to a bare
// flag when true, nothing when false; absent optional inputs contribute
// nothing. args MUST have passed ValidateArgs first — BuildArgv trusts types.
func BuildArgv(row Row, args map[string]any) []string {
	argv := strings.Fields(row.Path)
	for _, arg := range row.Args {
		if arg.Flag == "" {
			continue
		}
		v, ok := args[arg.Name]
		if !ok {
			continue
		}
		switch arg.Type {
		case ArgBoolean:
			if b, _ := v.(bool); b {
				argv = append(argv, arg.Flag)
			}
		case ArgInteger:
			argv = append(argv, arg.Flag, strconv.Itoa(int(v.(float64))))
		default:
			argv = append(argv, arg.Flag, v.(string))
		}
	}
	positionals := positionalArgs(row)
	for _, arg := range positionals {
		if v, ok := args[arg.Name]; ok {
			argv = append(argv, v.(string))
		}
	}
	for _, arg := range row.Args {
		if arg.Literal != "" {
			argv = append(argv, arg.Literal)
		}
	}
	return argv
}

// positionalArgs returns the row's positional inputs ordered by slot.
func positionalArgs(row Row) []Arg {
	var out []Arg
	for _, arg := range row.Args {
		if arg.Positional > 0 {
			out = append(out, arg)
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Positional < out[j-1].Positional; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
