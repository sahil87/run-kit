package tmux

import (
	"regexp"
	"strings"
)

// ansiRegex matches the union of ANSI escape sequences we strip:
//   - CSI: \x1b[ ... final-byte (e.g., SGR color codes)
//   - OSC: \x1b] ... BEL or ST (title setters, bracketed paste markers, etc.)
//   - Other single-char escapes in the C1 range \x1b[\x40-\x5f].
//
// Compiled once at package init to avoid per-call cost.
var ansiRegex = regexp.MustCompile(
	`\x1b\[[0-9;?]*[a-zA-Z]` + // CSI
		`|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)` + // OSC terminated by BEL or ST
		`|\x1b[\x40-\x5f].`, // other ESC sequences
)

// StripANSI removes ANSI escape sequences and non-printable control characters
// (except \n and \t) from the input. Color semantics are intentionally
// discarded — callers render plain monochrome text.
func StripANSI(s string) string {
	// First strip escape sequences.
	stripped := ansiRegex.ReplaceAllString(s, "")

	// Then drop remaining non-printable control characters, preserving
	// newlines and tabs so line/column structure survives.
	var b strings.Builder
	b.Grow(len(stripped))
	for _, r := range stripped {
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			continue
		}
		// Drop ASCII control characters (0x00-0x1f and 0x7f).
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// LastLine returns the last non-empty, non-whitespace-only line from the
// input. Trailing whitespace on the chosen line is trimmed. Empty input or
// input consisting only of whitespace returns "".
func LastLine(s string) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		trimmed := strings.TrimRight(lines[i], " \t\r")
		if strings.TrimSpace(trimmed) == "" {
			continue
		}
		return trimmed
	}
	return ""
}
