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

// operatorReq builds a POST /operator-request request for subject window @1
// with the given body.
func operatorReq(body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/windows/@1/operator-request", strings.NewReader(body))
}

// operatorSessions builds the two-window fixture: subject window @1 with a
// reconciled claude chat session plus worktree/fab facts, and the operator
// window @9 (Role "operator", rollup AgentState as given) with its chat on
// pane %9 — the only pane delivery may target.
func operatorSessions(agentState string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", Name: "zsh", WorktreePath: "/wt/project",
				ChatProvider: "claude", ChatSessionRef: testChatRef,
				FabChange: "260822-fih1-operator-request-fix-tab-name", FabStage: "apply",
				Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
		}},
		{Name: "_rk-operator", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Name: "operator", Role: "operator", AgentState: agentState,
				Panes: []tmux.PaneInfo{{PaneID: "%9", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
		}},
	}
}

// --- 400s: validation happens before any fetch or tmux call -----------------

// TestOperatorRequestInvalidWindowID: a malformed window id is a 400 with no
// injection.
func TestOperatorRequestInvalidWindowID(t *testing.T) {
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	req := httptest.NewRequest(http.MethodPost, "/api/windows/not-a-window/operator-request", strings.NewReader(`{"template":"fix-tab-name"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) on a bad window id", ops.chatCalls)
	}
}

// TestOperatorRequestInvalidJSON: an undecodable body is a 400 with no injection.
func TestOperatorRequestInvalidJSON(t *testing.T) {
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{not json`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) on a bad body", ops.chatCalls)
	}
}

