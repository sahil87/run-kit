package api

import (
	"bytes"
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

// splitAgentWindow is a split whose AGENT pane (%2, the @rk_pane_chat carrier)
// is NOT the active pane (%1) — the case where active-pane targeting would
// deliver to the wrong pane.
func splitAgentWindow(windowID string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: windowID, Panes: []tmux.PaneInfo{
				{PaneID: "%1", IsActive: true},
				{PaneID: "%2", IsActive: false, ChatProvider: "claude", ChatSessionRef: testTranscriptRef},
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
			fastAgentSendProbe(t)
			ops := &mockTmuxOps{capturePaneResults: tt.captures}
			router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, windowSendReq("@1", tt.body))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if got := strings.Join(ops.agentSendCalls, ","); got != strings.Join(tt.want, ",") {
				t.Fatalf("calls = %v, want %v", ops.agentSendCalls, tt.want)
			}
			if tt.name == "raw" && (ops.setAgentBufferText != "a\tb\nc" || ops.pasteAgentRawPaneID != "%2") {
				t.Fatalf("raw delivery = text %q pane %q", ops.setAgentBufferText, ops.pasteAgentRawPaneID)
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
		{"unknown target", "@1", `{"text":"hello","mode":"submit","target":"shell"}`},
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
			if len(ops.agentSendCalls) != 0 {
				t.Fatalf("tmux calls = %v, want none", ops.agentSendCalls)
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
	if len(ops.agentSendCalls) != 0 {
		t.Fatalf("tmux calls = %v, want none", ops.agentSendCalls)
	}
}

func TestWindowSendAgentTargetResolvesAgentPane(t *testing.T) {
	// target:"agent" on a split whose agent pane is NOT active delivers to the
	// agent pane (%2), never the active shell (%1).
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: splitAgentWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"raw","target":"agent"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.pasteAgentRawPaneID != "%2" {
		t.Fatalf("raw delivery pane = %q, want %%2 (the agent pane)", ops.pasteAgentRawPaneID)
	}
}

func TestWindowSendAgentTargetNoAgent404(t *testing.T) {
	// Fail-closed: no pane carries chat → 404, and NOTHING is pasted — an
	// agent-targeted send to a shell window never executes there.
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit","target":"agent"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.agentSendCalls) != 0 {
		t.Fatalf("tmux calls = %v, want none", ops.agentSendCalls)
	}
}

func TestWindowSendDefaultTargetsActivePane(t *testing.T) {
	// No target field: byte-identical to before — the ACTIVE pane (%1 here),
	// even when another pane carries chat.
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: splitAgentWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"raw"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.pasteAgentRawPaneID != "%1" {
		t.Fatalf("raw delivery pane = %q, want %%1 (the active pane)", ops.pasteAgentRawPaneID)
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
	ops := &mockTmuxOps{pasteAgentRawBufferErr: errors.New("paste failed")}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"raw"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindowSendProbeFailureCode(t *testing.T) {
	fastAgentSendProbe(t)
	ops := &mockTmuxOps{capturePaneResult: "$ "}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	assertConflictCode(t, rec, "probe_failure")
	if ops.sendEnterCalled {
		t.Fatal("Enter sent despite probe failure")
	}
}

func TestWindowSendSubmitUnverifiedCode(t *testing.T) {
	fastAgentSendProbe(t)
	ops := unverifiedSubmitOps(t, "$ ", "$ hello")
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	assertConflictCode(t, rec, "submit_unverified")
}

func TestWindowSendStagedFailureCode(t *testing.T) {
	fastAgentSendProbe(t)
	ops := &mockTmuxOps{
		capturePaneResults: []string{"$ ", "$ hello"},
		sendEnterErr:       errors.New("client is read-only"),
	}
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{result: activePaneWindow("@1")}, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, windowSendReq("@1", `{"text":"hello","mode":"submit"}`))
	assertConflictCode(t, rec, "staged_send_failure")
}

func TestWindowSendFailureLogging(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		ops       *mockTmuxOps
		wantLevel string
		wantMode  string
	}{
		{
			name: "recoverable",
			body: `{"text":"hello","mode":"submit"}`,
			ops: &mockTmuxOps{
				capturePaneResults: []string{"$ ", "$ hello"},
				sendEnterErr:       errors.New("client is read-only"),
			},
			wantLevel: "WARN",
			wantMode:  "submit",
		},
		{
			name:      "fatal",
			body:      `{"text":"hello","mode":"raw"}`,
			ops:       &mockTmuxOps{pasteAgentRawBufferErr: errors.New("paste failed")},
			wantLevel: "ERROR",
			wantMode:  "raw",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fastAgentSendProbe(t)
			var logs bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logs, nil))
			router := NewTestRouter(logger, &mockSessionFetcher{result: activePaneWindow("@1")}, tt.ops, "host")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, windowSendReq("@1", tt.body))

			record := decodeLogRecord(t, &logs)
			for key, want := range map[string]string{
				"level": tt.wantLevel, "server": "test", "windowID": "@1",
				"paneID": "%2", "mode": tt.wantMode,
			} {
				if got := record[key]; got != want {
					t.Errorf("log %s = %v, want %q; record=%v", key, got, want, record)
				}
			}
			if errText, ok := record["err"].(string); !ok || errText == "" {
				t.Errorf("log err = %v, want non-empty string; record=%v", record["err"], record)
			}
		})
	}
}

func decodeLogRecord(t *testing.T, logs *bytes.Buffer) map[string]any {
	t.Helper()
	var record map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &record); err != nil {
		t.Fatalf("decode log %q: %v", logs.String(), err)
	}
	return record
}

func assertConflictCode(t *testing.T, rec *httptest.ResponseRecorder, wantCode string) {
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
