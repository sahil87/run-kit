package main

import (
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
)

// shellInitBanner returns the leading comment block emitted at the top of
// `rk shell-init <shell>` output. It mirrors the pattern used by `tu`, `hop`,
// and `wt` — a one-line tagline, an install hint, and an explanatory note that
// the snippet is intended for `eval` (not for `$fpath` autoload).
//
// rk does NOT define a shell function wrapper (unlike hop/wt) because rk has
// no bare-name dispatch, no tool-form sugar, and no verb dispatch — every
// subcommand is reached the regular way via `rk <subcommand>`. The shell-init
// output is therefore completion-only.
func shellInitBanner(shell string) string {
	installRC := "~/.zshrc"
	if shell == "bash" {
		installRC = "~/.bashrc"
	}
	return fmt.Sprintf(`# rk(1) %[1]s completion
# Install:
#   echo 'eval "$(rk shell-init %[1]s)"' >> %[2]s
#
# This snippet is intended for `+"`eval`"+`, not for autoload via $fpath. It defines
# the cobra-generated _rk completion function and registers it with the shell's
# completion system. rk has no shell function wrapper — every subcommand is
# reached via `+"`rk <subcommand>`"+`, so this snippet is completion-only.
`, shell, installRC)
}

// zshCompinitShim is prepended to the cobra-generated zsh completion so that
// `compdef` is available even when the user's rc file hasn't already run
// `compinit`. Without this, sourcing the eval'd output from a fresh shell
// (or before compinit fires) fails with `compdef: command not found` and the
// `_rk` function never registers.
const zshCompinitShim = `
# Lazy-load compinit if the user hasn't already initialised the completion
# system — ` + "`compdef`" + ` is provided by compinit and is required to register _rk
# against the ` + "`rk`" + ` command at eval time.
(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -i }

`

// newShellInitCmd returns the `rk shell-init <shell>` cobra command. It emits
// shell-eval-safe content for the given shell, suitable for the user (or the
// `shll` meta-CLI) to drop into their rc file as:
//
//	eval "$(rk shell-init zsh)"
//
// Supported shells: zsh, bash, fish, powershell. zsh/bash are the documented
// targets; fish/powershell are included because the underlying cobra delegation
// is a single Gen*Completion call with no shell-specific wrapping required.
//
// Argument validation:
//   - missing shell    → stderr "rk shell-init: missing shell. Supported: zsh, bash" exit 2
//   - unsupported shell → stderr "rk shell-init: unsupported shell '<shell>'. Supported: zsh, bash" exit 2
//
// Exit-code translation is done locally (mirroring runRiffWithExitCode) so
// main.execute() — shared with every other subcommand — doesn't need touching.
func newShellInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "shell-init <shell>",
		Short: "emit shell integration (completion) for zsh or bash",
		Long: `Emit a shell-eval-safe completion script for the given shell.

The output is intended to be sourced via:

  eval "$(rk shell-init zsh)"

rk has no shell function wrapper — the snippet only registers the cobra-generated
completion function for the rk command. compinit is lazy-loaded for zsh so the
snippet is safe to eval from a shell that hasn't yet run compinit.`,
		Args:          cobra.MaximumNArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			err := runShellInit(cmd, args)
			if err == nil {
				return nil
			}
			var ece *exitCodeError
			if errors.As(err, &ece) {
				fmt.Fprintln(cmd.ErrOrStderr(), ece.msg)
				os.Exit(ece.code)
			}
			return err
		},
	}
}

// runShellInit is the core of `rk shell-init`. Split out from the cobra RunE
// so it's testable without the os.Exit side-effect that *exitCodeError
// triggers in the wrapper.
func runShellInit(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return &exitCodeError{code: 2, msg: "rk shell-init: missing shell. Supported: zsh, bash"}
	}
	shell := args[0]
	switch shell {
	case "zsh", "bash", "fish", "powershell":
		// supported
	default:
		return &exitCodeError{code: 2, msg: fmt.Sprintf("rk shell-init: unsupported shell '%s'. Supported: zsh, bash", shell)}
	}

	out := cmd.OutOrStdout()
	if _, err := io.WriteString(out, shellInitBanner(shell)); err != nil {
		return fmt.Errorf("rk shell-init: write banner: %w", err)
	}

	// Delegate the actual completion-script generation to cobra. The root
	// command's existing `completion` subcommand uses these same generators
	// internally — we call them directly so the shell-init output is
	// self-contained (the user evals one blob; no second `rk completion <shell>`
	// call needed).
	switch shell {
	case "zsh":
		if _, err := io.WriteString(out, zshCompinitShim); err != nil {
			return fmt.Errorf("rk shell-init: write compinit shim: %w", err)
		}
		if err := rootCmd.GenZshCompletion(out); err != nil {
			return fmt.Errorf("rk shell-init: zsh completion: %w", err)
		}
	case "bash":
		// V2 emits a richer script (with descriptions support); the second arg
		// enables completion descriptions.
		if err := rootCmd.GenBashCompletionV2(out, true); err != nil {
			return fmt.Errorf("rk shell-init: bash completion: %w", err)
		}
	case "fish":
		if err := rootCmd.GenFishCompletion(out, true); err != nil {
			return fmt.Errorf("rk shell-init: fish completion: %w", err)
		}
	case "powershell":
		if err := rootCmd.GenPowerShellCompletionWithDesc(out); err != nil {
			return fmt.Errorf("rk shell-init: powershell completion: %w", err)
		}
	}
	return nil
}
