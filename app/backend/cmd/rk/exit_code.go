package main

import (
	"errors"
	"strings"
)

// Exit-code convention (shll toolkit Principle 4, https://shll.ai/shll/standards/principles):
//
//	0  success
//	1  operational failure (a dead server, a failed dependency check, a subprocess error)
//	2  usage error (unknown command, arg-count violation, unknown/invalid flag)
//
// riff carries a third operational class (3, subprocess) in internal/riff; see
// that package's ExitCodeError.
const (
	exitUsage = 2 // usage/flag/arg-count/unknown-command errors
)

// unknownCommandPrefix is the stable leading text of cobra's legacyArgs/Find
// unknown-command error ("unknown command %q for %q…"). The root command keeps
// Args: nil so cobra prints that error natively (message, Levenshtein
// suggestions, and the "Run '… --help' for usage." hint) — exitCode classifies
// it usage-class (2) by matching this prefix. If cobra ever changes the wording
// the match fails safe: the error defaults to operational (1), never wrong
// output. Note the case: cobra's help-topic error ("Unknown help topic …", exit
// 0) has a capital U and does NOT match, so `run-kit help bogus` stays 0.
const unknownCommandPrefix = "unknown command "

// exitCodeError is a CLI-local error carrying a specific os.Exit code. It is the
// single mechanism for distinct exit codes: the shared main.execute() classifies
// every error rootCmd.Execute() returns via exitCode() and exits with the carried
// code (usage → 2), defaulting to 1 for a plain operational error. A subcommand
// MAY also inspect it directly and os.Exit itself (see `rk shell-init`) when it
// must print before cobra's own error path — but that is no longer required just
// to get a non-1 code.
//
// This is a general CLI helper used by `rk shell-init` (and historically by
// `rk riff`, whose exit-code type now lives in internal/riff as the exported
// ExitCodeError so the HTTP frontend can classify engine failures too — the CLI
// maps riff.ExitCodeError in runRiffWithExitCode).
type exitCodeError struct {
	code int
	msg  string
}

func (e *exitCodeError) Error() string { return e.msg }

// usageError wraps err as a usage-class error (exit 2). The message is preserved
// verbatim — Error() returns err.Error() unchanged — so cobra's existing stderr
// output (the "Error: …" line + usage) is untouched; only the process exit code
// changes. Used by the root FlagErrorFunc, the Args-validator wraps, and riff's
// manual flag-parse wrap (runRiffWithExitCode) to tag usage-class errors.
func usageError(err error) error {
	return &exitCodeError{code: exitUsage, msg: err.Error()}
}

// exitCode classifies an error into an os.Exit code. It is a pure function (no
// os.Exit, no I/O) so root_test.go can table-test classification in-process. A
// carried *exitCodeError yields its .code (via errors.As, so a wrapped chain is
// unwrapped); a plain unknown-command error (cobra's native legacyArgs/Find
// path, matched by unknownCommandPrefix) yields usage-class 2; any other non-nil
// error defaults to 1 (operational). A nil error yields 0. Both the CLI-local
// *exitCodeError (usage class) and the wrapped riff.ExitCodeError chains flow
// through here because riff's RunE wrapper os.Exits before returning for its own
// classes; a riff error that escapes as a plain error still defaults to 1.
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ece *exitCodeError
	if errors.As(err, &ece) {
		return ece.code
	}
	// Unknown-command errors are printed natively by cobra (root Args is nil),
	// so they arrive here as plain errors. Classify them usage-class (2) by the
	// stable message prefix; anything else defaults to operational (1).
	if strings.HasPrefix(err.Error(), unknownCommandPrefix) {
		return exitUsage
	}
	return 1
}
