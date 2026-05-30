package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"rk/internal/tmux"
)

// withRelayTmux starts an isolated tmux server with a single real session
// containing two windows whose payloads are deterministic (echo + sleep) so a
// relay client can identify which window it is attached to from the PTY bytes.
// Skips the test if tmux is not on PATH. Returns the live window IDs (@N) for
// the two windows in list-order so callers can address them by stable ID.
func withRelayTmux(t *testing.T) (server, real, win0ID, win1ID string) {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}

	server = fmt.Sprintf("rk-relay-test-%d-%d", os.Getpid(), time.Now().UnixNano())
	real = "real"

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelBoot()
	// Window 0: print WINDOW_ZERO then idle for the test duration.
	cmd := exec.CommandContext(bootCtx, "tmux", "-L", server,
		"new-session", "-d", "-s", real, "-x", "80", "-y", "24",
		"-n", "win0", "sh", "-c", "printf 'WINDOW_ZERO\\n'; sleep 30")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}

	// Window 1: print WINDOW_ONE then idle.
	addCtx, cancelAdd := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelAdd()
	addCmd := exec.CommandContext(addCtx, "tmux", "-L", server,
		"new-window", "-t", real, "-n", "win1", "sh", "-c", "printf 'WINDOW_ONE\\n'; sleep 30")
	if out, err := addCmd.CombinedOutput(); err != nil {
		t.Fatalf("create second window: %v\n%s", err, string(out))
	}

	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})

	// Resolve the live window IDs (@N) by index so tests can address windows by
	// their stable ID rather than a mutable index.
	listCtx, cancelList := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelList()
	windows, err := tmux.ListWindows(listCtx, real, server)
	if err != nil {
		t.Fatalf("list windows: %v", err)
	}
	for _, win := range windows {
		switch win.Index {
		case 0:
			win0ID = win.WindowID
		case 1:
			win1ID = win.WindowID
		}
	}
	if win0ID == "" || win1ID == "" {
		t.Fatalf("could not resolve window IDs (got win0=%q win1=%q) from %+v", win0ID, win1ID, windows)
	}
	return server, real, win0ID, win1ID
}

// relayServerWithProdTmux returns an httptest.Server whose router is wired
// against the real tmux package (prodTmuxOps). A live tmux server is required.
func relayServerWithProdTmux(t *testing.T) *httptest.Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	router := NewTestRouter(logger, &prodSessionFetcher{}, &prodTmuxOps{}, "test-host")
	return httptest.NewServer(router)
}

// dialRelay opens a WebSocket relay connection to the given server's
// /relay/{windowId}?server={tmuxServer} URL. The window's owning session is
// resolved server-side from the window ID.
func dialRelay(t *testing.T, ts *httptest.Server, tmuxServer, windowID string) *websocket.Conn {
	t.Helper()
	httpURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	wsURL := url.URL{
		Scheme:   "ws",
		Host:     httpURL.Host,
		Path:     fmt.Sprintf("/relay/%s", windowID),
		RawQuery: fmt.Sprintf("server=%s", tmuxServer),
	}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		body := ""
		if resp != nil {
			body = fmt.Sprintf(" status=%d", resp.StatusCode)
		}
		t.Fatalf("dial relay %s: %v%s", wsURL.String(), err, body)
	}
	// Send the initial resize message so the PTY starts at the expected size.
	resize := struct {
		Type string `json:"type"`
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}{Type: "resize", Cols: 80, Rows: 24}
	body, err := json.Marshal(resize)
	if err != nil {
		t.Fatalf("marshal resize: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, body); err != nil {
		t.Fatalf("write resize: %v", err)
	}
	return conn
}

// readUntilContains reads PTY messages from the WebSocket up to deadline,
// concatenating bytes and returning once the buffer contains needle (or
// deadline elapses, in which case the accumulated bytes are returned).
func readUntilContains(t *testing.T, conn *websocket.Conn, needle string, deadline time.Duration) []byte {
	t.Helper()
	end := time.Now().Add(deadline)
	var buf bytes.Buffer
	for time.Now().Before(end) {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			// Read deadline exceeded is expected during polling; only bail on
			// permanent failures.
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			if strings.Contains(err.Error(), "i/o timeout") || strings.Contains(err.Error(), "deadline exceeded") {
				continue
			}
			// Connection closed — return what we have.
			return buf.Bytes()
		}
		buf.Write(msg)
		if bytes.Contains(buf.Bytes(), []byte(needle)) {
			return buf.Bytes()
		}
	}
	return buf.Bytes()
}

