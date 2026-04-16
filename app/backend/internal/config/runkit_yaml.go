package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const runkitYAMLFile = "run-kit.yaml"

// FindGitRoot walks up from dir until it finds a directory containing .git
// (file or directory), returning that directory. Returns "" if not found.
func FindGitRoot(dir string) string {
	for {
		candidate := filepath.Join(dir, ".git")
		if _, err := os.Stat(candidate); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// ReadSessionColor reads the session_color value from run-kit.yaml at the
// given project root. Returns nil on missing file, missing key, or parse error.
// Best-effort: never returns an error.
func ReadSessionColor(projectRoot string) *int {
	if projectRoot == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(projectRoot, runkitYAMLFile))
	if err != nil {
		return nil
	}
	return parseSessionColor(string(data))
}

// parseSessionColor extracts session_color from a simple YAML string.
// Only handles "session_color: N" lines — no full YAML parser needed.
func parseSessionColor(content string) *int {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := splitYAMLLine(line)
		if !ok {
			continue
		}
		if key == "session_color" {
			n, err := strconv.Atoi(value)
			if err != nil {
				return nil
			}
			return &n
		}
	}
	return nil
}

// WriteSessionColor writes or clears the session_color in run-kit.yaml.
// When color is non-nil, sets session_color: N.
// When nil, removes the session_color key (deletes file if it becomes empty).
func WriteSessionColor(projectRoot string, color *int) error {
	path := filepath.Join(projectRoot, runkitYAMLFile)

	if color == nil {
		return removeSessionColorKey(path)
	}

	// Read existing content to preserve other keys.
	existing, _ := os.ReadFile(path)
	content := setSessionColorInContent(string(existing), *color)
	return os.WriteFile(path, []byte(content), 0o644)
}

// setSessionColorInContent replaces or appends session_color in YAML content.
func setSessionColorInContent(content string, color int) string {
	lines := strings.Split(content, "\n")
	found := false
	newLine := "session_color: " + strconv.Itoa(color)

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, _, ok := splitYAMLLine(trimmed)
		if ok && key == "session_color" {
			lines[i] = newLine
			found = true
			break
		}
	}

	if !found {
		// Append to content, ensuring a newline before if content is non-empty.
		trimmed := strings.TrimRight(content, "\n\r\t ")
		if trimmed == "" {
			return newLine + "\n"
		}
		return trimmed + "\n" + newLine + "\n"
	}

	return strings.Join(lines, "\n")
}

// removeSessionColorKey removes the session_color line from the file.
// Deletes the file if it becomes empty.
func removeSessionColorKey(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing to clear
		}
		return err
	}

	lines := strings.Split(string(data), "\n")
	var kept []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			kept = append(kept, line)
			continue
		}
		key, _, ok := splitYAMLLine(trimmed)
		if ok && key == "session_color" {
			continue // remove this line
		}
		kept = append(kept, line)
	}

	// Check if only blank/comment lines remain.
	hasContent := false
	for _, line := range kept {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
			hasContent = true
			break
		}
	}

	if !hasContent {
		return os.Remove(path)
	}

	return os.WriteFile(path, []byte(strings.Join(kept, "\n")), 0o644)
}

// splitYAMLLine splits a simple "key: value" YAML line.
func splitYAMLLine(line string) (key, value string, ok bool) {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return "", "", false
	}
	key = strings.TrimSpace(line[:idx])
	value = strings.TrimSpace(line[idx+1:])
	return key, value, true
}
