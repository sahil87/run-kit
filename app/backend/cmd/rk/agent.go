package main

import "github.com/spf13/cobra"

// rk agent — the agent-instrumentation command family (docs/specs/cli-layering.md):
// the pair of verbs behind the @rk_agent_state pane option. `setup` installs the
// agent-harness hooks that report lifecycle state; `hook` is the stable interface
// the installed hook lines invoke at fire time. Unlike mux, the family carries no
// shared persistent flag — the members' flag sets are disjoint, so the parent is
// a pure grouping node (bare `rk agent` prints the family help).
//
// Both members also exist at the root as hidden aliases (agent_setup.go /
// agent_hook.go): `agent-setup` is a deprecated human-typed alias pointing here;
// `agent-hook` is a PERMANENT machine-invoked alias — installed settings.json
// hook lines carry the literal `agent-hook` invocation frozen at install time, so
// it must keep resolving (silently) forever (cli-layering.md delegation rule 3).

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Agent instrumentation (state hooks setup and reporting)",
	Long: "Agent instrumentation: `setup` installs the agent-harness hooks that " +
		"write the @rk_agent_state tmux pane option (so run-kit can show any " +
		"agent's active/waiting/idle state); `hook` is the stable interface those " +
		"installed hooks invoke at fire time.",
}

func init() {
	agentCmd.AddCommand(agentSetupFamilyCmd)
	agentCmd.AddCommand(agentHookFamilyCmd)
}
