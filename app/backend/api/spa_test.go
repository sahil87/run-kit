package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func setupSPADir(t *testing.T) (string, func()) {
	t.Helper()
	dir := t.TempDir()

	// Save original spaDir and restore after test
	orig := spaDir
	spaDir = dir

	// Create index.html
	indexPath := filepath.Join(dir, "index.html")
	if err := os.WriteFile(indexPath, []byte("<html>SPA</html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create a static asset
	assetsDir := filepath.Join(dir, "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "main.js"), []byte("console.log('app')"), 0o644); err != nil {
		t.Fatal(err)
	}

	return dir, func() {
		spaDir = orig
	}
}

func TestSPAStaticAsset(t *testing.T) {
	_, cleanup := setupSPADir(t)
	defer cleanup()

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/assets/main.js", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	body := rec.Body.String()
	if body != "console.log('app')" {
		t.Errorf("body = %q, want %q", body, "console.log('app')")
	}
}

func TestSPAFallback(t *testing.T) {
	_, cleanup := setupSPADir(t)
	defer cleanup()

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/p/run-kit/0", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	body := rec.Body.String()
	if body != "<html>SPA</html>" {
		t.Errorf("body = %q, want SPA index.html content", body)
	}
}

func TestSPAPathTraversal(t *testing.T) {
	_, cleanup := setupSPADir(t)
	defer cleanup()

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/../../etc/passwd", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should not serve /etc/passwd — path traversal must be blocked with 404
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestSPANotBuilt(t *testing.T) {
	// Point spaDir to a nonexistent directory
	orig := spaDir
	spaDir = "/tmp/nonexistent-spa-dir-12345"
	defer func() { spaDir = orig }()

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
