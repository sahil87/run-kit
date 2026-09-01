package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/tmux"
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
		// Slot 1 reads its own root, then (only when that is empty) the retired
		// @rk_win_present_root — both are legitimate slot-1 reads.
		if option != tmux.WebTabRootOption(1) && option != tmux.LegacyWinPresentRootOption {
			t.Errorf("handler read option %q, want %q or %q", option, tmux.WebTabRootOption(1), tmux.LegacyWinPresentRootOption)
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

// retire-with: present-nless-compat
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

// TestPresentIndexedSlot verifies the slot sniff: an indexed form reads
// @rk_win_web_<n>_root, the n-less form reads slot 1, and an out-of-range slot
// segment ("9") is treated as a FILE NAME under slot 1 — never a root read
// outside 1..8.
func TestPresentIndexedSlot(t *testing.T) {
	root, _ := presentFixture(t)
	var option string
	getWindowOptionFn = func(_ context.Context, _ /* windowID */, server, opt string) (string, error) {
		option = opt
		return root, nil
	}
	t.Cleanup(func() { getWindowOptionFn = defaultGetWindowOption })
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getPresent(t, router, "/present/@7/2/mock.html")
	if rec.Code != 200 {
		t.Fatalf("indexed form status = %d, want 200 (body: %q)", rec.Code, rec.Body.String())
	}
	if want := tmux.WebTabRootOption(2); option != want {
		t.Errorf("indexed form read option %q, want %q", option, want)
	}

	rec = getPresent(t, router, "/present/@7/mock.html")
	if rec.Code != 200 {
		t.Fatalf("n-less form status = %d, want 200 (body: %q)", rec.Code, rec.Body.String())
	}
	if want := tmux.WebTabRootOption(1); option != want {
		t.Errorf("n-less form read option %q, want %q", option, want)
	}

	// "9" is not a slot (gate is ^[1-8]$): the request is the file "9/x.html"
	// under slot 1 — it must read ONLY the slot-1 root and 404 on the missing
	// file.
	rec = getPresent(t, router, "/present/@7/9/x.html")
	if rec.Code != 404 {
		t.Errorf("out-of-range slot status = %d, want 404", rec.Code)
	}
	if want := tmux.WebTabRootOption(1); option != want {
		t.Errorf("out-of-range slot read option %q, want %q (slot-1 root only)", option, want)
	}
}

// TestPresentLegacyRootFallback: slot 1 with an empty @rk_win_web_1_root falls
// back to the retired @rk_win_present_root (live-stamped by external writers);
// an indexed slot other than 1 never does.
// retire-with: present-nless-compat
func TestPresentLegacyRootFallback(t *testing.T) {
	root, _ := presentFixture(t)
	var reads []string
	getWindowOptionFn = func(_ context.Context, _ /* windowID */, _ string, opt string) (string, error) {
		reads = append(reads, opt)
		if opt == tmux.LegacyWinPresentRootOption {
			return root, nil
		}
		return "", nil
	}
	t.Cleanup(func() { getWindowOptionFn = defaultGetWindowOption })
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getPresent(t, router, "/present/@7/mock.html")
	if rec.Code != 200 {
		t.Fatalf("n-less form with legacy root status = %d, want 200 (body: %q)", rec.Code, rec.Body.String())
	}
	want := []string{tmux.WebTabRootOption(1), tmux.LegacyWinPresentRootOption}
	if strings.Join(reads, ",") != strings.Join(want, ",") {
		t.Errorf("reads = %v, want %v", reads, want)
	}

	reads = nil
	rec = getPresent(t, router, "/present/@7/2/mock.html")
	if rec.Code != 404 {
		t.Errorf("slot 2 with empty root status = %d, want 404 (no legacy fallback)", rec.Code)
	}
	if len(reads) != 1 || reads[0] != tmux.WebTabRootOption(2) {
		t.Errorf("slot-2 reads = %v, want only %q", reads, tmux.WebTabRootOption(2))
	}
}

// TestPresentIndexedBareRedirects: a bare indexed form (/present/@7/2) gets the
// same 308 trailing-slash redirect as the n-less form.
func TestPresentIndexedBareRedirects(t *testing.T) {
	root, _ := presentFixture(t)
	stubWindowOption(t, root)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getPresent(t, router, "/present/@7/2?server=dev")
	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/present/@7/2/?server=dev" {
		t.Errorf("Location = %q, want /present/@7/2/?server=dev (query preserved)", loc)
	}
}

