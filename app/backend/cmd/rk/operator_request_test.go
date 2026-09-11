package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// resetOperatorRequestFlags restores the subcommand's package-level flag vars
// and pflag Changed state — cobra does not reset these between Execute calls
// (the resetMuxFlags problem).
func resetOperatorRequestFlags() {
	operatorRequestWindow = ""
	operatorRequestText = ""
	operatorRequestSession = ""
	operatorRequestServer = ""
	operatorRequestList = false
	operatorRequestJSON = false
	for _, name := range []string{"window", "text", "session", "server", "list", "json"} {
		if f := operatorRequestCmd.Flags().Lookup(name); f != nil {
			_ = f.Value.Set(f.DefValue)
			f.Changed = false
		}
	}
	// cobra never resets its own --help flag between Execute calls — a --help
	// run latches it true and every later run prints help instead of executing.
	if f := operatorRequestCmd.Flags().Lookup("help"); f != nil {
		_ = f.Value.Set("false")
		f.Changed = false
	}
}

// runOperatorRequestCmd drives `rk operator request <args...>` through the real
// cobra Execute seam (the runMuxCmd pattern) so flag parsing and exit
// classification run exactly as in production.
func runOperatorRequestCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetOperatorRequestFlags()
	t.Cleanup(resetOperatorRequestFlags)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"operator", "request"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// operatorRequestRecorder is an httptest handler recording every request the
// verb makes, answering with the configured status/body.
type operatorRequestRecorder struct {
	t          *testing.T
	status     int
	body       string
	requests   int
	gotMethod  string
	gotPath    string
	gotQuery   string
	gotBody    map[string]string
	gotRawBody []byte
}

func (r *operatorRequestRecorder) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.requests++
		r.gotMethod = req.Method
		r.gotPath = req.URL.Path
		r.gotQuery = req.URL.RawQuery
		data, _ := io.ReadAll(req.Body)
		r.gotRawBody = data
		_ = json.Unmarshal(data, &r.gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(r.status)
		_, _ = w.Write([]byte(r.body))
	}))
}

// stubOperatorRequestTMUX drives the server-label default through the $TMUX
// seam (the real tmux.OriginalTMUX is fixed at package-init time).
func stubOperatorRequestTMUX(t *testing.T, tmuxEnv string) {
	t.Helper()
	orig := operatorOriginalTMUXFn
	operatorOriginalTMUXFn = func() string { return tmuxEnv }
	t.Cleanup(func() { operatorOriginalTMUXFn = orig })
}

// TestOperatorRequestRegisteredUnderOperator: the verb is a child of the
// existing operator command and the parent's own contract is unchanged.
func TestOperatorRequestRegisteredUnderOperator(t *testing.T) {
	found := false
	for _, cmd := range operatorCmd.Commands() {
		if cmd.Name() == "request" {
			found = true
		}
	}
	if !found {
		t.Error("expected a 'request' subcommand registered on operatorCmd")
	}
	if operatorCmd.Args == nil || operatorCmd.RunE == nil {
		t.Error("operatorCmd must keep its own Args validator and RunE")
	}
	if err := operatorCmd.Args(operatorCmd, []string{"stray"}); err == nil {
		t.Error("rk operator <stray> must still be rejected (NoArgs)")
	}
}

// TestOperatorRequestHelpNamesTheSurface: --help exits 0 naming the positional
// and every flag.
func TestOperatorRequestHelpNamesTheSurface(t *testing.T) {
	stdout, _, err := runOperatorRequestCmd(t, "--help")
	if err != nil {
		t.Fatalf("--help err = %v", err)
	}
	for _, want := range []string{"<template>", "--window", "--text", "--session", "--list", "--json", "--server"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("--help missing %q:\n%s", want, stdout)
		}
	}
}

