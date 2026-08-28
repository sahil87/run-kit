package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"rk/internal/tmux"
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
	// Keep the deep-link derivation inert so the test never invokes the real
	// tmux binary when the test process itself runs inside a tmux pane.
	t.Setenv("TMUX_PANE", "")
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

// stubNotifyDeriveSeams installs recording stubs for the two present.go seams
// deriveNotifyURL consumes, restoring the real implementations on cleanup.
// Returns a pointer to the recorded tmux invocations.
func stubNotifyDeriveSeams(t *testing.T, tmuxEnv, out string, outErr error) *[][]string {
	t.Helper()
	calls := &[][]string{}
	presentOriginalTMUXFn = func() string { return tmuxEnv }
	presentRunOutputFn = func(ctx context.Context, args []string) ([]byte, error) {
		*calls = append(*calls, args)
		if outErr != nil {
			return nil, outErr
		}
		return []byte(out), nil
	}
	t.Cleanup(func() {
		presentOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
		presentRunOutputFn = func(ctx context.Context, args []string) ([]byte, error) {
			return tmux.RunOutput(ctx, args, tmux.RunOpts{})
		}
	})
	return calls
}

func resetNotifyFlagState(t *testing.T) {
	t.Helper()
	reset := func() {
		for _, name := range []string{"title", "url"} {
			if f := notifyCmd.Flags().Lookup(name); f != nil {
				_ = f.Value.Set("")
				f.Changed = false
			}
		}
	}
	reset()
	t.Cleanup(reset)
}

func TestDeriveNotifyURL_composesWindowRoute(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls := stubNotifyDeriveSeams(t, "/tmp/tmux-1000/noon,123,0", "@57\n", nil)

	got := deriveNotifyURL(context.Background())

	if got != "/noon/57" {
		t.Errorf("deriveNotifyURL = %q, want %q", got, "/noon/57")
	}
	if len(*calls) != 1 {
		t.Fatalf("tmux invocations = %d, want 1", len(*calls))
	}
	want := []string{"-S", "/tmp/tmux-1000/noon", "display-message", "-pt", "%3", "#{window_id}"}
	if !reflect.DeepEqual((*calls)[0], want) {
		t.Errorf("tmux args = %v, want %v", (*calls)[0], want)
	}
}

func TestDeriveNotifyURL_escapesSegments(t *testing.T) {
	t.Setenv("TMUX_PANE", "%1")
	stubNotifyDeriveSeams(t, "/tmp/tmux-1000/my server,1,0", "@8\n", nil)

	if got := deriveNotifyURL(context.Background()); got != "/my%20server/8" {
		t.Errorf("deriveNotifyURL = %q, want %q", got, "/my%20server/8")
	}
}

// TestNotify_derivationFailureModesPostWithoutURL drives every derivation
// failure mode through the full RunE → POST path (R4/A-008): the captured
// request body must carry no url key at all, and RunE must return nil.
func TestNotify_derivationFailureModesPostWithoutURL(t *testing.T) {
	cases := []struct {
		name    string
		pane    string
		tmuxEnv string
		out     string
		outErr  error
	}{
		{name: "no TMUX_PANE", pane: "", tmuxEnv: "/tmp/tmux-1000/noon,1,0", out: "@5\n"},
		{name: "malformed TMUX", pane: "%3", tmuxEnv: "", out: "@5\n"},
		{name: "tmux error", pane: "%3", tmuxEnv: "/tmp/tmux-1000/noon,1,0", outErr: errors.New("no server")},
		{name: "tmux timeout", pane: "%3", tmuxEnv: "/tmp/tmux-1000/noon,1,0", outErr: context.DeadlineExceeded},
		{name: "invalid window id", pane: "%3", tmuxEnv: "/tmp/tmux-1000/noon,1,0", out: "garbage\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resetNotifyFlagState(t)
			var gotBody map[string]string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(data, &gotBody)
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			pointConfigAt(t, srv.URL)
			t.Setenv("TMUX_PANE", tc.pane)
			calls := stubNotifyDeriveSeams(t, tc.tmuxEnv, tc.out, tc.outErr)

			if err := notifyCmd.RunE(notifyCmd, []string{"msg"}); err != nil {
				t.Fatalf("RunE returned %v, want nil (fail-silent)", err)
			}
			if got := deriveNotifyURL(context.Background()); got != "" {
				t.Errorf("deriveNotifyURL = %q, want empty", got)
			}
			if _, ok := gotBody["url"]; ok {
				t.Errorf("payload carries url key %q on derivation failure, want key absent", gotBody["url"])
			}
			if gotBody["body"] != "msg" {
				t.Errorf("body = %q, want %q (the send must still happen)", gotBody["body"], "msg")
			}
			if tc.pane == "" && len(*calls) != 0 {
				t.Errorf("tmux invoked %d time(s) with no $TMUX_PANE, want 0", len(*calls))
			}
		})
	}
}