// rootHash derives the test's composed hash segment for a root — the same
// full-digest-then-prefix-matched sha256 the handler's new arm uses, pinned
// at the composed 12-hex length.
func rootHash(root string) string {
	sum := sha256.Sum256([]byte(root))
	return hex.EncodeToString(sum[:])[:12]
}

// stubDeclaredRoots installs the new arm's tmux read seam, returning the
// given roots for every call, and reports the servers it observed plus a
// call count (malformed-segment cases must never reach tmux).
func stubDeclaredRoots(t *testing.T, roots []string) (calls *int, servers *[]string) {
	t.Helper()
	n := 0
	seen := []string{}
	listDeclaredWebRootsFn = func(_ context.Context, server string) ([]string, error) {
		n++
		seen = append(seen, server)
		return roots, nil
	}
	t.Cleanup(func() { listDeclaredWebRootsFn = defaultListDeclaredWebRoots })
	return &n, &seen
}

// defaultListDeclaredWebRoots mirrors the handler's default seam value so
// tests can restore it (the tmux import is already named in present.go).
var defaultListDeclaredWebRoots = listDeclaredWebRootsFn

// TestPresentContentKeyed covers the new arm's resolution matrix: serving
// through a declared root, prefix-length variants, ambiguity fail-closed,
// undeclared roots, malformed segments (400 before any tmux call), the dir
// redirect + index.html, containment regression, and the legacy-arm
// regression (R4) that proves the legacy form still serves verbatim.
func TestPresentContentKeyed(t *testing.T) {
	root, _ := presentFixture(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// hash12 is the composed 12-hex segment for root; the 8-hex prefix is a
	// valid route-level prefix of the same digest.
	hash12 := rootHash(root)
	hash8 := hash12[:8]

	tests := []struct {
		name       string
		path       string
		roots      []string // what the stubbed declared-root enumeration returns
		wantStatus int
		wantBody   string
		wantMIME   string
	}{
		{"serves via a declared root", "/present/dev/" + hash12 + "/mock.html", []string{root}, 200, "<html>mock</html>", "text/html"},
		{"8-hex prefix resolves", "/present/dev/" + hash8 + "/mock.html", []string{root}, 200, "<html>mock</html>", "text/html"},
		{"64-hex full digest resolves", "/present/dev/" + func() string {
			sum := sha256.Sum256([]byte(root))
			return hex.EncodeToString(sum[:])
		}() + "/mock.html", []string{root}, 200, "<html>mock</html>", "text/html"},
		{"root dir serves index.html", "/present/dev/" + hash12 + "/", []string{root}, 200, "<html>root index</html>", "text/html"},
		{"subdir serves its index.html", "/present/dev/" + hash12 + "/sub/", []string{root}, 200, "<html>sub index</html>", "text/html"},
		{"missing file is 404", "/present/dev/" + hash12 + "/nope.html", []string{root}, 404, "", ""},
		{"dir without index is 404 not a listing", "/present/dev/" + hash12 + "/noidx/", []string{root}, 404, "", ""},
		{"intra-tree symlink serves", "/present/dev/" + hash12 + "/link.html", []string{root}, 200, "<html>real</html>", "text/html"},
		{"dotdot traversal is 404", "/present/dev/" + hash12 + "/../outside/secret.txt", []string{root}, 404, "", ""},
		{"encoded dotdot traversal is 404", "/present/dev/" + hash12 + "/%2e%2e/outside/secret.txt", []string{root}, 404, "", ""},
		{"escaping symlink is 404", "/present/dev/" + hash12 + "/evil/secret.txt", []string{root}, 404, "", ""},
		{"undeclared root is 404", "/present/dev/" + hash12 + "/mock.html", []string{}, 404, "", ""},
		{"different declared root is 404", "/present/dev/" + hash12 + "/mock.html", []string{filepath.Join(root, "other")}, 404, "", ""},
		{"bad server segment is 400", "/present/bad%20name/" + hash12 + "/mock.html", []string{root}, 400, "", ""},
		{"short hash is 400", "/present/dev/3f9a2c/mock.html", []string{root}, 400, "", ""},
		{"non-hex hash is 400", "/present/dev/zz9a2c8e1b77/mock.html", []string{root}, 400, "", ""},
		{"overlong hash is 400", "/present/dev/" + hash12 + "fffffffffffffffffffffffffffffffffffffffffffffffffffffffff/mock.html", []string{root}, 400, "", ""},
		// Ambiguity: the same root enumerated twice still fails closed
		// (two matches for one prefix → 404 — the handler counts matches,
		// production dedupes before enumerating).
		{"ambiguous prefix is 404", "/present/dev/" + hash8 + "/mock.html",
			[]string{root, root}, 404, "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			stubDeclaredRoots(t, tc.roots)
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
			if strings.Contains(rec.Body.String(), "TOP-SECRET") {
				t.Error("response leaked a file outside the serve root")
			}
		})
	}
}

