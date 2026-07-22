package settings

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"rk/internal/validate"
)

// Settings holds user preferences persisted at ~/.rk/settings.yaml.
type Settings struct {
	Theme      string
	ThemeDark  string
	ThemeLight string
	// InstanceColor is the per-instance accent color ("host color") — a color
	// value descriptor ("4" for a single ANSI index, "1+3" for a two-hue
	// blend). Scalar (one color per instance), unlike the ServerColors map.
	// Empty means "no explicit color set" — the frontend falls back to a
	// hostname-hash default. Stored as a string so a blend can round-trip;
	// reads tolerate a legacy bare integer (normalized on load).
	InstanceColor string
	// server name → color value descriptor ("4" for a single ANSI index,
	// "1+3" for a two-hue blend). Stored as a string so a blend can round-trip;
	// reads tolerate a legacy bare integer (normalized on load).
	ServerColors map[string]string
	// BoardOrder is the user-defined display order of board names; rank = slice
	// index. Boards absent from the list sort after ranked boards, alphabetically
	// (the sort itself lives at the API layer — this package only persists the
	// list). nil when no order has been set (legacy files / never reordered).
	BoardOrder []string
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
	inBoardOrder := false
	for _, line := range strings.Split(data, "\n") {
		raw := line
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Detect indentation: if the raw line starts with whitespace, it's a
		// nested entry under the current section heading.
		indented := len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t')

		if indented && inBoardOrder {
			// A YAML sequence item: "  - name". Strip the leading "- " marker.
			if !strings.HasPrefix(trimmed, "-") {
				continue
			}
			name := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			// Strip optional surrounding double quotes (the serializer quotes
			// values so a name is always round-trippable).
			name = strings.Trim(name, "\"")
			if name != "" {
				s.BoardOrder = append(s.BoardOrder, name)
			}
			continue
		}

		if indented && inServerColors {
			key, value, ok := strings.Cut(trimmed, ":")
			if !ok {
				continue
			}
			serverName := strings.TrimSpace(key)
			// Strip optional surrounding double quotes (the serializer quotes
			// values; legacy bare-integer values are unquoted).
			colorStr := strings.Trim(strings.TrimSpace(value), "\"")
			// Tolerant read: accept a legacy bare integer OR the string
			// descriptor ("1+3"); normalize and drop anything malformed.
			if serverName != "" {
				if normalized, ok := validate.NormalizeColorValue(colorStr); ok {
					if s.ServerColors == nil {
						s.ServerColors = make(map[string]string)
					}
					s.ServerColors[serverName] = normalized
				}
			}
			continue
		}

		// Non-indented line — end any active section.
		inServerColors = false
		inBoardOrder = false

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
		case "instance_color":
			// Tolerant read: accept a legacy bare integer OR the quoted string
			// descriptor ("1+3"); normalize and drop anything malformed.
			colorStr := strings.Trim(value, "\"")
			if normalized, ok := validate.NormalizeColorValue(colorStr); ok {
				s.InstanceColor = normalized
			}
		case "server_colors":
			inServerColors = true
		case "board_order":
			inBoardOrder = true
		}
	}
	return s
}

// serialize produces the "key: value" text representation.
func serialize(s Settings) string {
	out := "theme: " + s.Theme + "\n" +
		"theme_dark: " + s.ThemeDark + "\n" +
		"theme_light: " + s.ThemeLight + "\n"

	// Instance color — emitted only when non-empty so a settings file without
	// an instance color serializes byte-identically to the pre-change output.
	// Always quoted so a blend ("1+3") round-trips unambiguously.
	if s.InstanceColor != "" {
		out += "instance_color: \"" + s.InstanceColor + "\"\n"
	}

	if len(s.ServerColors) > 0 {
		out += "server_colors:\n"
		// Sort keys for deterministic output.
		names := make([]string, 0, len(s.ServerColors))
		for name := range s.ServerColors {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			// Always written as a string descriptor (quoted so a bare "1+3"
			// or numeric value parses back unambiguously and round-trips).
			out += "  " + name + ": \"" + s.ServerColors[name] + "\"\n"
		}
	}

	// Board order — emitted only when non-empty so a theme-only settings file
	// serializes byte-identically to the pre-change output. A YAML sequence,
	// each name quoted so it round-trips unambiguously.
	if len(s.BoardOrder) > 0 {
		out += "board_order:\n"
		for _, name := range s.BoardOrder {
			out += "  - \"" + name + "\"\n"
		}
	}
	return out
}

// GetServerColor returns the color-value descriptor for the named server, or nil.
func GetServerColor(server string) *string {
	s := Load()
	if v, ok := s.ServerColors[server]; ok {
		return &v
	}
	return nil
}

// SetServerColor sets or clears the color-value descriptor for the named server.
func SetServerColor(server string, color *string) error {
	s := Load()
	if color == nil {
		delete(s.ServerColors, server)
	} else {
		if s.ServerColors == nil {
			s.ServerColors = make(map[string]string)
		}
		s.ServerColors[server] = *color
	}
	return Save(s)
}

// GetInstanceColor returns the instance accent color-value descriptor, or nil
// when no explicit color is set. Mirrors GetServerColor.
func GetInstanceColor() *string {
	s := Load()
	if s.InstanceColor == "" {
		return nil
	}
	return &s.InstanceColor
}

// SetInstanceColor sets or clears the instance accent color-value descriptor
// (nil clears). Mirrors SetServerColor (load-then-save).
func SetInstanceColor(color *string) error {
	s := Load()
	if color == nil {
		s.InstanceColor = ""
	} else {
		s.InstanceColor = *color
	}
	return Save(s)
}

// GetBoardOrder returns the user-defined board display order (rank = index), or
// nil when no order has been set. Mirrors GetServerColor.
func GetBoardOrder() []string {
	return Load().BoardOrder
}

// SetBoardOrder persists the full ordered board-name list, replacing any prior
// order. A nil/empty slice clears the stored order. Mirrors SetServerColor —
// every reorder writes the whole list, so staleness self-heals.
func SetBoardOrder(names []string) error {
	s := Load()
	if len(names) == 0 {
		s.BoardOrder = nil
	} else {
		s.BoardOrder = names
	}
	return Save(s)
}
