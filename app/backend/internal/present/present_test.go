package present

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixedNow pins the cache-buster so URL derivations are deterministic.
func fixedNow() int64 { return 1700000000 }

func TestParseTarget_fileAndDir(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "mock.html")
	if err := os.WriteFile(file, []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		arg      string
		cwd      string
		wantKind Kind
		wantRoot string
		wantName string
	}{
		{"absolute file", file, dir, KindFile, dir, "mock.html"},
		{"relative file from cwd", "mock.html", dir, KindFile, dir, "mock.html"},
		{"dot-relative file", "./mock.html", dir, KindFile, dir, "mock.html"},
		{"absolute dir", dir, dir, KindDir, dir, filepath.Base(dir)},
		{"relative dir", ".", dir, KindDir, dir, filepath.Base(dir)},
		{"trailing-slash dir", dir + "/", dir, KindDir, dir, filepath.Base(dir)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseTarget(tc.arg, tc.cwd)
			if err != nil {
				t.Fatalf("ParseTarget(%q): %v", tc.arg, err)
			}
			if got.Kind != tc.wantKind {
				t.Errorf("kind = %v, want %v", got.Kind, tc.wantKind)
			}
			if got.Root != tc.wantRoot {
				t.Errorf("root = %q, want %q", got.Root, tc.wantRoot)
			}
			if got.Name != tc.wantName {
				t.Errorf("name = %q, want %q", got.Name, tc.wantName)
			}
		})
	}
}

func TestParseTarget_nonexistentPathErrors(t *testing.T) {
	_, err := ParseTarget(filepath.Join(t.TempDir(), "nope.html"), "/")
	if err == nil {
		t.Fatal("ParseTarget of a nonexistent path: err = nil, want error")
	}
	if !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("error %q does not name the missing target", err)
	}
}

func TestParseTarget_portForm(t *testing.T) {
	got, err := ParseTarget(":5173", "/")
	if err != nil {
		t.Fatalf("ParseTarget(\":5173\"): %v", err)
	}
	if got.Kind != KindPort || got.Port != 5173 {
		t.Errorf("got %+v, want KindPort port 5173", got)
	}
	if got.Name != "port-5173" {
		t.Errorf("name = %q, want port-5173", got.Name)
	}
	if u := got.URL("@7", "dev", fixedNow); u != "/proxy/5173/" {
		t.Errorf("url = %q, want /proxy/5173/", u)
	}

	for _, bad := range []string{":0", ":65536", ":abc", ":"} {
		if _, err := ParseTarget(bad, "/"); err == nil {
			t.Errorf("ParseTarget(%q): err = nil, want error", bad)
		}
	}
}

func TestParseTarget_localURLs(t *testing.T) {
	tests := []struct {
		arg      string
		wantPort int
		wantPQ   string
		wantURL  string
	}{
		{"http://localhost:8080/docs?x=1", 8080, "/docs?x=1", "/proxy/8080/docs?x=1"},
		{"http://localhost:8080", 8080, "/", "/proxy/8080/"},
		{"http://localhost/app", 80, "/app", "/proxy/80/app"},
		{"http://127.0.0.1:3000", 3000, "/", "/proxy/3000/"},
		{"http://[::1]:9000/a/b?y=2&z=3", 9000, "/a/b?y=2&z=3", "/proxy/9000/a/b?y=2&z=3"},
	}
	for _, tc := range tests {
		t.Run(tc.arg, func(t *testing.T) {
			got, err := ParseTarget(tc.arg, "/")
			if err != nil {
				t.Fatalf("ParseTarget(%q): %v", tc.arg, err)
			}
			if got.Kind != KindLocalURL {
				t.Fatalf("kind = %v, want KindLocalURL", got.Kind)
			}
			if got.Port != tc.wantPort {
				t.Errorf("port = %d, want %d", got.Port, tc.wantPort)
			}
			if got.PathQuery != tc.wantPQ {
				t.Errorf("pathQuery = %q, want %q", got.PathQuery, tc.wantPQ)
			}
			if u := got.URL("@7", "dev", fixedNow); u != tc.wantURL {
				t.Errorf("url = %q, want %q (relative form, never an absolute origin)", u, tc.wantURL)
			}
		})
	}
}

