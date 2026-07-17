package main

import (
	_ "embed"
	"fmt"

	"github.com/spf13/cobra"
)

//go:generate ../../../../scripts/sync-skill.sh

// skillBundle holds run-kit's canonical agent skill bundle, copied into this
// package dir from docs/site/skill.md by scripts/sync-skill.sh and embedded at
// build time. The Go module root is app/backend/ and docs/site/ sits above it,
// so //go:embed cannot reach the canonical file directly — the sync step copies
// it here first. The committed copy is what a clean `go build ./...` compiles;
// TestSkillEmbedMatchesCanonical keeps it byte-honest against docs/site/skill.md
// on every `go test`. This mirrors shll's `standards` embed mechanism, which the
// toolkit skill standard names as the one to reuse.
//
//go:embed skill/skill.md
var skillBundle []byte

// skillCmd implements the toolkit `<tool> skill` contract: it prints the static
// agent skill bundle — a usage briefing for an agent operating run-kit — as raw
// markdown to stdout, byte-identical to the canonical docs/site/skill.md, with
// empty stderr and exit 0. No rendering, no pager, no added framing (stdout is
// data). The bundle is static-only: it carries no session/pane/server-URL state
// (that stays exclusive to `rk context`), so its bytes never vary by where or
// when it runs.
var skillCmd = &cobra.Command{
	Use:   "skill",
	Short: "Print run-kit's agent skill bundle (static usage briefing)",
	Long: "Print run-kit's agent skill bundle — a static, one-page usage briefing " +
		"for an agent operating run-kit (when to reach for it, its capabilities, how " +
		"it composes, and the gotchas). The bytes are identical on every invocation " +
		"and byte-identical to the repo's canonical docs/site/skill.md. For the live " +
		"environment (session, pane, server URL) use `run-kit context` instead.",
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, _ []string) error {
		_, err := fmt.Fprint(cmd.OutOrStdout(), string(skillBundle))
		return err
	},
}
