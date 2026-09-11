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
// arguments: the command path, then a single ordered walk over Args — each
// flag, flag-shaped literal, positional, and bare literal is emitted where it
// sits in Args (so gui_exec places `--detach --json --` before its
// positionals while capture keeps `-L s -l 100 %3 --json`). Booleans map to a
// bare flag when true, nothing when false; absent optional inputs contribute
// nothing, except that an absent Flag input carrying a Default emits
// `flag Default` at its position; a Literal whose When input is absent is
// skipped; a Format positional renders its token from the named schema-only
// inputs. args MUST have passed ValidateArgs first — BuildArgv trusts types.
func BuildArgv(row Row, args map[string]any) []string {
	argv := strings.Fields(row.Path)
	for _, arg := range row.Args {
		switch {
		case arg.Flag != "":
			v, ok := args[arg.Name]
			if !ok {
				if arg.Default != "" {
					argv = append(argv, arg.Flag, arg.Default)
				}
				continue
			}
			switch arg.Type {
			case ArgBoolean:
				if b, _ := v.(bool); b {
					argv = append(argv, arg.Flag)
				}
			case ArgInteger:
				argv = append(argv, arg.Flag, strconv.Itoa(int(v.(float64))))
			case ArgStringArray:
				for _, item := range v.([]any) {
					argv = append(argv, arg.Flag, item.(string))
				}
			default:
				argv = append(argv, arg.Flag, v.(string))
			}
		case arg.Positional > 0:
			if arg.Format != "" {
				if token, ok := renderFormat(arg.Format, args); ok {
					argv = append(argv, token)
				}
				continue
			}
			v, ok := args[arg.Name]
			if !ok {
				continue
			}
			switch arg.Type {
			case ArgStringArray:
				for _, item := range v.([]any) {
					argv = append(argv, item.(string))
				}
			case ArgInteger:
				argv = append(argv, strconv.Itoa(int(v.(float64))))
			default:
				argv = append(argv, v.(string))
			}
		case arg.Literal != "":
			if arg.When != "" {
				if _, ok := args[arg.When]; !ok {
					continue
				}
			}
			argv = append(argv, arg.Literal)
		}
	}
	return argv
}

// renderFormat renders a formatted positional's argv token: {name} substitutes
// the named input's string value (integers via strconv.Itoa) and a […]
// segment is dropped when any input inside it is absent. ok is false when a
// non-optional input is absent — the positional then contributes nothing.
func renderFormat(format string, args map[string]any) (string, bool) {
	var b strings.Builder
	for i := 0; i < len(format); i++ {
		switch format[i] {
		case '{':
			end := strings.IndexByte(format[i:], '}')
			if end < 0 {
				b.WriteByte(format[i])
				continue
			}
			v, ok := args[format[i+1:i+end]]
			if !ok {
				return "", false
			}
			b.WriteString(formatValue(v))
			i += end
		case '[':
			end := strings.IndexByte(format[i:], ']')
			if end < 0 {
				b.WriteByte(format[i])
				continue
			}
			if seg, ok := renderFormat(format[i+1:i+end], args); ok {
				b.WriteString(seg)
			}
			i += end
		default:
			b.WriteByte(format[i])
		}
	}
	return b.String(), true
}

// formatValue renders one input value inside a Format token.
func formatValue(v any) string {
	if f, ok := v.(float64); ok {
		return strconv.Itoa(int(f))
	}
	s, _ := v.(string)
	return s
}
