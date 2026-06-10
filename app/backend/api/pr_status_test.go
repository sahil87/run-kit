package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"rk/internal/prstatus"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// stubSnapshotter implements PRStatusSnapshotter with a canned map.
type stubSnapshotter struct {
	snap map[int]prstatus.PRStatus
}

func (s stubSnapshotter) Snapshot() map[int]prstatus.PRStatus { return s.snap }

func intp(n int) *int       { return &n }
func strp(s string) *string { return &s }

func TestAttachPRStatusChangeBoundGate(t *testing.T) {
	hub := &sseHub{
		prStatus: stubSnapshotter{snap: map[int]prstatus.PRStatus{
			386: {Number: 386, URL: "u386", State: "open", Checks: "pass", ReviewDecision: "approved"},
			999: {Number: 999, URL: "u999", State: "merged", Checks: "fail"},
		}},
	}

	sess := []sessions.ProjectSession{{
		Name: "dev",
		Windows: []tmux.WindowInfo{
			// change-bound window with a matching PR → attach
			{Index: 0, FabChange: "260610-x", PrNumber: intp(386), PrURL: strp("u386")},
			// scratch window (no FabChange) WITH a PrNumber → gate blocks attach
			{Index: 1, FabChange: "", PrNumber: intp(999), PrURL: strp("u999")},
			// change-bound window whose PR is not in the snapshot → no attach
			{Index: 2, FabChange: "260610-y", PrNumber: intp(123)},
			// change-bound window with no PrNumber → no attach
			{Index: 3, FabChange: "260610-z", PrNumber: nil},
		},
	}}

	hub.attachPRStatus(sess)
	ws := sess[0].Windows

	if ws[0].PrState != "open" || ws[0].PrChecks != "pass" || ws[0].PrReview != "approved" {
		t.Errorf("window 0 (change-bound, matched) not enriched: %+v", ws[0])
	}
	if ws[1].PrState != "" || ws[1].PrChecks != "" || ws[1].PrReview != "" {
		t.Errorf("window 1 (scratch) must NOT be enriched despite PrNumber: %+v", ws[1])
	}
	if ws[2].PrState != "" {
		t.Errorf("window 2 (no snapshot match) must stay empty: %+v", ws[2])
	}
	if ws[3].PrState != "" {
		t.Errorf("window 3 (no PrNumber) must stay empty: %+v", ws[3])
	}
}

func TestAttachPRStatusNilCollectorNoop(t *testing.T) {
	hub := &sseHub{prStatus: nil}
	sess := []sessions.ProjectSession{{
		Windows: []tmux.WindowInfo{{FabChange: "x", PrNumber: intp(1)}},
	}}
	hub.attachPRStatus(sess) // must not panic
	if sess[0].Windows[0].PrState != "" {
		t.Error("nil collector should attach nothing")
	}
}

func TestAttachPRStatusResetsStaleFields(t *testing.T) {
	// A window carrying stale PR fields whose PR dropped from the snapshot must
	// be cleared (wholesale-rebuild + reset semantics).
	hub := &sseHub{prStatus: stubSnapshotter{snap: map[int]prstatus.PRStatus{}}}
	sess := []sessions.ProjectSession{{
		Windows: []tmux.WindowInfo{
			{FabChange: "x", PrNumber: intp(386), PrState: "open", PrChecks: "pass", PrReview: "approved", PrIsDraft: true},
		},
	}}
	hub.attachPRStatus(sess)
	w := sess[0].Windows[0]
	if w.PrState != "" || w.PrChecks != "" || w.PrReview != "" || w.PrIsDraft {
		t.Errorf("stale PR fields not reset: %+v", w)
	}
}

func TestHandlePRStatusRefreshReturnsOK(t *testing.T) {
	// No collector wired (test router) — handler must still 200 {"ok":true}.
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
	req := httptest.NewRequest(http.MethodPost, "/api/pr-status/refresh", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v (%s)", err, rec.Body.String())
	}
	if !body["ok"] {
		t.Errorf("body = %v, want {ok:true}", body)
	}
}
