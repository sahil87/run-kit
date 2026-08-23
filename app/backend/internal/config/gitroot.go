package config

import (
	"os"
	"path/filepath"
)

// FindGitRoot walks up from dir until it finds a directory containing .git
// (file or directory), returning that directory. Returns "" if not found.
func FindGitRoot(dir string) string {
	for {
		candidate := filepath.Join(dir, ".git")
		if _, err := os.Stat(candidate); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
