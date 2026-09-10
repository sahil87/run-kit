// Package shellq owns rk's single POSIX shell-quoting implementation and the
// agent-exit shell-fallback tail. Consumers are the composition points where a
// caller-supplied value becomes one word inside a shell-interpreted string
// (tmux's shell-command positional, pipe-pane's command): every such value
// goes through Quote/QuoteArgv so it reaches the shell as one literal word
// (constitution §I). Pure — no I/O.
package shellq

import (
	"fmt"
	"strings"
)

// Quote single-quotes s for a POSIX shell. An embedded single quote is
// rendered by closing the quote, emitting a backslash-escaped quote, and
// reopening the quote (the canonical four-character POSIX sequence). The
// result is exactly one shell word no matter what s contains. Pure.
func Quote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// QuoteArgv renders argv as a space-joined sequence of Quote'd words — the
// composition for tmux's single shell-command positional, where each argv
// element must survive as one literal word through the window shell's parse.
// Empty argv yields "". Pure.
func QuoteArgv(argv []string) string {
	quoted := make([]string, 0, len(argv))
	for _, tok := range argv {
		quoted = append(quoted, Quote(tok))
	}
	return strings.Join(quoted, " ")
}

// WithShellFallback appends `; exec "${SHELL:-/bin/sh}"` to cmd so the pane
// drops into an interactive shell rather than closing when cmd exits.
// Empty/whitespace-only input yields just the bare `exec "${SHELL:-/bin/sh}"`
// (never a leading `;`). Pure.
func WithShellFallback(cmd string) string {
	if strings.TrimSpace(cmd) == "" {
		return `exec "${SHELL:-/bin/sh}"`
	}
	return fmt.Sprintf(`%s; exec "${SHELL:-/bin/sh}"`, cmd)
}
