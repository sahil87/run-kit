package api

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"run-kit/frontend"

	"github.com/go-chi/chi/v5"
)

// spaDir is the directory containing the built SPA assets (used in dev mode).
var spaDir = "app/frontend/dist"

// hasEmbeddedAssets reports whether the embedded frontend FS contains real build output
// (i.e., more than just the .gitkeep placeholder).
func hasEmbeddedAssets() bool {
	entries, err := fs.ReadDir(frontend.Dist, "dist")
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.Name() != ".gitkeep" {
			return true
		}
	}
	return false
}

func (s *Server) mountSPA(r chi.Router) {
	if hasEmbeddedAssets() {
		s.mountEmbeddedSPA(r)
	} else {
		s.mountFilesystemSPA(r)
	}
}

// mountEmbeddedSPA serves the SPA from the embedded filesystem (production mode).
func (s *Server) mountEmbeddedSPA(r chi.Router) {
	// Sub into the "dist" subdirectory of the embed.FS.
	sub, err := fs.Sub(frontend.Dist, "dist")
	if err != nil {
		s.logger.Error("failed to open embedded frontend", "err", err)
		return
	}
	fsys := http.FS(sub)

	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		urlPath := strings.TrimPrefix(req.URL.Path, "/")

		// Skip API and relay routes defensively.
		if strings.HasPrefix(req.URL.Path, "/api/") || strings.HasPrefix(req.URL.Path, "/relay/") {
			http.NotFound(w, req)
			return
		}

		// Try to serve the file directly from embedded FS.
		// Only serve regular files — reject directories to prevent directory listings.
		if urlPath != "" {
			if f, err := sub.Open(urlPath); err == nil {
				stat, statErr := f.Stat()
				f.Close()
				if statErr == nil && !stat.IsDir() {
					http.FileServer(fsys).ServeHTTP(w, req)
					return
				}
			}
		}

		// SPA fallback: serve index.html for client-side routing.
		req.URL.Path = "/"
		http.FileServer(fsys).ServeHTTP(w, req)
	})
}

// mountFilesystemSPA serves the SPA from the local filesystem (dev mode).
func (s *Server) mountFilesystemSPA(r chi.Router) {
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
