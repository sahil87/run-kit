package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNotifyCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "notify" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'notify' subcommand to be registered on rootCmd")
	}
}

// pointConfigAt sets RK_HOST/RK_PORT so config.Load() resolves to the given
// test server's host:port.
func pointConfigAt(t *testing.T, serverURL string) {
	t.Helper()
	// serverURL looks like http://127.0.0.1:PORT
	hostport := strings.TrimPrefix(serverURL, "http://")
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		t.Fatalf("split host:port from %q: %v", serverURL, err)
	}
	t.Setenv("RK_HOST", host)
	t.Setenv("RK_PORT", port)
}

func TestNotify_postsTitleAndBody(t *testing.T) {
	var gotBody map[string]string
	var gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"sent":0,"pruned":0}`))
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)

	sendNotify(context.Background(), "CI", "deploy done")

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/api/notify" {
		t.Errorf("path = %q, want /api/notify", gotPath)
	}
	if gotBody["title"] != "CI" {
		t.Errorf("title = %q, want %q", gotBody["title"], "CI")
	}
	if gotBody["body"] != "deploy done" {
		t.Errorf("body = %q, want %q", gotBody["body"], "deploy done")
	}
}

func TestNotify_failSilentOnUnreachable(t *testing.T) {
	// Point at a port nothing is listening on; sendNotify must not panic or
	// surface anything — it simply returns.
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1") // privileged/unused — connection refused

	// No assertion beyond "does not panic / returns": the fail-silent contract
	// is that the function returns without error and RunE returns nil.
	sendNotify(context.Background(), "", "msg")
}

func TestNotify_failSilentOnNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)

	// A 500 is swallowed: no panic, no surfaced error.
	sendNotify(context.Background(), "", "msg")
}

func TestNotifyCmd_RunEReturnsNil(t *testing.T) {
	// Even with no reachable server, RunE must return nil (fail-silent).
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1")
	if err := notifyCmd.RunE(notifyCmd, []string{"hello"}); err != nil {
		t.Errorf("RunE returned %v, want nil (fail-silent)", err)
	}
}

// TestNotify_usesTmuxOptionOrigin asserts that with no explicit RK_HOST/RK_PORT
// env, a pane in a covered server POSTs to the daemon-stamped @rk_origin.
func TestNotify_usesTmuxOptionOrigin(t *testing.T) {
	var gotPath string
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	t.Setenv("RK_HOST", "")
	t.Setenv("RK_PORT", "")
	stubOriginSeams(t, originTestSocket+",1234,0", srv.URL+"\n", nil)

	sendNotify(context.Background(), "", "msg")

	if !hit {
		t.Fatal("expected the POST to target the @rk_origin origin; no request received")
	}
	if gotPath != "/api/notify" {
		t.Errorf("path = %q, want /api/notify", gotPath)
	}
}

// TestNotify_envWinsOverTmuxOption asserts explicit RK_HOST/RK_PORT beat a
// stamped @rk_origin (deliberate operator override).
func TestNotify_envWinsOverTmuxOption(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	pointConfigAt(t, srv.URL)
	// A stamped option pointing elsewhere must be ignored in favor of env.
	stubOriginSeams(t, originTestSocket+",1234,0", "http://127.0.0.1:1\n", nil)

	sendNotify(context.Background(), "", "msg")

	if !hit {
		t.Error("expected the POST to target the env-derived origin; no request received")
	}
}