// TestPresentContentKeyedBareRedirects: the slash-less directory form
// (/present/{server}/{hash}) 308-redirects to the trailing-slash form with
// the query preserved — the same rule as the legacy arm.
func TestPresentContentKeyedBareRedirects(t *testing.T) {
	root, _ := presentFixture(t)
	stubDeclaredRoots(t, []string{root})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := getPresent(t, router, "/present/dev/"+rootHash(root)+"?v=1")
	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/present/dev/"+rootHash(root)+"/?v=1" {
		t.Errorf("Location = %q, want /present/dev/%s/?v=1 (query preserved)", loc, rootHash(root))
	}
}

// TestPresentContentKeyedBadSegmentsNeverTouchTmux: malformed server or hash
// segments are rejected 400 BEFORE any tmux call (Constitution I — the gate
// runs before the subprocess).
func TestPresentContentKeyedBadSegmentsNeverTouchTmux(t *testing.T) {
	root, _ := presentFixture(t)
	calls, _ := stubDeclaredRoots(t, []string{root})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, path := range []string{
		"/present/bad%20name/" + rootHash(root) + "/mock.html",
		"/present/dev/short/mock.html",
		"/present/dev/not-hex-12/mock.html",
	} {
		rec := getPresent(t, router, path)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400", path, rec.Code)
		}
	}
	if *calls != 0 {
		t.Errorf("tmux read seam called %d times for malformed segments, want 0 (gate before subprocess)", *calls)
	}
}

// TestPresentContentKeyedServerParam: the path-derived server name reaches
// the root enumeration (the ?server= query param is ignored on the new form).
func TestPresentContentKeyedServerParam(t *testing.T) {
	root, _ := presentFixture(t)
	_, servers := stubDeclaredRoots(t, []string{root})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	getPresent(t, router, "/present/dev/"+rootHash(root)+"/mock.html")
	getPresent(t, router, "/present/other/"+rootHash(root)+"/mock.html?server=ignored")

	got := *servers
	want := []string{"dev", "other"}
	if len(got) != len(want) {
		t.Fatalf("servers seen = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("call %d server = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestPresentLegacyArmVerbatim proves R4: a stored pre-change
// /present/@N/{n}/{path}?server= URL serves unchanged through the legacy arm
// after the change ships (same root read, same containment, same 404
// posture). One row covering the n-less and indexed forms, the slot-1
// @rk_win_present_root dual-read, and the bad-windowId 400.
func TestPresentLegacyArmVerbatim(t *testing.T) {
	root, _ := presentFixture(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// n-less and indexed forms resolve against the same slot-1 dual-read.
	var reads []string
	getWindowOptionFn = func(_ context.Context, _ /* windowID */, _ string, opt string) (string, error) {
		reads = append(reads, opt)
		if opt == tmux.LegacyWinPresentRootOption {
			return root, nil
		}
		return "", nil
	}
	t.Cleanup(func() { getWindowOptionFn = defaultGetWindowOption })

	rec := getPresent(t, router, "/present/@7/mock.html?server=dev")
	if rec.Code != 200 {
		t.Fatalf("n-less legacy form status = %d, want 200 (body: %q)", rec.Code, rec.Body.String())
	}
	if body := strings.TrimSpace(rec.Body.String()); body != "<html>mock</html>" {
		t.Errorf("body = %q, want <html>mock</html>", body)
	}
	want := []string{tmux.WebTabRootOption(1), tmux.LegacyWinPresentRootOption}
	if strings.Join(reads, ",") != strings.Join(want, ",") {
		t.Errorf("reads = %v, want %v", reads, want)
	}

	// Bad windowId on the legacy arm is still a 400 before any tmux call.
	reads = nil
	rec = getPresent(t, router, "/present/@x/mock.html")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("bad windowId status = %d, want 400", rec.Code)
	}
	if len(reads) != 0 {
		t.Errorf("tmux reads on bad windowId = %v, want none", reads)
	}
}
