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
		// Clean the URL path
		urlPath := req.URL.Path

		// Skip API and relay routes (should never reach here due to route ordering,
		// but guard defensively)
		if strings.HasPrefix(urlPath, "/api/") || strings.HasPrefix(urlPath, "/relay/") {
			http.NotFound(w, req)
			return
		}

		// Try to serve the static file directly
		filePath := filepath.Join(spaDir, urlPath)
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
