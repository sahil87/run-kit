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
	// SSHHost is the verbatim SSH destination remote clients use to reach this
	// host — an alias from the client's ~/.ssh/config or a `user@host` form.
	// Empty means "unset": /api/health then falls back to the RK_SSH_HOST env
	// var. Scalar, like InstanceColor.
	SSHHost string
	// InstanceName is the display-name override for this run-kit instance.
	// Empty means "unset": display surfaces derive the name from os.Hostname()
	// (via /api/health `hostname`). Scalar, like InstanceColor.
	InstanceName string
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

// nestedSection describes one nested settings.yaml section for parse/serialize.
// Two shapes exist, built by mapSection (string map: `  name: "value"` entries)
// and listSection (string list: `  - "value"` entries). Adding a section is a
// registry entry plus its Settings field — not new scanner branches.
type nestedSection struct {
	// key is the section heading ("server_colors").
	key string
	// parseEntry consumes one indented, non-empty, non-comment line (trimmed)
	// while this section is active, silently skipping malformed entries.
	parseEntry func(s *Settings, trimmed string)
	// serialize emits the whole section (heading + entries), or "" when the
	// section is empty — sections are omitted when empty so a settings file
	// without them serializes byte-identically to one that never had them.
	serialize func(s *Settings) string
}

// mapSection builds a nested string-map section. Values are quote-stripped on
// read (the serializer quotes; legacy bare values are unquoted) and passed
// through normalize — a tolerant read that canonicalizes and drops anything
// malformed. Serialization sorts keys for deterministic output and always
// quotes values so they round-trip unambiguously.
func mapSection(key string, target func(s *Settings) *map[string]string, normalize func(string) (string, bool)) nestedSection {
	return nestedSection{
		key: key,
		parseEntry: func(s *Settings, trimmed string) {
			k, v, ok := strings.Cut(trimmed, ":")
			if !ok {
				return
			}
			name := strings.TrimSpace(k)
			value := strings.Trim(strings.TrimSpace(v), "\"")
			if name == "" {
				return
			}
			normalized, ok := normalize(value)
			if !ok {
				return
			}
			m := target(s)
			if *m == nil {
				*m = make(map[string]string)
			}
			(*m)[name] = normalized
		},
		serialize: func(s *Settings) string {
			m := *target(s)
			if len(m) == 0 {
				return ""
			}
			out := key + ":\n"
			names := make([]string, 0, len(m))
			for name := range m {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				out += "  " + name + ": \"" + m[name] + "\"\n"
			}
			return out
		},
	}
}

// listSection builds a nested string-list section (a YAML sequence). Entries
// are quote-stripped on read; serialization quotes each name so it
// round-trips unambiguously.
func listSection(key string, target func(s *Settings) *[]string) nestedSection {
	return nestedSection{
		key: key,
		parseEntry: func(s *Settings, trimmed string) {
			// A YAML sequence item: "  - name". Strip the leading "- " marker.
			if !strings.HasPrefix(trimmed, "-") {
				return
			}
			name := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			name = strings.Trim(name, "\"")
			if name != "" {
				l := target(s)
				*l = append(*l, name)
			}
		},
		serialize: func(s *Settings) string {
			l := *target(s)
			if len(l) == 0 {
				return ""
			}
			out := key + ":\n"
			for _, name := range l {
				out += "  - \"" + name + "\"\n"
			}
			return out
		},
	}
}

// nestedSections is the registry of nested settings.yaml sections, in
// serialization order (all nested sections follow the scalar keys).
var nestedSections = []nestedSection{
	// Tolerant color read: accept a legacy bare integer OR the string
	// descriptor ("1+3"); normalize and drop anything malformed.
	mapSection("server_colors", func(s *Settings) *map[string]string { return &s.ServerColors }, validate.NormalizeColorValue),
	listSection("board_order", func(s *Settings) *[]string { return &s.BoardOrder }),
}

// parse extracts settings from simple "key: value" lines.
// Supports one level of nesting: indented lines under a registered section
// heading (see nestedSections) are parsed as that section's entries.
func parse(data string) Settings {
	s := Default()
	var active *nestedSection
	for _, line := range strings.Split(data, "\n") {
		raw := line
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Detect indentation: if the raw line starts with whitespace, it's a
		// nested entry under the current section heading.
		indented := len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t')

		if indented && active != nil {
			active.parseEntry(&s, trimmed)
			continue
		}

		// Non-indented line — end any active section.
		active = nil

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
		case "ssh_host":
			// Tolerant read: quote-stripped and trimmed (serialize always
			// quotes so the value round-trips unambiguously).
			s.SSHHost = strings.TrimSpace(strings.Trim(value, "\""))
		case "instance_name":
			s.InstanceName = strings.TrimSpace(strings.Trim(value, "\""))
		default:
			for i := range nestedSections {
				if key == nestedSections[i].key {
					active = &nestedSections[i]
					break
				}
			}
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

	// SSH host + instance name — each emitted only when non-empty so a settings
	// file without them serializes byte-identically to the pre-change output.
	// Always quoted so any value round-trips unambiguously.
	if s.SSHHost != "" {
		out += "ssh_host: \"" + s.SSHHost + "\"\n"
	}
	if s.InstanceName != "" {
		out += "instance_name: \"" + s.InstanceName + "\"\n"
	}

	// Nested sections, in registry order (each omitted when empty).
	for i := range nestedSections {
		out += nestedSections[i].serialize(&s)
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

// GetSSHHost returns the stored SSH destination, or nil when unset. Mirrors
// GetInstanceColor.
func GetSSHHost() *string {
	s := Load()
	if s.SSHHost == "" {
		return nil
	}
	return &s.SSHHost
}

// SetSSHHost sets or clears the stored SSH destination (nil clears). Mirrors
// SetInstanceColor (load-then-save).
func SetSSHHost(host *string) error {
	s := Load()
	if host == nil {
		s.SSHHost = ""
	} else {
		s.SSHHost = *host
	}
	return Save(s)
}

// GetInstanceName returns the stored instance display-name override, or nil
// when unset. Mirrors GetInstanceColor.
func GetInstanceName() *string {
	s := Load()
	if s.InstanceName == "" {
		return nil
	}
	return &s.InstanceName
}

// SetInstanceName sets or clears the stored instance display-name override
// (nil clears). Mirrors SetInstanceColor (load-then-save).
func SetInstanceName(name *string) error {
	s := Load()
	if name == nil {
		s.InstanceName = ""
	} else {
		s.InstanceName = *name
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
