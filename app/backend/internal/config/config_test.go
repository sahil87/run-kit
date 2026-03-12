package config

import (
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
