package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

func windowSendReq(windowID, body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/windows/"+windowID+"/send?server=test", strings.NewReader(body))
}

func activePaneWindow(windowID string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: windowID, Panes: []tmux.PaneInfo{
				{PaneID: "%1", IsActive: false},
				{PaneID: "%2", IsActive: true},
			}},
		}},
	}
}

func TestWindowSendModeStrategies(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		captures []string
		want     []string
	}{
		{
			name:     "submit",
			body:     `{"text":"hello","mode":"submit"}`,
			captures: []string{"$ ", "$ hello", "working"},
			want:     []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys", "capture-pane"},
		},
		{
			name:     "insert-line",
			body:     `{"text":"hello","mode":"insert-line"}`,
			captures: []string{"$ ", "$ hello"},
			want:     []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane"},
		},
		{
			name: "raw",
			body: `{"text":"a\tb\nc","mode":"raw"}`,
			want: []string{"set-buffer", "paste-buffer-raw"},
		},
		{
			name: "enter",
			body: `{"text":"","mode":"enter"}`,
			want: []string{"send-keys"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fastChatSendProbe(t)
			ops := &mockTmuxOps{capturePaneResults: tt.captures}
			router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, windowSendReq("@1", tt.body))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if got := strings.Join(ops.chatCalls, ","); got != strings.Join(tt.want, ",") {
				t.Fatalf("calls = %v, want %v", ops.chatCalls, tt.want)
			}
			if tt.name == "raw" && (ops.setChatBufferText != "a\tb\nc" || ops.pasteChatRawPaneID != "%2") {
				t.Fatalf("raw delivery = text %q pane %q", ops.setChatBufferText, ops.pasteChatRawPaneID)
			}
			if tt.name == "enter" && ops.sendEnterPaneID != "%2" {
				t.Fatalf("Enter pane = %q, want %%2", ops.sendEnterPaneID)
			}
		})
	}
}

func TestWindowSendBadRequestsDoNotTouchTmux(t *testing.T) {
	tests := []struct {
		name     string
		windowID string
		body     string
	}{
		{"bad window id", "nope", `{"text":"hello","mode":"submit"}`},
		{"bad json", "@1", `{not json`},
		{"missing mode", "@1", `{"text":"hello"}`},
		{"unknown mode", "@1", `{"text":"hello","mode":"other"}`},
		{"empty submit", "@1", `{"text":" \n ","mode":"submit"}`},
		{"empty insert-line", "@1", `{"text":"","mode":"insert-line"}`},
		{"empty raw", "@1", `{"text":"\u0001\u001b","mode":"raw"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ops := &mockTmuxOps{}
			router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, windowSendReq(tt.windowID, tt.body))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if len(ops.chatCalls) != 0 {
				t.Fatalf("tmux calls = %v, want none", ops.chatCalls)
			}
		})
	}
}

func TestWindowSendMissingWindow404(t *testing.T) {
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@9", `{"text":"hello","mode":"submit"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Fatalf("tmux calls = %v, want none", ops.chatCalls)
	}
}

func TestWindowSendFetchError500(t *testing.T) {
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{err: errors.New("tmux down")}, &mockTmuxOps{}, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindowSendInjectionError500(t *testing.T) {
	ops := &mockTmuxOps{pasteChatRawBufferErr: errors.New("paste failed")}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"raw"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindowSendProbeFailureCode(t *testing.T) {
	fastChatSendProbe(t)
	ops := &mockTmuxOps{capturePaneResult: "$ "}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	assertWindowSendConflict(t, rec, "probe_failure")
	if ops.sendEnterCalled {
		t.Fatal("Enter sent despite probe failure")
	}
}

func TestWindowSendSubmitUnverifiedCode(t *testing.T) {
	fastChatSendProbe(t)
	ops := unverifiedSubmitOps(t, "$ ", "$ hello")
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	assertWindowSendConflict(t, rec, "submit_unverified")
}

func TestWindowSendPaneRetargeting(t *testing.T) {
	fastChatSendProbe(t)
	ops := &mockTmuxOps{capturePaneResults: []string{"$ ", "$ hello", "working"}}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit","pane":"%1"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.pasteChatPaneID != "%1" {
		t.Errorf("paste pane = %q, want %%1 (the requested pane, not the active %%2)", ops.pasteChatPaneID)
	}
	if ops.sendEnterPaneID != "%1" {
		t.Errorf("Enter pane = %q, want %%1", ops.sendEnterPaneID)
	}
}

func TestWindowSendPaneOutOfWindow400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit","pane":"%9"}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "pane %9 does not belong to window @1") {
		t.Errorf("body = %s, want the pane-not-in-window message", rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Fatalf("tmux calls = %v, want none", ops.chatCalls)
	}
}

func TestWindowSendMalformedPane400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit","pane":"bogus"}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Fatalf("tmux calls = %v, want none", ops.chatCalls)
	}
}

func TestWindowSendAbsentPaneTargetsActivePane(t *testing.T) {
	fastChatSendProbe(t)
	ops := &mockTmuxOps{capturePaneResults: []string{"$ ", "$ hello", "working"}}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.pasteChatPaneID != "%2" || ops.sendEnterPaneID != "%2" {
		t.Errorf("delivery panes = paste %q / enter %q, want the active %%2 for both", ops.pasteChatPaneID, ops.sendEnterPaneID)
	}
}

func assertWindowSendConflict(t *testing.T, rec *httptest.ResponseRecorder, wantCode string) {
	t.Helper()
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != wantCode || body.Error == "" {
		t.Fatalf("body = %+v, want code %q and a message", body, wantCode)
	}
}
