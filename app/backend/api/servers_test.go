package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"os"
	"testing"

	"rk/internal/tmux"
)

// serversTmuxMock extends mockTmuxOps with configurable ListServers/ListSessions
// for the /api/servers list handler tests.
type serversTmuxMock struct {
	mockTmuxOps
	servers  []string
	sessions map[string][]tmux.SessionInfo
	errs     map[string]error
}

func (m *serversTmuxMock) ListServers(ctx context.Context) ([]string, error) {
	return m.servers, nil
}

func (m *serversTmuxMock) ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error) {
	if err, ok := m.errs[server]; ok && err != nil {
		return nil, err
	}
	return m.sessions[server], nil
}

func TestHandleServersList_Empty(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{servers: nil}
	router := NewTestRouter(logger, nil, mock, "test-host")

	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("len = %d, want 0. body=%s", len(got), rec.Body.String())
	}
	// Confirm it's `[]` not `null` in the wire format
	if rec.Body.String() != "[]\n" && rec.Body.String() != "[]" {
		t.Fatalf("body = %q, want [] (not null)", rec.Body.String())
	}
}

func TestHandleServersList_SingleServer(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers: []string{"default"},
		sessions: map[string][]tmux.SessionInfo{
			"default": {
				{Name: "a"}, {Name: "b"}, {Name: "c"}, {Name: "d"},
			},
		},
	}
	router := NewTestRouter(logger, nil, mock, "test-host")

	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Name != "default" || got[0].SessionCount != 4 {
		t.Fatalf("got %+v, want {default 4}", got[0])
	}
}

func TestHandleServersList_MultipleWithOneFailure(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers: []string{"default", "work", "broken"},
		sessions: map[string][]tmux.SessionInfo{
			"default": {{Name: "s1"}, {Name: "s2"}, {Name: "s3"}},
			"work":    {{Name: "s1"}, {Name: "s2"}},
		},
		errs: map[string]error{
			"broken": errors.New("no server running"),
		},
	}
	router := NewTestRouter(logger, nil, mock, "test-host")

	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200 (per-server failure must not surface as 5xx). body=%s", rec.Code, rec.Body.String())
	}

	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}

	// Response is sorted by name: broken, default, work
	byName := map[string]int{}
	for _, e := range got {
		byName[e.Name] = e.SessionCount
	}
	if byName["default"] != 3 {
		t.Errorf("default count = %d, want 3", byName["default"])
	}
	if byName["work"] != 2 {
		t.Errorf("work count = %d, want 2", byName["work"])
	}
	if byName["broken"] != 0 {
		t.Errorf("broken count = %d, want 0 (error -> 0)", byName["broken"])
	}
}

func TestHandleServersList_SortedAlphabetically(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers: []string{"zebra", "alpha", "mike"},
		sessions: map[string][]tmux.SessionInfo{
			"zebra": {{Name: "s1"}},
			"alpha": {{Name: "s1"}},
			"mike":  {{Name: "s1"}},
		},
	}
	router := NewTestRouter(logger, nil, mock, "test-host")

	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []string{"alpha", "mike", "zebra"}
	for i, e := range got {
		if e.Name != want[i] {
			t.Errorf("got[%d].Name = %q, want %q", i, e.Name, want[i])
		}
	}
}
