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
}

func TestParseMissing(t *testing.T) {
	s := parse("")
	if s.Theme != "system" {
		t.Errorf("parse empty: Theme = %q, want %q", s.Theme, "system")
	}
}

func TestParseValid(t *testing.T) {
	s := parse("theme: dracula\n")
	if s.Theme != "dracula" {
		t.Errorf("parse valid: Theme = %q, want %q", s.Theme, "dracula")
	}
}

func TestParseMalformed(t *testing.T) {
	s := parse("garbage line without colon\n")
	if s.Theme != "system" {
		t.Errorf("parse malformed: Theme = %q, want %q", s.Theme, "system")
	}
}

func TestParseEmptyValue(t *testing.T) {
	s := parse("theme: \n")
	if s.Theme != "system" {
		t.Errorf("parse empty value: Theme = %q, want %q", s.Theme, "system")
	}
}

func TestParseWithComments(t *testing.T) {
	s := parse("# this is a comment\ntheme: nord\n")
	if s.Theme != "nord" {
		t.Errorf("parse with comments: Theme = %q, want %q", s.Theme, "nord")
	}
}

func TestSaveAndLoad(t *testing.T) {
	// Use a temp directory to override HOME
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	s := Settings{Theme: "dracula"}
	if err := Save(s); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Verify file was created
	p := filepath.Join(tmp, ".rk", "settings.yaml")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if got := string(data); got != "theme: dracula\n" {
		t.Errorf("file content = %q, want %q", got, "theme: dracula\n")
	}

	// Load should return the saved value
	loaded := Load()
	if loaded.Theme != "dracula" {
		t.Errorf("Load().Theme = %q, want %q", loaded.Theme, "dracula")
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

	if err := Save(Settings{Theme: "nord"}); err != nil {
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
}

func TestSerialize(t *testing.T) {
	got := serialize(Settings{Theme: "catppuccin-mocha"})
	want := "theme: catppuccin-mocha\n"
	if got != want {
		t.Errorf("serialize = %q, want %q", got, want)
	}
}
