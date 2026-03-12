package sessions

import (
	"os"
	"path/filepath"
	"testing"

	"run-kit/internal/tmux"
)

func TestHasFabKit(t *testing.T) {
	tests := []struct {
		name       string
		setupDir   func(t *testing.T) string
		wantResult bool
	}{
		{
			name: "returns true when fab/project/config.yaml exists",
			setupDir: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				configDir := filepath.Join(dir, "fab", "project")
				if err := os.MkdirAll(configDir, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("name: test"), 0o644); err != nil {
					t.Fatal(err)
				}
				return dir
			},
			wantResult: true,
		},
		{
			name: "returns false when fab/project/config.yaml does not exist",
			setupDir: func(t *testing.T) string {
				t.Helper()
				return t.TempDir()
			},
			wantResult: false,
		},
		{
			name: "returns false when fab dir exists but config.yaml is missing",
			setupDir: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				if err := os.MkdirAll(filepath.Join(dir, "fab", "project"), 0o755); err != nil {
					t.Fatal(err)
				}
				return dir
			},
			wantResult: false,
		},
		{
			name: "returns false for empty string",
			setupDir: func(t *testing.T) string {
				t.Helper()
				return ""
			},
			wantResult: false,
		},
		{
			name: "returns false for nonexistent directory",
			setupDir: func(t *testing.T) string {
				t.Helper()
				return "/nonexistent/path/that/does/not/exist"
			},
			wantResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := tt.setupDir(t)
			got := hasFabKit(dir)
			if got != tt.wantResult {
				t.Errorf("hasFabKit(%q) = %v, want %v", dir, got, tt.wantResult)
			}
		})
	}
}

func TestProjectRootDerivation(t *testing.T) {
	tests := []struct {
		name     string
		windows  []tmux.WindowInfo
		wantRoot string
	}{
		{
			name: "project root from first window",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "main", WorktreePath: "/home/user/project"},
				{Index: 1, Name: "build", WorktreePath: "/tmp/build"},
			},
			wantRoot: "/home/user/project",
		},
		{
			name:     "empty windows returns empty root",
			windows:  []tmux.WindowInfo{},
			wantRoot: "",
		},
		{
			name: "single window",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/code"},
			},
			wantRoot: "/home/user/code",
		},
		{
			name: "first window has empty path",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "main", WorktreePath: ""},
				{Index: 1, Name: "sub", WorktreePath: "/home/user/other"},
			},
			wantRoot: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			projectRoot := ""
			if len(tt.windows) > 0 {
				projectRoot = tt.windows[0].WorktreePath
			}
			if projectRoot != tt.wantRoot {
				t.Errorf("projectRoot = %q, want %q", projectRoot, tt.wantRoot)
			}
		})
	}
}

func TestEnrichSessionWithFabState(t *testing.T) {
	// Create a project root with .fab-status.yaml
	dir := t.TempDir()
	yaml := `name: 260312-abc-feature
progress:
  intake: done
  spec: done
  tasks: done
  apply: active
  review: pending
`
	if err := os.WriteFile(filepath.Join(dir, ".fab-status.yaml"), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}

	windows := []tmux.WindowInfo{
		{Index: 0, Name: "main", WorktreePath: dir},
		{Index: 1, Name: "build", WorktreePath: "/tmp/build"},
		{Index: 2, Name: "test", WorktreePath: "/tmp/test"},
	}

	enrichSession(windows, dir)

	// All windows should share the same fab state
	for i, win := range windows {
		if win.FabChange != "260312-abc-feature" {
			t.Errorf("window[%d].FabChange = %q, want %q", i, win.FabChange, "260312-abc-feature")
		}
		if win.FabStage != "apply" {
			t.Errorf("window[%d].FabStage = %q, want %q", i, win.FabStage, "apply")
		}
	}
}

func TestEnrichSessionNoFabFile(t *testing.T) {
	dir := t.TempDir()

	windows := []tmux.WindowInfo{
		{Index: 0, Name: "test", WorktreePath: dir},
		{Index: 1, Name: "other", WorktreePath: dir},
	}

	enrichSession(windows, dir)

	for i, win := range windows {
		if win.FabChange != "" {
			t.Errorf("window[%d].FabChange = %q, want empty", i, win.FabChange)
		}
		if win.FabStage != "" {
			t.Errorf("window[%d].FabStage = %q, want empty", i, win.FabStage)
		}
	}
}

func TestProjectSessionStruct(t *testing.T) {
	ps := ProjectSession{
		Name: "my-project",
		Windows: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true},
			{Index: 1, Name: "build", WorktreePath: "/tmp/build", Activity: "idle", IsActiveWindow: false},
		},
	}

	if ps.Name != "my-project" {
		t.Errorf("Name = %q, want %q", ps.Name, "my-project")
	}
	if len(ps.Windows) != 2 {
		t.Fatalf("Windows count = %d, want 2", len(ps.Windows))
	}
	if ps.Windows[0].IsActiveWindow != true {
		t.Error("Windows[0].IsActiveWindow should be true")
	}
	if ps.Windows[1].IsActiveWindow != false {
		t.Error("Windows[1].IsActiveWindow should be false")
	}
}
