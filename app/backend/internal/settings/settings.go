package settings

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Settings holds user preferences persisted at ~/.rk/settings.yaml.
type Settings struct {
	Theme        string
	ThemeDark    string
	ThemeLight   string
	ServerColors map[string]int // server name → ANSI palette index (0-15)
}

// Default returns the default settings.
func Default() Settings {
	return Settings{
		Theme:      "system",
		ThemeDark:  "default-dark",
		ThemeLight: "default-light",
	}
}

// settingsPath returns the absolute path to ~/.rk/settings.yaml.
func settingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".rk", "settings.yaml"), nil
}

// Load reads ~/.rk/settings.yaml and returns the parsed Settings.
// Returns Default() if the file is missing or unreadable.
func Load() Settings {
	p, err := settingsPath()
	if err != nil {
		return Default()
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return Default()
	}
	return parse(string(data))
}

// Save writes the settings to ~/.rk/settings.yaml, creating ~/.rk/ if absent.
func Save(s Settings) error {
	p, err := settingsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	content := serialize(s)
	return os.WriteFile(p, []byte(content), 0644)
}

// parse extracts settings from simple "key: value" lines.
// Supports one level of nesting: indented lines under "server_colors:" are
// parsed as "server_name: color_index" entries.
func parse(data string) Settings {
	s := Default()
	inServerColors := false
	for _, line := range strings.Split(data, "\n") {
		raw := line
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Detect indentation: if the raw line starts with whitespace, it's a
		// nested entry under the current section heading.
		indented := len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t')

		if indented && inServerColors {
			key, value, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			serverName := strings.TrimSpace(key)
			colorStr := strings.TrimSpace(value)
			if serverName != "" && colorStr != "" {
				n, err := strconv.Atoi(colorStr)
				if err == nil && n >= 0 && n <= 15 {
					if s.ServerColors == nil {
						s.ServerColors = make(map[string]int)
					}
					s.ServerColors[serverName] = n
				}
			}
			continue
		}

		// Non-indented line — end any active section.
		inServerColors = false

		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)

		switch key {
		case "theme":
			if value != "" {
				s.Theme = value
			}
		case "theme_dark":
			if value != "" {
				s.ThemeDark = value
			}
		case "theme_light":
			if value != "" {
				s.ThemeLight = value
			}
		case "server_colors":
			inServerColors = true
		}
	}
	return s
}

// serialize produces the "key: value" text representation.
func serialize(s Settings) string {
	out := "theme: " + s.Theme + "\n" +
		"theme_dark: " + s.ThemeDark + "\n" +
		"theme_light: " + s.ThemeLight + "\n"

	if len(s.ServerColors) > 0 {
		out += "server_colors:\n"
		// Sort keys for deterministic output.
		names := make([]string, 0, len(s.ServerColors))
		for name := range s.ServerColors {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			out += "  " + name + ": " + strconv.Itoa(s.ServerColors[name]) + "\n"
		}
	}
	return out
}

// GetServerColor returns the ANSI color index for the named server, or nil.
func GetServerColor(server string) *int {
	s := Load()
	if n, ok := s.ServerColors[server]; ok {
		return &n
	}
	return nil
}

// SetServerColor sets or clears the ANSI color for the named server.
func SetServerColor(server string, color *int) error {
	s := Load()
	if color == nil {
		delete(s.ServerColors, server)
	} else {
		if s.ServerColors == nil {
			s.ServerColors = make(map[string]int)
		}
		s.ServerColors[server] = *color
	}
	return Save(s)
}
