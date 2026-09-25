package api

import (
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"sync"
	"time"
)

// Forward-proxy timeouts (named per code-quality; the forward transport mirrors
// proxy.go's 5s dial / 10s response-header shape).
const (
	// proxyConnectDialTimeout bounds the CONNECT upstream dial.
	proxyConnectDialTimeout = 10 * time.Second
	// proxyForwardDialTimeout bounds the absolute-form upstream dial.
	proxyForwardDialTimeout = 5 * time.Second
	// proxyForwardResponseHeaderTimeout bounds the wait for upstream response
	// headers on absolute-form forwards.
	proxyForwardResponseHeaderTimeout = 10 * time.Second
)

// forwardTransport is the dedicated absolute-form transport. Proxy is nil so a
// request is NEVER chained through the daemon's own HTTP_PROXY/HTTPS_PROXY env
// — this host is the proxy.
var forwardTransport = &http.Transport{
	Proxy:                 nil,
	DialContext:           (&net.Dialer{Timeout: proxyForwardDialTimeout}).DialContext,
	ResponseHeaderTimeout: proxyForwardResponseHeaderTimeout,
	MaxIdleConnsPerHost:   10,
}

// forwardReverseProxy forwards absolute-form requests to the request URL's own
// host. No ModifyResponse — bodies pass through verbatim (the opposite of
// /proxy/{port}'s HTML rewrite). ReverseProxy strips hop-by-hop headers
// (Connection + Connection-listed, Keep-Alive, TE, Trailer, Transfer-Encoding,
// Upgrade); Proxy-Connection/Proxy-Authorization are additionally removed
// explicitly so the contract does not rest on the stdlib's hop-header list.
var forwardReverseProxy = &httputil.ReverseProxy{
	Rewrite: func(pr *httputil.ProxyRequest) {
		// pr.Out.URL is a clone of the inbound absolute URL — the forward
		// target. Out.Host is cleared so the outbound Host header comes from
		// the URL, not whatever the client sent.
		pr.Out.Host = ""
		pr.Out.Header.Del("Proxy-Connection")
		pr.Out.Header.Del("Proxy-Authorization")
	},
	Transport: forwardTransport,
	ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Warn("forward proxy: upstream error", "method", r.Method, "url", r.URL.String(), "err", err)
		writeError(w, http.StatusBadGateway, "forward proxy: upstream unreachable")
	},
}

// ForwardProxy wraps the daemon's top-level handler (wired at serve.go's
// http.Server, AHEAD of the chi router) and dispatches HTTP forward-proxy
// traffic: CONNECT authority-form requests are tunnelled, absolute-form
// plain-HTTP requests are forwarded, everything else passes to next unchanged.
//
// There is NO destination policy (dial anything — anyone who can reach rk
// already has a shell through the terminal relay, so a policy is security
// theater), no subprocess (net dialing only, Constitution I), and no state
// beyond live connections (Constitution II). Because the wrapper sits outside
// chi (no Logger/Recoverer), it carries its own per-request panic recovery.
func ForwardProxy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("forward proxy: panic", "method", r.Method, "url", r.URL.String(), "err", rec)
				// Post-hijack this write is a harmless no-op (ErrHijacked).
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		switch {
		case r.Method == http.MethodConnect:
			proxyConnect(w, r)
		case r.URL.IsAbs() && r.URL.Scheme == "http":
			slog.Debug("forward proxy: forward", "method", r.Method, "url", r.URL.String())
			forwardReverseProxy.ServeHTTP(w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// proxyConnect tunnels a CONNECT request: dial the authority, hijack the
// client connection, then bidirectionally copy with close-driven cleanup — no
// fixed deadline, no idle cap (HMR WebSockets and long-polls are long-lived).
func proxyConnect(w http.ResponseWriter, r *http.Request) {
	target := r.Host
	if target == "" {
		target = r.URL.Host
	}
	slog.Debug("forward proxy: CONNECT", "target", target)

	upstream, err := (&net.Dialer{Timeout: proxyConnectDialTimeout}).DialContext(r.Context(), "tcp", target)
	if err != nil {
		slog.Warn("forward proxy: CONNECT dial failed", "target", target, "err", err)
		writeError(w, http.StatusBadGateway, "forward proxy: connect failed")
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		slog.Error("forward proxy: response writer cannot hijack", "target", target)
		writeError(w, http.StatusInternalServerError, "forward proxy: hijack unsupported")
		return
	}
	client, rw, err := hijacker.Hijack()
	if err != nil {
		upstream.Close()
		slog.Warn("forward proxy: hijack failed", "target", target, "err", err)
		return
	}

	if _, err := rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		client.Close()
		upstream.Close()
		return
	}
	if err := rw.Flush(); err != nil {
		client.Close()
		upstream.Close()
		return
	}
	// Any bytes the client pipelined past the CONNECT head belong to the
	// tunnel — forward them before the copies start.
	if buffered := rw.Reader.Buffered(); buffered > 0 {
		if _, err := io.CopyN(upstream, rw.Reader, int64(buffered)); err != nil {
			client.Close()
			upstream.Close()
			return
		}
	}

	// When either direction ends, half-close the other's write side so it
	// observes EOF; once both copies exit, close both conns so neither
	// goroutine nor socket leaks.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		copyHalfClose(upstream, client)
	}()
	go func() {
		defer wg.Done()
		copyHalfClose(client, upstream)
	}()
	wg.Wait()
	client.Close()
	upstream.Close()
	slog.Debug("forward proxy: CONNECT closed", "target", target)
}

// closeWriter is implemented by *net.TCPConn and friends.
type closeWriter interface {
	CloseWrite() error
}

func copyHalfClose(dst, src net.Conn) {
	_, _ = io.Copy(dst, src)
	if cw, ok := dst.(closeWriter); ok {
		_ = cw.CloseWrite()
	}
}
