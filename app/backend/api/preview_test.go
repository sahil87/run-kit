package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

func TestActivePaneID(t *testing.T) {
	// Active pane is chosen.
	w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
		{PaneID: "%1", IsActive: false},
		{PaneID: "%2", IsActive: true},
	}}
	if id, ok := activePaneID(w); !ok || id != "%2" {
		t.Errorf("activePaneID = (%q, %v), want (%q, true)", id, ok, "%2")
	}

	// No active flag → first pane fallback.
	w = tmux.WindowInfo{Panes: []tmux.PaneInfo{{PaneID: "%3"}, {PaneID: "%4"}}}
	if id, ok := activePaneID(w); !ok || id != "%3" {
		t.Errorf("activePaneID fallback = (%q, %v), want (%q, true)", id, ok, "%3")
	}

	// No panes → not ok.
	if id, ok := activePaneID(tmux.WindowInfo{}); ok || id != "" {
		t.Errorf("activePaneID empty = (%q, %v), want (\"\", false)", id, ok)
	}
}

func TestTailLines(t *testing.T) {
	// capture-pane returns ~n+pane_height lines; tailLines must keep only the
	// newest n so the preview shows current output, not the top of the block.
	twenty := make([]string, 0, 20)
	for i := 1; i <= 20; i++ {
		twenty = append(twenty, "line"+strconv.Itoa(i))
	}
	got := tailLines(strings.Join(twenty, "\n"), 5)
	if want := "line16\nline17\nline18\nline19\nline20"; got != want {
		t.Errorf("tailLines keep-last = %q, want %q", got, want)
	}

	// Trailing blank lines (idle-pane bottom padding) are dropped BEFORE taking
	// the tail, so real output is not pushed out of view.
	got = tailLines("a\nb\nc\n\n\n", 2)
	if want := "b\nc"; got != want {
		t.Errorf("tailLines trailing-blank = %q, want %q", got, want)
	}

	// Fewer lines than n → return all of them (no negative slice index).
	if got := tailLines("only\ntwo", 10); got != "only\ntwo" {
		t.Errorf("tailLines short = %q, want %q", got, "only\ntwo")
	}

	// Interior blank lines are preserved (blank-line fidelity, per CapturePane).
	if got := tailLines("x\n\ny", 5); got != "x\n\ny" {
		t.Errorf("tailLines interior-blank = %q, want %q", got, "x\n\ny")
	}
}

func TestCapturePreviewsBoundedAndDeduped(t *testing.T) {
	sess := []sessions.ProjectSession{
		{Name: "a", Windows: []tmux.WindowInfo{
			{WindowID: "@1", Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true}}},
			{WindowID: "@2", Panes: []tmux.PaneInfo{{PaneID: "%2", IsActive: true}}},
		}},
		{Name: "b", Windows: []tmux.WindowInfo{
			{WindowID: "@3", Panes: []tmux.PaneInfo{{PaneID: "%3", IsActive: true}}},
		}},
	}
	calls := map[string]int{}
	capture := func(w tmux.WindowInfo, server string) (string, bool) {
		calls[w.WindowID]++
		return "text-" + w.WindowID, true
	}

	// Only session "a" expanded → only @1, @2 captured, not @3.
	got := capturePreviews(sess, map[string]bool{"a": true}, "srv", capture)
	if len(got) != 2 || got["@1"] != "text-@1" || got["@2"] != "text-@2" {
		t.Errorf("capturePreviews = %v, want @1/@2 only", got)
	}
	if _, ok := got["@3"]; ok {
		t.Error("captured @3 for an unexpanded session")
	}

	// Empty union → capture nothing.
	if got := capturePreviews(sess, map[string]bool{}, "srv", capture); len(got) != 0 {
		t.Errorf("empty union should capture nothing, got %v", got)
	}
}

func TestPreviewSubsetFor(t *testing.T) {
	byWindow := map[string][]string{"a": {"@1", "@2"}, "b": {"@3"}}
	full := map[string]string{"@1": "x1", "@2": "x2", "@3": "x3"}

	c := &sseClient{expanded: map[string]bool{"a": true}}
	subset := previewSubsetFor(c, full, byWindow)
	if len(subset) != 2 || subset["@1"] != "x1" || subset["@2"] != "x2" {
		t.Errorf("subset = %v, want @1/@2", subset)
	}

	// Nothing expanded → nil.
	if s := previewSubsetFor(&sseClient{expanded: map[string]bool{}}, full, byWindow); s != nil {
		t.Errorf("empty expanded should yield nil, got %v", s)
	}
}

