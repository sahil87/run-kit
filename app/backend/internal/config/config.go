package config

import (
	"flag"
	"log/slog"
	"os"

	"gopkg.in/yaml.v3"
)

// Config holds server configuration.
type Config struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

var defaults = Config{
	Port: 3000,
	Host: "127.0.0.1",
}

// validPort returns true if the port is in the valid range 1-65535.
func validPort(p int) bool {
	return p >= 1 && p <= 65535
}

// readYAML reads config from run-kit.yaml. Returns zero-value fields for missing/invalid values.
func readYAML() Config {
	data, err := os.ReadFile("run-kit.yaml")
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("error reading run-kit.yaml", "err", err)
		}
		return Config{}
	}

	var doc struct {
		Server struct {
			Port *int   `yaml:"port"`
			Host string `yaml:"host"`
		} `yaml:"server"`
	}

	if err := yaml.Unmarshal(data, &doc); err != nil {
		slog.Warn("error parsing run-kit.yaml", "err", err)
		return Config{}
	}

	var cfg Config
	if doc.Server.Port != nil && validPort(*doc.Server.Port) {
		cfg.Port = *doc.Server.Port
	}
	if doc.Server.Host != "" {
		cfg.Host = doc.Server.Host
	}
	return cfg
}

// Load reads configuration with resolution order: CLI flags > run-kit.yaml > defaults.
func Load() Config {
	portFlag := flag.Int("port", 0, "server port")
	hostFlag := flag.String("host", "", "bind address")
	flag.Parse()

	yamlCfg := readYAML()

	cfg := defaults

	// YAML overrides defaults
	if yamlCfg.Port != 0 {
		cfg.Port = yamlCfg.Port
	}
	if yamlCfg.Host != "" {
		cfg.Host = yamlCfg.Host
	}

	// CLI overrides YAML
	if *portFlag != 0 && validPort(*portFlag) {
		cfg.Port = *portFlag
	}
	if *hostFlag != "" {
		cfg.Host = *hostFlag
	}

	return cfg
}
