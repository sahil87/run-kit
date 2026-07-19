package validate

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Characters that are never valid in tmux session/window names.
var forbiddenChars = regexp.MustCompile(`[;&|` + "`" + `$(){}[\]<>!#*?\n\r\t]`)

// MaxNameLength is the maximum allowed length for names.
const MaxNameLength = 128

// ValidateName validates a tmux session or window name.
// Returns empty string if valid, error message if invalid.
func ValidateName(name, label string) string {
	if strings.TrimSpace(name) == "" {
		return fmt.Sprintf("%s cannot be empty", label)
	}
	if len(name) > MaxNameLength {
		return fmt.Sprintf("%s exceeds maximum length of %d characters", label, MaxNameLength)
	}
	if forbiddenChars.MatchString(name) {
		return fmt.Sprintf("%s contains forbidden characters", label)
	}
	if strings.Contains(name, ":") || strings.Contains(name, ".") {
		return fmt.Sprintf("%s cannot contain colons or periods", label)
	}
	return ""
}

// ValidateColorValue validates a swatch color-value descriptor: a single ANSI
// index ("4") or a two-hue blend of two indices joined by '+' ("1+3"). Every
// index must be an integer in [0, 15]. Returns empty string if valid, an error
// message otherwise. This is the single shared color-value rule reused by the
// window, session, and server color handlers (constitution §I — input validated
// before it ever reaches `tmux set-option` or the settings file).
func ValidateColorValue(value string) string {
	_, msg := parseColorIndices(value)
	return msg
}

// parseColorIndices splits a color-value descriptor into its 1–2 ANSI indices,
// validating each. Returns the parsed indices and an empty message on success,
// or nil and an error message otherwise. Surrounding/internal whitespace around
// each index is tolerated so the rule matches the frontend parser
// (themes.ts parseColorValue), which trims each part; empty parts are rejected
// explicitly rather than relying on strconv error shapes.
func parseColorIndices(value string) ([]int, string) {
	parts := strings.Split(value, "+")
	if len(parts) < 1 || len(parts) > 2 {
		return nil, "Color must be a single index (0-15) or a blend (a+b)"
	}
	indices := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			return nil, "Color must be a single index (0-15) or a blend (a+b)"
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, "Color must be a single index (0-15) or a blend (a+b)"
		}
		if n < 0 || n > 15 {
			return nil, "Color indices must be between 0 and 15"
		}
		indices = append(indices, n)
	}
	return indices, ""
}

// NormalizeColorValue parses a stored color value (which may be a legacy bare
// integer or the string descriptor) and returns its canonical string form, or
// ("", false) when malformed. The canonical form re-serializes the parsed
// indices ("4" or "a+b"), so equivalent-but-noisy inputs ("01", " 1 + 3 ")
// collapse to a single representation. Used by tolerant-read storage paths
// (settings, run-kit.yaml) to accept int-or-string on read and always normalize
// to the canonical string.
func NormalizeColorValue(value string) (string, bool) {
	indices, msg := parseColorIndices(value)
	if msg != "" {
		return "", false
	}
	parts := make([]string, len(indices))
	for i, n := range indices {
		parts[i] = strconv.Itoa(n)
	}
	return strings.Join(parts, "+"), true
}

// MarkerValues is the closed set of accepted @rk_marker window-option values.
// The empty string means "unset" (no marker); the three named states drive the
// left-gutter marker's border style in the UI (dotted/solid 3px, double 6px).
// A closed set bounds the injection/abuse surface (constitution §I) exactly as
// the color-value rule does — the value flows into `tmux set-option`.
var MarkerValues = map[string]bool{"": true, "dotted": true, "solid": true, "double": true}

// ValidateMarkerValue validates an @rk_marker value: one of ""/dotted/solid/
// double. Returns an empty string if valid, an error message otherwise. An empty
// value is valid (it means unset). Mirrors ValidateColorValue as the single
// shared marker-value rule reused by the window-option handler.
func ValidateMarkerValue(value string) string {
	if MarkerValues[value] {
		return ""
	}
	return "Marker must be one of: dotted, solid, double (or empty to clear)"
}

// windowIDPattern matches a tmux window ID: an '@' followed by one or more digits
// (e.g. "@5"). Window IDs originate from tmux's #{window_id} and are never
// user-typed, but they flow into subprocess args, so they are validated against
// this strict shape (constitution §I — Security First). This is intentionally
// stricter than ValidateName, which permits '@' but does not constrain the value
// to the @N form.
var windowIDPattern = regexp.MustCompile(`^@[0-9]+$`)

// ValidateWindowID validates a tmux window ID (the canonical window identity).
// Returns empty string if valid, error message if invalid.
func ValidateWindowID(id, label string) string {
	if id == "" {
		return fmt.Sprintf("%s cannot be empty", label)
	}
	if !windowIDPattern.MatchString(id) {
		return fmt.Sprintf("%s must be a tmux window ID of the form @N", label)
	}
	return ""
}

// serverNamePattern matches valid server names: alphanumeric, hyphens, underscores.
var serverNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// MaxServerNameLength is the maximum allowed length for server names.
const MaxServerNameLength = 64

