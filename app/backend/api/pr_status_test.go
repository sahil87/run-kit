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
	snap map[string]prstatus.PRStatus
}

func (s stubSnapshotter) Snapshot() map[string]prstatus.PRStatus { return s.snap }

func intp(n int) *int       { return &n }
func strp(s string) *string { return &s }

// TestAttachPRStatusURLGate verifies the URL-only gate since 260705-dmex: the
// former FabChange (change-bound) gate is GONE, so ANY window with a non-empty
// derived PrURL that matches the snapshot is enriched — including a scratch
// (non-change-bound) window. The empty-PrURL / no-PrURL / no-match cases still
// stay empty (the URL is the join key).
func TestAttachPRStatusURLGate(t *testing.T) {
	hub := &sseHub{
		prStatus: stubSnapshotter{snap: map[string]prstatus.PRStatus{
			"u386": {Number: 386, URL: "u386", State: "open", Checks: "pass", ReviewDecision: "approved"},
			"u999": {Number: 999, URL: "u999", State: "merged", Checks: "fail"},
			// Poisoned empty key: the collector never produces one, but the
			// gate must still refuse to join an empty PrURL against it.
			"": {State: "closed"},
		}},
	}

	sess := []sessions.ProjectSession{{
		Name: "dev",
		Windows: []tmux.WindowInfo{
			// change-bound window with a matching PR → attach
			{Index: 0, FabChange: "260610-x", PrNumber: intp(386), PrURL: strp("u386")},
			// scratch window (no FabChange) WITH a matching PrURL → attach now
			// (branch-derived PR; the change gate is gone)
			{Index: 1, FabChange: "", PrNumber: intp(999), PrURL: strp("u999")},
			// window whose PR is not in the snapshot → no attach
			{Index: 2, FabChange: "260610-y", PrNumber: intp(123), PrURL: strp("u123")},
			// window with no PrURL → no attach — the join key is the URL
			{Index: 3, FabChange: "260610-z", PrNumber: intp(386), PrURL: nil},
			// window with an EMPTY PrURL → gate treats it as missing; must not
			// match an empty snapshot key
			{Index: 4, FabChange: "260610-w", PrNumber: intp(7), PrURL: strp("")},
		},
	}}

	hub.attachPRStatus(sess)
	ws := sess[0].Windows

	if ws[0].PrState != "open" || ws[0].PrChecks != "pass" || ws[0].PrReview != "approved" {
		t.Errorf("window 0 (change-bound, matched) not enriched: %+v", ws[0])
	}
	if ws[1].PrState != "merged" || ws[1].PrChecks != "fail" {
		t.Errorf("window 1 (scratch, matched) MUST be enriched now the change gate is gone: %+v", ws[1])
	}
	if ws[2].PrState != "" {
		t.Errorf("window 2 (no snapshot match) must stay empty: %+v", ws[2])
	}
	if ws[3].PrState != "" {
		t.Errorf("window 3 (no PrURL) must stay empty: %+v", ws[3])
	}
	if ws[4].PrState != "" {
		t.Errorf("window 4 (empty PrURL) must stay empty: %+v", ws[4])
	}
}

func TestAttachPRStatusSameNumberDifferentRepos(t *testing.T) {
	// Regression: two change-bound windows whose PRs share a number but live in
	// different repos must each get THEIR OWN state. The old number-keyed join
	// showed an open idea#18 as merged because shll#18 (same number) had merged.
	hub := &sseHub{
		prStatus: stubSnapshotter{snap: map[string]prstatus.PRStatus{
			"https://github.com/sahil87/idea/pull/18": {Number: 18, URL: "https://github.com/sahil87/idea/pull/18", State: "open", Checks: "pass"},
			"https://github.com/sahil87/shll/pull/18": {Number: 18, URL: "https://github.com/sahil87/shll/pull/18", State: "merged", Checks: "none"},
		}},
	}

	sess := []sessions.ProjectSession{{
		Name: "dev",
		Windows: []tmux.WindowInfo{
			{Index: 0, FabChange: "260612-a", PrNumber: intp(18), PrURL: strp("https://github.com/sahil87/idea/pull/18")},
			{Index: 1, FabChange: "260612-b", PrNumber: intp(18), PrURL: strp("https://github.com/sahil87/shll/pull/18")},
		},
	}}

	hub.attachPRStatus(sess)
	ws := sess[0].Windows

	if ws[0].PrState != "open" {
		t.Errorf("idea#18 window state = %q, want open: %+v", ws[0].PrState, ws[0])
	}
	if ws[1].PrState != "merged" {
		t.Errorf("shll#18 window state = %q, want merged: %+v", ws[1].PrState, ws[1])
	}
}

func TestAttachPRStatusNilCollectorNoop(t *testing.T) {
	hub := &sseHub{prStatus: nil}
	sess := []sessions.ProjectSession{{
		Windows: []tmux.WindowInfo{{FabChange: "x", PrNumber: intp(1), PrURL: strp("u1")}},
	}}
	hub.attachPRStatus(sess) // must not panic
	if sess[0].Windows[0].PrState != "" {
		t.Error("nil collector should attach nothing")
	}
}

func TestAttachPRStatusResetsStaleFields(t *testing.T) {
	// A window carrying stale PR fields whose PR dropped from the snapshot must
	// be cleared (wholesale-rebuild + reset semantics).
	hub := &sseHub{prStatus: stubSnapshotter{snap: map[string]prstatus.PRStatus{}}}
	sess := []sessions.ProjectSession{{
		Windows: []tmux.WindowInfo{
			{FabChange: "x", PrNumber: intp(386), PrURL: strp("u386"), PrState: "open", PrChecks: "pass", PrReview: "approved", PrIsDraft: true},
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
