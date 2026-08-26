package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// tinyGIF is a 1×1 transparent GIF89a, generated as source bytes (never a
// committed binary fixture).
var tinyGIF = []byte{
	'G', 'I', 'F', '8', '9', 'a', 1, 0, 1, 0, 0x80, 0, 0,
	0, 0, 0, 0xff, 0xff, 0xff,
	'!', 0xf9, 4, 1, 0, 0, 0, 0,
	',', 0, 0, 0, 0, 1, 0, 1, 0, 0,
	2, 2, 0x44, 1, 0,
	';',
}

// stageConfigRoot points $HOME at a fresh temp dir (so settings.Dir() resolves
// there) and returns the would-be config root — the equivalent of
// isolateSettings for the config-dir file conventions.
func stageConfigRoot(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	return filepath.Join(home, ".config", "run-kit")
}

// writeCustomFlair creates dir/custom-flair<ext> with the given bytes.
func writeCustomFlair(t *testing.T, dir, ext string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "custom-flair"+ext), data, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}

func getFlair(t *testing.T, router http.Handler, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/flair/custom", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestCustomFlair_notFoundWhenAbsent(t *testing.T) {
	stageConfigRoot(t) // empty temp HOME — no config root, no asset
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getFlair(t, router, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestCustomFlair_servesGifWithETag(t *testing.T) {
	dir := stageConfigRoot(t)
	writeCustomFlair(t, dir, ".gif", tinyGIF)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getFlair(t, router, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/gif" {
		t.Errorf("Content-Type = %q, want image/gif", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag missing — the custom flair asset must carry a content-derived validator")
	}
	if body := rec.Body.Bytes(); string(body) != string(tinyGIF) {
		t.Errorf("body = %d bytes, want the %d fixture bytes verbatim", len(body), len(tinyGIF))
	}

	// Revalidation with the returned ETag collapses to a 304.
	rec = getFlair(t, router, map[string]string{"If-None-Match": etag})
	if rec.Code != http.StatusNotModified {
		t.Errorf("revalidated status = %d, want %d", rec.Code, http.StatusNotModified)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("304 body = %d bytes, want empty", rec.Body.Len())
	}

	// A changed file changes the ETag — the request-time read never serves a
	// stale validator (the old tag revalidates to a fresh 200).
	writeCustomFlair(t, dir, ".gif", append(tinyGIF, 0x00))
	rec = getFlair(t, router, map[string]string{"If-None-Match": etag})
	if rec.Code != http.StatusOK {
		t.Errorf("post-change status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("ETag"); got == etag {
		t.Errorf("ETag %q unchanged after the file changed", got)
	}

	// Deleting the file 404s the NEXT request — no cache holds the asset.
	if err := os.Remove(filepath.Join(dir, "custom-flair.gif")); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	rec = getFlair(t, router, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("post-delete status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestCustomFlair_webpPreferredOverGif(t *testing.T) {
	dir := stageConfigRoot(t)
	writeCustomFlair(t, dir, ".gif", tinyGIF)
	writeCustomFlair(t, dir, ".webp", []byte("RIFF fake webp bytes"))
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getFlair(t, router, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Errorf("Content-Type = %q, want image/webp (webp wins over gif)", got)
	}
}

func TestCustomFlair_zeroByteFileServesEmpty(t *testing.T) {
	dir := stageConfigRoot(t)
	writeCustomFlair(t, dir, ".gif", nil)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// A zero-byte asset is a well-formed empty serve, never a 5xx.
	rec := getFlair(t, router, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body = %d bytes, want 0 for a zero-byte asset", rec.Body.Len())
	}
	if rec.Header().Get("ETag") == "" {
		t.Error("ETag missing on the empty serve")
	}
}