// TestOperatorRequestUsageErrorsMakeNoHTTPCall: every pre-flight rule in the
// R2 table exits 2 before any network call.
func TestOperatorRequestUsageErrorsMakeNoHTTPCall(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		wantMsg string
	}{
		{"unknown template", []string{"bogus"}, `unknown operator template "bogus"`},
		{"unknown template names --list", []string{"bogus"}, "rk operator request --list"},
		{"server-scoped rejects --window", []string{"brief-me", "--window", "@3"}, `server-scoped; drop --window`},
		{"window-scoped requires --window", []string{"fix-tab-name"}, `window-scoped; pass --window @N`},
		{"text on a closed template", []string{"brief-me", "--text", "x"}, `does not accept --text`},
		{"session on a non-acceptor", []string{"brief-me", "--session", "run-kit"}, `does not accept --session`},
		{"malformed window, bare number", []string{"fix-tab-name", "--window", "7"}, "--window must be a tmux window ID"},
		{"malformed window, pane id", []string{"fix-tab-name", "--window", "%3"}, "--window must be a tmux window ID"},
		{"invalid -L value", []string{"brief-me", "-L", "bad!name"}, "Server name must contain only"},
		{"--list with a positional", []string{"brief-me", "--list"}, "--list takes no template argument"},
		{"no positional", nil, "exactly one template argument"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
			srv := rec.server()
			defer srv.Close()
			pointConfigAt(t, srv.URL)
			stubOperatorRequestTMUX(t, "")

			stdout, stderr, err := runOperatorRequestCmd(t, tc.args...)
			if err == nil || exitCode(err) != 2 {
				t.Fatalf("err = %v, want a usage-class error (exit 2)", err)
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Errorf("error %q missing %q", err.Error(), tc.wantMsg)
			}
			if rec.requests != 0 {
				t.Errorf("daemon received %d requests on a pre-flight failure, want 0", rec.requests)
			}
			if stdout != "" {
				t.Errorf("stdout = %q on a usage error, want empty", stdout)
			}
			if !strings.Contains(stderr, "Error:") {
				t.Errorf("stderr = %q, want cobra's Error: line", stderr)
			}
		})
	}
}

// TestOperatorRequestWindowScopedHappyPath: a window-scoped template POSTs to
// the window route with the bare template body and yields the receipt with the
// fixed field order.
func TestOperatorRequestWindowScopedHappyPath(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	stdout, _, err := runOperatorRequestCmd(t, "annotate-tab", "--window", "@7", "-L", "runkit", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", rec.gotMethod)
	}
	if rec.gotPath != "/api/windows/@7/operator-request" {
		t.Errorf("path = %q, want /api/windows/@7/operator-request", rec.gotPath)
	}
	if rec.gotQuery != "server=runkit" {
		t.Errorf("query = %q, want server=runkit", rec.gotQuery)
	}
	if len(rec.gotBody) != 1 || rec.gotBody["template"] != "annotate-tab" {
		t.Errorf("body = %v (%s), want exactly the template key", rec.gotBody, rec.gotRawBody)
	}
	want := "{\n  \"ok\": true,\n  \"result\": {\n    \"template\": \"annotate-tab\",\n    \"window\": \"@7\",\n    \"queued\": false\n  }\n}\n"
	if stdout != want {
		t.Errorf("stdout = %q, want exactly %q (fixed receipt field order)", stdout, want)
	}
}

// TestOperatorRequestServerScopedHappyPath: a server-scoped template POSTs to
// the server route, carries --text when accepted, and prints the human report.
func TestOperatorRequestServerScopedHappyPath(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	stdout, _, err := runOperatorRequestCmd(t, "spawn-task", "--text", "fix the flaky spec")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.gotPath != "/api/operator-request" {
		t.Errorf("path = %q, want /api/operator-request", rec.gotPath)
	}
	if rec.gotQuery != "server=default" {
		t.Errorf("query = %q, want server=default (no $TMUX)", rec.gotQuery)
	}
	if len(rec.gotBody) != 2 || rec.gotBody["template"] != "spawn-task" || rec.gotBody["text"] != "fix the flaky spec" {
		t.Errorf("body = %v (%s), want template + text only", rec.gotBody, rec.gotRawBody)
	}
	if stdout != "delivered spawn-task\n" {
		t.Errorf("stdout = %q, want the delivered report line", stdout)
	}
}

// TestOperatorRequestSessionFlagOnAcceptor: update-annotations accepts
// --session and the body carries it.
func TestOperatorRequestSessionFlagOnAcceptor(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	if _, _, err := runOperatorRequestCmd(t, "update-annotations", "--session", "run-kit"); err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.gotBody["session"] != "run-kit" || rec.gotBody["template"] != "update-annotations" {
		t.Errorf("body = %v, want template + session", rec.gotBody)
	}
}

