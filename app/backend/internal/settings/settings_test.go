package settings

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefault(t *testing.T) {
	s := Default()
	if s.Theme != "system" {
		t.Errorf("Default().Theme = %q, want %q", s.Theme, "system")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("Default().ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("Default().ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestParseMissing(t *testing.T) {
	s := parse("")
	if s.Theme != "system" {
		t.Errorf("parse empty: Theme = %q, want %q", s.Theme, "system")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("parse empty: ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("parse empty: ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestParseValid(t *testing.T) {
	s := parse("theme: dracula\ntheme_dark: dracula\ntheme_light: solarized-light\n")
	if s.Theme != "dracula" {
		t.Errorf("parse valid: Theme = %q, want %q", s.Theme, "dracula")
	}
	if s.ThemeDark != "dracula" {
		t.Errorf("parse valid: ThemeDark = %q, want %q", s.ThemeDark, "dracula")
	}
	if s.ThemeLight != "solarized-light" {
		t.Errorf("parse valid: ThemeLight = %q, want %q", s.ThemeLight, "solarized-light")
	}
}

func TestParseLegacy(t *testing.T) {
	s := parse("theme: dracula\n")
	if s.Theme != "dracula" {
		t.Errorf("parse legacy: Theme = %q, want %q", s.Theme, "dracula")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("parse legacy: ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("parse legacy: ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestParseMalformed(t *testing.T) {
	s := parse("garbage line without colon\n")
	if s.Theme != "system" {
		t.Errorf("parse malformed: Theme = %q, want %q", s.Theme, "system")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("parse malformed: ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("parse malformed: ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestParseEmptyValue(t *testing.T) {
	s := parse("theme: \ntheme_dark: \ntheme_light: \n")
	if s.Theme != "system" {
		t.Errorf("parse empty value: Theme = %q, want %q", s.Theme, "system")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("parse empty value: ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("parse empty value: ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestParseWithComments(t *testing.T) {
	s := parse("# this is a comment\ntheme: nord\ntheme_dark: dracula\ntheme_light: solarized-light\n")
	if s.Theme != "nord" {
		t.Errorf("parse with comments: Theme = %q, want %q", s.Theme, "nord")
	}
	if s.ThemeDark != "dracula" {
		t.Errorf("parse with comments: ThemeDark = %q, want %q", s.ThemeDark, "dracula")
	}
	if s.ThemeLight != "solarized-light" {
		t.Errorf("parse with comments: ThemeLight = %q, want %q", s.ThemeLight, "solarized-light")
	}
}

func TestSaveAndLoad(t *testing.T) {
	// Use a temp directory to override HOME
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	s := Settings{Theme: "system", ThemeDark: "dracula", ThemeLight: "solarized-light"}
	if err := Save(s); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Verify file was created
	p := filepath.Join(tmp, ".rk", "settings.yaml")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	want := "theme: system\ntheme_dark: dracula\ntheme_light: solarized-light\n"
	if got := string(data); got != want {
		t.Errorf("file content = %q, want %q", got, want)
	}

	// Load should return the saved values
	loaded := Load()
	if loaded.Theme != "system" {
		t.Errorf("Load().Theme = %q, want %q", loaded.Theme, "system")
	}
	if loaded.ThemeDark != "dracula" {
		t.Errorf("Load().ThemeDark = %q, want %q", loaded.ThemeDark, "dracula")
	}
	if loaded.ThemeLight != "solarized-light" {
		t.Errorf("Load().ThemeLight = %q, want %q", loaded.ThemeLight, "solarized-light")
	}
}

func TestSaveCreatesDir(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// .rk/ does not exist yet
	rkDir := filepath.Join(tmp, ".rk")
	if _, err := os.Stat(rkDir); !os.IsNotExist(err) {
		t.Fatal("expected .rk/ to not exist initially")
	}

	if err := Save(Settings{Theme: "nord", ThemeDark: "default-dark", ThemeLight: "default-light"}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(rkDir)
	if err != nil {
		t.Fatalf("Stat .rk: %v", err)
	}
	if !info.IsDir() {
		t.Error(".rk should be a directory")
	}
}

func TestLoadMissingFile(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	s := Load()
	if s.Theme != "system" {
		t.Errorf("Load (missing): Theme = %q, want %q", s.Theme, "system")
	}
	if s.ThemeDark != "default-dark" {
		t.Errorf("Load (missing): ThemeDark = %q, want %q", s.ThemeDark, "default-dark")
	}
	if s.ThemeLight != "default-light" {
		t.Errorf("Load (missing): ThemeLight = %q, want %q", s.ThemeLight, "default-light")
	}
}

func TestSerialize(t *testing.T) {
	got := serialize(Settings{Theme: "catppuccin-mocha", ThemeDark: "catppuccin-mocha", ThemeLight: "github-light"})
	want := "theme: catppuccin-mocha\ntheme_dark: catppuccin-mocha\ntheme_light: github-light\n"
	if got != want {
		t.Errorf("serialize = %q, want %q", got, want)
	}
}
