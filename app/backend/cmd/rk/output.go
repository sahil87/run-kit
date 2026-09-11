package main

import (
	"encoding/json"
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

// Envelope codes for the --json error document (docs/specs/mcp.md § Envelope):
// exit 2 ⇔ usage, exit 1 ⇔ operational — `ok` mirrors the exit code exactly.
const (
	envelopeCodeUsage       = "usage"
	envelopeCodeOperational = "operational"
)

// envelopeError is the --json error object (docs/specs/mcp.md § Envelope).
// Hint and Reason are omitted when empty; a verb sets them only when it holds
// a machine-neutral next step or a daemon-defined reason token to carry.
type envelopeError struct {
	Code    string `json:"code"` // envelopeCodeUsage | envelopeCodeOperational
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// envelopedError marks an error whose envelope document has already been
// written to stdout (by Envelope or JSONError), so execute()'s central failure
// writer (see root.go) does not write a second one. Unwrap delegates to the
// inner error so exitCode's errors.As still finds a carried *exitCodeError and
// the exit code is unchanged; Error() delegates so cobra's stderr "Error: …"
// text is unchanged.
type envelopedError struct{ err error }

func (e envelopedError) Error() string { return e.err.Error() }
func (e envelopedError) Unwrap() error { return e.err }

// envelopeOK and envelopeFail are the two wire shapes (spec § Envelope): on
// success result is always present (even when null); on failure result rides
// along only when non-nil — the verdict-bearing verbs (doctor, tab new on
// gone, code exec --all) print their document and still exit non-zero.
type envelopeOK struct {
	OK     bool `json:"ok"`
	Result any  `json:"result"`
}

type envelopeFail struct {
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  *envelopeError `json:"error"`
}

// writeEnvelope is the single encoder every envelope document goes through:
// exactly one two-space-indented JSON document, newline-terminated, on the
// data channel (stdout — never gated by --quiet). Verbs never hand-format an
// envelope.
func (s outputSink) writeEnvelope(doc any) error {
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	s.Dataf("%s\n", b)
	return nil
}

// Envelope writes the --json document for a verb's outcome and returns err
// wrapped as an envelopedError (nil in, nil out) so the caller's RunE keeps
// its exit code while execute() knows the document is already written:
//
//	err == nil → {"ok":true,"result":<result>}
//	err != nil → {"ok":false,"error":{code,message}} plus "result":<result>
//	             when result is non-nil (verdict-bearing verbs)
//
// error.code is envelopeCodeUsage iff exitCode(err) == 2, else
// envelopeCodeOperational; error.message is err.Error() — the same text cobra
// prints to stderr. A document that fails to encode returns the encode error
// unwrapped (no envelope was written, so the central writer may still emit
// one). Verbs that compose their own error object (a daemon hint or reason
// token) use JSONError instead.
//
// The failure document is written once: verbs that hold an error value call
// Envelope (the marker below tells execute() so), verbs that composed their
// own error object call JSONError and return a plain error — execute() then
// sees bytes already on stdout and writes nothing.
//
// Boundary: the envelope contract starts at RunE entry. Flag-parse failures
// (FlagErrorFunc) and Args-validator failures happen before that and emit NO
// envelope — cobra's stderr error and exit 2 only (root.go tags them
// preRunError so execute() skips them; the MCP proxy's exit-code fallback
// classifies them as usage).
func (s outputSink) Envelope(result any, err error) error {
	if err == nil {
		return s.writeEnvelope(envelopeOK{OK: true, Result: result})
	}
	doc := envelopeFail{Result: result, Error: &envelopeError{Code: envelopeCodeForErr(err), Message: err.Error()}}
	if wErr := s.writeEnvelope(doc); wErr != nil {
		return wErr
	}
	return envelopedError{err: err}
}

// JSONResult writes {"ok":true,"result":v} — Envelope's success half for a
// caller holding no error value (an encode failure writes nothing).
func (s outputSink) JSONResult(v any) {
	_ = s.writeEnvelope(envelopeOK{OK: true, Result: v})
}

// JSONError writes {"ok":false,"error":e} for a verb that composed its own
// error object (a daemon hint or reason token — send/await/operator request)
// and then returns its RunE error as usual; e.Code is the caller's to keep in
// step with that error's exit class (envelopeCodeForErr). execute()'s central
// writer adds no second document because stdout already carries bytes (the
// root out-writer tracker in root.go), so no marker rides the error here.
func (s outputSink) JSONError(e envelopeError) {
	_ = s.writeEnvelope(envelopeFail{Error: &e})
}

// envelopeCodeForErr classifies a RunE error into the envelope code through
// the one exit-code classifier: exit 2 is usage; everything else is
// operational — `ok` mirrors the exit code (docs/specs/mcp.md § Envelope).
func envelopeCodeForErr(err error) string {
	if exitCode(err) == exitUsage {
		return envelopeCodeUsage
	}
	return envelopeCodeOperational
}
