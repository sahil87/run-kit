package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/snapshot"
)

// recoverySnap builds a minimal one-session/one-window snapshot for the
// recovery handler tests.
func recoverySnap(server string, takenAt time.Time, command string) *snapshot.Snapshot {
	return &snapshot.Snapshot{
		Server:  server,
		TakenAt: takenAt,
		Sessions: []snapshot.Session{{
			Name:      "s1",
			CreatedAt: 100,
			Color:     "blue",
			Windows: []snapshot.Window{{
				Index: 1, ID: "@1", Name: "w1",
				Panes: []snapshot.Pane{{ID: "%0", Index: 0, Cwd: "/tmp", Command: command}},
			}},
		}},
	}
}

func TestHandleRecoveryList_NilStore(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	router := NewTestRouter(logger, nil, &serversTmuxMock{}, "test-host")

	req := httptest.NewRequest("GET", "/api/recovery", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"offers":[]}` {
		t.Fatalf("body = %q, want {\"offers\":[]} (empty list, not null)", body)
	}
}

func TestHandleRecoveryList_Offers(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	store := snapshot.NewStore(t.TempDir())
	if _, err := store.Write(recoverySnap("kit", base, "claude -c")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(recoverySnap("rk-daemon", base, "serve")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(recoverySnap("old", base, "zsh")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tombstone("old", base.Add(time.Hour), false); err != nil {
		t.Fatal(err)
	}

	mock := &serversTmuxMock{servers: []string{"dev"}}
	s := &Server{logger: logger, tmux: mock, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	req := httptest.NewRequest("GET", "/api/recovery", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var got recoveryOffersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Offers) != 1 {
		t.Fatalf("offers = %+v, want exactly [kit]", got.Offers)
	}
	o := got.Offers[0]
	if o.Server != "kit" || o.SessionCount != 1 || o.WindowCount != 1 {
		t.Errorf("offer = %+v, want kit 1/1", o)
	}
	if len(o.Sessions) != 1 || o.Sessions[0].Name != "s1" || o.Sessions[0].Color != "blue" {
		t.Errorf("sessions = %+v", o.Sessions)
	}
	w := o.Sessions[0].Windows[0]
	if !w.Resumable || len(w.Commands) != 1 || w.Commands[0] != "claude -c" {
		t.Errorf("window = %+v, want resumable with [claude -c]", w)
	}

	// Once the server is live, the offer disappears.
	mock.servers = []string{"dev", "kit"}
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/recovery", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Offers) != 0 {
		t.Fatalf("offers with kit live = %+v, want none", got.Offers)
	}
}

func TestHandleRecoveryRestore_ValidationBeforeAnyAccess(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	store := snapshot.NewStore(t.TempDir())
	if _, err := store.Write(recoverySnap("kit", base, "zsh")); err != nil {
		t.Fatal(err)
	}

	restoreCalls := 0
	orig := restoreSnapshotFn
	restoreSnapshotFn = func(ctx context.Context, server string, snap *snapshot.Snapshot) (*snapshot.Report, error) {
		restoreCalls++
		return &snapshot.Report{Server: server}, nil
	}
	t.Cleanup(func() { restoreSnapshotFn = orig })

	s := &Server{logger: logger, tmux: &serversTmuxMock{}, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	for _, body := range []string{`{"server":"../x"}`, `{"server":"a.b"}`, `{"server":""}`, `not-json`} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/restore", strings.NewReader(body)))
		if rec.Code != 400 {
			t.Errorf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
	if restoreCalls != 0 {
		t.Errorf("restore engine called %d times, want 0 (validation first)", restoreCalls)
	}
	// The store was never mutated.
	if snap, err := store.LoadLatest("kit"); err != nil || snap == nil {
		t.Errorf("store touched by rejected requests: snap=%v err=%v", snap, err)
	}
}

func TestHandleRecoveryRestore_Success(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	store := snapshot.NewStore(t.TempDir())
	if _, err := store.Write(recoverySnap("kit", base, "zsh")); err != nil {
		t.Fatal(err)
	}

	orig := restoreSnapshotFn
	restoreSnapshotFn = func(ctx context.Context, server string, snap *snapshot.Snapshot) (*snapshot.Report, error) {
		if server != "kit" || snap == nil || snap.Server != "kit" {
			t.Errorf("engine args = %q %+v, want kit snapshot", server, snap)
		}
		if _, ok := ctx.Deadline(); !ok {
			t.Error("engine context carries no deadline (the ~60s restore bound)")
		}
		return &snapshot.Report{
			Server: server,
			Sessions: []snapshot.RestoredSession{{
				Name: "s1",
				Windows: []snapshot.RestoredWindow{{
					Index: 1, Name: "w1", Panes: 1, FormerCommands: []string{"zsh"},
				}},
			}},
		}, nil
	}
	t.Cleanup(func() { restoreSnapshotFn = orig })

	s := &Server{logger: logger, tmux: &serversTmuxMock{}, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/restore", strings.NewReader(`{"server":"kit"}`)))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var report snapshot.Report
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if report.Server != "kit" || len(report.Sessions) != 1 || report.Sessions[0].Windows[0].FormerCommands[0] != "zsh" {
		t.Errorf("report = %+v", report)
	}
}

func TestHandleRecoveryRestore_EngineErrorSurfaces(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	store := snapshot.NewStore(t.TempDir())
	if _, err := store.Write(recoverySnap("kit", base, "zsh")); err != nil {
		t.Fatal(err)
	}

	orig := restoreSnapshotFn
	restoreSnapshotFn = func(ctx context.Context, server string, snap *snapshot.Snapshot) (*snapshot.Report, error) {
		return nil, errors.New(`server "kit" is alive with 2 session(s) — refusing to restore over it`)
	}
	t.Cleanup(func() { restoreSnapshotFn = orig })

	s := &Server{logger: logger, tmux: &serversTmuxMock{}, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/restore", strings.NewReader(`{"server":"kit"}`)))

	if rec.Code != 500 {
		t.Fatalf("status = %d, want 500 for engine refusal", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.Contains(got["error"], "refusing to restore") {
		t.Errorf("error = %q, want the engine's refusal message", got["error"])
	}
}

func TestHandleRecoveryRestore_NoSnapshot(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	store := snapshot.NewStore(t.TempDir())
	s := &Server{logger: logger, tmux: &serversTmuxMock{}, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/restore", strings.NewReader(`{"server":"ghost"}`)))
	if rec.Code != 404 {
		t.Fatalf("status = %d, want 404 for absent snapshot. body=%s", rec.Code, rec.Body.String())
	}

	// An unwired (nil) store behaves the same as an empty one.
	router = NewTestRouter(logger, nil, &serversTmuxMock{}, "test-host")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/restore", strings.NewReader(`{"server":"ghost"}`)))
	if rec.Code != 404 {
		t.Fatalf("nil store: status = %d, want 404", rec.Code)
	}
}

func TestHandleRecoveryDismiss(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	base := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

	dir := t.TempDir()
	store := snapshot.NewStore(dir)
	if _, err := store.Write(recoverySnap("kit", base, "zsh")); err != nil {
		t.Fatal(err)
	}

	s := &Server{logger: logger, tmux: &serversTmuxMock{}, hostname: "test-host"}
	s.SetSnapshotStore(store)
	router := s.buildRouter()

	// Malformed names are rejected before the store is touched.
	for _, body := range []string{`{"server":"../x"}`, `{"server":"a.b"}`} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/dismiss", strings.NewReader(body)))
		if rec.Code != 400 {
			t.Errorf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
	if snap, _ := store.LoadLatest("kit"); snap == nil {
		t.Fatal("store touched by rejected dismiss")
	}

	// Dismiss succeeds and the offer is gone.
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/dismiss", strings.NewReader(`{"server":"kit"}`)))
	if rec.Code != 200 {
		t.Fatalf("dismiss: status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if snap, _ := store.LoadLatest("kit"); snap != nil {
		t.Fatal("latest still present after dismiss")
	}
	// History directory left intact.
	entries, err := os.ReadDir(filepath.Join(dir, "kit"))
	if err != nil || len(entries) != 1 {
		t.Errorf("history dir = %v entries, err %v — want 1 entry intact", len(entries), err)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/recovery", nil))
	var got recoveryOffersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Offers) != 0 {
		t.Fatalf("offers after dismiss = %+v, want none", got.Offers)
	}

	// Idempotent: a second dismiss (no latest) is a no-op success.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/dismiss", strings.NewReader(`{"server":"kit"}`)))
	if rec.Code != 200 {
		t.Fatalf("repeat dismiss: status = %d, want 200", rec.Code)
	}

	// Unwired (nil) store: dismiss is a no-op success too.
	router = NewTestRouter(logger, nil, &serversTmuxMock{}, "test-host")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/recovery/dismiss", strings.NewReader(`{"server":"kit"}`)))
	if rec.Code != 200 {
		t.Fatalf("nil-store dismiss: status = %d, want 200", rec.Code)
	}
}
