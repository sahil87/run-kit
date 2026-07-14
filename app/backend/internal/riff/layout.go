package riff

import (
	"fmt"
	"sort"
	"strings"
)

// layoutAliases maps every accepted layout value (6 canonical + 6 shortforms)
// to its canonical tmux name. `auto` stays `auto` — its dispatch by pane count
// is handled by autoLayout.
//
// The `deck-*` shortforms exist because tmux's `main-horizontal` puts the main
// pane on top with a horizontal split line below, which is counterintuitive.
// Both names round-trip to the same tmux-canonical value.
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

// ResolveLayout maps any of the 12 valid layout inputs to its canonical tmux
// name. Unknown inputs produce an error listing all 12 names sorted
// alphabetically (deterministic output for help/error text). Exported so the
// CLI can validate the --layout flag before dispatching to the engine.
func ResolveLayout(raw string) (string, error) {
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
//	count 0 or 1 → "" (no select-layout call; single-pane windows need none)
//	count 2      → "even-horizontal" (side-by-side)
//	count ≥ 3    → "tiled" (grid)
//
// Pure — no side effects.
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