// TestOperatorRequestUnknownTemplate: a template id outside the closed registry
// is a 400 naming the id — the /options key-allowlist posture.
func TestOperatorRequestUnknownTemplate(t *testing.T) {
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"nuke-everything"}`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "nuke-everything") {
		t.Errorf("400 body = %s, want it to name the unknown template id", rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) for an unknown template", ops.chatCalls)
	}
}

// --- 404s: resolution failures, no injection --------------------------------

// TestOperatorRequestSubjectNotFound: a subject window absent from the server is
// a 404 with no injection.
func TestOperatorRequestSubjectNotFound(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "_rk-operator", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Role: "operator"},
		}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) with no subject window", ops.chatCalls)
	}
}

// TestOperatorRequestNoOperator: a server with no operator window is a 404
// ("no operator on this server") with no injection — the race backstop for the
// UI's degrade-to-absent gating.
func TestOperatorRequestNoOperator(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", ChatProvider: "claude", ChatSessionRef: testChatRef},
		}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no operator on this server") {
		t.Errorf("404 body = %s, want the no-operator message", rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) with no operator", ops.chatCalls)
	}
}

// TestOperatorRequestSubjectNoChatRef: the fix-tab-name template declares the
// chat ref as a required fact — a subject without a reconciled chat session is
// a 404 with no injection.
func TestOperatorRequestSubjectNoChatRef(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", Name: "zsh"},
		}},
		{Name: "_rk-operator", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Role: "operator", AgentState: "idle",
				Panes: []tmux.PaneInfo{{PaneID: "%9", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
		}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) for a chatless subject", ops.chatCalls)
	}
}

// TestOperatorRequestTranscriptNotFound: a resolvable-looking ref whose
// transcript is absent on disk is a 404 (same vocabulary as the chat read
// endpoints) with no injection.
func TestOperatorRequestTranscriptNotFound(t *testing.T) {
	stageEmptyConfigDir(t)
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) with an unresolvable transcript", ops.chatCalls)
	}
}

// TestOperatorRequestOperatorNoChatPane: an operator window with no reconciled
// chat pane cannot receive requests — 404, no injection.
func TestOperatorRequestOperatorNoChatPane(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", ChatProvider: "claude", ChatSessionRef: testChatRef,
				Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
		}},
		{Name: "_rk-operator", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Role: "operator", AgentState: "idle",
				Panes: []tmux.PaneInfo{{PaneID: "%9", IsActive: true}}},
		}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) for a chatless operator", ops.chatCalls)
	}
}

// --- 409s: busy gate + probe failure ----------------------------------------

// TestOperatorRequestBusyGate: an active OR waiting operator is a 409 naming
// the state, with ZERO injection subprocesses (reject, never queue).
func TestOperatorRequestBusyGate(t *testing.T) {
	for _, state := range []string{"active", "waiting"} {
		t.Run(state, func(t *testing.T) {
			stageFixtureTranscript(t, testChatRef)
			sf := &mockSessionFetcher{result: operatorSessions(state)}
			ops := &mockTmuxOps{}
			router := NewTestRouter(slog.Default(), sf, ops, "host")

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "busy ("+state+")") {
				t.Errorf("409 body = %s, want the state named", rec.Body.String())
			}
			if len(ops.chatCalls) != 0 {
				t.Errorf("injection ran (%v) for a busy operator", ops.chatCalls)
			}
		})
	}
}

// TestOperatorRequestProbeFailureWithholdsEnter: the pasted prompt never echoes
// → the structured 409 chat-send returns, and NO Enter reaches the operator
// pane.
func TestOperatorRequestProbeFailureWithholdsEnter(t *testing.T) {
	fastChatSendProbe(t)
	stageFixtureTranscript(t, testChatRef)
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{capturePaneResult: "some unrelated pane output"}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter was sent despite a failed probe (must be withheld)")
	}
	if !strings.Contains(rec.Body.String(), "Enter withheld") {
		t.Errorf("409 body = %s, want the structured probe error", rec.Body.String())
	}
}

// --- 500 + 200 ---------------------------------------------------------------

// TestOperatorRequestFetchError: a FetchSessions failure is a 500
// (infrastructure fault), NOT a 404 — mirroring the chat endpoints.
func TestOperatorRequestFetchError(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux exploded")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestOperatorRequestSuccess: an idle operator receives the rendered prompt
// through the full injection sequence — baseline capture → set-buffer → paste →
// probe → Enter — every step targeting the OPERATOR's resolved pane %9 (never
// the subject's %1), and the rendered prompt carries the server-derived facts
// and NO client-supplied text (the body's extra field never reaches it).
func TestOperatorRequestSuccess(t *testing.T) {
	for _, state := range []string{"idle", ""} {
		t.Run("state="+state, func(t *testing.T) {
			fastChatSendProbe(t)
			stageFixtureTranscript(t, testChatRef)
			sf := &mockSessionFetcher{result: operatorSessions(state)}
			// The multiline prompt collapses into a fresh paste chip post-paste
			// (absent from the baseline) — a legitimate probe pass.
			ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ [Pasted text #1 +9 lines]"}}
			router := NewTestRouter(slog.Default(), sf, ops, "host")

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name","text":"evil client text"}`))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), `"ok":true`) {
				t.Errorf("200 body = %s, want {\"ok\":true}", rec.Body.String())
			}
			want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys"}
			if strings.Join(ops.chatCalls, ",") != strings.Join(want, ",") {
				t.Errorf("injection order = %v, want %v", ops.chatCalls, want)
			}
			if ops.pasteChatPaneID != "%9" || ops.sendEnterPaneID != "%9" {
				t.Errorf("injection targeted paste=%q enter=%q, want the OPERATOR pane %%9 (never the subject's %%1)",
					ops.pasteChatPaneID, ops.sendEnterPaneID)
			}
			prompt := ops.setChatBufferText
			for _, want := range []string{
				"tmux window @1", `"zsh"`,
				"projects/someproj/" + testChatRef + ".jsonl",
				"worktree /wt/project",
				"fab change 260822-fih1-operator-request-fix-tab-name at stage apply",
				"tmux rename-window -t @1",
				"Do not reply",
			} {
				if !strings.Contains(prompt, want) {
					t.Errorf("prompt missing %q:\n%s", want, prompt)
				}
			}
			if strings.Contains(prompt, "evil client text") {
				t.Errorf("client-supplied text reached the rendered prompt:\n%s", prompt)
			}
		})
	}
}

// --- the fix-tab-name render func --------------------------------------------

// TestRenderFixTabName: the template renders every derived fact plus the exact
// actuation command and the do-not-reply bound; the fab clause appears only
// when FabChange is non-empty.
func TestRenderFixTabName(t *testing.T) {
	facts := operatorFacts{
		WindowID:       "@5",
		Name:           "zsh",
		TranscriptPath: "/home/u/.claude/projects/p/ref.jsonl",
		WorktreePath:   "/wt/project",
	}
	prompt := renderFixTabName(facts)
	for _, want := range []string{
		"tmux window @5", `"zsh"`, "/home/u/.claude/projects/p/ref.jsonl",
		"worktree /wt/project", "tmux rename-window -t @5", "Do not reply",
		"already accurately describes",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "fab change") {
		t.Errorf("empty FabChange rendered a fab clause:\n%s", prompt)
	}

	facts.FabChange, facts.FabStage = "260822-fih1-operator-request-fix-tab-name", "apply"
	prompt = renderFixTabName(facts)
	if !strings.Contains(prompt, "fab change 260822-fih1-operator-request-fix-tab-name at stage apply") {
		t.Errorf("non-empty FabChange did not render the fab clause:\n%s", prompt)
	}
}
