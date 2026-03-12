package fab

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// stageOrder defines the canonical order of fab pipeline stages.
var stageOrder = []string{
	"intake", "spec", "tasks", "apply", "review", "hydrate", "ship", "review-pr",
}

// State holds the active fab change name and current stage.
type State struct {
	Change string // active change folder name
	Stage  string // first stage with "active" progress, empty if none
}

// statusFile is the YAML structure of .fab-status.yaml.
type statusFile struct {
	Name     string            `yaml:"name"`
	Progress map[string]string `yaml:"progress"`
}

// ReadState reads .fab-status.yaml from projectRoot and returns the active
// change name and current stage. Returns nil if the file does not exist,
// is a dangling symlink, or cannot be parsed.
func ReadState(projectRoot string) *State {
	data, err := os.ReadFile(filepath.Join(projectRoot, ".fab-status.yaml"))
	if err != nil {
		return nil
	}

	var status statusFile
	if err := yaml.Unmarshal(data, &status); err != nil {
		return nil
	}

	if status.Name == "" {
		return nil
	}

	// Find the first active stage in canonical order.
	stage := ""
	for _, s := range stageOrder {
		if status.Progress[s] == "active" {
			stage = s
			break
		}
	}

	return &State{
		Change: status.Name,
		Stage:  stage,
	}
}
