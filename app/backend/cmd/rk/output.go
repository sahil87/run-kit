package main

import (
	"fmt"
	"io"

	"github.com/spf13/cobra"
)

// quiet is bound to the persistent --quiet flag registered on rootCmd (see
// root.go init). It is the fallback signal for newSink when a command's own
// flag set does not resolve --quiet (e.g. a directly-constructed command in a
// unit test). Production reads the flag off the invoked command; the var keeps
// the two in sync because cobra's BoolVar writes it during flag parsing.
var quiet bool

// outputSink is the single output convention for CLI commands, decided once
// (Toolkit Principle 9): stdout carries data (machine-consumable results —
// never gated by --quiet); stderr carries chatter (progress, decoration) which
// --quiet drops. Errors are NOT the sink's concern — they keep flowing through
// RunE returns and ungated stderr writes, so they always survive --quiet.
//
// Built on cmd.OutOrStdout()/cmd.ErrOrStderr() (never bare os.Stdout/os.Stderr)
// so quiet-gating is unit-testable — the idiom doctor.go and agent_setup.go
// already use.
type outputSink struct {
	data    io.Writer // stdout — survives --quiet
	chatter io.Writer // stderr, or io.Discard under --quiet
}

// newSink builds the sink for a cobra command. Data goes to the command's
// stdout; chatter goes to the command's stderr unless --quiet is set, in which
// case it is discarded. It resolves --quiet from the command's own flag set
// (persistent flags are visible through cmd.Flags()); if the flag is not
// registered on that command (e.g. a test that constructs a bare command), it
// falls back to the package-level `quiet` var.
func newSink(cmd *cobra.Command) outputSink {
	q := quiet
	if f := cmd.Flags().Lookup("quiet"); f != nil {
		if v, err := cmd.Flags().GetBool("quiet"); err == nil {
			q = v
		}
	}
	chatter := cmd.ErrOrStderr()
	if q {
		chatter = io.Discard
	}
	return outputSink{data: cmd.OutOrStdout(), chatter: chatter}
}

// newSinkWriters constructs a sink from explicit writers, for unit tests that
// want to observe the data and chatter channels independently without a cobra
// command. Passing the same buffer for both channels yields a sink that behaves
// like a non-quiet run collapsed onto one stream.
func newSinkWriters(data, chatter io.Writer) outputSink {
	return outputSink{data: data, chatter: chatter}
}

// Dataf writes to the data channel (stdout) — a machine-consumable result that
// is never suppressed by --quiet.
func (s outputSink) Dataf(format string, a ...any) {
	fmt.Fprintf(s.data, format, a...)
}

// Notef writes to the chatter channel (stderr, or io.Discard under --quiet) —
// progress and decoration that --quiet drops.
func (s outputSink) Notef(format string, a ...any) {
	fmt.Fprintf(s.chatter, format, a...)
}
