package config

import (
	"os"
	"strconv"
)

// Config holds server configuration.
type Config struct {
	Port int
	Host string
}

var defaults = Config{
	Port: 3000,
	Host: "127.0.0.1",
}

// validPort returns true if the port is in the valid range 1-65535.
func validPort(p int) bool {
	return p >= 1 && p <= 65535
}

// Load reads configuration from BACKEND_PORT and BACKEND_HOST env vars,
// falling back to defaults.
func Load() Config {
	cfg := defaults

	if portStr := os.Getenv("BACKEND_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil && validPort(p) {
			cfg.Port = p
		}
	}

	if host := os.Getenv("BACKEND_HOST"); host != "" {
		cfg.Host = host
	}

	return cfg
}
