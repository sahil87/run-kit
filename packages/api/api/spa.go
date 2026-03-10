package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

// spaDir is the directory containing the built SPA assets.
// Defaults to packages/web/dist/ relative to working directory.
var spaDir = "packages/web/dist"

func mountSPA(r chi.Router) {
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		// Clean the URL path and strip the leading slash so filepath.Join
		// resolves relative to spaDir instead of discarding it.
		urlPath := strings.TrimPrefix(req.URL.Path, "/")

		// Skip API and relay routes (should never reach here due to route ordering,
		// but guard defensively)
		if strings.HasPrefix(req.URL.Path, "/api/") || strings.HasPrefix(req.URL.Path, "/relay/") {
			http.NotFound(w, req)
			return
		}

		// Try to serve the static file directly
		filePath := filepath.Join(spaDir, filepath.Clean(urlPath))

		// Ensure the resolved path stays within spaDir to prevent path traversal
		absFilePath, _ := filepath.Abs(filePath)
		absSpaDir, _ := filepath.Abs(spaDir)
		if !strings.HasPrefix(absFilePath, absSpaDir+string(filepath.Separator)) && absFilePath != absSpaDir {
			http.NotFound(w, req)
			return
		}
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, req, filePath)
			return
		}

		// SPA fallback: serve index.html for client-side routing
		indexPath := filepath.Join(spaDir, "index.html")
		if _, err := os.Stat(indexPath); err != nil {
			// SPA not built yet — return 404
			http.NotFound(w, req)
			return
		}

		http.ServeFile(w, req, indexPath)
	})
}
