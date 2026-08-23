// Package settings owns the run-kit preference store at
// ~/.config/run-kit/config.yaml — the single registry-driven settings
// surface.
//
// Override order: code default < config.yaml < env < CLI flag. Env forms
// exist ONLY for deployment-bootstrap keys (RK_PORT, RK_HOST,
// RK_CODE_SERVER_PORT); the only other env reads are the undocumented
// per-process escapes RK_TMUX_CONF and LOG_LEVEL, which win over their
// config.yaml keys but are never user-facing.
//
// The config root is fixed at $HOME/.config/run-kit — never
// $XDG_CONFIG_HOME, never os.UserConfigDir: rk runs as daemon + CLI +
// agents-in-panes, and an env-dependent path would silently fork which file
// each context reads. Only $HOME moves the root.
package settings

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"rk/internal/validate"
)

// Settings holds user preferences persisted at ~/.config/run-kit/config.yaml
// (a legacy ~/.rk/settings.yaml is fallback-read and migrated on first save).
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
	// Empty means "unset": /api/health then omits sshHost (this key is the
	// only ssh-host surface — no env form exists). Scalar, like InstanceColor.
	SSHHost string
	// InstanceName is the display-name override for this run-kit instance.
	// Empty means "unset": display surfaces derive the name from os.Hostname()
	// (via /api/health `hostname`). Scalar, like InstanceColor.
	InstanceName string
	// server name → color value descriptor ("4" for a single ANSI index,
	// "1+3" for a two-hue blend). Stored as a string so a blend can round-trip;
	// reads tolerate a legacy bare integer (normalized on load).
	ServerColors map[string]string
	// ServerFlairs is server name → flair token — the flair decoration on the
	// server's sidebar surfaces (group header, SERVER tile). A closed set
	// (validate.FlairValues, the single universal vocabulary); reads drop
	// anything outside it.
	ServerFlairs map[string]string
	// BoardOrder is the user-defined display order of board names; rank = slice
	// index. Boards absent from the list sort after ranked boards, alphabetically
	// (the sort itself lives at the API layer — this package only persists the
	// list). nil when no order has been set (legacy files / never reordered).
	BoardOrder []string
	// AutoName arms the auto-name-on-idle trigger: on a window's busy→idle
	// transition the server's operator window is handed a fix-tab-name request.
	// Strictly opt-in (default false — the trigger injects prompts into the
	// operator on its own); read at hub construction, so a change applies on
	// the next daemon restart.
	AutoName bool
	// TmuxConf is the path to the tmux.conf rk passes to tmux. Empty means
	// "unset": tmux resolution falls back to its built-in default. The user
	// owns the file — rk performs no ensure/refresh on it. Read at tmux
	// command construction, so a change applies on the next daemon restart.
	TmuxConf string
	// LogLevel is the daemon log verbosity: "info" or "debug". Read at serve
	// startup (the LOG_LEVEL env escape wins when set), so a change applies on
	// the next daemon restart.
	LogLevel string
}

// Default returns the default settings.
func Default() Settings {
	return Settings{
		Theme:      "system",
		ThemeDark:  "default-dark",
		ThemeLight: "default-light",
		LogLevel:   "info",
	}
}

// Dir returns the fixed config root $HOME/.config/run-kit/. The only
// environment input is $HOME (see the package doc comment).
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "run-kit"), nil
}

// configPath returns the settings file path: $HOME/.config/run-kit/config.yaml.
func configPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// legacySettingsPath returns the pre-migration settings file location,
// ~/.rk/settings.yaml — read as a fallback when config.yaml is absent, and
// breadcrumb-renamed after a successful save.
func legacySettingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".rk", "settings.yaml"), nil
}

// Load reads ~/.config/run-kit/config.yaml and returns the parsed Settings.
// When that file is unreadable, it falls back to the legacy
// ~/.rk/settings.yaml (same format); when both are absent or unreadable it
// returns Default().
func Load() Settings {
	p, err := configPath()
	if err != nil {
		return Default()
	}
	data, err := os.ReadFile(p)
	if err != nil {
		legacy, lerr := legacySettingsPath()
		if lerr != nil {
			return Default()
		}
		data, err = os.ReadFile(legacy)
		if err != nil {
			return Default()
		}
	}
	return parse(string(data))
}

// Save writes the settings to ~/.config/run-kit/config.yaml, creating
// ~/.config/run-kit/ if absent. After a successful write, a still-present
// legacy ~/.rk/settings.yaml is renamed to settings.yaml.migrated —
// best-effort; a rename failure never fails the save.
func Save(s Settings) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	content := serialize(s)
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		return err
	}
	if legacy, err := legacySettingsPath(); err == nil {
		_ = os.Rename(legacy, legacy+".migrated")
	}
	return nil
}

// nestedSection describes one nested config.yaml section for parse/serialize.
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

