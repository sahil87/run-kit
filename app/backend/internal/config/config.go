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
	// CodeServerPort is the optional code-server port OVERRIDE (env
	// RK_CODE_SERVER_PORT); 0 means unset (invalid values load as unset).
	// It is never used directly — consumers call ResolvedCodeServerPort,
	// which falls back to the RK_PORT+2 convention. Set the override only to
	// point rk at an externally managed code-server; by default the daemon
	// runs one behind the stable /code/ route, so the port is a private
	// implementation detail and never appears in a URL the frontend builds.
	CodeServerPort int
}

// ResolvedCodeServerPort returns the effective code-server port: the preset
// RK_CODE_SERVER_PORT (CodeServerPort) when valid, else the RK_PORT+2
// convention. This is the ONE resolution rule shared by the daemon's
// code-server spawn, the /code reverse proxy, the SSE reachability probe, and
// doctor — nothing else configures it (Constitution VII). 0 means the feature
// is off, reachable only via a degenerate RK_PORT whose +2 falls outside
// 1-65535.
func (c Config) ResolvedCodeServerPort() int {
	if validPort(c.CodeServerPort) {
		return c.CodeServerPort
	}
	if validPort(c.Port + 2) {
		return c.Port + 2
	}
	return 0
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

	if csPortStr := os.Getenv("RK_CODE_SERVER_PORT"); csPortStr != "" {
		if p, err := strconv.Atoi(csPortStr); err == nil && validPort(p) {
			cfg.CodeServerPort = p
		}
	}

	return cfg
}
