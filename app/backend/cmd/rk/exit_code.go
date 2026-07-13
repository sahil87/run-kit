package main

// exitCodeError is a CLI-local error carrying a specific os.Exit code. A
// subcommand's RunE wrapper inspects it and calls os.Exit(code) after printing
// msg to stderr — the only way to get distinct exit codes without touching the
// shared main.execute() (which returns exit 1 for generic errors).
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
