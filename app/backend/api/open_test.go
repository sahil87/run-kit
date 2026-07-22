package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/wt"
)

// mockWtOps stubs the WtOps seam for the open handlers.
type mockWtOps struct {
	apps    []wt.App
	listErr error

	openCalled bool
	openPath   string
	openApp    string
	openErr    error
}

func (m *mockWtOps) ListApps(ctx context.Context) ([]wt.App, error) {
	return m.apps, m.listErr
}

func (m *mockWtOps) Open(ctx context.Context, path, app string) error {
	m.openCalled = true
	m.openPath = path
	m.openApp = app
	return m.openErr
}

// openTestSessions is a snapshot with one window: worktree path
// /Users/x/code/proj, active pane cwd /Users/x/code/proj/sub.
func openTestSessions() []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{
			Name: "proj",
			Windows: []tmux.WindowInfo{
				{
					WindowID:     "@1",
					Name:         "main",
					WorktreePath: "/Users/x/code/proj",
					Panes: []tmux.PaneInfo{
						{PaneID: "%1", Cwd: "/Users/x/code/proj/sub", IsActive: true},
					},
				},
			},
		},
	}
}

func newOpenTestRouter(t *testing.T, wtOps WtOps, sf SessionFetcher) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	return NewTestRouterWithWt(logger, sf, nil, wtOps, "test-host")
}

func TestOpenAppsEndpoint(t *testing.T) {
	t.Run("returns the registry", func(t *testing.T) {
		wtOps := &mockWtOps{apps: []wt.App{
			{ID: "vscode", Label: "VS Code", Kind: "editor"},
			{ID: "iterm", Label: "iTerm", Kind: "terminal"},
		}}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{})

		req := httptest.NewRequest(http.MethodGet, "/api/open-apps", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var got []wt.App
		if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(got) != 2 || got[0].ID != "vscode" || got[1].ID != "iterm" {
			t.Errorf("apps = %+v", got)
		}
	})

	t.Run("degrades to 200 [] when the wrapper errors (wt absent/old)", func(t *testing.T) {
		wtOps := &mockWtOps{listErr: errors.New("exec: wt: not found")}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{})

		req := httptest.NewRequest(http.MethodGet, "/api/open-apps", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if body := rec.Body.String(); body != "[]\n" {
			t.Errorf("body = %q, want []", body)
		}
	})

	t.Run("degrades to 200 [] for a nil registry", func(t *testing.T) {
		wtOps := &mockWtOps{apps: nil}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{})

		req := httptest.NewRequest(http.MethodGet, "/api/open-apps", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK || rec.Body.String() != "[]\n" {
			t.Errorf("status = %d body = %q, want 200 []", rec.Code, rec.Body.String())
		}
	})
}

func postOpen(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/open", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestOpenEndpoint(t *testing.T) {
	registry := []wt.App{{ID: "vscode", Label: "VS Code", Kind: "editor"}}

	t.Run("launches a validated pane cwd", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj/sub","app":"vscode"}`)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if !wtOps.openCalled || wtOps.openPath != "/Users/x/code/proj/sub" || wtOps.openApp != "vscode" {
			t.Errorf("open call = %v %q %q", wtOps.openCalled, wtOps.openPath, wtOps.openApp)
		}
	})

	t.Run("launches a validated worktree path", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj","app":"vscode"}`)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if !wtOps.openCalled {
			t.Error("wrapper Open not called")
		}
	})

	t.Run("rejects invalid JSON", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{not json`)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if wtOps.openCalled {
			t.Error("Open must not be called on invalid JSON")
		}
	})

	t.Run("rejects an empty path", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"","app":"vscode"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("rejects a relative path", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"code/proj","app":"vscode"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("rejects a path not derived from panes or worktrees", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/etc","app":"vscode"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("rejects a parent of a derived path (exact-match allowlist)", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code","app":"vscode"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("rejects an app id not in the registry", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj","app":"emacs"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("rejects every app when the registry errors (no blind launch)", func(t *testing.T) {
		wtOps := &mockWtOps{listErr: errors.New("wt too old")}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj","app":"vscode"}`)

		if rec.Code != http.StatusBadRequest || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 400/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("500 when the session snapshot fails", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{err: errors.New("tmux down")})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj","app":"vscode"}`)

		if rec.Code != http.StatusInternalServerError || wtOps.openCalled {
			t.Fatalf("status = %d openCalled = %v, want 500/false", rec.Code, wtOps.openCalled)
		}
	})

	t.Run("502 when the launch itself fails", func(t *testing.T) {
		wtOps := &mockWtOps{apps: registry, openErr: errors.New("launch failed")}
		router := newOpenTestRouter(t, wtOps, &mockSessionFetcher{result: openTestSessions()})

		rec := postOpen(t, router, `{"path":"/Users/x/code/proj","app":"vscode"}`)

		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
	})
}

func TestPathDerivedFromSessions(t *testing.T) {
	snapshot := openTestSessions()

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"pane cwd exact", "/Users/x/code/proj/sub", true},
		{"worktree path exact", "/Users/x/code/proj", true},
		{"trailing slash normalizes", "/Users/x/code/proj/", true},
		{"dot segments normalize", "/Users/x/code/proj/sub/../sub", true},
		{"parent rejected", "/Users/x/code", false},
		{"child rejected", "/Users/x/code/proj/sub/deeper", false},
		{"traversal out rejected", "/Users/x/code/proj/../../../etc", false},
		{"unrelated rejected", "/etc", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pathDerivedFromSessions(snapshot, tc.path); got != tc.want {
				t.Errorf("pathDerivedFromSessions(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}