func TestRelay_TwoWindowsTwoRelaysDistinctOutput(t *testing.T) {
	tmuxServer, _, win0ID, win1ID := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	connA := dialRelay(t, ts, tmuxServer, win0ID)
	connB := dialRelay(t, ts, tmuxServer, win1ID)
	defer connA.Close()
	defer connB.Close()

	// Read enough bytes from each to capture the echo'd window markers.
	bytesA := readUntilContains(t, connA, "WINDOW_ZERO", 5*time.Second)
	bytesB := readUntilContains(t, connB, "WINDOW_ONE", 5*time.Second)

	if !bytes.Contains(bytesA, []byte("WINDOW_ZERO")) {
		t.Errorf("relay A did not receive WINDOW_ZERO marker; got: %q", string(bytesA))
	}
	if !bytes.Contains(bytesB, []byte("WINDOW_ONE")) {
		t.Errorf("relay B did not receive WINDOW_ONE marker; got: %q", string(bytesB))
	}
	// The central bug-fix invariant: each relay only sees its own window's
	// content, never the other's.
	if bytes.Contains(bytesA, []byte("WINDOW_ONE")) {
		t.Errorf("relay A leaked WINDOW_ONE content (would indicate the active-window bug); got: %q", string(bytesA))
	}
	if bytes.Contains(bytesB, []byte("WINDOW_ZERO")) {
		t.Errorf("relay B leaked WINDOW_ZERO content (would indicate the active-window bug); got: %q", string(bytesB))
	}
}