// TestOperatorRequest202QueuedIsSuccess: a busy operator's 202 is a success
// receipt (queued:true, exit 0) — the lane queues work, it does not refuse it.
func TestOperatorRequest202QueuedIsSuccess(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusAccepted, body: `{"queued":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	t.Run("human", func(t *testing.T) {
		stdout, stderr, err := runOperatorRequestCmd(t, "brief-me")
		if err != nil {
			t.Fatalf("err = %v, want exit 0 — a 202 is a success", err)
		}
		if stdout != "queued brief-me\n" {
			t.Errorf("stdout = %q, want the queued report line", stdout)
		}
		if !strings.Contains(stderr, "operator is busy") {
			t.Errorf("stderr = %q, want the queued note", stderr)
		}
	})

	t.Run("json", func(t *testing.T) {
		stdout, stderr, err := runOperatorRequestCmd(t, "brief-me", "--json")
		if err != nil {
			t.Fatalf("err = %v, want exit 0 — a 202 is a success", err)
		}
		want := "{\n  \"ok\": true,\n  \"result\": {\n    \"template\": \"brief-me\",\n    \"queued\": true\n  }\n}\n"
		if stdout != want {
			t.Errorf("stdout = %q, want exactly %q (no window key server-scoped)", stdout, want)
		}
		if !strings.Contains(stderr, "operator is busy") {
			t.Errorf("stderr = %q, want the queued note even under --json", stderr)
		}
	})
}

// TestOperatorRequestChatTemplateReceipt: user-message (window-scoped,
// acceptsText) POSTs to the window route with text and echoes the window in
// the receipt.
func TestOperatorRequestChatTemplateReceipt(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	stdout, _, err := runOperatorRequestCmd(t, "user-message", "--window", "@2", "--text", "hi", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	want := "{\n  \"ok\": true,\n  \"result\": {\n    \"template\": \"user-message\",\n    \"window\": \"@2\",\n    \"queued\": false\n  }\n}\n"
	if stdout != want {
		t.Errorf("stdout = %q, want exactly %q", stdout, want)
	}
}

// TestOperatorRequest400MapsToUsage: the daemon's 400 passes through as a
// usage-class error (exit 2) carrying the daemon's message.
func TestOperatorRequest400MapsToUsage(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusBadRequest, body: `{"error":"operator template \"brief-me\" requires a non-empty text"}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	_, _, err := runOperatorRequestCmd(t, "brief-me")
	if err == nil || exitCode(err) != 2 {
		t.Fatalf("err = %v, want exit 2", err)
	}
	if !strings.Contains(err.Error(), "requires a non-empty text") {
		t.Errorf("error %q must carry the daemon's message", err.Error())
	}

	stdout, _, err := runOperatorRequestCmd(t, "brief-me", "--json")
	if err == nil || exitCode(err) != 2 {
		t.Fatalf("--json err = %v, want exit 2", err)
	}
	want := "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"usage\",\n    \"message\": \"operator template \\\"brief-me\\\" requires a non-empty text\"\n  }\n}\n"
	if stdout != want {
		t.Errorf("stdout = %q, want exactly %q", stdout, want)
	}
}

