package api

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// pasteReq builds a POST /paste request for the given window with the given body.
func pasteReq(windowID, body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/windows/"+windowID+"/paste", strings.NewReader(body))
}

// twoPaneWindow is a window whose ACTIVE pane is the SECOND pane and which
// carries no chat provider anywhere — the paste route must target the active
// pane and must not require a chat session.
func twoPaneWindow(windowID string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: windowID, Panes: []tmux.PaneInfo{
				{PaneID: "%1", IsActive: false},
				{PaneID: "%2", IsActive: true},
			}},
		}},
	}
}

func TestWindowPasteSuccessTargetsActivePane(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := &mockTmuxOps{capturePaneResults: []string{"$ ", "$ one\ntwo", "one\ntwo\nworking"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"one\ntwo"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys", "capture-pane"}
	if strings.Join(ops.chatCalls, ",") != strings.Join(want, ",") {
		t.Errorf("injection order = %v, want %v", ops.chatCalls, want)
	}
	if ops.setChatBufferText != "one\ntwo" {
		t.Errorf("buffer text = %q, want verbatim %q", ops.setChatBufferText, "one\ntwo")
	}
	if ops.pasteChatPaneID != "%2" {
		t.Errorf("paste pane = %q, want the ACTIVE pane %%2", ops.pasteChatPaneID)
	}
	if ops.sendEnterPaneID != "%2" {
		t.Errorf("Enter pane = %q, want %%2", ops.sendEnterPaneID)
	}
}

func TestWindowPasteSubmitFalseSkipsEnter(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := &mockTmuxOps{capturePaneResults: []string{"$ ", "$ one\ntwo"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"one\ntwo","submit":false}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane"}
	if strings.Join(ops.chatCalls, ",") != strings.Join(want, ",") {
		t.Errorf("injection order = %v, want %v (no send-keys)", ops.chatCalls, want)
	}
	if ops.sendEnterCalled {
		t.Error("Enter was sent for submit:false")
	}
}

func TestWindowPasteProbeFailure409(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	// Every capture returns the unchanged prompt: the needle never echoes.
	ops := &mockTmuxOps{capturePaneResult: "$ "}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"one\ntwo"}`))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter was sent despite probe failure")
	}
	if !strings.Contains(rec.Body.String(), "Enter withheld") {
		t.Errorf("body = %s, want the probe-failure message", rec.Body.String())
	}
}

func TestWindowPasteSubmitUnverified409(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := unverifiedSubmitOps(t, "$ ", "$ one\ntwo")
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"one\ntwo"}`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "may or may not have been submitted") {
		t.Fatalf("body = %s, want submit-unconfirmed guidance", rec.Body.String())
	}
}

func TestWindowPasteEmptyText(t *testing.T) {
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	for _, body := range []string{`{"text":""}`, `{"text":"   \n  "}`, `{"text":"\x01\x02\x1b"}`} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, pasteReq("@1", body))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("tmux was called for empty text: %v", ops.chatCalls)
	}
}

func TestWindowPasteInvalidJSON(t *testing.T) {
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{}, &mockTmuxOps{}, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{not json`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestWindowPasteInvalidWindowID(t *testing.T) {
	router := NewTestRouter(slog.Default(), &mockSessionFetcher{}, &mockTmuxOps{}, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("nope", `{"text":"a\nb"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindowPasteUnknownWindow404(t *testing.T) {
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@9", `{"text":"a\nb"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("tmux was called for an unknown window: %v", ops.chatCalls)
	}
}

func TestWindowPasteFetchError500(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux down")}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"a\nb"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindowPastePasteFailure500(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoPaneWindow("@1")}
	ops := &mockTmuxOps{capturePaneResult: "$ ", pasteChatBufferErr: errors.New("paste-buffer: boom")}
	router := NewTestRouter(slog.Default(), sf, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, pasteReq("@1", `{"text":"a\nb"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter was sent after a paste failure")
	}
}