// registryEntry is one settings key in the single-source-of-truth registry.
// Scalar entries carry parse/serialize hooks; nested entries (maps and lists)
// carry a section built by mapSection/listSection instead. Adding a key is one
// entry — parse and serialize need no new branches.
type registryEntry struct {
	key      string // config.yaml key ("theme", "server_colors")
	kind     string // value type: enum, string, color, path, bool, map, list
	def      string // default value, text form ("{}", "[]" for nested sections)
	desc     string // one-line description
	category string // grouping for later UI surfaces
	ui       bool   // exposed on the settings UI surface
	live     bool   // applies on next read without a daemon restart
	// parse consumes one scalar "key: value" line (value already trimmed).
	// Nil on nested-section entries.
	parse func(s *Settings, value string)
	// serialize emits the scalar line(s) for the key, or "" when the value is
	// at its default — defaults are omitted so an untouched file round-trips
	// byte-identically. Nil on nested-section entries.
	serialize func(s *Settings) string
	// section is the nested-section machinery for map/list keys. Zero value
	// (section.key == "") on scalar entries.
	section nestedSection
}

// registry is the single source of truth for every settings key. Slice order
// IS serialization order: scalar keys first (theme … log_level), then the
// nested sections. Descriptions/defaults/flags are data for the settings API
// and pane that later phases build on this table.
var registry = []registryEntry{
	{
		key: "theme", kind: "enum", def: "system",
		desc:     "UI color mode — system, dark, light, or a named theme.",
		category: "appearance", ui: true, live: true,
		parse: func(s *Settings, value string) {
			if value != "" {
				s.Theme = value
			}
		},
		serialize: func(s *Settings) string { return "theme: " + s.Theme + "\n" },
	},
	{
		key: "theme_dark", kind: "string", def: "default-dark",
		desc:     "Theme applied when the UI is in dark mode.",
		category: "appearance", ui: true, live: true,
		parse: func(s *Settings, value string) {
			if value != "" {
				s.ThemeDark = value
			}
		},
		serialize: func(s *Settings) string { return "theme_dark: " + s.ThemeDark + "\n" },
	},
	{
		key: "theme_light", kind: "string", def: "default-light",
		desc:     "Theme applied when the UI is in light mode.",
		category: "appearance", ui: true, live: true,
		parse: func(s *Settings, value string) {
			if value != "" {
				s.ThemeLight = value
			}
		},
		serialize: func(s *Settings) string { return "theme_light: " + s.ThemeLight + "\n" },
	},
	{
		key: "instance_color", kind: "color", def: "",
		desc:     "Per-instance accent color descriptor (\"4\" for one ANSI index, \"1+3\" for a two-hue blend).",
		category: "appearance", ui: true, live: true,
		// Tolerant read: accept a legacy bare integer OR the quoted string
		// descriptor ("1+3"); normalize and drop anything malformed.
		parse: func(s *Settings, value string) {
			colorStr := strings.Trim(value, "\"")
			if normalized, ok := validate.NormalizeColorValue(colorStr); ok {
				s.InstanceColor = normalized
			}
		},
		// Always quoted so a blend ("1+3") round-trips unambiguously.
		serialize: quotedScalar("instance_color", func(s *Settings) *string { return &s.InstanceColor }),
	},
	{
		key: "ssh_host", kind: "string", def: "",
		desc:     "Verbatim SSH destination remote clients use to reach this host (ssh config alias or user@host).",
		category: "connectivity", ui: true, live: true,
		// Tolerant read: quote-stripped and trimmed (serialize always quotes
		// so the value round-trips unambiguously).
		parse:     quoteTrimmedScalar(func(s *Settings) *string { return &s.SSHHost }),
		serialize: quotedScalar("ssh_host", func(s *Settings) *string { return &s.SSHHost }),
	},
	{
		key: "instance_name", kind: "string", def: "",
		desc:     "Display-name override for this run-kit instance.",
		category: "identity", ui: true, live: true,
		parse:     quoteTrimmedScalar(func(s *Settings) *string { return &s.InstanceName }),
		serialize: quotedScalar("instance_name", func(s *Settings) *string { return &s.InstanceName }),
	},
	{
		key: "auto_name", kind: "bool", def: "false",
		desc:     "Arms the auto-name-on-idle trigger: the operator window is asked to fix tab names on busy→idle transitions.",
		category: "behavior", ui: true, live: false,
		// Tolerant read: any strconv.ParseBool value; anything else keeps the
		// default (off) — the safe direction for an opt-in trigger.
		parse: func(s *Settings, value string) {
			if b, err := strconv.ParseBool(strings.Trim(value, "\"")); err == nil {
				s.AutoName = b
			}
		},
		serialize: func(s *Settings) string {
			if s.AutoName {
				return "auto_name: true\n"
			}
			return ""
		},
	},
	{
		key: "tmux_conf", kind: "path", def: "",
		desc:     "Path to the tmux.conf rk passes to tmux; empty uses the built-in default. The RK_TMUX_CONF env escape wins when set.",
		category: "advanced", ui: true, live: false,
		parse:     quoteTrimmedScalar(func(s *Settings) *string { return &s.TmuxConf }),
		serialize: quotedScalar("tmux_conf", func(s *Settings) *string { return &s.TmuxConf }),
	},
	{
		key: "log_level", kind: "enum", def: "info",
		desc:     "Daemon log verbosity — info or debug. The LOG_LEVEL env escape wins when set.",
		category: "advanced", ui: true, live: false,
		// Tolerant read: only info/debug are accepted; anything else keeps the
		// default.
		parse: func(s *Settings, value string) {
			switch v := strings.Trim(value, "\""); v {
			case "info", "debug":
				s.LogLevel = v
			}
		},
		serialize: func(s *Settings) string {
			if s.LogLevel != "" && s.LogLevel != "info" {
				return "log_level: " + s.LogLevel + "\n"
			}
			return ""
		},
	},
	{
		key: "server_colors", kind: "map", def: "{}",
		desc:     "Server name → accent color descriptor for the server's sidebar surfaces.",
		category: "appearance", ui: true, live: true,
		// Tolerant color read: accept a legacy bare integer OR the string
		// descriptor ("1+3"); normalize and drop anything malformed.
		section: mapSection("server_colors", func(s *Settings) *map[string]string { return &s.ServerColors }, validate.NormalizeColorValue),
	},
	{
		key: "server_flairs", kind: "map", def: "{}",
		desc:     "Server name → flair token (a closed set: validate.FlairValues) for the server's sidebar surfaces.",
		category: "appearance", ui: true, live: true,
		// Tolerant flair read: accept only non-empty tokens in the universal
		// set; no canonicalization needed — flair tokens round-trip as-is.
		section: mapSection("server_flairs", func(s *Settings) *map[string]string { return &s.ServerFlairs }, normalizeFlairValue),
	},
	{
		key: "board_order", kind: "list", def: "[]",
		desc:     "User-defined board display order; rank = list index.",
		category: "layout", ui: true, live: true,
		section: listSection("board_order", func(s *Settings) *[]string { return &s.BoardOrder }),
	},
}

