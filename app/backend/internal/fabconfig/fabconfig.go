// Package fabconfig reads the fab/project/config.yaml file that lives at a
// repo root. It provides best-effort accessors that return empty values rather
// than errors when the file is absent, malformed, or missing keys — this
// mirrors the pattern used by internal/config for run-kit.yaml.
package fabconfig

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// fabConfigRelPath is the location of the fab config relative to the repo root.
const fabConfigRelPath = "fab/project/config.yaml"

// fabConfig mirrors the subset of fab/project/config.yaml that rk cares about.
// We deliberately only model the keys we need; additional top-level keys in the
// file are ignored by the YAML decoder.
type fabConfig struct {
	Agent struct {
		SpawnCommand string `yaml:"spawn_command"`
	} `yaml:"agent"`
}

// ReadSpawnCommand returns the value of agent.spawn_command from
// <repoRoot>/fab/project/config.yaml. It returns "" for any of:
//   - empty repoRoot
//   - missing file
//   - unreadable file
//   - malformed YAML
//   - missing agent block
//   - missing or empty spawn_command key
//
// This is best-effort and never returns an error — callers are expected to
// apply a fallback when the result is "".
func ReadSpawnCommand(repoRoot string) string {
	if repoRoot == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(repoRoot, fabConfigRelPath))
	if err != nil {
		return ""
	}
	var cfg fabConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Agent.SpawnCommand)
}
