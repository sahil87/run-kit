package fab

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadState(t *testing.T) {
	tests := []struct {
		name       string
		setup      func(t *testing.T) string
		wantNil    bool
		wantChange string
		wantStage  string
	}{
		{
			name: "active change with active stage",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: 260312-r4t9-go-backend-api
progress:
  intake: done
  spec: done
  tasks: done
  apply: active
  review: pending
  hydrate: pending
  ship: pending
  review-pr: pending
`
				writeFile(t, dir, ".fab-status.yaml", yaml)
				return dir
			},
			wantNil:    false,
			wantChange: "260312-r4t9-go-backend-api",
			wantStage:  "apply",
		},
		{
			name: "no file returns nil",
			setup: func(t *testing.T) string {
				t.Helper()
				return t.TempDir()
			},
			wantNil: true,
		},
		{
			name: "dangling symlink returns nil",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				// Create a symlink to a nonexistent target
				target := filepath.Join(dir, "nonexistent-target.yaml")
				link := filepath.Join(dir, ".fab-status.yaml")
				if err := os.Symlink(target, link); err != nil {
					t.Fatal(err)
				}
				return dir
			},
			wantNil: true,
		},
		{
			name: "all stages done returns change with empty stage",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: 260312-abc-feature
progress:
  intake: done
  spec: done
  tasks: done
  apply: done
  review: done
  hydrate: done
  ship: done
  review-pr: done
`
				writeFile(t, dir, ".fab-status.yaml", yaml)
				return dir
			},
			wantNil:    false,
			wantChange: "260312-abc-feature",
			wantStage:  "",
		},
		{
			name: "all stages pending returns change with empty stage",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: 260312-xyz-other
progress:
  intake: pending
  spec: pending
  tasks: pending
  apply: pending
  review: pending
  hydrate: pending
  ship: pending
  review-pr: pending
`
				writeFile(t, dir, ".fab-status.yaml", yaml)
				return dir
			},
			wantNil:    false,
			wantChange: "260312-xyz-other",
			wantStage:  "",
		},
		{
			name: "invalid YAML returns nil",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				writeFile(t, dir, ".fab-status.yaml", "{{invalid yaml")
				return dir
			},
			wantNil: true,
		},
		{
			name: "empty name returns nil",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: ""
progress:
  apply: active
`
				writeFile(t, dir, ".fab-status.yaml", yaml)
				return dir
			},
			wantNil: true,
		},
		{
			name: "first active stage in canonical order wins",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: 260312-multi-active
progress:
  intake: done
  spec: active
  tasks: active
  apply: pending
`
				writeFile(t, dir, ".fab-status.yaml", yaml)
				return dir
			},
			wantNil:    false,
			wantChange: "260312-multi-active",
			wantStage:  "spec",
		},
		{
			name: "symlink to real file works",
			setup: func(t *testing.T) string {
				t.Helper()
				dir := t.TempDir()
				yaml := `name: 260312-linked-change
progress:
  intake: active
`
				// Write the real file in a subdirectory
				subDir := filepath.Join(dir, "changes")
				if err := os.MkdirAll(subDir, 0o755); err != nil {
					t.Fatal(err)
				}
				realFile := filepath.Join(subDir, "status.yaml")
				if err := os.WriteFile(realFile, []byte(yaml), 0o644); err != nil {
					t.Fatal(err)
				}
				// Symlink .fab-status.yaml -> changes/status.yaml
				if err := os.Symlink(realFile, filepath.Join(dir, ".fab-status.yaml")); err != nil {
					t.Fatal(err)
				}
				return dir
			},
			wantNil:    false,
			wantChange: "260312-linked-change",
			wantStage:  "intake",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := tt.setup(t)
			got := ReadState(dir)

			if tt.wantNil {
				if got != nil {
					t.Errorf("ReadState() = %+v, want nil", got)
				}
				return
			}

			if got == nil {
				t.Fatal("ReadState() = nil, want non-nil")
			}
			if got.Change != tt.wantChange {
				t.Errorf("Change = %q, want %q", got.Change, tt.wantChange)
			}
			if got.Stage != tt.wantStage {
				t.Errorf("Stage = %q, want %q", got.Stage, tt.wantStage)
			}
		})
	}
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
