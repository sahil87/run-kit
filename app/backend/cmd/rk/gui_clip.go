package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui clip — the CLIPBOARD selection via xclip (xsel fallback), probed on
// PATH: rk installs nothing. Not an input verb — the human-input guard never
// applies.

// guiClipNoToolError names both ladder tools so the hint survives a partial
// install.
const guiClipNoToolError = "no clipboard tool found (tried xclip, xsel) — sudo apt install xclip"

// guiClipTimeout bounds the clipboard subprocess (the tmux-class bound).
const guiClipTimeout = 10 * time.Second

// guiClipArgv is the per-tool argv: xclip's -selection clipboard, xsel's
// --clipboard; out=false is the write form.
func guiClipArgv(tool string, out bool) []string {
	if tool == "xsel" {
		if out {
			return []string{"xsel", "--clipboard", "--output"}
		}
		return []string{"xsel", "--clipboard", "--input"}
	}
	if out {
		return []string{"xclip", "-selection", "clipboard", "-o"}
	}
	return []string{"xclip", "-selection", "clipboard", "-i"}
}

// guiClipTool resolves the ladder: xclip first, then xsel. "" on a miss.
func guiClipTool(lookPath func(string) (string, error)) string {
	for _, tool := range []string{"xclip", "xsel"} {
		if _, err := lookPath(tool); err == nil {
			return tool
		}
	}
	return ""
}

// guiClipGetFn runs the clipboard read and captures stdout. A package seam so
// tests drive the ladder without an X server.
var guiClipGetFn = func(ctx context.Context, display string, argv []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, guiClipTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = gui.LaunchEnv(os.Environ(), display, "")
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		if tail := strings.TrimSpace(errBuf.String()); tail != "" {
			return "", errors.New(tail)
		}
		return "", err
	}
	return out.String(), nil
}

// guiClipSetFn runs the clipboard write with the text on stdin. The runner
// attaches NO stdout/stderr pipes and never kills a forked selection owner:
// xclip -i / xsel --input fork a child that IS the clipboard on a desktop
// with no clipboard manager (it serves paste requests for as long as the
// clipboard holds the value) — a Go Wait on an inherited pipe would block
// until the timeout, and a kill would empty the clipboard. The context bounds
// only the parent's exit. A package seam so tests drive the ladder without an
// X server.
var guiClipSetFn = func(ctx context.Context, display string, argv []string, text string) error {
	ctx, cancel := context.WithTimeout(ctx, guiClipTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = gui.LaunchEnv(os.Environ(), display, "")
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}

var guiClipCmd = &cobra.Command{
	Use:   "clip <get|set> [<text> | --stdin]",
	Short: "Read or write the GUI display's clipboard",
	Long: `Read or write the display's CLIPBOARD selection via xclip (xsel
fallback; neither installed is an error with the apt hint).

'clip get' prints the clipboard verbatim on stdout (no trailing newline
added). 'clip set <text>' / 'clip set --stdin' writes it and prints nothing —
pair 'clip set' with 'rk gui key ctrl+v' to paste a paragraph instead of
typing it. The write leaves xclip/xsel's forked child alive: on a desktop
with no clipboard manager that child IS the clipboard.

Refuses (exit 1) when the GUI is off or enabled but not running.`,
	Args:         cobra.ArbitraryArgs,
	SilenceUsage: true,
	RunE:         runGuiClip,
}

func init() {
	guiClipCmd.Flags().Bool("stdin", false, "set reads the text from stdin")
}

func runGuiClip(cmd *cobra.Command, args []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("clip")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 30*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	stdinFlag, _ := cmd.Flags().GetBool("stdin")

	var mode string
	var text string
	switch {
	case len(args) >= 1 && args[0] == "get":
		mode = "get"
		if len(args) > 1 || stdinFlag {
			return usageError(errors.New("clip get takes no argument"))
		}
	case len(args) >= 1 && args[0] == "set":
		mode = "set"
		switch {
		case len(args) == 2 && stdinFlag:
			return usageError(errors.New("clip set takes the text as an argument or --stdin, not both"))
		case len(args) == 2:
			text = args[1]
		case len(args) == 1 && stdinFlag:
			data, rerr := io.ReadAll(cmd.InOrStdin())
			if rerr != nil {
				return fmt.Errorf("error: reading stdin: %w", rerr)
			}
			text = string(data)
		default:
			return usageError(errors.New("clip set needs the text as an argument or --stdin"))
		}
	default:
		return usageError(errors.New("clip needs a subcommand: get | set <text> | set --stdin"))
	}

	tool := guiClipTool(guiLookPathFn)
	if tool == "" {
		return errors.New(guiClipNoToolError)
	}
	if mode == "get" {
		out, err := guiClipGetFn(ctx, st.Display, guiClipArgv(tool, true))
		if err != nil {
			return fmt.Errorf("error: %s: %w", tool, err)
		}
		// The datum is the clipboard verbatim — no trailing newline added.
		newSink(cmd).Dataf("%s", out)
		return nil
	}
	if err := guiClipSetFn(ctx, st.Display, guiClipArgv(tool, false), text); err != nil {
		return fmt.Errorf("error: %s: %w", tool, err)
	}
	return nil
}