// quoteTrimmedScalar builds the parse hook for a plain string scalar: the
// value is quote-stripped and trimmed (serialize always quotes so the value
// round-trips unambiguously).
func quoteTrimmedScalar(target func(*Settings) *string) func(*Settings, string) {
	return func(s *Settings, value string) {
		*target(s) = strings.TrimSpace(strings.Trim(value, "\""))
	}
}

// quotedScalar builds the serialize hook for a string scalar emitted quoted
// and omitted when empty — a settings file without the key serializes
// byte-identically to one that never had it.
func quotedScalar(key string, target func(*Settings) *string) func(*Settings) string {
	return func(s *Settings) string {
		if v := *target(s); v != "" {
			return key + ": \"" + v + "\"\n"
		}
		return ""
	}
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

// normalizeFlairValue is the membership-check normalize for the server_flairs
// mapSection: a value survives iff it is a non-empty token in the universal
// flair set. Unlike colors, flair tokens need no canonical form — pass/fail
// only.
func normalizeFlairValue(value string) (string, bool) {
	if value != "" && validate.FlairValues[value] {
		return value, true
	}
	return "", false
}

// parse extracts settings from simple "key: value" lines.
// Supports one level of nesting: indented lines under a registered section
// heading are parsed as that section's entries. Keys not in the registry are
// ignored.
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

		for i := range registry {
			if key != registry[i].key {
				continue
			}
			if registry[i].section.key != "" {
				active = &registry[i].section
			} else {
				registry[i].parse(&s, value)
			}
			break
		}
	}
	return s
}

// serialize produces the "key: value" text representation, in registry order
// (scalar keys first, then nested sections; defaults and empty sections
// omitted).
func serialize(s Settings) string {
	out := ""
	for i := range registry {
		if registry[i].section.key != "" {
			out += registry[i].section.serialize(&s)
		} else {
			out += registry[i].serialize(&s)
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

// GetServerFlair returns the flair token for the named server, or nil. Mirrors
// GetServerColor.
func GetServerFlair(server string) *string {
	s := Load()
	if v, ok := s.ServerFlairs[server]; ok {
		return &v
	}
	return nil
}

// SetServerFlair sets or clears the flair token for the named server (nil
// clears). Mirrors SetServerColor (load-then-save).
func SetServerFlair(server string, flair *string) error {
	s := Load()
	if flair == nil {
		delete(s.ServerFlairs, server)
	} else {
		if s.ServerFlairs == nil {
			s.ServerFlairs = make(map[string]string)
		}
		s.ServerFlairs[server] = *flair
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
