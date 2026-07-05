package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
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

// The test-socket hide filter was DELETED: /api/servers now surfaces EVERY
// tmux server, including leaked rk-test-* orphans (and the unified
// rk-test-e2e-* Playwright servers). `rk reaper` is the sole mechanism that
// keeps this list clean. The former hide-assertion is inverted here — all
// servers must be returned, sorted alphabetically.
func TestHandleServersList_ReturnsAllServersIncludingTestSockets(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers: []string{
			"default",
			"Some",
			"rk-test-unit-12345-67890",         // shown (was hidden)
			"rk-test-relay-12345-67890",        // shown (was hidden)
			"rk-test-tmuxctl-12345-67890",      // shown (was hidden)
			"rk-test-daemon-12345-67890",       // shown (was hidden)
			"rk-test-e2e",                      // shown (persistent harness)
			"rk-test-e2e-coupling-12345-67890", // shown (Playwright secondary)
			"rk-test-e2e-multi-12345-67890",    // shown (Playwright secondary)
		},
		sessions: map[string][]tmux.SessionInfo{},
	}
	router := NewTestRouter(logger, nil, mock, "test-host")

	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	gotNames := make([]string, len(got))
	for i, e := range got {
		gotNames[i] = e.Name
	}
	// Every server is returned, including the rk-test-* orphans, sorted by name.
	want := []string{
		"Some",
		"default",
		"rk-test-daemon-12345-67890",
		"rk-test-e2e",
		"rk-test-e2e-coupling-12345-67890",
		"rk-test-e2e-multi-12345-67890",
		"rk-test-relay-12345-67890",
		"rk-test-tmuxctl-12345-67890",
		"rk-test-unit-12345-67890",
	}
	if len(gotNames) != len(want) {
		t.Fatalf("got %v, want %v", gotNames, want)
	}
	for i, name := range want {
		if gotNames[i] != name {
			t.Errorf("got[%d] = %q, want %q (full: %v)", i, gotNames[i], name, gotNames)
		}
	}
}

func intPtr(n int) *int { return &n }

func TestHandleServersList_IncludesRankField(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers: []string{"work", "default"},
		sessions: map[string][]tmux.SessionInfo{
			"work":    {{Name: "s1"}},
			"default": {{Name: "s1"}},
		},
	}
	// "default" is ranked 0; "work" has no rank (nil).
	mock.getServerRankByServer = map[string]*int{"default": intPtr(0)}

	router := NewTestRouter(logger, nil, mock, "test-host")
	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Array stays alphabetical (asserted contract): default, work.
	if len(got) != 2 || got[0].Name != "default" || got[1].Name != "work" {
		t.Fatalf("got %+v, want [default, work] alphabetical", got)
	}
	if got[0].Rank == nil || *got[0].Rank != 0 {
		t.Errorf("default rank = %v, want 0", got[0].Rank)
	}
	if got[1].Rank != nil {
		t.Errorf("work rank = %v, want nil (unranked)", got[1].Rank)
	}
}

func TestHandleServersList_RankReadErrorYieldsNullRank(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{
		servers:  []string{"broken"},
		sessions: map[string][]tmux.SessionInfo{"broken": {{Name: "s1"}}},
	}
	mock.getServerRankErrByServer = map[string]error{"broken": errors.New("boom")}

	router := NewTestRouter(logger, nil, mock, "test-host")
	req := httptest.NewRequest("GET", "/api/servers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200 (rank read failure must not surface as 5xx)", rec.Code)
	}
	var got []serverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Rank != nil {
		t.Fatalf("got %+v, want rank nil on read error", got)
	}
}

func TestHandleServerOrderPost_WritesRanksInOrder(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{}

	router := NewTestRouter(logger, nil, mock, "test-host")
	body := `{"order":["a","b","c"]}`
	req := httptest.NewRequest("POST", "/api/servers/order", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if len(mock.setServerRankCalls) != 3 {
		t.Fatalf("SetServerRank called %d times, want 3: %+v", len(mock.setServerRankCalls), mock.setServerRankCalls)
	}
	want := []struct {
		Server string
		Rank   int
	}{{"a", 0}, {"b", 1}, {"c", 2}}
	for i, c := range mock.setServerRankCalls {
		if c != want[i] {
			t.Errorf("call[%d] = %+v, want %+v", i, c, want[i])
		}
	}
}

func TestHandleServerOrderPost_InvalidNameRejected(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{}

	router := NewTestRouter(logger, nil, mock, "test-host")
	// A name with a forbidden character fails ValidateServerName.
	body := `{"order":["ok","bad name!"]}`
	req := httptest.NewRequest("POST", "/api/servers/order", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400 for invalid server name", rec.Code)
	}
	if len(mock.setServerRankCalls) != 0 {
		t.Errorf("SetServerRank was called %d times, want 0 (validation before any write)", len(mock.setServerRankCalls))
	}
}

func TestHandleServerOrderPost_DuplicateNameRejected(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{}

	router := NewTestRouter(logger, nil, mock, "test-host")
	// A duplicated name would assign multiple ranks (last wins) — reject up front.
	body := `{"order":["srv-a","srv-b","srv-a"]}`
	req := httptest.NewRequest("POST", "/api/servers/order", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400 for duplicate server name", rec.Code)
	}
	if len(mock.setServerRankCalls) != 0 {
		t.Errorf("SetServerRank was called %d times, want 0 (validation before any write)", len(mock.setServerRankCalls))
	}
}

func TestHandleServerOrderPost_MalformedBodyRejected(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	mock := &serversTmuxMock{}

	router := NewTestRouter(logger, nil, mock, "test-host")
	req := httptest.NewRequest("POST", "/api/servers/order", strings.NewReader(`{"order": "not-an-array"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400 for malformed body", rec.Code)
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
