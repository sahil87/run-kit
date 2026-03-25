package settings

import (
	"os"
	"path/filepath"
	"strings"
)

// Settings holds user preferences persisted at ~/.rk/settings.yaml.
type Settings struct {
	Theme      string
	ThemeDark  string
	ThemeLight string
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
func parse(data string) Settings {
	s := Default()
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
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
		}
	}
	return s
}

// serialize produces the "key: value" text representation.
func serialize(s Settings) string {
	return "theme: " + s.Theme + "\n" +
		"theme_dark: " + s.ThemeDark + "\n" +
		"theme_light: " + s.ThemeLight + "\n"
}
