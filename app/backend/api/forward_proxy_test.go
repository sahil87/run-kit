package api

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"rk/internal/testutil"
)

func forwardProxyLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// startEchoUpstream starts a raw-TCP echo server on loopback. It accepts ONE
// connection, echoes bytes until EOF, and closes the returned channel when the
// accepted connection's copy loop exits (the close-cleanup signal).
func startEchoUpstream(t *testing.T) (addr string, closed <-chan struct{}) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		io.Copy(conn, conn)
		conn.Close()
	}()
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().String(), done
}

// connectTunnel dials the proxy server, issues CONNECT to target, and returns
// the tunnelled connection plus a reader that drains anything already buffered
// past the response head.
func connectTunnel(t *testing.T, proxyAddr, target string) (net.Conn, *bufio.Reader) {
	t.Helper()
	conn, err := net.Dial("tcp", proxyAddr)
	if err != nil {
		t.Fatalf("dial proxy: %v", err)
	}
	fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		t.Fatalf("read CONNECT status line: %v", err)
	}
	if !strings.Contains(statusLine, " 200 ") {
		conn.Close()
		t.Fatalf("CONNECT status line = %q, want 200", strings.TrimSpace(statusLine))
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			conn.Close()
			t.Fatalf("read CONNECT head: %v", err)
		}
		if line == "\r\n" {
			break
		}
	}
	return conn, br
}

func proxyServerAddr(srv *httptest.Server) string {
	return strings.TrimPrefix(srv.URL, "http://")
}

// bufferedConn routes reads through the buffered reader first, so bytes a
// bufio.Reader already pulled past the CONNECT head are not lost.
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c bufferedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

func TestForwardProxyConnectBidirectional(t *testing.T) {
	upstreamAddr, _ := startEchoUpstream(t)
	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	srv := httptest.NewServer(ForwardProxy(router))
	defer srv.Close()

	conn, br := connectTunnel(t, proxyServerAddr(srv), upstreamAddr)
	defer conn.Close()

	for _, msg := range []string{"hello-tunnel", "second-round-trip"} {
		if _, err := conn.Write([]byte(msg)); err != nil {
			t.Fatalf("write %q: %v", msg, err)
		}
		buf := make([]byte, len(msg))
		if _, err := io.ReadFull(br, buf); err != nil {
			t.Fatalf("read echo of %q: %v", msg, err)
		}
		if string(buf) != msg {
			t.Errorf("echo = %q, want %q", buf, msg)
		}
	}
}

// A WebSocket upgrade rides the established CONNECT tunnel (Chromium sends
// ws:// and wss:// through an HTTP proxy via CONNECT).
func TestForwardProxyConnectWebSocket(t *testing.T) {
	upgrader := websocket.Upgrader{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			mt, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			if err := c.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	upstreamAddr := proxyServerAddr(upstream)

	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	srv := httptest.NewServer(ForwardProxy(router))
	defer srv.Close()

	conn, br := connectTunnel(t, proxyServerAddr(srv), upstreamAddr)
	defer conn.Close()

	wsURL := &url.URL{Scheme: "ws", Host: upstreamAddr, Path: "/ws"}
	ws, resp, err := websocket.NewClient(bufferedConn{conn, br}, wsURL, nil, 1024, 1024)
	if err != nil {
		t.Fatalf("websocket handshake over tunnel: %v", err)
	}
	defer ws.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("upgrade status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}

	if err := ws.WriteMessage(websocket.TextMessage, []byte("ws-over-connect")); err != nil {
		t.Fatalf("ws write: %v", err)
	}
	mt, msg, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	if mt != websocket.TextMessage || string(msg) != "ws-over-connect" {
		t.Errorf("ws echo = (%d, %q), want (%d, %q)", mt, msg, websocket.TextMessage, "ws-over-connect")
	}
}

func TestForwardProxyConnectDialFailure(t *testing.T) {
	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	srv := httptest.NewServer(ForwardProxy(router))
	defer srv.Close()

	conn, err := net.Dial("tcp", proxyServerAddr(srv))
	if err != nil {
		t.Fatalf("dial proxy: %v", err)
	}
	defer conn.Close()
	// Port 1 on loopback refuses immediately.
	fmt.Fprintf(conn, "CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n")
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read status line: %v", err)
	}
	if !strings.Contains(statusLine, " 502 ") {
		t.Errorf("CONNECT status line = %q, want 502", strings.TrimSpace(statusLine))
	}
}

// Closing the client side of an established tunnel MUST close the upstream
// connection and let the copy goroutines exit — close-driven lifetime, no
// deadline, no leak.
func TestForwardProxyConnectCloseDrivenCleanup(t *testing.T) {
	upstreamAddr, upstreamClosed := startEchoUpstream(t)
	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	srv := httptest.NewServer(ForwardProxy(router))
	defer srv.Close()

	before := runtime.NumGoroutine()

	conn, br := connectTunnel(t, proxyServerAddr(srv), upstreamAddr)
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatalf("write: %v", err)
	}
	buf := make([]byte, len("ping"))
	if _, err := io.ReadFull(br, buf); err != nil {
		t.Fatalf("read echo: %v", err)
	}

	conn.Close()

	testutil.MustWaitUntil(t, 5*time.Second, func() bool {
		select {
		case <-upstreamClosed:
			return true
		default:
			return false
		}
	}, "upstream conn did not close after client disconnect")
	testutil.MustWaitUntil(t, 5*time.Second, func() bool {
		return runtime.NumGoroutine() <= before
	}, "goroutine count did not settle: before=%d now=%d", before, runtime.NumGoroutine())
}

