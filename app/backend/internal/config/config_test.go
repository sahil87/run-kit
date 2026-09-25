package config

import (
	"os"
	"path/filepath"
	"testing"

	"rk/internal/portpolicy"
	"rk/internal/settings"
)

// isolateConfigRoot points settings.Load at an empty temp root so no test
// reads the developer's real config.yaml. When configContent is non-empty it
// is written as the config.yaml there.
func isolateConfigRoot(t *testing.T, configContent string) {
	t.Helper()
	dir := t.TempDir()
	if configContent != "" {
		if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(configContent), 0o644); err != nil {
			t.Fatalf("writing config.yaml: %v", err)
		}
	}
	t.Setenv(settings.ConfigDirEnv, dir)
}

func TestValidPort(t *testing.T) {
	tests := []struct {
		name string
		port int
		want bool
	}{
		{"valid lower bound", 1, true},
		{"valid upper bound", 65535, true},
		{"valid common port", 3000, true},
		{"zero", 0, false},
		{"negative", -1, false},
		{"above upper bound", 65536, false},
		{"way above", 99999, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := validPort(tt.port)
			if got != tt.want {
				t.Errorf("validPort(%d) = %v, want %v", tt.port, got, tt.want)
			}
		})
	}
}

func TestDefaults(t *testing.T) {
	if defaults.Port != portpolicy.DaemonDefault {
		t.Errorf("default port = %d, want portpolicy.DaemonDefault %d", defaults.Port, portpolicy.DaemonDefault)
	}
	if defaults.Host != "127.0.0.1" {
		t.Errorf("default host = %q, want 127.0.0.1", defaults.Host)
	}
}

func TestLoad(t *testing.T) {
	t.Run("reads port and host from env", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "8080")
		t.Setenv(HostEnvVar, "0.0.0.0")

		cfg := Load()
		if cfg.Port != 8080 {
			t.Errorf("port = %d, want 8080", cfg.Port)
		}
		if cfg.Host != "0.0.0.0" {
			t.Errorf("host = %q, want 0.0.0.0", cfg.Host)
		}
	})

	t.Run("ignores invalid port", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "notanumber")

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
	})

	t.Run("ignores out-of-range port", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "99999")

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
	})

	t.Run("falls back to defaults when unset", func(t *testing.T) {
		isolateConfigRoot(t, "")
		os.Unsetenv(PortEnvVar)
		os.Unsetenv(HostEnvVar)

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
		if cfg.Host != defaults.Host {
			t.Errorf("host = %q, want default %q", cfg.Host, defaults.Host)
		}
	})

	t.Run("reads code-server port from env", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(CodeServerPortEnvVar, "8080")

		cfg := Load()
		if cfg.CodeServerPort != 8080 {
			t.Errorf("codeServerPort = %d, want 8080", cfg.CodeServerPort)
		}
	})

	t.Run("code-server port zero when unset, invalid, or out of range", func(t *testing.T) {
		isolateConfigRoot(t, "")
		for _, v := range []string{"", "notanumber", "0", "99999"} {
			t.Setenv(CodeServerPortEnvVar, v)

			cfg := Load()
			if cfg.CodeServerPort != 0 {
				t.Errorf("RK_CODE_SERVER_PORT=%q: codeServerPort = %d, want 0 (unset)", v, cfg.CodeServerPort)
			}
		}
	})
}

// TestLoadConfigYamlRung pins the port precedence chain: code default <
// config.yaml `port:` < a valid RK_PORT, with an invalid RK_PORT ignored back
// down to the config.yaml rung.
func TestLoadConfigYamlRung(t *testing.T) {
	t.Run("config.yaml port applies when no env", func(t *testing.T) {
		isolateConfigRoot(t, "port: 4000\n")
		os.Unsetenv(PortEnvVar)

		cfg := Load()
		if cfg.Port != 4000 {
			t.Errorf("port = %d, want 4000 (config.yaml)", cfg.Port)
		}
		if got := cfg.ResolvedCodeServerPort(); got != 4002 {
			t.Errorf("ResolvedCodeServerPort = %d, want 4002 (resolved port + 2)", got)
		}
	})

	t.Run("valid RK_PORT wins over config.yaml", func(t *testing.T) {
		isolateConfigRoot(t, "port: 4000\n")
		t.Setenv(PortEnvVar, "5000")

		if cfg := Load(); cfg.Port != 5000 {
			t.Errorf("port = %d, want 5000 (env over config)", cfg.Port)
		}
	})

	t.Run("invalid RK_PORT falls back to config.yaml", func(t *testing.T) {
		isolateConfigRoot(t, "port: 4000\n")
		t.Setenv(PortEnvVar, "junk")

		if cfg := Load(); cfg.Port != 4000 {
			t.Errorf("port = %d, want 4000 (invalid env ignored)", cfg.Port)
		}
	})

	t.Run("out-of-range RK_PORT falls back to config.yaml", func(t *testing.T) {
		isolateConfigRoot(t, "port: 4000\n")
		t.Setenv(PortEnvVar, "70000")

		if cfg := Load(); cfg.Port != 4000 {
			t.Errorf("port = %d, want 4000 (out-of-range env ignored)", cfg.Port)
		}
	})

	t.Run("neither set resolves the code default", func(t *testing.T) {
		isolateConfigRoot(t, "")
		os.Unsetenv(PortEnvVar)

		if cfg := Load(); cfg.Port != portpolicy.DaemonDefault {
			t.Errorf("port = %d, want portpolicy.DaemonDefault %d", cfg.Port, portpolicy.DaemonDefault)
		}
	})

	t.Run("invalid config.yaml port leaves the default", func(t *testing.T) {
		isolateConfigRoot(t, "port: 70000\n")
		os.Unsetenv(PortEnvVar)

		if cfg := Load(); cfg.Port != portpolicy.DaemonDefault {
			t.Errorf("port = %d, want default %d (invalid config value tolerated)", cfg.Port, portpolicy.DaemonDefault)
		}
	})
}

func TestResolvedCodeServerPort(t *testing.T) {
	t.Run("preset wins over the convention", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "3020")
		t.Setenv(CodeServerPortEnvVar, "3939")

		if got := Load().ResolvedCodeServerPort(); got != 3939 {
			t.Errorf("ResolvedCodeServerPort = %d, want 3939 (preset)", got)
		}
	})

	t.Run("convention default is RK_PORT+2", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "3000")
		t.Setenv(CodeServerPortEnvVar, "")

		if got := Load().ResolvedCodeServerPort(); got != 3002 {
			t.Errorf("ResolvedCodeServerPort = %d, want 3002 (RK_PORT+2)", got)
		}
	})

	t.Run("invalid preset falls back to the convention", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "3000")
		t.Setenv(CodeServerPortEnvVar, "notanumber")

		if got := Load().ResolvedCodeServerPort(); got != 3002 {
			t.Errorf("ResolvedCodeServerPort = %d, want 3002 (invalid preset = unset)", got)
		}
	})

	t.Run("degenerate RK_PORT resolves to 0 (feature off)", func(t *testing.T) {
		isolateConfigRoot(t, "")
		t.Setenv(PortEnvVar, "65535")
		t.Setenv(CodeServerPortEnvVar, "")

		if got := Load().ResolvedCodeServerPort(); got != 0 {
			t.Errorf("ResolvedCodeServerPort = %d, want 0 (RK_PORT+2 out of range)", got)
		}
	})
}
