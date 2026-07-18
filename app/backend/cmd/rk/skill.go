package main

import (
	_ "embed"
	"fmt"
	"sort"
	"strings"

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

// skillDisplayTopic holds the `display` topic page, canonical at
// docs/site/skill/display.md and synced into skill/display.md alongside the
// core bundle. Same embed + drift-guard mechanism (TestSkillDisplayEmbedMatchesCanonical),
// same static-only rules, independently bounded at ≤150 lines. Topic pages carry
// the depth (panes, iframes, the Visual Display Recipe) that would blow the core
// bundle's budget; the core carries only a topic-index line pointing here.
//
//go:embed skill/display.md
var skillDisplayTopic []byte

// skillTopics maps a topic name to its embedded bundle. Bare `rk skill` prints
// the core bundle (skillBundle); `rk skill <topic>` prints the matching entry
// here; an unknown topic fails fast (usage error naming the valid topics). Add a
// row per topic page shipped.
var skillTopics = map[string][]byte{
	"display": skillDisplayTopic,
}

// skillTopicNames returns the sorted list of valid topic names, for the
// unknown-topic error message (deterministic ordering).
func skillTopicNames() []string {
	names := make([]string, 0, len(skillTopics))
	for name := range skillTopics {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// skillCmd implements the toolkit `<tool> skill` contract: bare `rk skill`
// prints the static core bundle — a usage briefing for an agent operating
// run-kit — as raw markdown to stdout, byte-identical to the canonical
// docs/site/skill.md, with empty stderr and exit 0. `rk skill <topic>` prints
// one topic page (docs/site/skill/<topic>.md) under the same contract. No
// rendering, no pager, no added framing (stdout is data). The bundles are
// static-only: they carry no session/pane/server-URL state — an agent derives
// its location directly (see the core bundle's "Where am I" block; the server
// URL comes from `rk url`), so the bytes never vary by where or when they run.
var skillCmd = &cobra.Command{
	Use:   "skill [topic]",
	Short: "Print run-kit's agent skill bundle (static usage briefing)",
	Long: "Print run-kit's agent skill bundle — a static, one-page usage briefing " +
		"for an agent operating run-kit (when to reach for it, its capabilities, how " +
		"it composes, and the gotchas). The bytes are identical on every invocation " +
		"and byte-identical to the repo's canonical docs/site/skill.md. Pass a topic " +
		"(e.g. `run-kit skill display`) to print that topic page instead. The bundle " +
		"is static-only — derive your location directly (get the server URL from " +
		"`run-kit url`).",
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		bundle := skillBundle
		if len(args) == 1 {
			topic := args[0]
			b, ok := skillTopics[topic]
			if !ok {
				return usageError(fmt.Errorf("unknown topic %q (valid: %s)",
					topic, strings.Join(skillTopicNames(), ", ")))
			}
			bundle = b
		}
		_, err := fmt.Fprint(cmd.OutOrStdout(), string(bundle))
		return err
	},
}
