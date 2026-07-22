package config

import (
	"os"
	"strconv"
)

// Config holds server configuration.
type Config struct {
	Port int
	Host string
	// SSHHost is the optional SSH host alias remote clients use to reach this
	// host (env RK_SSH_HOST). It feeds the frontend's editor ssh-remote
	// deeplinks; empty (unset) means the deeplink section stays hidden.
	SSHHost string
}

var defaults = Config{
	Port: 3000,
	Host: "127.0.0.1",
}

// validPort returns true if the port is in the valid range 1-65535.
func validPort(p int) bool {
	return p >= 1 && p <= 65535
}

// Load reads configuration from RK_PORT, RK_HOST, and RK_SSH_HOST env vars,
// falling back to defaults.
func Load() Config {
	cfg := defaults

	if portStr := os.Getenv("RK_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil && validPort(p) {
			cfg.Port = p
		}
	}

	if host := os.Getenv("RK_HOST"); host != "" {
		cfg.Host = host
	}

	cfg.SSHHost = os.Getenv("RK_SSH_HOST")

	return cfg
}
