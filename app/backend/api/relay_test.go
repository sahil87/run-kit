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
// Skips the test if tmux is not on PATH.
func withRelayTmux(t *testing.T) (server, real string) {
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
	return server, real
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
// /relay/{session}/{window}?server={tmuxServer} URL.
func dialRelay(t *testing.T, ts *httptest.Server, tmuxServer, session string, window int) *websocket.Conn {
	t.Helper()
	httpURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	wsURL := url.URL{
		Scheme:   "ws",
		Host:     httpURL.Host,
		Path:     fmt.Sprintf("/relay/%s/%d", session, window),
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
	tmuxServer, real := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	connA := dialRelay(t, ts, tmuxServer, real, 0)
	connB := dialRelay(t, ts, tmuxServer, real, 1)
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
	tmuxServer, real := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	connA := dialRelay(t, ts, tmuxServer, real, 0)
	connB := dialRelay(t, ts, tmuxServer, real, 1)

	// Wait briefly so the relay handlers finish creating their ephemerals.
	listCtx, cancelList := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelList()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		names, err := tmux.ListRawSessionNames(listCtx, tmuxServer)
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
		names, err := tmux.ListRawSessionNames(listCtx, tmuxServer)
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

// TestRelay_MissingSessionClose4004 exercises the error path: opening a relay
// to a non-existent real session should close the WebSocket with code 4004
// and not leak any ephemeral on the tmux server.
func TestRelay_MissingSessionClose4004(t *testing.T) {
	tmuxServer, _ := withRelayTmux(t)
	ts := relayServerWithProdTmux(t)
	defer ts.Close()

	httpURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	wsURL := url.URL{
		Scheme:   "ws",
		Host:     httpURL.Host,
		Path:     "/relay/ghost/0",
		RawQuery: fmt.Sprintf("server=%s", tmuxServer),
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatalf("dial relay: %v", err)
	}
	defer conn.Close()

	// Read the close frame; the handler closes with 4004 when the session is
	// missing (either via ListWindows or NewGroupedSession).
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

