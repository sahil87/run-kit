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

func TestParseServerColors(t *testing.T) {
	// Tolerant read: legacy bare integers, quoted strings, and blends all parse.
	s := parse("theme: system\nserver_colors:\n  default: 4\n  dev: \"10\"\n  blend: \"1+3\"\n  bad: \"99\"\n")
	if len(s.ServerColors) != 3 {
		t.Fatalf("expected 3 valid server colors (malformed dropped), got %d: %v", len(s.ServerColors), s.ServerColors)
	}
	if s.ServerColors["default"] != "4" {
		t.Errorf("ServerColors[default] = %q, want \"4\"", s.ServerColors["default"])
	}
	if s.ServerColors["dev"] != "10" {
		t.Errorf("ServerColors[dev] = %q, want \"10\"", s.ServerColors["dev"])
	}
	if s.ServerColors["blend"] != "1+3" {
		t.Errorf("ServerColors[blend] = %q, want \"1+3\"", s.ServerColors["blend"])
	}
	if _, ok := s.ServerColors["bad"]; ok {
		t.Errorf("malformed value 99 should have been dropped, got %q", s.ServerColors["bad"])
	}
}

func TestSerializeServerColors(t *testing.T) {
	s := Settings{
		Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light",
		ServerColors: map[string]string{"default": "4", "dev": "1+3"},
	}
	got := serialize(s)
	// Values are always written quoted so a blend ("1+3") round-trips.
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nserver_colors:\n  default: \"4\"\n  dev: \"1+3\"\n"
	if got != want {
		t.Errorf("serialize = %q, want %q", got, want)
	}
}

// TestParseServerColors_legacyIntBackCompat verifies a pre-change settings file
// holding bare integer server colors (the old format) still loads after the
// int→string type change, with no migration code path.
func TestParseServerColors_legacyIntBackCompat(t *testing.T) {
	s := parse("server_colors:\n  default: 4\n  dev: 10\n")
	if s.ServerColors["default"] != "4" || s.ServerColors["dev"] != "10" {
		t.Errorf("legacy integer server colors did not load: %v", s.ServerColors)
	}
}

func TestParseBoardOrder(t *testing.T) {
	s := parse("theme: system\nboard_order:\n  - \"reviews\"\n  - \"deploys\"\n  - scratch\n")
	want := []string{"reviews", "deploys", "scratch"}
	if len(s.BoardOrder) != len(want) {
		t.Fatalf("BoardOrder = %v, want %v", s.BoardOrder, want)
	}
	for i, name := range want {
		if s.BoardOrder[i] != name {
			t.Errorf("BoardOrder[%d] = %q, want %q", i, s.BoardOrder[i], name)
		}
	}
}

// TestParseNoBoardOrder verifies a legacy settings file predating the
// board_order: block loads with a nil BoardOrder and no error.
func TestParseNoBoardOrder(t *testing.T) {
	s := parse("theme: dracula\nserver_colors:\n  default: 4\n")
	if s.BoardOrder != nil {
		t.Errorf("BoardOrder = %v, want nil for a file with no board_order block", s.BoardOrder)
	}
}

