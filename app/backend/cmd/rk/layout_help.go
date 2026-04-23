package main

import "strings"

// renderLayoutMocks returns a multi-line string visualizing each of the 6
// accepted layout options with Unicode box-drawing characters. Used in the
// --layout flag's Usage text so `rk riff -h` renders inline layout
// references at the moment the user is looking for the flag.
//
// Design choice per spec §Design Decisions #7: inline mocks inside the flag
// description slot (Cobra/pflag render multi-line Usage verbatim). The
// canonical names and shortforms are listed on each block header so `rk
// riff -h | grep <name>` hits; the ASCII mock follows, offset by two
// leading spaces so it visually associates with the preceding header but
// doesn't collide with cobra's indentation of subsequent flags.
func renderLayoutMocks() string {
	// The mocks are sized for ~40-character wide terminals to leave room for
	// cobra's own leading indentation. Keep them tight.
	var b strings.Builder
	b.WriteString("layout name (canonical + shortform):\n")
	b.WriteString("  a, auto             — pane-count-based:\n")
	b.WriteString("                        1 pane = no layout\n")
	b.WriteString("                        2 panes = even-horizontal\n")
	b.WriteString("                        3+ panes = tiled\n")
	b.WriteString("  t, tiled            — grid\n")
	b.WriteString("                        ┌───┬───┐\n")
	b.WriteString("                        │ 0 │ 1 │\n")
	b.WriteString("                        ├───┼───┤\n")
	b.WriteString("                        │ 2 │ 3 │\n")
	b.WriteString("                        └───┴───┘\n")
	b.WriteString("  h, even-horizontal  — side-by-side\n")
	b.WriteString("                        ┌───┬───┬───┐\n")
	b.WriteString("                        │ 0 │ 1 │ 2 │\n")
	b.WriteString("                        └───┴───┴───┘\n")
	b.WriteString("  v, even-vertical    — stacked\n")
	b.WriteString("                        ┌───────────┐\n")
	b.WriteString("                        │     0     │\n")
	b.WriteString("                        ├───────────┤\n")
	b.WriteString("                        │     1     │\n")
	b.WriteString("                        ├───────────┤\n")
	b.WriteString("                        │     2     │\n")
	b.WriteString("                        └───────────┘\n")
	b.WriteString("  deck-h, main-horizontal — main on top, deck below\n")
	b.WriteString("                        ┌───────────┐\n")
	b.WriteString("                        │     0     │\n")
	b.WriteString("                        ├───┬───┬───┤\n")
	b.WriteString("                        │ 1 │ 2 │ 3 │\n")
	b.WriteString("                        └───┴───┴───┘\n")
	b.WriteString("  deck-v, main-vertical   — main on left, deck right\n")
	b.WriteString("                        ┌───────┬───┐\n")
	b.WriteString("                        │       │ 1 │\n")
	b.WriteString("                        │   0   ├───┤\n")
	b.WriteString("                        │       │ 2 │\n")
	b.WriteString("                        │       ├───┤\n")
	b.WriteString("                        │       │ 3 │\n")
	b.WriteString("                        └───────┴───┘\n")
	return b.String()
}

// layoutFlagUsage returns the full Usage text for the --layout flag,
// including the ASCII mocks. Cobra/pflag renders multi-line usage strings
// verbatim, indented under the flag name.
func layoutFlagUsage() string {
	return "Pane layout (default \"auto\"). " + renderLayoutMocks()
}
