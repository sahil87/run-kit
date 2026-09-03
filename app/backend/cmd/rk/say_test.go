package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rk/internal/tmux"
)

func TestSayCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "say" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'say' subcommand to be registered on rootCmd")
	}
}

// stubSayTmux points the tmux-context derivation seams at the given $TMUX value
// and display-message result; an empty tmuxEnv models "not inside tmux".
func stubSayTmux(t *testing.T, tmuxEnv string, windowID string, err error) {
	t.Helper()
	sayOriginalTMUXFn = func() string { return tmuxEnv }
	sayRunOutputFn = func(context.Context, []string) ([]byte, error) {
		if err != nil {
			return nil, err
		}
		return []byte(windowID + "\n"), nil
	}
	t.Cleanup(func() {
		sayOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
		sayRunOutputFn = func(ctx context.Context, args []string) ([]byte, error) {
			return tmux.RunOutput(ctx, args, tmux.RunOpts{})
		}
	})
}

func TestSay_postsText(t *testing.T) {
	var gotBody map[string]string
	var gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	// Outside tmux: no server/window derivation.
	stubSayTmux(t, "", "", nil)

	sendSay(context.Background(), "deploy finished")

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/api/say" {
		t.Errorf("path = %q, want /api/say", gotPath)
	}
	if gotBody["text"] != "deploy finished" {
		t.Errorf("text = %q, want %q", gotBody["text"], "deploy finished")
	}
	if _, ok := gotBody["server"]; ok {
		t.Errorf("server present outside tmux: %v", gotBody)
	}
	if _, ok := gotBody["window"]; ok {
		t.Errorf("window present outside tmux: %v", gotBody)
	}
}

// TestSay_postsTmuxContext: inside a tmux pane, the POST body carries the
// caller's server (socket basename) and @N window id.
func TestSay_postsTmuxContext(t *testing.T) {
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	t.Setenv("TMUX_PANE", "%7")
	stubSayTmux(t, "/tmp/tmux-1000/rk-test-x,1234,0", "@3", nil)

	sendSay(context.Background(), "staged: make test")

	if gotBody["server"] != "rk-test-x" {
		t.Errorf("server = %q, want %q", gotBody["server"], "rk-test-x")
	}
	if gotBody["window"] != "@3" {
		t.Errorf("window = %q, want %q", gotBody["window"], "@3")
	}
}

// TestSay_omitsContextOnDerivationFailure: any derivation failure (no
// $TMUX_PANE, a failed display-message, an implausible window id) omits BOTH
// fields silently.
func TestSay_omitsContextOnDerivationFailure(t *testing.T) {
	for name, tc := range map[string]struct {
		paneEnv  string
		tmuxEnv  string
		windowID string
		err      error
	}{
		"no TMUX_PANE":          {paneEnv: "", tmuxEnv: "/tmp/rk-test-x.sock,1,0", windowID: "@3"},
		"display-message fails": {paneEnv: "%7", tmuxEnv: "/tmp/rk-test-x.sock,1,0", err: errors.New("no pane")},
		"invalid window id":     {paneEnv: "%7", tmuxEnv: "/tmp/rk-test-x.sock,1,0", windowID: "garbage"},
	} {
		t.Run(name, func(t *testing.T) {
			var gotBody map[string]string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(data, &gotBody)
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()
			pointConfigAt(t, srv.URL)
			t.Setenv("TMUX_PANE", tc.paneEnv)
			stubSayTmux(t, tc.tmuxEnv, tc.windowID, tc.err)

			sendSay(context.Background(), "msg")

			if _, ok := gotBody["server"]; ok {
				t.Errorf("server present despite failed derivation: %v", gotBody)
			}
			if _, ok := gotBody["window"]; ok {
				t.Errorf("window present despite failed derivation: %v", gotBody)
			}
			if gotBody["text"] != "msg" {
				t.Errorf("text = %q, want %q", gotBody["text"], "msg")
			}
		})
	}
}

func TestSay_failSilentOnUnreachable(t *testing.T) {
	// Point at a port nothing is listening on; sendSay must not panic or
	// surface anything — it simply returns.
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1") // privileged/unused — connection refused
	stubSayTmux(t, "", "", nil)

	sendSay(context.Background(), "msg")
}

func TestSay_failSilentOnNon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	pointConfigAt(t, srv.URL)
	stubSayTmux(t, "", "", nil)

	// A 500 is swallowed: no panic, no surfaced error.
	sendSay(context.Background(), "msg")
}

func TestSayCmd_RunEReturnsNil(t *testing.T) {
	// Even with no reachable server, RunE must return nil (fail-silent).
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", "1")
	stubSayTmux(t, "", "", nil)
	if err := sayCmd.RunE(sayCmd, []string{"hello"}); err != nil {
		t.Errorf("RunE returned %v, want nil (fail-silent)", err)
	}
}