func TestSerializeEmptyBoardOrderIsByteIdentical(t *testing.T) {
	// A theme-only Settings with no board order must serialize exactly as before
	// (no board_order: line), guarding the existing exact-string assertions.
	got := serialize(Settings{Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light"})
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\n"
	if got != want {
		t.Errorf("serialize (empty BoardOrder) = %q, want %q", got, want)
	}
}

func TestSerializeBoardOrder(t *testing.T) {
	s := Settings{
		Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light",
		BoardOrder: []string{"reviews", "deploys"},
	}
	got := serialize(s)
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nboard_order:\n  - \"reviews\"\n  - \"deploys\"\n"
	if got != want {
		t.Errorf("serialize = %q, want %q", got, want)
	}
}

func TestBoardOrderRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// Unset → nil.
	if got := GetBoardOrder(); got != nil {
		t.Errorf("GetBoardOrder (unset) = %v, want nil", got)
	}

	order := []string{"b", "a", "c"}
	if err := SetBoardOrder(order); err != nil {
		t.Fatalf("SetBoardOrder: %v", err)
	}
	got := GetBoardOrder()
	if len(got) != 3 || got[0] != "b" || got[1] != "a" || got[2] != "c" {
		t.Errorf("GetBoardOrder = %v, want [b a c]", got)
	}

	// A full-list rewrite replaces (self-heals stale names).
	if err := SetBoardOrder([]string{"a"}); err != nil {
		t.Fatalf("SetBoardOrder rewrite: %v", err)
	}
	got = GetBoardOrder()
	if len(got) != 1 || got[0] != "a" {
		t.Errorf("GetBoardOrder after rewrite = %v, want [a]", got)
	}

	// Empty clears.
	if err := SetBoardOrder(nil); err != nil {
		t.Fatalf("SetBoardOrder nil: %v", err)
	}
	if got := GetBoardOrder(); got != nil {
		t.Errorf("GetBoardOrder after clear = %v, want nil", got)
	}
}

// TestBoardOrderCoexistsWithServerColors verifies board_order and server_colors
// both persist and load together (distinct nested shapes: sequence vs map).
func TestBoardOrderCoexistsWithServerColors(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	color := "4"
	if err := SetServerColor("default", &color); err != nil {
		t.Fatalf("SetServerColor: %v", err)
	}
	if err := SetBoardOrder([]string{"x", "y"}); err != nil {
		t.Fatalf("SetBoardOrder: %v", err)
	}
	loaded := Load()
	if loaded.ServerColors["default"] != "4" {
		t.Errorf("ServerColors[default] = %q, want 4", loaded.ServerColors["default"])
	}
	if len(loaded.BoardOrder) != 2 || loaded.BoardOrder[0] != "x" || loaded.BoardOrder[1] != "y" {
		t.Errorf("BoardOrder = %v, want [x y]", loaded.BoardOrder)
	}
}

func TestParseInstanceColor(t *testing.T) {
	// Tolerant read: quoted string descriptors, blends, and a legacy bare
	// integer all parse; malformed values are dropped (empty field).
	cases := []struct {
		in   string
		want string
	}{
		{"instance_color: \"4\"\n", "4"},
		{"instance_color: \"1+3\"\n", "1+3"},
		{"instance_color: 4\n", "4"},        // legacy bare int
		{"instance_color: \"01\"\n", "1"},   // normalized
		{"instance_color: \"99\"\n", ""},    // out of range → dropped
		{"instance_color: \"1+2+3\"\n", ""}, // malformed → dropped
		{"theme: system\n", ""},             // absent → empty
	}
	for _, c := range cases {
		s := parse(c.in)
		if s.InstanceColor != c.want {
			t.Errorf("parse(%q).InstanceColor = %q, want %q", c.in, s.InstanceColor, c.want)
		}
	}
}

func TestSerializeInstanceColor(t *testing.T) {
	s := Settings{
		Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light",
		InstanceColor: "1+3",
	}
	got := serialize(s)
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\ninstance_color: \"1+3\"\n"
	if got != want {
		t.Errorf("serialize = %q, want %q", got, want)
	}
}

func TestSerializeEmptyInstanceColorIsByteIdentical(t *testing.T) {
	// A Settings with no instance color must serialize exactly as before (no
	// instance_color: line), guarding the existing exact-string assertions.
	got := serialize(Settings{Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light"})
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\n"
	if got != want {
		t.Errorf("serialize (empty InstanceColor) = %q, want %q", got, want)
	}
}

func TestInstanceColorRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// Unset → nil.
	if got := GetInstanceColor(); got != nil {
		t.Errorf("GetInstanceColor (unset) = %v, want nil", got)
	}

	color := "5"
	if err := SetInstanceColor(&color); err != nil {
		t.Fatalf("SetInstanceColor: %v", err)
	}
	got := GetInstanceColor()
	if got == nil || *got != "5" {
		t.Errorf("GetInstanceColor = %v, want \"5\"", got)
	}

	// Blend round-trips through write→read as a string.
	blend := "1+3"
	if err := SetInstanceColor(&blend); err != nil {
		t.Fatalf("SetInstanceColor blend: %v", err)
	}
	got = GetInstanceColor()
	if got == nil || *got != "1+3" {
		t.Errorf("GetInstanceColor = %v, want \"1+3\"", got)
	}

	// Clear.
	if err := SetInstanceColor(nil); err != nil {
		t.Fatalf("SetInstanceColor nil: %v", err)
	}
	if got := GetInstanceColor(); got != nil {
		t.Errorf("GetInstanceColor after clear = %v, want nil", got)
	}
}

// TestInstanceColorCoexists verifies the scalar instance color persists and
// loads alongside the nested server_colors map and board_order sequence.
func TestInstanceColorCoexists(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	serverColor := "4"
	if err := SetServerColor("default", &serverColor); err != nil {
		t.Fatalf("SetServerColor: %v", err)
	}
	instColor := "2"
	if err := SetInstanceColor(&instColor); err != nil {
		t.Fatalf("SetInstanceColor: %v", err)
	}
	if err := SetBoardOrder([]string{"x"}); err != nil {
		t.Fatalf("SetBoardOrder: %v", err)
	}
	loaded := Load()
	if loaded.InstanceColor != "2" {
		t.Errorf("InstanceColor = %q, want \"2\"", loaded.InstanceColor)
	}
	if loaded.ServerColors["default"] != "4" {
		t.Errorf("ServerColors[default] = %q, want \"4\"", loaded.ServerColors["default"])
	}
	if len(loaded.BoardOrder) != 1 || loaded.BoardOrder[0] != "x" {
		t.Errorf("BoardOrder = %v, want [x]", loaded.BoardOrder)
	}
}

func TestServerColorRoundTrip(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	color := "6"
	if err := SetServerColor("default", &color); err != nil {
		t.Fatalf("SetServerColor: %v", err)
	}

	got := GetServerColor("default")
	if got == nil || *got != "6" {
		t.Errorf("GetServerColor(default) = %v, want \"6\"", got)
	}

	// Blend round-trips through write→read as a string.
	blend := "1+3"
	if err := SetServerColor("default", &blend); err != nil {
		t.Fatalf("SetServerColor blend: %v", err)
	}
	got = GetServerColor("default")
	if got == nil || *got != "1+3" {
		t.Errorf("GetServerColor(default) = %v, want \"1+3\"", got)
	}

	// Unset server should return nil
	got = GetServerColor("nonexistent")
	if got != nil {
		t.Errorf("GetServerColor(nonexistent) = %v, want nil", got)
	}

	// Clear
	if err := SetServerColor("default", nil); err != nil {
		t.Fatalf("SetServerColor nil: %v", err)
	}
	got = GetServerColor("default")
	if got != nil {
		t.Errorf("GetServerColor after clear = %v, want nil", got)
	}
}
