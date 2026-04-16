package api

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

// proxyCache holds per-port ReverseProxy instances. Keyed by port number.
// sync.Map is appropriate here: read-heavy, write-rare, single-digit entry count.
var proxyCache sync.Map

// rewritePattern matches localhost/127.0.0.1 URLs in HTML attributes.
// Captures: (http:|)(//localhost:{port}) or (http:|)(//127.0.0.1:{port})
var rewritePattern = regexp.MustCompile(
	`(https?:)?//(localhost|127\.0\.0\.1):(\d+)`,
)

// getOrCreateProxy returns a cached ReverseProxy for the given port, creating
// one on demand if absent.
func getOrCreateProxy(port int) *httputil.ReverseProxy {
	key := port
	if cached, ok := proxyCache.Load(key); ok {
		return cached.(*httputil.ReverseProxy)
	}

	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("127.0.0.1:%d", port),
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			// Strip the /proxy/{port} prefix from the path
			origPath := r.Out.URL.Path
			prefix := fmt.Sprintf("/proxy/%d", port)
			r.Out.URL.Path = strings.TrimPrefix(origPath, prefix)
			if r.Out.URL.Path == "" {
				r.Out.URL.Path = "/"
			}
			r.Out.URL.RawPath = ""
			r.Out.Host = target.Host
		},
		ModifyResponse: makeModifyResponse(port),
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConnsPerHost:   10,
		},
	}

	actual, _ := proxyCache.LoadOrStore(key, proxy)
	return actual.(*httputil.ReverseProxy)
}

// makeModifyResponse returns a ModifyResponse function that rewrites HTML
// responses, replacing localhost:{port} references with /proxy/{port} paths.
func makeModifyResponse(port int) func(*http.Response) error {
	return func(resp *http.Response) error {
		ct := resp.Header.Get("Content-Type")
		if !strings.Contains(ct, "text/html") {
			return nil
		}

		var reader io.ReadCloser
		var isGzipped bool

		switch resp.Header.Get("Content-Encoding") {
		case "gzip":
			isGzipped = true
			var err error
			reader, err = gzip.NewReader(resp.Body)
			if err != nil {
				return nil // Can't decompress — pass through unchanged
			}
			defer reader.Close()
		default:
			reader = resp.Body
		}

		body, err := io.ReadAll(reader)
		if err != nil {
			return nil // Read error — pass through
		}

		rewritten := rewriteHTML(body, port)

		if isGzipped {
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			if _, err := gz.Write(rewritten); err != nil {
				gz.Close()
				// Fall back to uncompressed
				resp.Body = io.NopCloser(bytes.NewReader(rewritten))
				resp.ContentLength = int64(len(rewritten))
				resp.Header.Del("Content-Encoding")
				return nil
			}
			gz.Close()
			rewritten = buf.Bytes()
			resp.Body = io.NopCloser(bytes.NewReader(rewritten))
			resp.ContentLength = int64(len(rewritten))
		} else {
			resp.Body = io.NopCloser(bytes.NewReader(rewritten))
			resp.ContentLength = int64(len(rewritten))
		}

		return nil
	}
}

// rewriteHTML replaces localhost:{port} and 127.0.0.1:{port} references in HTML
// with /proxy/{port} paths.
func rewriteHTML(body []byte, proxyPort int) []byte {
	return rewritePattern.ReplaceAllFunc(body, func(match []byte) []byte {
		submatch := rewritePattern.FindSubmatch(match)
		if len(submatch) < 4 {
			return match
		}
		matchedPort, err := strconv.Atoi(string(submatch[3]))
		if err != nil {
			return match
		}
		return []byte(fmt.Sprintf("/proxy/%d", matchedPort))
	})
}

// handleProxy is the HTTP handler for /proxy/{port}/*
func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	portStr := chi.URLParam(r, "port")
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		writeError(w, http.StatusBadRequest, "invalid port")
		return
	}

	proxy := getOrCreateProxy(port)
	proxy.ServeHTTP(w, r)
}
