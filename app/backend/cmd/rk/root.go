package main

import (
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// version is set at build time via ldflags: -X main.version=...
var version = "dev"

// displayVersion prefixes a numeric version with "v" to match the shll toolkit
// standard (e.g. "run-kit version v1.5.3"). The "dev" sentinel used for
// non-ldflags builds is left untouched so we don't end up with "vdev".
func displayVersion() string {
	if version == "dev" || strings.HasPrefix(version, "v") {
		return version
	}
	return "v" + version
}

var rootCmd = &cobra.Command{
	Use:     "run-kit",
	Short:   "run-kit — tmux session manager with web UI",
	Version: displayVersion(),
	// No-args invocation defaults to serve (backwards compat).
	RunE: func(cmd *cobra.Command, args []string) error {
		return serveCmd.RunE(cmd, args)
	},
	// Args is left nil so cobra's native legacyArgs/Find path prints the
	// unknown-command error EXACTLY as before — the "unknown command %q for %q"
	// line, the Levenshtein "Did you mean this?" suggestions, and the trailing
	// "Run 'run-kit --help' for usage." hint. Unknown-command exit-code
	// classification happens centrally at the execute() seam (see exitCode's
	// unknownCommandPrefix check), which keeps user-facing stderr byte-identical
	// and fails safe (2→1) if cobra ever changes the message wording. A bare
	// `run-kit` (no positional args) still descends into the serve default.
	SilenceUsage: true,
}

func init() {
	// quiet is a single persistent flag on the root so every subcommand accepts
	// it uniformly and future commands inherit it with zero registration work
	// (Toolkit Principle 9). It is a no-op on commands not yet routed through the
	// output sink (see output.go) — deliberate incremental adoption. Bound to the
	// package-level `quiet` var; the sink reads that var via the cobra flag on the
	// invoked command so quiet-gating stays unit-testable.
	rootCmd.PersistentFlags().BoolVar(&quiet, "quiet", false,
		"Suppress progress/decoration/chatter (data and errors still print)")

	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(updateCmd)
	rootCmd.AddCommand(doctorCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(daemonCmd)
	rootCmd.AddCommand(desktopCmd)
	rootCmd.AddCommand(urlCmd)
	rootCmd.AddCommand(skillCmd)
	rootCmd.AddCommand(notifyCmd)
	rootCmd.AddCommand(agentCmd)
	// Hidden root aliases for the agent family (see agent.go): agent-setup is
	// deprecated (warns on stderr, still runs); agent-hook is PERMANENT — the
	// machine-invoked contract installed hook lines depend on.
	rootCmd.AddCommand(agentSetupAliasCmd)
	rootCmd.AddCommand(agentHookAliasCmd)
	rootCmd.AddCommand(tmuxGuardCmd)
	rootCmd.AddCommand(riffCmd)
	rootCmd.AddCommand(remoteCmd)
	rootCmd.AddCommand(roleCmd)
	rootCmd.AddCommand(codeServerCmd)
	rootCmd.AddCommand(presentCmd)
	rootCmd.AddCommand(muxCmd)
	// Hidden root aliases for the mux family (see mux.go): all three are
	// deprecation-grade — they warn on stderr and still run, pointing at the
	// `rk mux` form, and are removable in a future release.
	rootCmd.AddCommand(reapAliasCmd)
	rootCmd.AddCommand(snapshotAliasCmd)
	rootCmd.AddCommand(initConfAliasCmd)
	rootCmd.AddCommand(newShellInitCmd())
	rootCmd.AddCommand(helpDumpCmd)

	// Flag-parse errors on the root and any inheriting subcommand are usage-class
	// (exit 2). Cobra's FlagErrorFunc is inherited by children that do NOT set
	// their own, so this one func covers every subcommand except the two agent-hook
	// instances (the `agent hook` family member and the permanent `agent-hook`
	// root alias), which each set their own SetFlagErrorFunc(→ nil) to preserve
	// the NEVER-FAIL contract (Claude Code treats a hook exit 2 as *blocking*).
	// Own-wins inheritance keeps both hook instances shadowing this — do not
	// remove their funcs.
	rootCmd.SetFlagErrorFunc(func(_ *cobra.Command, err error) error {
		return usageError(err)
	})

	// Arg-count validator errors (NoArgs / ExactArgs / MaximumNArgs on the
	// subcommands) are usage-class (exit 2). Wrap each subcommand's non-nil Args
	// validator centrally so a violation carries the usage sentinel. This loop
	// covers DIRECT children only — family members (mux send/await and
	// snapshot's children, agent setup) wrap their own Args at declaration. Commands with ArbitraryArgs (the
	// agent-hook alias, riff) never produce a validator error, so the wrap is
	// inert for them. This is deliberately a one-place root-cause fix rather than
	// editing each declaration site.
	for _, c := range rootCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

// usageArgs wraps a cobra positional-args validator so a non-nil validation error
// is re-tagged as usage-class (exit 2) while preserving the original message. A
// nil result (valid args) passes through unchanged.
func usageArgs(v cobra.PositionalArgs) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if err := v(cmd, args); err != nil {
			return usageError(err)
		}
		return nil
	}
}

func execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(exitCode(err))
	}
}