func TestRelay_EphemeralCleanupOnClose(t *testing.T) {
	tmuxServer, _, win0ID, win1ID := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	connA := dialRelay(t, ts, tmuxServer, win0ID)
	connB := dialRelay(t, ts, tmuxServer, win1ID)

	// Helper that uses a fresh per-call timeout so the surrounding polling
	// loops never run past a shared parent deadline (which previously made
	// this test flaky once the cleanup wait outlived the original 3s ctx).
	listRelaySessions := func() ([]string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return tmux.ListRawSessionNames(ctx, tmuxServer)
	}

	// Wait briefly so the relay handlers finish creating their ephemerals.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		names, err := listRelaySessions()
		if err == nil {
			n := 0
			for _, name := range names {
				if strings.HasPrefix(name, tmux.RelaySessionPrefix) {
					n++
				}
			}
			if n >= 2 {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Close both WebSockets; the relay handlers' deferred KillSessionCtx must
	// reap the ephemerals.
	connA.Close()
	connB.Close()

	// Poll until no rk-relay-* sessions remain (cleanup is best-effort and
	// runs after the goroutine sees the WS close).
	cleanupDeadline := time.Now().Add(5 * time.Second)
	var lastNames []string
	for time.Now().Before(cleanupDeadline) {
		names, err := listRelaySessions()
		if err != nil {
			t.Fatalf("ListRawSessionNames: %v", err)
		}
		lastNames = names
		any := false
		for _, name := range names {
			if strings.HasPrefix(name, tmux.RelaySessionPrefix) {
				any = true
				break
			}
		}
		if !any {
			return // success
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("rk-relay-* sessions persisted after WebSocket close: %v", lastNames)
}

// TestRelay_PercentEncodedAtNot400 is a regression: clients URL-encode '@'
// as '%40' via encodeURIComponent in path segments, and chi v5 preserves the
// encoded form in URLParam. The handler must percent-decode before validating,
// or every relay attempt 400s before the WebSocket upgrade.
//
// A plain HTTP GET (no Upgrade header) is sufficient — the validation gate
// runs before upgrader.Upgrade and would 400 the encoded form. After the fix
// the request reaches upgrader.Upgrade, which 400s with "Bad Request"
// (different body) because there is no Upgrade header. We assert the body
// does NOT match the validation error.
func TestRelay_PercentEncodedAtNot400(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	router := NewTestRouter(logger, &mockSessionFetcher{}, &mockTmuxOps{}, "test-host")
	ts := httptest.NewServer(router)
	defer ts.Close()

	req := httptest.NewRequest("GET", "/relay/%4018?server=default", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	body := rec.Body.String()
	if strings.Contains(body, "Window ID must be a tmux window ID") {
		t.Errorf("validation rejected percent-encoded '@'; body=%q", body)
	}
}

// TestRelay_MissingWindowClose4004 exercises the error path: opening a relay
// to a well-formed but non-existent window ID should close the WebSocket with
// code 4004 (session resolution fails) and not leak any ephemeral on the tmux
// server.
func TestRelay_MissingWindowClose4004(t *testing.T) {
	tmuxServer, _, _, _ := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	httpURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	wsURL := url.URL{
		Scheme:   "ws",
		Host:     httpURL.Host,
		Path:     "/relay/@9999",
		RawQuery: fmt.Sprintf("server=%s", tmuxServer),
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatalf("dial relay: %v", err)
	}
	defer conn.Close()

	// Read the close frame; the handler closes with 4004 when the window's
	// owning session cannot be resolved.
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, readErr := conn.ReadMessage()
	if readErr == nil {
		t.Fatal("expected close from server, got message")
	}
	closeErr, ok := readErr.(*websocket.CloseError)
	if !ok {
		// The server may abort without a clean close frame in some paths; we
		// still need to verify no ephemeral was created.
		t.Logf("read returned non-close error (acceptable): %v", readErr)
	} else if closeErr.Code != 4004 {
		t.Errorf("close code = %d, want 4004", closeErr.Code)
	}

	// Verify no rk-relay-* leaked.
	listCtx, cancelList := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelList()
	names, err := tmux.ListRawSessionNames(listCtx, tmuxServer)
	if err != nil {
		t.Fatalf("ListRawSessionNames: %v", err)
	}
	for _, name := range names {
		if strings.HasPrefix(name, tmux.RelaySessionPrefix) {
			t.Errorf("ephemeral leaked after missing-session relay: %s", name)
		}
	}
}

// TestRelay_OwnerStampFailureAbortsClean exercises the abort-clean path: when
// the @rk_owner_pid stamp fails after the ephemeral grouped session is created,
// handleRelay MUST close the WebSocket with the relay-allocation code (4001) and
// reap the half-owned ephemeral via the deferred KillSessionCtx — so no live
// but unstamped relay survives (which the next sweep would wrongly reap as an
// owner=="" orphan). Uses mockTmuxOps to inject the stamp failure deterministically
// after a successful session resolution and NewGroupedSession.
func TestRelay_OwnerStampFailureAbortsClean(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	ops := &mockTmuxOps{
		resolveWindowSessionResult: "real-session",
		setSessionOwnerPIDErr:      fmt.Errorf("stamp failed: tmux unreachable"),
	}
	router := NewTestRouter(logger, &mockSessionFetcher{}, ops, "test-host")
	ts := httptest.NewServer(router)
	defer ts.Close()

	httpURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	wsURL := url.URL{
		Scheme:   "ws",
		Host:     httpURL.Host,
		Path:     "/relay/@1",
		RawQuery: "server=default",
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatalf("dial relay: %v", err)
	}
	defer conn.Close()

	// The handler must close with 4001 once the owner-pid stamp fails.
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, readErr := conn.ReadMessage()
	if readErr == nil {
		t.Fatal("expected close from server, got message")
	}
	if closeErr, ok := readErr.(*websocket.CloseError); ok {
		if closeErr.Code != 4001 {
			t.Errorf("close code = %d, want 4001", closeErr.Code)
		}
	} else {
		t.Logf("read returned non-close error (acceptable): %v", readErr)
	}

	// The stamp must have been attempted, and the ephemeral reaped by the
	// deferred KillSessionCtx so no unstamped relay survives.
	if !ops.setSessionOwnerPIDCalled {
		t.Error("SetSessionOwnerPID was not called — stamp path not exercised")
	}
	if !ops.killSessionCalled {
		t.Error("ephemeral was not reaped after stamp failure (deferred KillSessionCtx not invoked)")
	}
	if ops.killSessionName != ops.newGroupedSessionEphemeral {
		t.Errorf("reaped session = %q, want the created ephemeral %q",
			ops.killSessionName, ops.newGroupedSessionEphemeral)
	}
}