func TestParseTarget_externalURLsVerbatim(t *testing.T) {
	for _, arg := range []string{
		"https://staging.example.com/app",
		"https://staging.example.com",
		"http://192.168.1.20:8080/lan", // non-localhost http attaches verbatim
		"https://localhost:8443/",      // https-to-localhost is not proxied
	} {
		t.Run(arg, func(t *testing.T) {
			got, err := ParseTarget(arg, "/")
			if err != nil {
				t.Fatalf("ParseTarget(%q): %v", arg, err)
			}
			if got.Kind != KindExternalURL {
				t.Fatalf("kind = %v, want KindExternalURL", got.Kind)
			}
			if u := got.URL("@7", "dev", fixedNow); u != arg {
				t.Errorf("url = %q, want verbatim %q", u, arg)
			}
			if got.Root != "" {
				t.Errorf("root = %q, want empty (no serving for URL targets)", got.Root)
			}
		})
	}
}

func TestTargetURL_presentForms(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "mock.html")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	ft, err := ParseTarget(file, "/")
	if err != nil {
		t.Fatal(err)
	}
	if u, want := ft.URL("@7", "dev", fixedNow), "/present/@7/mock.html?server=dev&v=1700000000"; u != want {
		t.Errorf("file url = %q, want %q", u, want)
	}
	if !ft.NeedsRoot() {
		t.Error("file target NeedsRoot = false, want true")
	}

	dt, err := ParseTarget(dir, "/")
	if err != nil {
		t.Fatal(err)
	}
	if u, want := dt.URL("@12", "default", fixedNow), "/present/@12/?server=default&v=1700000000"; u != want {
		t.Errorf("dir url = %q, want %q", u, want)
	}

	// Port/URL targets carry no buster and no root.
	pt, err := ParseTarget(":5173", "/")
	if err != nil {
		t.Fatal(err)
	}
	if pt.NeedsRoot() {
		t.Error("port target NeedsRoot = true, want false")
	}
	if u := pt.URL("@7", "dev", fixedNow); strings.Contains(u, "v=") {
		t.Errorf("port url %q carries a cache-buster, want none", u)
	}
}

// TestTargetURL_rePresentBumpsOnlyV pins the refresh-verb contract: two
// invocations of the same file target differ ONLY in the v= value.
func TestTargetURL_rePresentBumpsOnlyV(t *testing.T) {
	tgt := Target{Kind: KindFile, Root: "/x", Name: "a b.html"}
	first := tgt.URL("@7", "dev", func() int64 { return 100 })
	second := tgt.URL("@7", "dev", func() int64 { return 200 })
	if first == second {
		t.Fatal("re-present produced identical URLs — the buster must change")
	}
	if strings.TrimSuffix(first, "100") != strings.TrimSuffix(second, "200") {
		t.Errorf("URLs differ beyond v=: %q vs %q", first, second)
	}
	if !strings.Contains(first, "a%20b.html") {
		t.Errorf("file basename not path-escaped: %q", first)
	}
}

func TestProbePort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	if err := ProbePort(context.Background(), port); err != nil {
		t.Errorf("ProbePort on a listening port: %v", err)
	}

	// 59999 is outside every ephemeral range in practice; guard against the
	// freak collision by binding nothing and expecting refusal/timeout.
	if err := ProbePort(context.Background(), 59999); err == nil {
		t.Error("ProbePort on a dead port: err = nil, want failure")
	} else if !strings.Contains(err.Error(), "59999") {
		t.Errorf("probe error %q does not name the port", err)
	}
}

func TestNeedsProbe(t *testing.T) {
	cases := map[Kind]bool{
		KindFile:        false,
		KindDir:         false,
		KindPort:        true,
		KindLocalURL:    true,
		KindExternalURL: false,
	}
	for k, want := range cases {
		if got := (Target{Kind: k}).NeedsProbe(); got != want {
			t.Errorf("Kind(%v).NeedsProbe() = %v, want %v", k, got, want)
		}
	}
}