// TestOperatorRequest409CarriesReasonCode: a structured 409 rides the daemon's
// code field through as the envelope's reason (exit 1, operational).
func TestOperatorRequest409CarriesReasonCode(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusConflict, body: `{"error":"staged send failed: tmux refused","code":"staged_send_failure"}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	stdout, _, err := runOperatorRequestCmd(t, "brief-me", "--json")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	want := "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"operational\",\n    \"message\": \"staged send failed: tmux refused\",\n    \"reason\": \"staged_send_failure\"\n  }\n}\n"
	if stdout != want {
		t.Errorf("stdout = %q, want exactly %q", stdout, want)
	}
	if err.Error() != "staged send failed: tmux refused" {
		t.Errorf("error = %q, want the daemon's message verbatim", err.Error())
	}
}

// TestOperatorRequestNonJSONErrorFallsBack: a non-JSON error body reports the
// status, never an empty message.
func TestOperatorRequestNonJSONErrorFallsBack(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusInternalServerError, body: "oops"}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")

	_, _, err := runOperatorRequestCmd(t, "brief-me")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if !strings.Contains(err.Error(), "run-kit daemon answered 500") {
		t.Errorf("error %q, want the fallback status message", err.Error())
	}
}

// TestOperatorRequestUnreachableDaemon: the verb is NOT fail-silent — a
// transport failure is exit 1 with a message and, under --json, the hint.
func TestOperatorRequestUnreachableDaemon(t *testing.T) {
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1") // privileged/unused — connection refused
	stubOperatorRequestTMUX(t, "")
	orig := operatorRequestTimeout
	operatorRequestTimeout = 2 * time.Second
	t.Cleanup(func() { operatorRequestTimeout = orig })

	_, stderr, err := runOperatorRequestCmd(t, "brief-me")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1 (not fail-silent)", err)
	}
	if !strings.Contains(err.Error(), "run-kit daemon unreachable at http://127.0.0.1:1") {
		t.Errorf("error %q, want the unreachable message naming the origin", err.Error())
	}
	if !strings.Contains(stderr, "Error:") {
		t.Errorf("stderr = %q, want the error line", stderr)
	}

	stdout, _, err := runOperatorRequestCmd(t, "brief-me", "--json")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("--json err = %v, want exit 1", err)
	}
	var doc struct {
		OK    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
			Hint string `json:"hint"`
		} `json:"error"`
	}
	if err := json.Unmarshal(bytes.TrimSpace([]byte(stdout)), &doc); err != nil {
		t.Fatalf("--json stdout is not one document: %v (%q)", err, stdout)
	}
	if doc.OK || doc.Error.Code != "operational" || doc.Error.Hint != "start it with rk daemon start" {
		t.Errorf("document = %+v, want ok:false operational with the daemon hint", doc)
	}
}

// TestOperatorRequestServerLabelDefault: with no -L, the ?server= value is the
// caller's tmux socket basename (cliServerLabel over the $TMUX seam).
func TestOperatorRequestServerLabelDefault(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{"ok":true}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "/tmp/tmux-1000/runkit,123,0")

	if _, _, err := runOperatorRequestCmd(t, "brief-me"); err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.gotQuery != "server=runkit" {
		t.Errorf("query = %q, want server=runkit (the $TMUX socket basename)", rec.gotQuery)
	}
}

// TestOperatorRequestListHuman: --list prints the registry sorted by id, scope
// word then declared flags, with no HTTP call.
func TestOperatorRequestListHuman(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)

	stdout, _, err := runOperatorRequestCmd(t, "--list")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.requests != 0 {
		t.Errorf("--list made %d HTTP requests, want 0", rec.requests)
	}
	lines := strings.Split(strings.TrimSuffix(stdout, "\n"), "\n")
	if len(lines) != 9 {
		t.Fatalf("--list printed %d lines, want 9:\n%s", len(lines), stdout)
	}
	if !strings.HasPrefix(lines[0], "annotate-tab") ||
		!strings.Contains(lines[0], "window") ||
		!strings.Contains(lines[0], "requiresAgentSessionRef") {
		t.Errorf("first line = %q, want annotate-tab window requiresAgentSessionRef", lines[0])
	}
	var userMessageLine string
	for _, l := range lines {
		if strings.HasPrefix(l, "user-message") {
			userMessageLine = l
		}
	}
	if !strings.Contains(userMessageLine, "acceptsText chatDelivery") {
		t.Errorf("user-message line = %q, want acceptsText chatDelivery", userMessageLine)
	}
}

// TestOperatorRequestListJSON: --list --json wraps the nine descriptors under a
// templates key, ids ascending, with no HTTP call.
func TestOperatorRequestListJSON(t *testing.T) {
	rec := &operatorRequestRecorder{t: t, status: http.StatusOK, body: `{}`}
	srv := rec.server()
	defer srv.Close()
	pointConfigAt(t, srv.URL)

	stdout, _, err := runOperatorRequestCmd(t, "--list", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if rec.requests != 0 {
		t.Errorf("--list made %d HTTP requests, want 0", rec.requests)
	}
	var doc struct {
		OK     bool `json:"ok"`
		Result struct {
			Templates []struct {
				ID           string `json:"id"`
				ServerScoped bool   `json:"serverScoped"`
			} `json:"templates"`
		} `json:"result"`
	}
	if err := json.Unmarshal(bytes.TrimSpace([]byte(stdout)), &doc); err != nil {
		t.Fatalf("--list --json stdout is not one document: %v (%q)", err, stdout)
	}
	if !doc.OK {
		t.Error("--list --json must be ok:true")
	}
	if len(doc.Result.Templates) != 9 {
		t.Fatalf("templates = %d, want 9", len(doc.Result.Templates))
	}
	for i, tmpl := range doc.Result.Templates {
		if i > 0 && doc.Result.Templates[i-1].ID >= tmpl.ID {
			t.Errorf("ids out of ascending order at %d: %q then %q", i, doc.Result.Templates[i-1].ID, tmpl.ID)
		}
	}
	if doc.Result.Templates[0].ID != "annotate-tab" {
		t.Errorf("first id = %q, want annotate-tab", doc.Result.Templates[0].ID)
	}
}

// TestOperatorRequestTimeoutBound: the POST context is bounded by
// operatorRequestTimeout — a hung daemon yields the unreachable-class error
// once the bound expires (the var is shrunk so the test never waits 20s).
func TestOperatorRequestTimeoutBound(t *testing.T) {
	// The handler blocks until the test releases it: blocking on the request
	// context instead would keep the keep-alive connection active and wedge
	// httptest's Close (which waits on outstanding handlers).
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer func() {
		close(release)
		srv.Close()
	}()
	pointConfigAt(t, srv.URL)
	stubOperatorRequestTMUX(t, "")
	orig := operatorRequestTimeout
	operatorRequestTimeout = 50 * time.Millisecond
	t.Cleanup(func() { operatorRequestTimeout = orig })

	_, _, err := runOperatorRequestCmd(t, "brief-me")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1 on a hung daemon past the bound", err)
	}
	if !strings.Contains(err.Error(), "run-kit daemon unreachable") {
		t.Errorf("error %q, want the unreachable-class message", err.Error())
	}
}
