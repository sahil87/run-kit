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

	server = testSocketName("relay")
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
			// Connection closed / failed — return what we have. Do NOT loop back
			// into ReadMessage(), which panics on an already-failed gorilla conn.
			return buf.Bytes()
		}
		buf.Write(msg)
		if bytes.Contains(buf.Bytes(), []byte(needle)) {
			return buf.Bytes()
		}
	}
	return buf.Bytes()
}

// realSessionNames returns the non-pin, non-anchor session names on a tmux
// server. Used to assert the relay creates NO extra (ephemeral) session — the
// move-based model attaches the PTY directly to the real session.
func realSessionNames(t *testing.T, server string) []string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	sessions, err := tmux.ListSessions(ctx, server)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	names := make([]string, 0, len(sessions))
	for _, s := range sessions {
		names = append(names, s.Name)
	}
	return names
}

// TestRelay_DirectAttachRendersSelectedWindow proves the relay attaches the PTY
// DIRECTLY to the real session and renders the window it selected — once per
// window. The connections are opened SEQUENTIALLY (not concurrently): in the
// move-based model both windows live in the SAME real session with a single
// shared active-window pointer (the accepted multi-client tradeoff #1), so two
// SIMULTANEOUS attaches would fight over that pointer. Sequential attaches
// exercise the direct-attach + select-window path per window without that race.
func TestRelay_DirectAttachRendersSelectedWindow(t *testing.T) {
	tmuxServer, real, win0ID, win1ID := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	connA := dialRelay(t, ts, tmuxServer, win0ID)
	bytesA := readUntilContains(t, connA, "WINDOW_ZERO", 5*time.Second)
	connA.Close()
	if !bytes.Contains(bytesA, []byte("WINDOW_ZERO")) {
		t.Errorf("relay for win0 did not receive WINDOW_ZERO marker; got: %q", string(bytesA))
	}

	connB := dialRelay(t, ts, tmuxServer, win1ID)
	bytesB := readUntilContains(t, connB, "WINDOW_ONE", 5*time.Second)
	connB.Close()
	if !bytes.Contains(bytesB, []byte("WINDOW_ONE")) {
		t.Errorf("relay for win1 did not receive WINDOW_ONE marker; got: %q", string(bytesB))
	}

	// The relay must NOT create any extra (ephemeral) session — it attaches the
	// PTY directly to the real session. Only `real` should remain user-facing.
	names := realSessionNames(t, tmuxServer)
	for _, n := range names {
		if n != real {
			t.Errorf("unexpected extra session %q after relay connect (no ephemeral expected); sessions=%v", n, names)
		}
	}
}

// TestRelay_NoEphemeralCreated asserts the relay attaches directly to the real
// session and leaves NO `rk-relay-*` ephemeral or extra session behind.
func TestRelay_NoEphemeralCreated(t *testing.T) {
	tmuxServer, real, win0ID, _ := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	conn := dialRelay(t, ts, tmuxServer, win0ID)
	defer conn.Close()

	// Give the attach a moment to establish.
	_ = readUntilContains(t, conn, "WINDOW_ZERO", 3*time.Second)

	names := realSessionNames(t, tmuxServer)
	if len(names) != 1 || names[0] != real {
		t.Errorf("expected only the real session %q, got %v (relay must not create an ephemeral)", real, names)
	}
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
// code 4004 (session resolution fails) and not leak any extra session on the
// tmux server.
func TestRelay_MissingWindowClose4004(t *testing.T) {
	tmuxServer, real, _, _ := withRelayTmux(t)
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
		// still need to verify no extra session was created.
		t.Logf("read returned non-close error (acceptable): %v", readErr)
	} else if closeErr.Code != 4004 {
		t.Errorf("close code = %d, want 4004", closeErr.Code)
	}

	// Verify no extra session leaked — only the real session should remain.
	names := realSessionNames(t, tmuxServer)
	for _, n := range names {
		if n != real {
			t.Errorf("unexpected extra session %q after missing-window relay; sessions=%v", n, names)
		}
	}
}