// ValidateServerName validates a tmux server name against a strict pattern.
// Returns empty string if valid, error message if invalid.
func ValidateServerName(name string) string {
	if name == "" {
		return "Server name cannot be empty"
	}
	if len(name) > MaxServerNameLength {
		return fmt.Sprintf("Server name exceeds maximum length of %d characters", MaxServerNameLength)
	}
	if !serverNamePattern.MatchString(name) {
		return "Server name must contain only alphanumeric characters, hyphens, and underscores"
	}
	return ""
}

// tierNamePattern matches a fab agent tier name: alphanumeric plus hyphen and
// underscore. A tier flows into a subprocess as a bare positional
// (`fab agent <tier> --print`), so it is validated against this strict identifier
// shape before use (constitution §I — Security First). Mirrors serverNamePattern.
// The leading char is constrained to alphanumeric or underscore so a tier can
// never be interpreted as a flag by `fab agent` — a leading `-` would make the
// positional a bare `-doing`-style option.
var tierNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`)

// MaxTierNameLength bounds a tier name. Tiers are short config keys
// (default/doing/fast/…); 64 is generous and matches the server-name bound.
const MaxTierNameLength = 64

// ValidateTier validates a fab agent tier name. Returns empty string if valid,
// an error message otherwise. An empty tier is the caller's "default tier"
// sentinel and is validated separately (callers skip this when the value is
// empty); this rule applies to a NON-empty tier that will reach argv. A leading
// `-` is rejected (see tierNamePattern) so the tier can't become a bare flag.
func ValidateTier(name string) string {
	if len(name) > MaxTierNameLength {
		return fmt.Sprintf("Tier name exceeds maximum length of %d characters", MaxTierNameLength)
	}
	if !tierNamePattern.MatchString(name) {
		return "Tier name must contain only alphanumeric characters, hyphens, and underscores, and must not start with a hyphen"
	}
	return ""
}

// ValidateWorktreeName validates a riff worktree name. It layers riff-seam-only
// hardening over the shared tmux-safe ValidateName rule (which the session/window
// callers also use — that shared rule is deliberately left unchanged). The extra
// rejections address how a worktree name is consumed downstream of riff: it
// becomes a `wt create --worktree-name` argv element (a leading `-` could look
// like a flag), a worktree directory basename (a `/` would split the path), and
// a `riff-<name>` tmux window name (a leading space is a surprising, error-prone
// name). Returns empty string if valid, an error message otherwise.
func ValidateWorktreeName(name string) string {
	if msg := ValidateName(name, "Worktree name"); msg != "" {
		return msg
	}
	if strings.HasPrefix(name, "-") {
		return "Worktree name must not start with a hyphen"
	}
	if strings.Contains(name, "/") {
		return "Worktree name must not contain a slash"
	}
	if strings.Contains(name, " ") {
		return "Worktree name must not contain spaces"
	}
	return ""
}

// ExpandTilde expands a leading ~ to $HOME and resolves the path.
// Returns the expanded path and an empty error string on success,
// or an empty path and error message on failure.
func ExpandTilde(raw string) (string, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "cannot determine home directory"
	}

	var expanded string

	if raw == "~" || strings.HasPrefix(raw, "~/") {
		expanded = filepath.Join(home, raw[1:])
		if raw == "~" {
			expanded = home
		}
	} else if strings.HasPrefix(raw, "~") {
		// Reject ~username syntax
		return "", "~user expansion is not supported; use ~/path"
	} else if filepath.IsAbs(raw) {
		expanded = filepath.Clean(raw)
	} else {
		// Bare relative path — resolve relative to $HOME
		expanded = filepath.Join(home, raw)
	}

	expanded = filepath.Clean(expanded)

	// Reject paths that escape $HOME
	if expanded != home && !strings.HasPrefix(expanded, home+"/") {
		return "", "Path must be under home directory"
	}

	return expanded, ""
}

// ValidatePath validates a file path.
// Returns empty string if valid, error message if invalid.
func ValidatePath(path, label string) string {
	if strings.TrimSpace(path) == "" {
		return fmt.Sprintf("%s cannot be empty", label)
	}
	if len(path) > 1024 {
		return fmt.Sprintf("%s exceeds maximum length", label)
	}
	if strings.ContainsAny(path, "\x00\n\r") {
		return fmt.Sprintf("%s contains invalid characters", label)
	}
	return ""
}

// SanitizeFilename sanitizes a user-provided filename for safe disk storage.
func SanitizeFilename(name string) string {
	// Strip null bytes
	sanitized := strings.ReplaceAll(name, "\x00", "")
	// Replace path separators with dash
	sanitized = strings.NewReplacer("/", "-", "\\", "-").Replace(sanitized)
	// Strip leading dots
	sanitized = strings.TrimLeft(sanitized, ".")
	// Strip sequences of 2+ dots (traversal remnants)
	sanitized = regexp.MustCompile(`\.{2,}`).ReplaceAllString(sanitized, "")
	// Collapse multiple dashes
	sanitized = regexp.MustCompile(`-{2,}`).ReplaceAllString(sanitized, "-")
	// Strip leading/trailing dashes
	sanitized = strings.Trim(sanitized, "-")
	sanitized = strings.TrimSpace(sanitized)

	if sanitized == "" {
		return "upload"
	}
	return sanitized
}
