package desktop

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// releaseJSON is a canned GitHub release document with per-arch DMG assets
// (plus a non-DMG asset that must never match).
const releaseJSON = `{
  "tag_name": "v3.13.0",
  "assets": [
    {"name": "run-kit-desktop-3.13.0-arm64.dmg",
     "browser_download_url": "https://example.invalid/arm64.dmg",
     "digest": "sha256:aabbcc"},
    {"name": "run-kit-desktop-3.13.0-x64.dmg",
     "browser_download_url": "https://example.invalid/x64.dmg",
     "digest": "sha256:ddeeff"},
    {"name": "run-kit-desktop-3.13.0-arm64.dmg.blockmap",
     "browser_download_url": "https://example.invalid/arm64.dmg.blockmap"}
  ]
}`

// newTestInstaller returns an Installer pointed at the given httptest server
// with a runner that fails the test if any subprocess runs.
func newTestInstaller(t *testing.T, srv *httptest.Server) *Installer {
	t.Helper()
	ins := New()
	ins.Client = srv.Client()
	ins.APIBase = srv.URL
	ins.Token = ""
	ins.Run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		t.Fatalf("unexpected subprocess: %s %v", name, args)
		return nil, nil
	}
	return ins
}

func TestResolveReleaseLatestSelectsArchAsset(t *testing.T) {
	cases := []struct {
		goarch, wantAsset, wantDigest string
	}{
		{"arm64", "run-kit-desktop-3.13.0-arm64.dmg", "aabbcc"},
		{"amd64", "run-kit-desktop-3.13.0-x64.dmg", "ddeeff"},
	}
	for _, tc := range cases {
		t.Run(tc.goarch, func(t *testing.T) {
			var gotPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				w.Write([]byte(releaseJSON))
			}))
			defer srv.Close()

			ins := newTestInstaller(t, srv)
			ins.Arch = tc.goarch
			rel, err := ins.ResolveRelease(context.Background(), "")
			if err != nil {
				t.Fatalf("ResolveRelease: %v", err)
			}
			if gotPath != "/repos/sahil87/run-kit/releases/latest" {
				t.Errorf("request path = %q, want /repos/sahil87/run-kit/releases/latest", gotPath)
			}
			if rel.Version != "3.13.0" {
				t.Errorf("version = %q, want 3.13.0", rel.Version)
			}
			if rel.AssetName != tc.wantAsset {
				t.Errorf("asset = %q, want %q", rel.AssetName, tc.wantAsset)
			}
			if rel.Digest != tc.wantDigest {
				t.Errorf("digest = %q, want %q", rel.Digest, tc.wantDigest)
			}
		})
	}
}

func TestResolveReleaseTagNormalizesBareSemver(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write([]byte(releaseJSON))
	}))
	defer srv.Close()

	ins := newTestInstaller(t, srv)
	ins.Arch = "arm64"
	if _, err := ins.ResolveRelease(context.Background(), "3.13.0"); err != nil {
		t.Fatalf("ResolveRelease: %v", err)
	}
	if gotPath != "/repos/sahil87/run-kit/releases/tags/v3.13.0" {
		t.Errorf("request path = %q, want the v-prefixed tag endpoint", gotPath)
	}
}

func TestResolveReleaseSendsTokenWhenSet(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(releaseJSON))
	}))
	defer srv.Close()

	ins := newTestInstaller(t, srv)
	ins.Arch = "arm64"
	ins.Token = "tok123"
	if _, err := ins.ResolveRelease(context.Background(), ""); err != nil {
		t.Fatalf("ResolveRelease: %v", err)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("Authorization = %q, want Bearer tok123", gotAuth)
	}
}

func TestResolveReleaseRateLimitError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	ins := newTestInstaller(t, srv)
	ins.Arch = "arm64"
	_, err := ins.ResolveRelease(context.Background(), "")
	if err == nil {
		t.Fatal("expected a rate-limit error, got nil")
	}
	if !strings.Contains(err.Error(), "rate limit") || !strings.Contains(err.Error(), "GITHUB_TOKEN") {
		t.Errorf("error %q should mention the rate limit and GITHUB_TOKEN", err)
	}
}

func TestResolveReleaseTagNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	ins := newTestInstaller(t, srv)
	ins.Arch = "arm64"
	_, err := ins.ResolveRelease(context.Background(), "v9.9.9")
	if err == nil || !strings.Contains(err.Error(), "release v9.9.9 not found") {
		t.Errorf("error = %v, want a release-not-found error naming the tag", err)
	}
}

func TestResolveReleaseMissingArchAsset(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"tag_name": "v3.13.0", "assets": []}`))
	}))
	defer srv.Close()

	ins := newTestInstaller(t, srv)
	ins.Arch = "arm64"
	_, err := ins.ResolveRelease(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "no arm64 DMG asset") {
		t.Errorf("error = %v, want a missing-asset error naming the arch", err)
	}
}

func TestResolveReleaseUnsupportedArch(t *testing.T) {
	ins := New()
	ins.Arch = "riscv64"
	_, err := ins.ResolveRelease(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "unsupported architecture") {
		t.Errorf("error = %v, want an unsupported-architecture error", err)
	}
}

func TestParseSHA256Digest(t *testing.T) {
	cases := []struct{ in, want string }{
		{"sha256:abc123", "abc123"},
		{"", ""},
		{"md5:abc123", ""},
	}
	for _, tc := range cases {
		if got := parseSHA256Digest(tc.in); got != tc.want {
			t.Errorf("parseSHA256Digest(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