// A peer that keeps its read side open after FIN (never writes back, never
// closes) MUST NOT strand the tunnel: the first completed copy closes both
// conns, the other copy unwinds, and the handler exits.
func TestForwardProxyConnectPeerHoldingReadOpen(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	holdOpen := make(chan struct{})
	t.Cleanup(func() { close(holdOpen) })
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// Drain until the client's FIN, then hold OUR write side open — the
		// long-lived tunnel behavior that used to leak the reverse copy.
		_, _ = io.Copy(io.Discard, conn)
		<-holdOpen
	}()

	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	srv := httptest.NewServer(ForwardProxy(router))
	defer srv.Close()

	before := runtime.NumGoroutine()

	conn, _ := connectTunnel(t, proxyServerAddr(srv), ln.Addr().String())
	defer conn.Close()
	if err := conn.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatalf("half-close client: %v", err)
	}

	testutil.MustWaitUntil(t, 5*time.Second, func() bool {
		return runtime.NumGoroutine() <= before
	}, "goroutine count did not settle: before=%d now=%d", before, runtime.NumGoroutine())
}

func TestForwardProxyAbsoluteForm(t *testing.T) {
	var gotHeader http.Header
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Clone()
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("X-Upstream", "yes")
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte("verbatim-body"))
	}))
	defer upstream.Close()

	handler := ForwardProxy(NewTestRouter(forwardProxyLogger(), nil, nil, "test-host"))

	req := httptest.NewRequest(http.MethodGet, upstream.URL+"/some/path?q=1", strings.NewReader("payload"))
	req.Header.Set("Proxy-Connection", "keep-alive")
	req.Header.Set("Proxy-Authorization", "Basic abc")
	req.Header.Set("Connection", "X-Foo")
	req.Header.Set("X-Foo", "bar")
	req.Header.Set("X-Keep", "me")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d (response verbatim)", rec.Code, http.StatusCreated)
	}
	if rec.Body.String() != "verbatim-body" {
		t.Errorf("body = %q, want %q (response verbatim)", rec.Body.String(), "verbatim-body")
	}
	if rec.Header().Get("X-Upstream") != "yes" {
		t.Errorf("X-Upstream = %q, want %q", rec.Header().Get("X-Upstream"), "yes")
	}

	if string(gotBody) != "payload" {
		t.Errorf("upstream body = %q, want %q", gotBody, "payload")
	}
	if gotHeader.Get("X-Keep") != "me" {
		t.Errorf("upstream X-Keep = %q, want %q", gotHeader.Get("X-Keep"), "me")
	}
	for _, h := range []string{"Proxy-Connection", "Proxy-Authorization", "X-Foo"} {
		if v := gotHeader.Get(h); v != "" {
			t.Errorf("upstream %s = %q, want stripped", h, v)
		}
	}
	if gotHeader.Get("Connection") == "X-Foo" {
		t.Errorf("upstream Connection = %q, want the client's hop-by-hop value stripped", gotHeader.Get("Connection"))
	}
}

func TestForwardProxyAbsoluteFormUpstreamRefusal(t *testing.T) {
	handler := ForwardProxy(NewTestRouter(forwardProxyLogger(), nil, nil, "test-host"))

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1/refused", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadGateway)
	}
}

// The forward transport has Proxy: nil — a bogus HTTP_PROXY in the daemon's
// environment MUST NOT chain the request away from the real upstream.
func TestForwardProxyIgnoresProxyEnv(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("http_proxy", "http://127.0.0.1:1")

	reached := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached <- struct{}{}
		w.Write([]byte("direct"))
	}))
	defer upstream.Close()

	handler := ForwardProxy(NewTestRouter(forwardProxyLogger(), nil, nil, "test-host"))
	req := httptest.NewRequest(http.MethodGet, upstream.URL+"/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	select {
	case <-reached:
	default:
		t.Fatalf("request did not reach the real upstream with HTTP_PROXY=%q", "http://127.0.0.1:1")
	}
	if rec.Code != http.StatusOK || rec.Body.String() != "direct" {
		t.Errorf("status/body = %d/%q, want 200/%q", rec.Code, rec.Body.String(), "direct")
	}
}

// Origin-form requests are not proxy-shaped and reach the chi router
// byte-for-byte as before.
func TestForwardProxyPassthrough(t *testing.T) {
	isolateSettings(t)
	router := NewTestRouter(forwardProxyLogger(), nil, nil, "test-host")
	handler := ForwardProxy(router)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Errorf("body = %q, want the router's health response", rec.Body.String())
	}
}
