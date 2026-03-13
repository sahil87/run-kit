package fab

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFormatIdleDuration(t *testing.T) {
	tests := []struct {
		seconds int64
		want    string
	}{
		{0, "0s"},
		{1, "1s"},
		{30, "30s"},
		{59, "59s"},
		{60, "1m"},
		{90, "1m"},   // floor division
		{120, "2m"},
		{300, "5m"},
		{3599, "59m"},
		{3600, "1h"},
		{7200, "2h"},
		{7260, "2h"},  // floor division
		{36000, "10h"},
	}

	for _, tt := range tests {
		got := FormatIdleDuration(tt.seconds)
		if got != tt.want {
			t.Errorf("FormatIdleDuration(%d) = %q, want %q", tt.seconds, got, tt.want)
		}
	}
}

// setupFabProject creates a temp dir with .fab-status.yaml (required for ReadRuntime to not return nil).
func setupFabProject(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	statusYaml := `name: 260313-txna-rich-sidebar-window-status
progress:
  apply: active
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-status.yaml"), []byte(statusYaml), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestReadRuntimeAgentActive(t *testing.T) {
	dir := setupFabProject(t)

	// Runtime file exists but no idle_since for the change
	runtimeYaml := `260313-txna-rich-sidebar-window-status:
  agent:
    pid: 12345
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil, want non-nil")
	}
	if got.AgentState != "active" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "active")
	}
	if got.AgentIdleDuration != "" {
		t.Errorf("AgentIdleDuration = %q, want empty", got.AgentIdleDuration)
	}
}

func TestReadRuntimeAgentIdleSeconds(t *testing.T) {
	dir := setupFabProject(t)

	runtimeYaml := `260313-txna-rich-sidebar-window-status:
  agent:
    idle_since: 1710299970
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	// 30 seconds ago
	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	if got.AgentState != "idle" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "idle")
	}
	if got.AgentIdleDuration != "30s" {
		t.Errorf("AgentIdleDuration = %q, want %q", got.AgentIdleDuration, "30s")
	}
}

func TestReadRuntimeAgentIdleMinutes(t *testing.T) {
	dir := setupFabProject(t)

	runtimeYaml := `260313-txna-rich-sidebar-window-status:
  agent:
    idle_since: 1710299700
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	// 300 seconds = 5 minutes ago
	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	if got.AgentState != "idle" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "idle")
	}
	if got.AgentIdleDuration != "5m" {
		t.Errorf("AgentIdleDuration = %q, want %q", got.AgentIdleDuration, "5m")
	}
}

func TestReadRuntimeAgentIdleHours(t *testing.T) {
	dir := setupFabProject(t)

	runtimeYaml := `260313-txna-rich-sidebar-window-status:
  agent:
    idle_since: 1710292800
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	// 7200 seconds = 2 hours ago
	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	if got.AgentState != "idle" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "idle")
	}
	if got.AgentIdleDuration != "2h" {
		t.Errorf("AgentIdleDuration = %q, want %q", got.AgentIdleDuration, "2h")
	}
}

func TestReadRuntimeFileMissing(t *testing.T) {
	dir := setupFabProject(t)
	// No .fab-runtime.yaml written → unknown

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil, want non-nil with unknown state")
	}
	if got.AgentState != "unknown" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "unknown")
	}
	if got.AgentIdleDuration != "" {
		t.Errorf("AgentIdleDuration = %q, want empty", got.AgentIdleDuration)
	}
}

func TestReadRuntimeEmptyFile(t *testing.T) {
	dir := setupFabProject(t)

	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	// Empty YAML → change entry missing → active
	if got.AgentState != "active" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "active")
	}
}

func TestReadRuntimeMissingChangeEntry(t *testing.T) {
	dir := setupFabProject(t)

	runtimeYaml := `other-change:
  agent:
    idle_since: 1710299700
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	if got.AgentState != "active" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "active")
	}
}

func TestReadRuntimeMissingAgentBlock(t *testing.T) {
	dir := setupFabProject(t)

	runtimeYaml := `260313-txna-rich-sidebar-window-status:
  something_else: true
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-runtime.yaml"), []byte(runtimeYaml), 0o644); err != nil {
		t.Fatal(err)
	}

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got == nil {
		t.Fatal("ReadRuntimeWithNow returned nil")
	}
	if got.AgentState != "active" {
		t.Errorf("AgentState = %q, want %q", got.AgentState, "active")
	}
}

func TestReadRuntimeNoFabStatusYaml(t *testing.T) {
	// No .fab-status.yaml → nil (non-fab project)
	dir := t.TempDir()

	got := ReadRuntimeWithNow(dir, "260313-txna-rich-sidebar-window-status", 1710300000)
	if got != nil {
		t.Errorf("ReadRuntimeWithNow returned %+v, want nil for non-fab project", got)
	}
}
