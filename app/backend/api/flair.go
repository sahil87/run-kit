package api

// Custom flair runtime asset — GET /api/flair/custom serves the user-supplied
// custom flair image for the `custom` flair token (the .rk-flair-custom rule in
// globals.css). The asset is content-neutral infrastructure: the repo ships no
// image; the user drops a file at a FIXED filename in the config root by hand:
//
//	~/.config/run-kit/custom-flair.webp   (preferred — full alpha, smaller)
//	~/.config/run-kit/custom-flair.gif
//
// Fixed names only — no upload endpoint, no settings key, and no user-controlled
// path ever reaches the filesystem (Constitution §I/§IV/§VII). The file is read
// AT REQUEST TIME from the config root (resolved via internal/settings.Dir —
// Constitution §II, no cache): a deleted file 404s on the next request and the
// `custom` token is inert until a file exists (a failed CSS background fetch
// paints nothing). ETag is content-derived with Cache-Control: no-cache, so
// revalidation collapses to a 304 when the file is unchanged. GET only (§IX).

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"

	"rk/internal/settings"
)

// customFlairAssets are the fixed asset filenames in preference order — the
// first file that reads successfully wins.
var customFlairAssets = []struct {
	name        string
	contentType string
}{
	{"custom-flair.webp", "image/webp"},
	{"custom-flair.gif", "image/gif"},
}

// handleCustomFlair serves GET /api/flair/custom. 404 when no asset file
// exists (or none is readable); 200 with the matched extension's content-type
// otherwise. A zero-byte file is a valid empty serve (200), never a 5xx.
func (s *Server) handleCustomFlair(w http.ResponseWriter, r *http.Request) {
	dir, err := settings.Dir()
	if err != nil {
		s.logger.Error("custom flair: config root unavailable", "err", err)
		http.NotFound(w, r)
		return
	}
	var data []byte
	contentType := ""
	for _, a := range customFlairAssets {
		b, err := os.ReadFile(filepath.Join(dir, a.name))
		if err != nil {
			continue
		}
		data, contentType = b, a.contentType
		break
	}
	if contentType == "" {
		http.NotFound(w, r)
		return
	}

	sum := sha256.Sum256(data)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(data)
}
