package main

import (
	"fmt"
	"sort"
	"strings"
)

// layoutAliases maps every accepted --layout value (6 canonical + 6 shortforms
// = 12 strings) to its canonical tmux name. `auto` stays as `auto` — its
// dispatch by pane count is handled separately by autoLayout.
//
// The `deck-*` shortforms exist because tmux's `main-horizontal` puts the
// main pane on top with a horizontal split line below, which is
// counterintuitive. The `deck-*` metaphor (main card on top or left, deck
// stacked below or right) is clearer; both names round-trip identically to
// the tmux-canonical value. See spec §Design Decisions #3.
var layoutAliases = map[string]string{
	"auto":            "auto",
	"a":               "auto",
	"tiled":           "tiled",
	"t":               "tiled",
	"even-horizontal": "even-horizontal",
	"h":               "even-horizontal",
	"even-vertical":   "even-vertical",
	"v":               "even-vertical",
	"main-horizontal": "main-horizontal",
	"deck-h":          "main-horizontal",
	"main-vertical":   "main-vertical",
	"deck-v":          "main-vertical",
}

// resolveLayout maps any of the 12 valid --layout inputs to its canonical
// tmux name. Unknown inputs produce an error listing all 12 names sorted
// alphabetically (deterministic output for help/error text).
func resolveLayout(raw string) (string, error) {
	if canonical, ok := layoutAliases[raw]; ok {
		return canonical, nil
	}
	keys := make([]string, 0, len(layoutAliases))
	for k := range layoutAliases {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return "", fmt.Errorf("run-kit riff: unknown --layout %q (valid values: %s)", raw, strings.Join(keys, ", "))
}

// autoLayout maps a pane count to the layout that `auto` resolves to:
//
//	count 0 or 1 → "" (no select-layout call; single-pane windows need no
//	                    layout, and an empty window is never spawned anyway).
//	count 2      → "even-horizontal" (side-by-side)
//	count ≥ 3    → "tiled" (grid)
//
// Pure helper — no side effects. Returning "" tells spawnRiff to skip the
// `tmux select-layout` call entirely, consistent with tmux's own behavior
// (single-pane windows cannot be meaningfully re-laid out).
func autoLayout(paneCount int) string {
	switch {
	case paneCount <= 1:
		return ""
	case paneCount == 2:
		return "even-horizontal"
	default:
		return "tiled"
	}
}
