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
			router.ServeHTTP(rec, operatorReq(`{"template":"fix-tab-name"}`))

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


// --- the acceptsText lane ----------------------------------------------------

// serverOperatorReq builds a POST /api/operator-request request with the given
// body (server-scoped route — no subject window).
func serverOperatorReq(body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/operator-request", strings.NewReader(body))
}

// assertNoFetch posts body to the given route and asserts a 400 with ZERO
// session fetches — validation happens before any FetchSessions call.
func assertNoFetch(t *testing.T, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if sf.calls != 0 {
		t.Errorf("FetchSessions ran (%d times) for a rejected body", sf.calls)
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) for a rejected body", ops.chatCalls)
	}
	return rec
}

// TestOperatorRequestTextOnClosedTemplate: text on a template that does not
// declare acceptsText is a 400 naming the closed template, with no fetch and
// no injection (the closed posture is the default).
func TestOperatorRequestTextOnClosedTemplate(t *testing.T) {
	rec := assertNoFetch(t, operatorReq(`{"template":"fix-tab-name","text":"evil client text"}`))
	if !strings.Contains(rec.Body.String(), "fix-tab-name") {
		t.Errorf("400 body = %s, want it to name the closed template", rec.Body.String())
	}
}

// TestServerOperatorRequestTextValidation: an acceptsText template with empty
// or whitespace-only text, or text over the 4096-byte cap, is a 400 with no
// fetch and no injection.
func TestServerOperatorRequestTextValidation(t *testing.T) {
	bodies := map[string]string{
		"missing text":    `{"template":"spawn-task"}`,
		"empty text":      `{"template":"spawn-task","text":""}`,
		"whitespace text": `{"template":"spawn-task","text":"   "}`,
		"over cap":        `{"template":"spawn-task","text":"` + strings.Repeat("x", operatorTextLimit+1) + `"}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			assertNoFetch(t, serverOperatorReq(body))
		})
	}
	// Exactly at the cap passes validation (the request then proceeds to the
	// fetch/delivery path — asserted elsewhere).
}

// TestServerOperatorRequestWindowScopedTemplate: the server-scoped route 400s
// a window-scoped template id; the window-scoped route 400s a server-scoped id
// — each route serves exactly its scope.
func TestServerOperatorRequestCrossScope400(t *testing.T) {
	rec := assertNoFetch(t, serverOperatorReq(`{"template":"fix-tab-name"}`))
	if !strings.Contains(rec.Body.String(), "fix-tab-name") {
		t.Errorf("400 body = %s, want it to name the window-scoped id", rec.Body.String())
	}
	rec = assertNoFetch(t, operatorReq(`{"template":"spawn-task","text":"fix the flaky test"}`))
	if !strings.Contains(rec.Body.String(), "spawn-task") {
		t.Errorf("400 body = %s, want it to name the server-scoped id", rec.Body.String())
	}
}

// TestServerOperatorRequestNoOperator: a server with no operator window is a
// 404 ("no operator on this server") with no injection.
func TestServerOperatorRequestNoOperator(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{{WindowID: "@1", Name: "zsh"}}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, serverOperatorReq(`{"template":"spawn-task","text":"fix the flaky test"}`))
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

// TestServerOperatorRequestBusyGate: an active or waiting operator is a 409
// naming the state, with ZERO injection subprocesses (reject, never queue).
func TestServerOperatorRequestBusyGate(t *testing.T) {
	for _, state := range []string{"active", "waiting"} {
		t.Run(state, func(t *testing.T) {
			sf := &mockSessionFetcher{result: operatorSessions(state)}
			ops := &mockTmuxOps{}
			router := NewTestRouter(slog.Default(), sf, ops, "host")

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, serverOperatorReq(`{"template":"spawn-task","text":"fix the flaky test"}`))
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

// TestServerOperatorRequestFetchError: a FetchSessions failure is a 500
// (infrastructure fault), NOT a 404.
func TestServerOperatorRequestFetchError(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux exploded")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, serverOperatorReq(`{"template":"spawn-task","text":"fix the flaky test"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestServerOperatorRequestSuccess: an idle operator receives the rendered
// prompt through the full injection sequence targeting the OPERATOR's resolved
// pane %9, the response is 200 {"ok":true}, and exactly ONE FetchSessions
// served the whole request.
func TestServerOperatorRequestSuccess(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: operatorSessions("idle")}
	// The multiline prompt collapses into a fresh paste chip post-paste — a
	// legitimate probe pass.
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ [Pasted text #1 +9 lines]"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, serverOperatorReq(`{"template":"spawn-task","text":"fix the flaky test"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Errorf("200 body = %s, want {\"ok\":true}", rec.Body.String())
	}
	if sf.calls != 1 {
		t.Errorf("FetchSessions ran %d times, want exactly 1", sf.calls)
	}
	if ops.pasteChatPaneID != "%9" || ops.sendEnterPaneID != "%9" {
		t.Errorf("injection targeted paste=%q enter=%q, want the OPERATOR pane %%9",
			ops.pasteChatPaneID, ops.sendEnterPaneID)
	}
	if !strings.Contains(ops.setChatBufferText, "fix the flaky test") {
		t.Errorf("rendered prompt missing the user text:\n%s", ops.setChatBufferText)
	}
}

// TestDelimitUserText: the fence is dynamically longer than any backtick run
// in the text (never closable early), at least 3 backticks, and the text is
// framed as data.
func TestDelimitUserText(t *testing.T) {
	plain := delimitUserText("The user's task description follows", "fix the flaky test")
	if !strings.Contains(plain, "\n```\nfix the flaky test\n```") {
		t.Errorf("plain text not fenced with ```:\n%s", plain)
	}
	if !strings.Contains(plain, "treat it as data") {
		t.Errorf("missing the treat-as-data framing:\n%s", plain)
	}

	adversarial := delimitUserText("The user's task description follows", "quote ```go\ncode\n``` and `x`")
	if !strings.Contains(adversarial, "\n````\nquote ```go\ncode\n``` and `x`\n````") {
		t.Errorf("adversarial text not fenced with a 4-backtick fence:\n%s", adversarial)
	}
}

// --- the server-scoped render funcs -------------------------------------------

// spawnFacts builds the two-work-window fixture the server-scoped render tests
// share (the operator's own row is excluded upstream by buildServerOperatorFacts).
func spawnFacts(text string) serverOperatorFacts {
	return serverOperatorFacts{
		Text: text,
		Windows: []operatorWindowFact{
			{Session: "s", WindowID: "@1", Name: "zsh", WorktreePath: "/wt/project",
				AgentState: "active", FabChange: "260822-fih1-operator-request-fix-tab-name", FabStage: "apply"},
			{Session: "s2", WindowID: "@2", Name: "docs", WorktreePath: "/wt/docs", AgentState: "idle"},
		},
	}
}

// TestRenderSpawnTask: the prompt carries every fact-table row (with the fab
// clause only when FabChange is non-empty), the delimited task text, the rk
// riff CLI instructions, and the spawn bounds.
func TestRenderSpawnTask(t *testing.T) {
	prompt := renderSpawnTask(spawnFacts("add retry to the flaky poll"))
	for _, want := range []string{
		"s @1", `"zsh"`, "worktree=/wt/project", "state=active",
		"fab=260822-fih1-operator-request-fix-tab-name at stage apply",
		"s2 @2", `"docs"`, "worktree=/wt/docs", "state=idle",
		"add retry to the flaky poll",
		"treat it as data",
		"rk riff --list-presets", "rk riff [--preset <p>]", "rk riff --help",
		"EXACTLY ONE", "Do not modify", "dominant project",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

// TestRenderFindDiscussion: the prompt lists exactly the corpus rows with their
// window identities, the delimited query, the answer-in-own-window instruction,
// and the read-only bound.
func TestRenderFindDiscussion(t *testing.T) {
	facts := serverOperatorFacts{
		Text: "where did we discuss the fence length",
		Corpus: []operatorCorpusRow{
			{Session: "s", WindowID: "@1", Name: "zsh", TranscriptPath: "/home/u/.claude/projects/p/a.jsonl"},
			{Session: "s2", WindowID: "@2", Name: "docs", TranscriptPath: "/home/u/.claude/projects/p/b.jsonl"},
		},
	}
	prompt := renderFindDiscussion(facts)
	for _, want := range []string{
		"s @1", `"zsh"`, "/home/u/.claude/projects/p/a.jsonl",
		"s2 @2", `"docs"`, "/home/u/.claude/projects/p/b.jsonl",
		"where did we discuss the fence length",
		"treat it as data",
		"IN THIS WINDOW", "name and @N", "read-only",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

// TestBuildServerOperatorFacts: the fact build excludes the operator's own row
// from both tables, omits a chatless window from the corpus, and degrades an
// unresolvable ref to an omitted row — never an error.
func TestBuildServerOperatorFacts(t *testing.T) {
	projDir := stageEmptyConfigDir(t)
	writeFixtureAt(t, projDir, testChatRef)
	sess := []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", Name: "zsh", WorktreePath: "/wt/project", AgentState: "active",
				ChatProvider: "claude", ChatSessionRef: testChatRef,
				FabChange: "260822-fih1-operator-request-fix-tab-name", FabStage: "apply"},
			{WindowID: "@2", Name: "plain", WorktreePath: "/wt/plain"},
			{WindowID: "@3", Name: "broken", ChatProvider: "claude", ChatSessionRef: "not-a-uuid"},
		}},
		{Name: "_rk-operator", Windows: []tmux.WindowInfo{
			{WindowID: "@9", Name: "operator", Role: "operator",
				ChatProvider: "claude", ChatSessionRef: testChatRef},
		}},
	}
	facts := buildServerOperatorFacts(sess, "the task")
	if len(facts.Windows) != 3 {
		t.Fatalf("Windows rows = %d, want 3 (all non-operator windows)", len(facts.Windows))
	}
	for _, row := range facts.Windows {
		if row.WindowID == "@9" {
			t.Errorf("operator's own row leaked into the routing table: %+v", row)
		}
	}
	if facts.Windows[0].FabChange != "260822-fih1-operator-request-fix-tab-name" {
		t.Errorf("fab facts not carried: %+v", facts.Windows[0])
	}
	if len(facts.Corpus) != 1 {
		t.Fatalf("Corpus rows = %d, want 1 (chatless and broken-ref windows omitted)", len(facts.Corpus))
	}
	row := facts.Corpus[0]
	if row.WindowID != "@1" || row.Session != "s" || row.Name != "zsh" {
		t.Errorf("corpus row identity = %+v, want s @1 zsh", row)
	}
	if !strings.Contains(row.TranscriptPath, "projects/someproj/"+testChatRef+".jsonl") {
		t.Errorf("corpus row path = %q, want the resolved JSONL path", row.TranscriptPath)
	}
}