// TestNotify_emptyURLFlagOptsOut asserts the explicit opt-out contract (R2):
// `--url=` (set but empty) suppresses derivation AND sends no url key.
func TestNotify_emptyURLFlagOptsOut(t *testing.T) {
	resetNotifyFlagState(t)
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	t.Setenv("TMUX_PANE", "%3")
	calls := stubNotifyDeriveSeams(t, "/tmp/tmux-1000/noon,123,0", "@57\n", nil)

	if err := notifyCmd.Flags().Set("url", ""); err != nil {
		t.Fatalf("set --url=: %v", err)
	}
	if err := notifyCmd.RunE(notifyCmd, []string{"msg"}); err != nil {
		t.Fatalf("RunE returned %v, want nil", err)
	}
	if _, ok := gotBody["url"]; ok {
		t.Errorf("payload carries url key %q with explicit --url=, want key absent (opt-out)", gotBody["url"])
	}
	if len(*calls) != 0 {
		t.Errorf("tmux invoked %d time(s) with --url= set, want 0 (derivation suppressed)", len(*calls))
	}
}

// TestNotify_derivedURLInPayload drives RunE end to end: an in-pane invocation
// with no --url carries the derived window route in the POST body.
func TestNotify_derivedURLInPayload(t *testing.T) {
	resetNotifyFlagState(t)
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	t.Setenv("TMUX_PANE", "%3")
	stubNotifyDeriveSeams(t, "/tmp/tmux-1000/noon,123,0", "@57\n", nil)

	if err := notifyCmd.RunE(notifyCmd, []string{"turn complete"}); err != nil {
		t.Fatalf("RunE returned %v, want nil", err)
	}
	if gotBody["url"] != "/noon/57" {
		t.Errorf("body url = %q, want %q", gotBody["url"], "/noon/57")
	}
	if gotBody["body"] != "turn complete" {
		t.Errorf("body = %q, want %q", gotBody["body"], "turn complete")
	}
}

// TestNotify_urlFlagSkipsDerivation asserts an explicit --url passes through
// verbatim and suppresses the tmux lookup entirely.
func TestNotify_urlFlagSkipsDerivation(t *testing.T) {
	resetNotifyFlagState(t)
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	t.Setenv("TMUX_PANE", "%3")
	calls := stubNotifyDeriveSeams(t, "/tmp/tmux-1000/noon,123,0", "@57\n", nil)

	if err := notifyCmd.Flags().Set("url", "/custom/7"); err != nil {
		t.Fatalf("set --url: %v", err)
	}
	if err := notifyCmd.RunE(notifyCmd, []string{"msg"}); err != nil {
		t.Fatalf("RunE returned %v, want nil", err)
	}
	if gotBody["url"] != "/custom/7" {
		t.Errorf("body url = %q, want %q", gotBody["url"], "/custom/7")
	}
	if len(*calls) != 0 {
		t.Errorf("tmux invoked %d time(s) with --url set, want 0 (derivation skipped)", len(*calls))
	}
}

// TestNotify_noURLKeyOutsideTmux asserts the back-compat contract: with no
// derivable route the payload carries no url key at all — byte-identical to
// the pre-deep-link behavior.
func TestNotify_noURLKeyOutsideTmux(t *testing.T) {
	resetNotifyFlagState(t)
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	t.Setenv("TMUX_PANE", "")

	if err := notifyCmd.RunE(notifyCmd, []string{"msg"}); err != nil {
		t.Fatalf("RunE returned %v, want nil", err)
	}
	if _, ok := gotBody["url"]; ok {
		t.Errorf("payload carries url key %q outside tmux, want key absent", gotBody["url"])
	}
}
