package codeserver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// releaseJSON builds a minimal GitHub releases/latest payload with one asset
// per code-server release platform pair.
func releaseJSON(tag, digest string) string {
	var assets []string
	for _, osLabel := range []string{"linux", "macos"} {
		for _, arch := range []string{"amd64", "arm64"} {
			name := fmt.Sprintf("code-server-%s-%s-%s.tar.gz", strings.TrimPrefix(tag, "v"), osLabel, arch)
			assets = append(assets, fmt.Sprintf(`{"name":%q,"browser_download_url":"BASE/dl/%s","digest":"sha256:%s"}`, name, name, digest))
		}
	}
	return fmt.Sprintf(`{"tag_name":%q,"assets":[%s]}`, tag, strings.Join(assets, ","))
}

// newReleaseServer serves the release listing at /repos/coder/code-server/
// releases/latest. The payload's BASE placeholder is rewritten to the server
// URL once it is known.
func newReleaseServer(t *testing.T, handler func(base string) http.Handler) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler(srv.URL).ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testInstaller(srv *httptest.Server, goos, goarch string) *Installer {
	ins := New()
	ins.APIBase = srv.URL
	ins.Client = srv.Client()
	ins.GOOS = goos
	ins.GOARCH = goarch
	return ins
}

func TestResolveLatestSelectsHostAsset(t *testing.T) {
	srv := newReleaseServer(t, func(base string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/repos/coder/code-server/releases/latest" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, strings.ReplaceAll(releaseJSON("v4.132.0", "abc123"), "BASE", base))
		})
	})

	for _, tc := range []struct {
		goos, goarch string
		wantAsset    string
	}{
		{"darwin", "arm64", "code-server-4.132.0-macos-arm64.tar.gz"},
		{"darwin", "amd64", "code-server-4.132.0-macos-amd64.tar.gz"},
		{"linux", "arm64", "code-server-4.132.0-linux-arm64.tar.gz"},
		{"linux", "amd64", "code-server-4.132.0-linux-amd64.tar.gz"},
	} {
		t.Run(tc.goos+"/"+tc.goarch, func(t *testing.T) {
			rel, err := testInstaller(srv, tc.goos, tc.goarch).resolveLatest(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if rel.Version != "4.132.0" {
				t.Errorf("Version = %q, want 4.132.0 (v-prefix stripped)", rel.Version)
			}
			if rel.AssetName != tc.wantAsset {
				t.Errorf("AssetName = %q, want %q", rel.AssetName, tc.wantAsset)
			}
			if rel.Digest != "abc123" {
				t.Errorf("Digest = %q, want abc123 (sha256: prefix stripped)", rel.Digest)
			}
			if !strings.HasPrefix(rel.AssetURL, srv.URL+"/dl/") {
				t.Errorf("AssetURL = %q, want under the API base", rel.AssetURL)
			}
		})
	}
}

func TestResolveLatestUnsupportedPlatform(t *testing.T) {
	srv := newReleaseServer(t, func(base string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("API must not be called for an unsupported platform")
			http.NotFound(w, r)
		})
	})
	for _, tc := range [][2]string{{"windows", "amd64"}, {"linux", "386"}} {
		if _, err := testInstaller(srv, tc[0], tc[1]).resolveLatest(context.Background()); err == nil {
			t.Errorf("%s/%s: want a clear error, got nil", tc[0], tc[1])
		} else if !strings.Contains(err.Error(), "unsupported platform") {
			t.Errorf("%s/%s: error = %v, want it to name the unsupported platform", tc[0], tc[1], err)
		}
	}
}

func TestResolveLatestMissingAsset(t *testing.T) {
	srv := newReleaseServer(t, func(base string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// A release listing every platform EXCEPT the requested one.
			fmt.Fprint(w, `{"tag_name":"v4.132.0","assets":[{"name":"code-server-4.132.0-linux-amd64.tar.gz","browser_download_url":"`+base+`/dl/x","digest":"sha256:aa"}]}`)
		})
	})
	_, err := testInstaller(srv, "darwin", "arm64").resolveLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no code-server-4.132.0-macos-arm64.tar.gz asset") {
		t.Errorf("err = %v, want a missing-asset error naming the asset", err)
	}
}

func TestResolveLatestAPIError(t *testing.T) {
	srv := newReleaseServer(t, func(base string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadGateway)
		})
	})
	_, err := testInstaller(srv, "linux", "amd64").resolveLatest(context.Background())
	if err == nil || !strings.Contains(err.Error(), "HTTP 502") {
		t.Errorf("err = %v, want the API status surfaced", err)
	}
}
