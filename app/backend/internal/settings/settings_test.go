package settings

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
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
	if s.TmuxConf != "" {
		t.Errorf("Default().TmuxConf = %q, want %q", s.TmuxConf, "")
	}
	if s.LogLevel != "info" {
		t.Errorf("Default().LogLevel = %q, want %q", s.LogLevel, "info")
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

	// Verify file was created at the fixed config root
	p := filepath.Join(tmp, ".config", "run-kit", "config.yaml")
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

	// .config/run-kit/ does not exist yet
	configDir := filepath.Join(tmp, ".config", "run-kit")
	if _, err := os.Stat(configDir); !os.IsNotExist(err) {
		t.Fatal("expected .config/run-kit/ to not exist initially")
	}

	if err := Save(Settings{Theme: "nord", ThemeDark: "default-dark", ThemeLight: "default-light"}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	info, err := os.Stat(configDir)
	if err != nil {
		t.Fatalf("Stat .config/run-kit: %v", err)
	}
	if !info.IsDir() {
		t.Error(".config/run-kit should be a directory")
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

func TestParseOptionalSettings(t *testing.T) {
	cases := []struct {
		name  string
		input string
		check func(*testing.T, Settings)
	}{
		{
			name:  "server colors",
			input: "theme: system\nserver_colors:\n  default: 4\n  dev: \"10\"\n  blend: \"1+3\"\n  bad: \"99\"\n",
			check: func(t *testing.T, s Settings) {
				if len(s.ServerColors) != 3 {
					t.Fatalf("expected 3 valid server colors, got %d: %v", len(s.ServerColors), s.ServerColors)
				}
				for key, want := range map[string]string{"default": "4", "dev": "10", "blend": "1+3"} {
					if got := s.ServerColors[key]; got != want {
						t.Errorf("ServerColors[%s] = %q, want %q", key, got, want)
					}
				}
				if _, ok := s.ServerColors["bad"]; ok {
					t.Errorf("malformed value 99 should have been dropped, got %q", s.ServerColors["bad"])
				}
			},
		},
		{
			name:  "legacy integer server colors",
			input: "server_colors:\n  default: 4\n  dev: 10\n",
			check: func(t *testing.T, s Settings) {
				if s.ServerColors["default"] != "4" || s.ServerColors["dev"] != "10" {
					t.Errorf("legacy integer server colors did not load: %v", s.ServerColors)
				}
			},
		},
		{
			name:  "server flairs",
			input: "theme: system\nserver_flairs:\n  default: \"nyan\"\n  dev: cube\n  bad: \"bogus\"\n  empty: \"\"\n",
			check: func(t *testing.T, s Settings) {
				if len(s.ServerFlairs) != 2 {
					t.Fatalf("expected 2 valid server flairs, got %d: %v", len(s.ServerFlairs), s.ServerFlairs)
				}
				if s.ServerFlairs["default"] != "nyan" || s.ServerFlairs["dev"] != "cube" {
					t.Errorf("ServerFlairs = %v, want default=nyan and dev=cube", s.ServerFlairs)
				}
				if _, ok := s.ServerFlairs["bad"]; ok {
					t.Errorf("unknown token bogus should have been dropped, got %q", s.ServerFlairs["bad"])
				}
			},
		},
		{
			name:  "board order",
			input: "theme: system\nboard_order:\n  - \"reviews\"\n  - \"deploys\"\n  - scratch\n",
			check: func(t *testing.T, s Settings) {
				want := []string{"reviews", "deploys", "scratch"}
				if !reflect.DeepEqual(s.BoardOrder, want) {
					t.Errorf("BoardOrder = %v, want %v", s.BoardOrder, want)
				}
			},
		},
		{
			name:  "missing board order",
			input: "theme: dracula\nserver_colors:\n  default: 4\n",
			check: func(t *testing.T, s Settings) {
				if s.BoardOrder != nil {
					t.Errorf("BoardOrder = %v, want nil", s.BoardOrder)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.check(t, parse(tc.input))
		})
	}

	t.Run("instance color vocabulary", func(t *testing.T) {
		for _, tc := range []struct {
			input string
			want  string
		}{
			{"instance_color: \"4\"\n", "4"},
			{"instance_color: \"1+3\"\n", "1+3"},
			{"instance_color: 4\n", "4"},
			{"instance_color: \"01\"\n", "1"},
			{"instance_color: \"99\"\n", ""},
			{"instance_color: \"1+2+3\"\n", ""},
			{"theme: system\n", ""},
		} {
			if got := parse(tc.input).InstanceColor; got != tc.want {
				t.Errorf("parse(%q).InstanceColor = %q, want %q", tc.input, got, tc.want)
			}
		}
	})

	t.Run("ssh host and instance name", func(t *testing.T) {
		for _, tc := range []struct {
			input        string
			wantSSH      string
			wantInstance string
		}{
			{"ssh_host: \"devbox\"\n", "devbox", ""},
			{"ssh_host: devbox\n", "devbox", ""},
			{"ssh_host: \"user@host\"\n", "user@host", ""},
			{"instance_name: \"my-box\"\n", "", "my-box"},
			{"instance_name: \"dev mini\"\n", "", "dev mini"},
			{"ssh_host: \"devbox\"\ninstance_name: \"my-box\"\n", "devbox", "my-box"},
			{"theme: system\n", "", ""},
		} {
			s := parse(tc.input)
			if s.SSHHost != tc.wantSSH {
				t.Errorf("parse(%q).SSHHost = %q, want %q", tc.input, s.SSHHost, tc.wantSSH)
			}
			if s.InstanceName != tc.wantInstance {
				t.Errorf("parse(%q).InstanceName = %q, want %q", tc.input, s.InstanceName, tc.wantInstance)
			}
		}
	})

	t.Run("tmux config and log level", func(t *testing.T) {
		for _, tc := range []struct {
			input        string
			wantTmuxConf string
			wantLogLevel string
		}{
			{"tmux_conf: \"/my/tmux.conf\"\n", "/my/tmux.conf", "info"},
			{"tmux_conf: /my/tmux.conf\n", "/my/tmux.conf", "info"},
			{"log_level: debug\n", "", "debug"},
			{"log_level: \"debug\"\n", "", "debug"},
			{"log_level: info\n", "", "info"},
			{"log_level: trace\n", "", "info"},
			{"log_level: \"\"\n", "", "info"},
			{"theme: system\n", "", "info"},
		} {
			s := parse(tc.input)
			if s.TmuxConf != tc.wantTmuxConf {
				t.Errorf("parse(%q).TmuxConf = %q, want %q", tc.input, s.TmuxConf, tc.wantTmuxConf)
			}
			if s.LogLevel != tc.wantLogLevel {
				t.Errorf("parse(%q).LogLevel = %q, want %q", tc.input, s.LogLevel, tc.wantLogLevel)
			}
		}
	})
}

func TestSerializeOptionalSettings(t *testing.T) {
	base := Settings{Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light"}
	cases := []struct {
		name   string
		mutate func(*Settings)
		want   string
	}{
		{
			name: "server colors",
			mutate: func(s *Settings) {
				s.ServerColors = map[string]string{"default": "4", "dev": "1+3"}
			},
			want: "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nserver_colors:\n  default: \"4\"\n  dev: \"1+3\"\n",
		},
		{
			name: "server flairs",
			mutate: func(s *Settings) {
				s.ServerFlairs = map[string]string{"default": "nyan", "dev": "cube"}
			},
			want: "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nserver_flairs:\n  default: \"nyan\"\n  dev: \"cube\"\n",
		},
		{
			name:   "board order",
			mutate: func(s *Settings) { s.BoardOrder = []string{"reviews", "deploys"} },
			want:   "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nboard_order:\n  - \"reviews\"\n  - \"deploys\"\n",
		},
		{
			name:   "instance color",
			mutate: func(s *Settings) { s.InstanceColor = "1+3" },
			want:   "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\ninstance_color: \"1+3\"\n",
		},
		{
			name: "ssh host and instance name",
			mutate: func(s *Settings) {
				s.InstanceColor = "4"
				s.SSHHost = "devbox"
				s.InstanceName = "my-box"
			},
			want: "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\ninstance_color: \"4\"\nssh_host: \"devbox\"\ninstance_name: \"my-box\"\n",
		},
		{
			name: "tmux config and log level",
			mutate: func(s *Settings) {
				s.AutoName = true
				s.TmuxConf = "/my/tmux.conf"
				s.LogLevel = "debug"
				s.ServerColors = map[string]string{"default": "4"}
			},
			want: "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\nauto_name: true\ntmux_conf: \"/my/tmux.conf\"\nlog_level: debug\nserver_colors:\n  default: \"4\"\n",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			tc.mutate(&s)
			if got := serialize(s); got != tc.want {
				t.Errorf("serialize = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSerializeEmptyOptionalSettingsIsByteIdentical(t *testing.T) {
	got := serialize(Settings{Theme: "system", ThemeDark: "default-dark", ThemeLight: "default-light", LogLevel: "info"})
	want := "theme: system\ntheme_dark: default-dark\ntheme_light: default-light\n"
	if got != want {
		t.Errorf("serialize with optional defaults = %q, want %q", got, want)
	}
}

func TestOptionalSettingRoundTrips(t *testing.T) {
	t.Run("scalar registry", func(t *testing.T) {
		cases := []struct {
			name        string
			firstValue  string
			secondValue string
			set         func(*string) error
			get         func() *string
		}{
			{name: "server color", firstValue: "6", secondValue: "1+3", set: func(v *string) error { return SetServerColor("default", v) }, get: func() *string { return GetServerColor("default") }},
			{name: "server flair", firstValue: "cube", secondValue: "warp", set: func(v *string) error { return SetServerFlair("default", v) }, get: func() *string { return GetServerFlair("default") }},
			{name: "instance color", firstValue: "5", secondValue: "1+3", set: SetInstanceColor, get: GetInstanceColor},
			{name: "ssh host", firstValue: "devbox", secondValue: "user@host", set: SetSSHHost, get: GetSSHHost},
			{name: "instance name", firstValue: "my-box", secondValue: "dev mini", set: SetInstanceName, get: GetInstanceName},
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				t.Setenv("HOME", t.TempDir())
				if got := tc.get(); got != nil {
					t.Errorf("get unset = %v, want nil", *got)
				}
				value := tc.firstValue
				if err := tc.set(&value); err != nil {
					t.Fatalf("set: %v", err)
				}
				if got := tc.get(); got == nil || *got != value {
					t.Errorf("get = %v, want %q", got, value)
				}
				value = tc.secondValue
				if err := tc.set(&value); err != nil {
					t.Fatalf("overwrite: %v", err)
				}
				if got := tc.get(); got == nil || *got != value {
					t.Errorf("get after overwrite = %v, want %q", got, value)
				}
				if err := tc.set(nil); err != nil {
					t.Fatalf("clear: %v", err)
				}
				if got := tc.get(); got != nil {
					t.Errorf("get after clear = %v, want nil", *got)
				}
			})
		}
	})

	t.Run("missing server color key", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		if got := GetServerColor("nonexistent"); got != nil {
			t.Errorf("GetServerColor(nonexistent) = %v, want nil", got)
		}
	})

	t.Run("server flair clear removes section", func(t *testing.T) {
		tmp := t.TempDir()
		t.Setenv("HOME", tmp)
		flair := "cube"
		if err := SetServerFlair("default", &flair); err != nil {
			t.Fatalf("SetServerFlair: %v", err)
		}
		if err := SetServerFlair("default", nil); err != nil {
			t.Fatalf("SetServerFlair clear: %v", err)
		}
		data, err := os.ReadFile(filepath.Join(tmp, ".config", "run-kit", "config.yaml"))
		if err != nil {
			t.Fatalf("ReadFile: %v", err)
		}
		if strings.Contains(string(data), "server_flairs") {
			t.Errorf("cleared map left a server_flairs heading in the file:\n%s", data)
		}
	})

	t.Run("board order", func(t *testing.T) {
		t.Setenv("HOME", t.TempDir())
		if got := GetBoardOrder(); got != nil {
			t.Errorf("GetBoardOrder unset = %v, want nil", got)
		}
		if err := SetBoardOrder([]string{"b", "a", "c"}); err != nil {
			t.Fatalf("SetBoardOrder: %v", err)
		}
		if got := GetBoardOrder(); !reflect.DeepEqual(got, []string{"b", "a", "c"}) {
			t.Errorf("GetBoardOrder = %v, want [b a c]", got)
		}
		if err := SetBoardOrder([]string{"a"}); err != nil {
			t.Fatalf("SetBoardOrder rewrite: %v", err)
		}
		if got := GetBoardOrder(); !reflect.DeepEqual(got, []string{"a"}) {
			t.Errorf("GetBoardOrder after rewrite = %v, want [a]", got)
		}
		if err := SetBoardOrder(nil); err != nil {
			t.Fatalf("SetBoardOrder nil: %v", err)
		}
		if got := GetBoardOrder(); got != nil {
			t.Errorf("GetBoardOrder after clear = %v, want nil", got)
		}
	})
}

func TestOptionalSettingsCoexist(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	serverColor := "4"
	instanceColor := "2"
	host := "devbox"
	name := "my-box"
	for label, set := range map[string]func() error{
		"server color":   func() error { return SetServerColor("default", &serverColor) },
		"instance color": func() error { return SetInstanceColor(&instanceColor) },
		"ssh host":       func() error { return SetSSHHost(&host) },
		"instance name":  func() error { return SetInstanceName(&name) },
		"board order":    func() error { return SetBoardOrder([]string{"x", "y"}) },
	} {
		if err := set(); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
	}

	loaded := Load()
	if loaded.ServerColors["default"] != "4" {
		t.Errorf("ServerColors[default] = %q, want 4", loaded.ServerColors["default"])
	}
	if loaded.InstanceColor != "2" {
		t.Errorf("InstanceColor = %q, want 2", loaded.InstanceColor)
	}
	if loaded.SSHHost != "devbox" {
		t.Errorf("SSHHost = %q, want devbox", loaded.SSHHost)
	}
	if loaded.InstanceName != "my-box" {
		t.Errorf("InstanceName = %q, want my-box", loaded.InstanceName)
	}
	if !reflect.DeepEqual(loaded.BoardOrder, []string{"x", "y"}) {
		t.Errorf("BoardOrder = %v, want [x y]", loaded.BoardOrder)
	}
}

func TestAutoName(t *testing.T) {
	t.Run("defaults off", func(t *testing.T) {
		if Default().AutoName {
			t.Error("Default().AutoName = true, want false")
		}
		if parse("theme: dark\n").AutoName {
			t.Error("AutoName = true for a file without the key, want false")
		}
	})

	t.Run("parses ParseBool values, tolerates garbage", func(t *testing.T) {
		for value, want := range map[string]bool{"true": true, "1": true, "TRUE": true, "false": false, "0": false, "yes-please": false, "\"true\"": true} {
			if got := parse("auto_name: " + value + "\n").AutoName; got != want {
				t.Errorf("parse auto_name: %s → %v, want %v", value, got, want)
			}
		}
	})

	t.Run("round-trips and is omitted when off", func(t *testing.T) {
		s := Default()
		s.AutoName = true
		if got := parse(serialize(s)); !got.AutoName {
			t.Error("AutoName lost in serialize/parse round-trip")
		}
		s.AutoName = false
		if out := serialize(s); strings.Contains(out, "auto_name") {
			t.Errorf("auto_name emitted for the off default — legacy files must serialize byte-identically:\n%s", out)
		}
	})
}

// --- fixed config root (R1, R2) ---

func TestConfigRootIsFixedAndEnvImmune(t *testing.T) {
	tmp := t.TempDir()
	xdg := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", xdg)

	dir, err := Dir()
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}
	if want := filepath.Join(tmp, ".config", "run-kit"); dir != want {
		t.Errorf("Dir() = %q, want %q (XDG_CONFIG_HOME must not move the root)", dir, want)
	}

	p, err := configPath()
	if err != nil {
		t.Fatalf("configPath: %v", err)
	}
	want := filepath.Join(tmp, ".config", "run-kit", "config.yaml")
	if p != want {
		t.Errorf("configPath() = %q, want %q", p, want)
	}
}

// --- registry round-trip (R8) ---

// TestRoundTripByteIdentical proves a current-format settings file parses and
// re-serializes to the exact same bytes.
func TestRoundTripByteIdentical(t *testing.T) {
	content := "theme: dracula\n" +
		"theme_dark: dracula\n" +
		"theme_light: solarized-light\n" +
		"instance_color: \"1+3\"\n" +
		"ssh_host: \"devbox\"\n" +
		"instance_name: \"my-box\"\n" +
		"auto_name: true\n" +
		"server_colors:\n  default: \"4\"\n  dev: \"1+3\"\n" +
		"server_flairs:\n  default: \"nyan\"\n  dev: \"cube\"\n" +
		"board_order:\n  - \"reviews\"\n  - \"deploys\"\n"
	if got := serialize(parse(content)); got != content {
		t.Errorf("round-trip not byte-identical:\n got: %q\nwant: %q", got, content)
	}
}

// --- migration 1: ~/.rk/settings.yaml → ~/.config/run-kit/config.yaml (R3, R4) ---

func TestLoadFallsBackToLegacyPath(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	legacyDir := filepath.Join(tmp, ".rk")
	if err := os.MkdirAll(legacyDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "settings.yaml"), []byte("theme: dracula\nssh_host: \"devbox\"\n"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	s := Load()
	if s.Theme != "dracula" {
		t.Errorf("Load (legacy fallback).Theme = %q, want %q", s.Theme, "dracula")
	}
	if s.SSHHost != "devbox" {
		t.Errorf("Load (legacy fallback).SSHHost = %q, want %q", s.SSHHost, "devbox")
	}
}

func TestSaveMigratesAndRenamesLegacyFile(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	legacy := filepath.Join(tmp, ".rk", "settings.yaml")
	if err := os.MkdirAll(filepath.Dir(legacy), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	legacyContent := "theme: dracula\nssh_host: \"devbox\"\n"
	if err := os.WriteFile(legacy, []byte(legacyContent), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// Load picks up legacy values via fallback; saving the merged state must
	// land at the new path and breadcrumb-rename the old file.
	s := Load()
	s.Theme = "nord"
	if err := Save(s); err != nil {
		t.Fatalf("Save: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(tmp, ".config", "run-kit", "config.yaml"))
	if err != nil {
		t.Fatalf("ReadFile new path: %v", err)
	}
	want := "theme: nord\ntheme_dark: default-dark\ntheme_light: default-light\nssh_host: \"devbox\"\n"
	if got := string(data); got != want {
		t.Errorf("new file content = %q, want %q (merged state)", got, want)
	}

	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Error("legacy settings.yaml should be gone after migration")
	}
	breadcrumb, err := os.ReadFile(legacy + ".migrated")
	if err != nil {
		t.Fatalf("ReadFile breadcrumb: %v", err)
	}
	if string(breadcrumb) != legacyContent {
		t.Errorf("breadcrumb content = %q, want original %q", breadcrumb, legacyContent)
	}
}

func TestLoadNewPathWinsWhenBothExist(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	legacyDir := filepath.Join(tmp, ".rk")
	if err := os.MkdirAll(legacyDir, 0755); err != nil {
		t.Fatalf("MkdirAll legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "settings.yaml"), []byte("theme: dracula\n"), 0644); err != nil {
		t.Fatalf("WriteFile legacy: %v", err)
	}
	newPath := filepath.Join(tmp, ".config", "run-kit", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(newPath), 0755); err != nil {
		t.Fatalf("MkdirAll new: %v", err)
	}
	if err := os.WriteFile(newPath, []byte("theme: nord\n"), 0644); err != nil {
		t.Fatalf("WriteFile new: %v", err)
	}

	if s := Load(); s.Theme != "nord" {
		t.Errorf("Load (both exist).Theme = %q, want %q (new path wins)", s.Theme, "nord")
	}
}

func TestLoadBothAbsentReturnsDefaults(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	s := Load()
	want := Default()
	if !reflect.DeepEqual(s, want) {
		t.Errorf("Load (both absent) = %+v, want defaults %+v", s, want)
	}
}

func TestSaveWithoutLegacyFileSucceeds(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// No legacy file — the breadcrumb rename must be a silent no-op.
	if err := Save(Default()); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tmp, ".config", "run-kit", "config.yaml")); err != nil {
		t.Fatalf("new path not written: %v", err)
	}
}