func TestSetPreviewScope(t *testing.T) {
	hub := newSSEHub(&mockSessionFetcher{}, nil, nil, nil)
	c := &sseClient{ch: make(chan []byte, 8), server: "srv", connID: "abc", expanded: map[string]bool{}}
	hub.clients["srv"] = []*sseClient{c}

	hub.setPreviewScope("srv", "abc", []string{"a", "b"})
	hub.mu.RLock()
	got := c.expanded
	hub.mu.RUnlock()
	if !got["a"] || !got["b"] || len(got) != 2 {
		t.Errorf("expanded = %v, want {a,b}", got)
	}

	// Unknown conn → no-op, no panic.
	hub.setPreviewScope("srv", "nope", []string{"z"})
	hub.mu.RLock()
	if c.expanded["z"] {
		t.Error("unknown conn mutated the wrong client")
	}
	hub.mu.RUnlock()

	// Empty conn → no-op.
	hub.setPreviewScope("srv", "", []string{"z"})
}

// TestPollEmitsPreviewEvent drives the real poll loop with a stubbed capture so
// the preview-broadcast path is exercised without a live tmux server.
func TestPollEmitsPreviewEvent(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "a", Windows: []tmux.WindowInfo{
			{WindowID: "@1", Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true}}},
		}},
		{Name: "b", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Panes: []tmux.PaneInfo{{PaneID: "%9", IsActive: true}}},
		}},
	}}
	hub := newSSEHub(sf, nil, nil, nil)
	hub.safetyInterval = 25 * time.Millisecond
	hub.captureFn = func(w tmux.WindowInfo, server string) (string, bool) {
		return "PREVIEW " + w.WindowID, true
	}

	c := &sseClient{ch: make(chan []byte, 32), server: "srv", connID: "abc", expanded: map[string]bool{"a": true}}
	hub.addClient(c) // starts poll goroutine

	gotPreview := false
	deadline := time.After(3 * time.Second)
	for !gotPreview {
		select {
		case ev := <-c.ch:
			s := string(ev)
			if strings.HasPrefix(s, "event: preview") {
				if !strings.Contains(s, "@1") || !strings.Contains(s, "PREVIEW @1") {
					t.Errorf("preview event missing @1 text: %s", s)
				}
				if strings.Contains(s, "@9") {
					t.Errorf("preview event leaked unexpanded window @9: %s", s)
				}
				gotPreview = true
			}
		case <-deadline:
			t.Fatal("did not receive event: preview")
		}
	}
}

func TestHandlePreviewScopeEndpoint(t *testing.T) {
	sf := &mockSessionFetcher{}
	router := newTestRouter(sf, &mockTmuxOps{})

	// Valid POST → 200 (no-op on scope because no live SSE connection, but the
	// handler must not error).
	body := `{"conn":"abc","expanded":["a"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/preview-scope", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("valid POST status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	// Missing conn → 400.
	req = httptest.NewRequest(http.MethodPost, "/api/preview-scope", strings.NewReader(`{"expanded":["a"]}`))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("missing conn status = %d, want 400", rec.Code)
	}

	// Malformed body → 400.
	req = httptest.NewRequest(http.MethodPost, "/api/preview-scope", strings.NewReader(`{not json`))
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body status = %d, want 400", rec.Code)
	}
}

// TestHandlePreviewScopeSetsLiveConnection wires a live SSE client into the
// server's hub, then POSTs a scope for that connection and asserts the client's
// expanded set updated — the end-to-end endpoint→hub path.
func TestHandlePreviewScopeSetsLiveConnection(t *testing.T) {
	sf := &mockSessionFetcher{}
	s := &Server{sessions: sf, tmux: &mockTmuxOps{}}
	s.initSSEHub()

	c := &sseClient{ch: make(chan []byte, 8), server: "default", connID: "live-1", expanded: map[string]bool{}}
	s.sseHub.clients["default"] = []*sseClient{c}

	body, _ := json.Marshal(previewScopeRequest{Conn: "live-1", Expanded: []string{"sess-x"}})
	req := httptest.NewRequest(http.MethodPost, "/api/preview-scope", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	s.handlePreviewScope(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	s.sseHub.mu.RLock()
	defer s.sseHub.mu.RUnlock()
	if !c.expanded["sess-x"] {
		t.Errorf("expanded = %v, want sess-x set", c.expanded)
	}
}
