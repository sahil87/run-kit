package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// isolatePush points ~/.rk persistence at a throwaway HOME so push tests
// neither read nor clobber the developer's real ~/.rk files.
func isolatePush(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
}

func TestPushVAPIDPublicKey_returnsKey(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/push/vapid-public-key", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["key"] == "" {
		t.Error("expected non-empty 'key' field in vapid-public-key response")
	}
}

func TestPushSubscribe_storesValid(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"endpoint":"https://push.example/x","keys":{"p256dh":"p","auth":"a"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/push/subscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["status"] != "ok" {
		t.Errorf("status field = %q, want %q", result["status"], "ok")
	}
}

func TestPushSubscribe_rejectsInvalid(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	cases := []string{
		`not json`,
		`{"endpoint":"","keys":{"p256dh":"p","auth":"a"}}`,
		`{"endpoint":"https://e","keys":{"p256dh":"","auth":""}}`,
	}
	for _, body := range cases {
		req := httptest.NewRequest(http.MethodPost, "/api/push/subscribe", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want %d", body, rec.Code, http.StatusBadRequest)
		}
	}
}

func TestNotify_emptyBodyRejected(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, body := range []string{`{}`, `{"body":""}`, `{"body":"   "}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/notify", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want %d", body, rec.Code, http.StatusBadRequest)
		}
	}
}

func TestNotify_noSubscriptionsReturnsSummary(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// No subscriptions stored → fan-out is a no-op, returns {sent:0, pruned:0}.
	req := httptest.NewRequest(http.MethodPost, "/api/notify", strings.NewReader(`{"body":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result struct {
		Sent   int `json:"sent"`
		Pruned int `json:"pruned"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Sent != 0 || result.Pruned != 0 {
		t.Errorf("summary = %+v, want {0,0}", result)
	}
}

func TestNotify_noSubscriptionsStillBroadcasts(t *testing.T) {
	isolatePush(t)
	server := &Server{
		logger:   slog.New(slog.NewTextHandler(os.Stderr, nil)),
		sessions: &mockSessionFetcher{},
		tmux:     &mockTmuxOps{},
		hostname: "test-host",
	}
	router := server.buildRouter()
	server.initSSEHub()
	sc := newTestStateConn(server.sseHub, "notify-test", 8)
	server.sseHub.replayGlobalSlots(sc)
	t.Cleanup(func() { server.sseHub.dropStateConn(sc) })
	drainFrames(sc.ch)

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/notify",
		strings.NewReader(`{"body":"hi","url":"/noon/57"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result struct {
		Sent   int `json:"sent"`
		Pruned int `json:"pruned"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.Sent != 0 || result.Pruned != 0 {
		t.Errorf("summary = %+v, want {0,0}", result)
	}

	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 {
		t.Fatalf("received %d frames, want 1 notify", len(frames))
	}
	frame := frames[0]
	if rawStr(frame, "kind") != kindGlobal || rawStr(frame, "type") != "notify" {
		t.Fatalf("envelope = %v, want global notify", frame)
	}
	if string(frame["data"]) != `{"title":"RunKit","body":"hi","url":"/noon/57"}` {
		t.Errorf("data = %s", frame["data"])
	}
}

func TestNotifyDeepLinkPath(t *testing.T) {
	cases := []struct {
		raw, want string
	}{
		{"/noon/57", "/noon/57"},
		{"/", "/"},
		{"/noon/57?view=chat", "/noon/57?view=chat"},
		{"//evil.example", ""},
		{"https://evil.example/x", ""},
		{"no-leading-slash", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := notifyDeepLinkPath(tc.raw); got != tc.want {
			t.Errorf("notifyDeepLinkPath(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}

// TestNotify_urlNeverRejects asserts the soft-drop contract: any url value —
// valid or hostile — still yields a 200 send summary, never a 400 (`body`
// remains the only required field).
func TestNotify_urlNeverRejects(t *testing.T) {
	isolatePush(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, body := range []string{
		`{"body":"hi","url":"/noon/57"}`,
		`{"body":"hi","url":"//evil.example"}`,
		`{"body":"hi","url":"https://evil.example"}`,
		`{"body":"hi","url":"garbage"}`,
		`{"body":"hi","url":""}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/notify", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("body %q: status = %d, want %d (invalid urls soft-drop, never 400)", body, rec.Code, http.StatusOK)
		}
	}
}
