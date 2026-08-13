package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// presentFixture builds a serve-root tree exercising the containment matrix:
//
//	root/
//	  index.html        (dir default)
//	  mock.html
//	  style.css
//	  real.html
//	  link.html  → ./real.html     (legitimate intra-tree symlink)
//	  evil       → <outside>/      (escaping symlink — must never be served)
//	  sub/index.html
//	  noidx/                        (no index.html → 404, never a listing)
//	<outside>/secret.txt            (escape target — must remain unread)
func presentFixture(t *testing.T) (root, outside string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "root")
	outside = filepath.Join(base, "outside")
	for _, dir := range []string{root, outside, filepath.Join(root, "sub"), filepath.Join(root, "noidx")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		filepath.Join(root, "index.html"):        "<html>root index</html>",
		filepath.Join(root, "mock.html"):         "<html>mock</html>",
		filepath.Join(root, "style.css"):         "body{}",
		filepath.Join(root, "real.html"):         "<html>real</html>",
		filepath.Join(root, "sub", "index.html"): "<html>sub index</html>",
		filepath.Join(outside, "secret.txt"):     "TOP-SECRET-OUTSIDE-ROOT",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("./real.html", filepath.Join(root, "link.html")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "evil")); err != nil {
		t.Fatal(err)
	}
	return root, outside
}

// stubWindowOption installs the handler's tmux read seam, returning root for
// every read, and reports the (server, option) pairs it observed plus a call
// count (the invalid-windowId case must never reach tmux).
func stubWindowOption(t *testing.T, root string) (calls *int, servers *[]string) {
	t.Helper()
	n := 0
	seen := []string{}
	getWindowOptionFn = func(_ context.Context, _ /* windowID */, server, option string) (string, error) {
		n++
		seen = append(seen, server)
		if option != presentRootOption {
			t.Errorf("handler read option %q, want %q", option, presentRootOption)
		}
		return root, nil
	}
	// The seam is package-global, so restore the production default. This must
	// be the ONLY cleanup touching the seam — t.Cleanup runs LIFO, so a second
	// (e.g. nil-ing) cleanup registered before this one would run after it and
	// leave the package in a broken state for later tests.
	t.Cleanup(func() { getWindowOptionFn = defaultGetWindowOption })
	return &n, &seen
}

// defaultGetWindowOption mirrors the handler's default seam value so tests can
// restore it (the tmux import is already named in present.go; re-pointing here
// keeps the test file's restore honest even if the default changes).
var defaultGetWindowOption = getWindowOptionFn

func getPresent(t *testing.T, router http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestPresentServes(t *testing.T) {
	root, _ := presentFixture(t)
	stubWindowOption(t, root)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	tests := []struct {
		name       string
		path       string
		wantStatus int
		wantBody   string
		wantMIME   string
	}{
		{"plain html file", "/present/@7/mock.html?server=dev", 200, "<html>mock</html>", "text/html"},
		{"css file", "/present/@7/style.css", 200, "body{}", "text/css"},
		{"root dir serves index.html", "/present/@7/", 200, "<html>root index</html>", "text/html"},
		{"subdir serves its index.html", "/present/@7/sub/", 200, "<html>sub index</html>", "text/html"},
		{"dir without index is 404 not a listing", "/present/@7/noidx/", 404, "", ""},
		{"missing file is 404", "/present/@7/nope.html", 404, "", ""},
		{"intra-tree symlink serves", "/present/@7/link.html", 200, "<html>real</html>", "text/html"},
		{"dotdot traversal is 404", "/present/@7/../outside/secret.txt", 404, "", ""},
		{"deep dotdot traversal is 404", "/present/@7/sub/../../outside/secret.txt", 404, "", ""},
		{"encoded dotdot traversal is 404", "/present/@7/%2e%2e/outside/secret.txt", 404, "", ""},
		{"escaping symlink is 404", "/present/@7/evil/secret.txt", 404, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := getPresent(t, router, tc.path)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body: %q)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantBody != "" {
				if body := strings.TrimSpace(rec.Body.String()); body != tc.wantBody {
					t.Errorf("body = %q, want %q", body, tc.wantBody)
				}
				if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, tc.wantMIME) {
					t.Errorf("Content-Type = %q, want prefix %q", ct, tc.wantMIME)
				}
			}
			// The escape target's content must never appear, whatever the case.
			if strings.Contains(rec.Body.String(), "TOP-SECRET") {
				t.Error("response leaked a file outside the serve root")
			}
		})
	}
}

func TestPresentBareWindowRedirects(t *testing.T) {
	root, _ := presentFixture(t)
	stubWindowOption(t, root)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getPresent(t, router, "/present/@7?server=dev")
	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/present/@7/?server=dev" {
		t.Errorf("Location = %q, want /present/@7/?server=dev (query preserved)", loc)
	}
}

func TestPresentRootGate(t *testing.T) {
	root, _ := presentFixture(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	tests := []struct {
		name string
		root string // "" simulates an unset option (dead window reads empty)
	}{
		{"unset option is 404", ""},
		{"relative root is 404", "relative/dir"},
		{"nonexistent root is 404", filepath.Join(root, "ghost")},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			stubWindowOption(t, tc.root)
			rec := getPresent(t, router, "/present/@7/mock.html")
			if rec.Code != 404 {
				t.Errorf("status = %d, want 404", rec.Code)
			}
		})
	}
}

func TestPresentInvalidWindowIDNeverTouchesTmux(t *testing.T) {
	root, _ := presentFixture(t)
	calls, _ := stubWindowOption(t, root)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, path := range []string{"/present/7/mock.html", "/present/@x/mock.html", "/present/@/mock.html"} {
		rec := getPresent(t, router, path)
		if rec.Code == 200 {
			t.Errorf("GET %s = 200, want rejection", path)
		}
	}
	if *calls != 0 {
		t.Errorf("tmux read seam called %d times for invalid windowIds, want 0 (gate before subprocess)", *calls)
	}
}

func TestPresentServerParam(t *testing.T) {
	root, _ := presentFixture(t)
	_, servers := stubWindowOption(t, root)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	getPresent(t, router, "/present/@7/mock.html?server=dev")
	getPresent(t, router, "/present/@7/mock.html?server=bad%20name")
	getPresent(t, router, "/present/@7/mock.html")

	got := *servers
	want := []string{"dev", "default", "default"} // invalid/absent → default
	if len(got) != len(want) {
		t.Fatalf("servers seen = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("call %d server = %q, want %q", i, got[i], want[i])
		}
	}
}
