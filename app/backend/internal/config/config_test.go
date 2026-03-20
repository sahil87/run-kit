package config

import (
	"os"
	"testing"
)

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
	if defaults.Port != 3000 {
		t.Errorf("default port = %d, want 3000", defaults.Port)
	}
	if defaults.Host != "127.0.0.1" {
		t.Errorf("default host = %q, want 127.0.0.1", defaults.Host)
	}
}

func TestLoad(t *testing.T) {
	t.Run("reads port and host from env", func(t *testing.T) {
		t.Setenv("RK_PORT", "8080")
		t.Setenv("RK_HOST", "0.0.0.0")

		cfg := Load()
		if cfg.Port != 8080 {
			t.Errorf("port = %d, want 8080", cfg.Port)
		}
		if cfg.Host != "0.0.0.0" {
			t.Errorf("host = %q, want 0.0.0.0", cfg.Host)
		}
	})

	t.Run("ignores invalid port", func(t *testing.T) {
		t.Setenv("RK_PORT", "notanumber")

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
	})

	t.Run("ignores out-of-range port", func(t *testing.T) {
		t.Setenv("RK_PORT", "99999")

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
	})

	t.Run("falls back to defaults when unset", func(t *testing.T) {
		os.Unsetenv("RK_PORT")
		os.Unsetenv("RK_HOST")

		cfg := Load()
		if cfg.Port != defaults.Port {
			t.Errorf("port = %d, want default %d", cfg.Port, defaults.Port)
		}
		if cfg.Host != defaults.Host {
			t.Errorf("host = %q, want default %q", cfg.Host, defaults.Host)
		}
	})
}
