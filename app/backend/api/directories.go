package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"run-kit/internal/validate"
)

func (s *Server) handleDirectories(w http.ResponseWriter, r *http.Request) {
	prefix := r.URL.Query().Get("prefix")
	if prefix == "" {
		writeJSON(w, http.StatusOK, map[string][]string{"directories": {}})
		return
	}

	expanded, expandErr := validate.ExpandTilde(prefix)
	if expandErr != "" {
		writeJSON(w, http.StatusOK, map[string][]string{"directories": {}})
		return
	}

	home, _ := os.UserHomeDir()

	var parentDir, filter string
	if strings.HasSuffix(prefix, "/") {
		parentDir = expanded
		filter = ""
	} else {
		parentDir = filepath.Dir(expanded)
		filter = strings.ToLower(filepath.Base(expanded))
	}

	entries, err := os.ReadDir(parentDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string][]string{"directories": {}})
		return
	}

	var directories []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if filter != "" && !strings.HasPrefix(strings.ToLower(entry.Name()), filter) {
			continue
		}
		// Skip hidden directories
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		absPath := filepath.Join(parentDir, entry.Name())
		display := tildePrefix(absPath, home) + "/"
		directories = append(directories, display)
	}

	if directories == nil {
		directories = []string{}
	}

	writeJSON(w, http.StatusOK, map[string][]string{"directories": directories})
}

func tildePrefix(absPath, home string) string {
	if absPath == home {
		return "~"
	}
	if strings.HasPrefix(absPath, home+"/") {
		return "~/" + absPath[len(home)+1:]
	}
	return absPath
}
