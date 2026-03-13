package fab

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

// RuntimeState holds the agent runtime state for a fab change.
type RuntimeState struct {
	AgentState        string // "active", "idle", or "unknown"
	AgentIdleDuration string // "2m", "1h" — only populated when idle
}

// FormatIdleDuration formats elapsed seconds as Ns (<60), Nm (60-3599), or Nh (>=3600).
func FormatIdleDuration(seconds int64) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	if seconds < 3600 {
		return fmt.Sprintf("%dm", seconds/60)
	}
	return fmt.Sprintf("%dh", seconds/3600)
}

// ReadRuntime reads .fab-runtime.yaml from projectRoot and resolves agent state
// for the given changeName. Returns nil if the project has no .fab-status.yaml.
func ReadRuntime(projectRoot string, changeName string) *RuntimeState {
	return ReadRuntimeWithNow(projectRoot, changeName, time.Now().Unix())
}

// ReadRuntimeWithNow is like ReadRuntime but accepts a nowUnix parameter for testing.
func ReadRuntimeWithNow(projectRoot string, changeName string, nowUnix int64) *RuntimeState {
	// Rule #6: return nil if no .fab-status.yaml exists (non-fab project safety net)
	if _, err := os.Stat(filepath.Join(projectRoot, ".fab-status.yaml")); err != nil {
		return nil
	}

	runtimePath := filepath.Join(projectRoot, ".fab-runtime.yaml")
	data, err := os.ReadFile(runtimePath)
	if err != nil {
		// Rule #5: runtime file missing → unknown
		return &RuntimeState{AgentState: "unknown"}
	}

	// Parse as untyped map to match fab-kit convention
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return &RuntimeState{AgentState: "unknown"}
	}

	// Navigate to {changeName}.agent.idle_since
	changeData, ok := raw[changeName]
	if !ok {
		// Rule #4: change entry missing → active
		return &RuntimeState{AgentState: "active"}
	}

	changeMap, ok := changeData.(map[string]interface{})
	if !ok {
		return &RuntimeState{AgentState: "active"}
	}

	agentData, ok := changeMap["agent"]
	if !ok {
		// Rule #4: agent block missing → active
		return &RuntimeState{AgentState: "active"}
	}

	agentMap, ok := agentData.(map[string]interface{})
	if !ok {
		return &RuntimeState{AgentState: "active"}
	}

	idleSinceRaw, ok := agentMap["idle_since"]
	if !ok {
		// Rule #4: idle_since absent → active
		return &RuntimeState{AgentState: "active"}
	}

	// Convert idle_since to int64 (YAML may decode as int or float64)
	var idleSince int64
	switch v := idleSinceRaw.(type) {
	case int:
		idleSince = int64(v)
	case int64:
		idleSince = v
	case float64:
		idleSince = int64(v)
	default:
		return &RuntimeState{AgentState: "active"}
	}

	elapsed := nowUnix - idleSince
	if elapsed < 0 {
		elapsed = 0
	}

	return &RuntimeState{
		AgentState:        "idle",
		AgentIdleDuration: FormatIdleDuration(elapsed),
	}
}
