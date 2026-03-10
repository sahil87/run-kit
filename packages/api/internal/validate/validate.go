package validate

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
