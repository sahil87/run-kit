package api

// Own-origin present routing (R2/R3): a request whose Host identifies a presented
// app's port is reverse-proxied to 127.0.0.1:{port} AT ROOT (no path prefix), so
// the app owns its whole path space — root-absolute assets and client-side routing
// work with no shim, no rescue, no base-path race. Two Host shapes carry the port:
//
//   - subdomain label  "{port}.{base}[:N]"   (base ∈ {localhost, base_domain})
//                                             — the loopback / SSH-tunnel mode
//   - host authority   "{base_domain}:{port}" — the tailscale host-URL mode, where
//                                             MagicDNS has no wildcard for a
//                                             subdomain so the port rides the
//                                             authority; `tailscale serve` preserves
//                                             it in the forwarded Host.
//
// The upstream Host is rewritten to the app's own loopback authority so a dev
// server with a strict Host allowlist (Vite) accepts the request, frame-blocking
// headers are stripped so the cross-origin dashboard tile can embed the app, and a
// host-generic sibling shim is injected into HTML. The bare dashboard host is
// always untouched and falls through to the normal router.

import (
	"bytes"
	"compress/gzip"
	_ "embed"
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

	"rk/internal/settings"
)

//go:embed proxy_hostswap.js
var proxyHostSwapJS string

func hostSwapScript() string { return "<script>\n" + proxyHostSwapJS + "</script>" }

// hostRoutingBaseDomainFn reads the configured wildcard/own-host base domain
// ("" = only *.localhost). A package seam so the middleware is testable without a
// config file.
var hostRoutingBaseDomainFn = func() string { return settings.GetBaseDomain() }

// splitSubdomainCandidate parses a Host header shaped "{port}.{tail}[:N]" into its
// leading numeric app port and the tail (the base after "{port}."). ok is false
// for anything that is NOT a per-port subdomain — a bare host, an IP literal
// (IPv4/IPv6), a multi-label or non-numeric leading label — so those hosts never
// reach a base_domain lookup. The tail is compared against the eligible bases by
// the caller; this parser does NO config read, so the common path (bare hosts,
// /proxy, API, assets, WS) is pure string work.
func splitSubdomainCandidate(hostHeader string) (port int, tail string, ok bool) {
	host := hostHeader
	if strings.HasPrefix(host, "[") { // bracketed IPv6 literal — never a subdomain
		return 0, "", false
	}
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	host = strings.ToLower(host)
	if net.ParseIP(host) != nil { // an IP literal is not a subdomain
		return 0, "", false
	}
	dot := strings.Index(host, ".")
	if dot <= 0 {
		return 0, "", false
	}
	label, rest := host[:dot], host[dot+1:]
	if rest == "" {
		return 0, "", false
	}
	p, err := strconv.Atoi(label)
	if err != nil || p < 1 || p > 65535 {
		return 0, "", false
	}
	return p, rest, true
}

// splitPortAuthority parses a Host header shaped "{host}:{port}" where the app's
// port lives in the AUTHORITY rather than a subdomain label — the tailscale /
// own-host shape, e.g. "dev-ws-x.ts.net:4295". It is used when MagicDNS has no
// wildcard so a per-port subdomain ("{port}.host") can't resolve; `tailscale
// serve --https={port}` publishes the app at that port and preserves it in the
// forwarded Host. Returns host+port ONLY when a port is explicitly present and
// the host is neither localhost nor an IP literal. A bare host (the dashboard UI
// reached over the host URL) has no explicit port and is rejected here, so it
// falls through to the normal router.
func splitPortAuthority(hostHeader string) (host string, port int, ok bool) {
	if strings.HasPrefix(hostHeader, "[") { // bracketed IPv6 authority — never this shape
		return "", 0, false
	}
	i := strings.LastIndex(hostHeader, ":")
	if i < 0 {
		return "", 0, false // no explicit port → bare host (UI), not this shape
	}
	host = strings.ToLower(hostHeader[:i])
	if host == "" || host == "localhost" || net.ParseIP(host) != nil {
		return "", 0, false
	}
	p, err := strconv.Atoi(hostHeader[i+1:])
	if err != nil || p < 1 || p > 65535 {
		return "", 0, false
	}
	return host, p, true
}

var subdomainProxyCache sync.Map

func subdomainProxy(port int) *httputil.ReverseProxy {
	if c, ok := subdomainProxyCache.Load(port); ok {
		return c.(*httputil.ReverseProxy)
	}
	target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)}
	p := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target) // path forwarded AS-IS — the app is at root
			// Rewrite Host to the app's own loopback authority so a dev server
			// with a strict Host allowlist accepts the request (the own-origin
			// Host never appears upstream).
			r.Out.Host = target.Host
			r.SetXForwarded()
		},
		ModifyResponse: func(resp *http.Response) error {
			// Strip frame-blocking headers so the cross-origin dashboard tile can
			// embed the app (harmless when the app is loaded directly).
			resp.Header.Del("X-Frame-Options")
			stripFrameAncestors(resp)
			if resp.Request != nil && resp.Request.Method == http.MethodHead {
				return nil
			}
			if !strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
				return nil
			}
			// Only identity or gzip bodies are safe to rewrite. A br/deflate/other
			// encoding would be read as opaque compressed bytes — injecting into
			// them corrupts the response — so leave those untouched (no shim). The
			// verified dev-server path (Vite, uncompressed HTML) is unaffected.
			enc := resp.Header.Get("Content-Encoding")
			if enc != "" && enc != "gzip" {
				return nil
			}
			var reader io.ReadCloser = resp.Body
			gzipped := enc == "gzip"
			if gzipped {
				zr, err := gzip.NewReader(resp.Body)
				if err != nil {
					return nil
				}
				defer zr.Close()
				reader = zr
			}
			body, err := io.ReadAll(reader)
			if err != nil {
				return nil
			}
			// Inject the sibling host-swap shim as the first child of <head>.
			body = injectHeadScript(body, hostSwapScript())
			if gzipped {
				var buf bytes.Buffer
				zw := gzip.NewWriter(&buf)
				if _, err := zw.Write(body); err == nil {
					zw.Close()
					body = buf.Bytes()
				} else {
					zw.Close()
					resp.Header.Del("Content-Encoding")
				}
			}
			resp.Body = io.NopCloser(bytes.NewReader(body))
			resp.ContentLength = int64(len(body))
			resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
			return nil
		},
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConnsPerHost:   10,
		},
	}
	actual, _ := subdomainProxyCache.LoadOrStore(port, p)
	return actual.(*httputil.ReverseProxy)
}

// stripFrameAncestors removes the `frame-ancestors` directive from an app's
// Content-Security-Policy so the cross-origin dashboard tile can embed it,
// leaving every other directive intact. A policy that was ONLY frame-ancestors is
// dropped entirely; a report-only policy is dropped so it cannot re-block the
// embed.
func stripFrameAncestors(resp *http.Response) {
	raw := resp.Header.Get("Content-Security-Policy")
	if raw == "" {
		return
	}
	dirs := parseCSP(raw)
	kept := dirs[:0]
	for _, d := range dirs {
		if d.name != "frame-ancestors" {
			kept = append(kept, d)
		}
	}
	if len(kept) == 0 {
		resp.Header.Del("Content-Security-Policy")
	} else {
		resp.Header.Set("Content-Security-Policy", serializeCSP(kept))
	}
	resp.Header.Del("Content-Security-Policy-Report-Only")
}

// subdomainRoutingMiddleware short-circuits an own-origin Host to a root reverse
// proxy for that port; everything else passes through. The base_domain settings
// read (a disk read, Constitution §II — no cache) is reached ONLY for a genuine
// non-localhost own-origin shape: the common path (bare hosts, IPs, /proxy, API,
// WS) is decided by shape alone, and the zero-config *.localhost subdomain routes
// without any config read.
func subdomainRoutingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if port, tail, ok := splitSubdomainCandidate(r.Host); ok {
			if tail == "localhost" {
				subdomainProxy(port).ServeHTTP(w, r)
				return
			}
			// Non-localhost subdomain shape: only now consult base_domain.
			if base := strings.ToLower(hostRoutingBaseDomainFn()); base != "" && tail == base {
				subdomainProxy(port).ServeHTTP(w, r)
				return
			}
		}
		// Tailscale / own-host port-authority shape: "{base_domain}:{port}" → app
		// at root. The tailnet path (no wildcard MagicDNS for subdomains): the port
		// rides the authority and `tailscale serve` preserves it in the Host. Gated
		// on base_domain being configured AND equal to the host, so an arbitrary
		// Host carrying a port can never trigger loopback proxying; default web
		// ports are excluded defensively (the bare-host UI request carries no
		// explicit port and never reaches here).
		if host, port, ok := splitPortAuthority(r.Host); ok && port != 80 && port != 443 {
			if base := strings.ToLower(hostRoutingBaseDomainFn()); base != "" && host == base {
				subdomainProxy(port).ServeHTTP(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ─── HTML / CSP helpers ─────────────────────────────────────────────────────
// Self-contained here (own-origin routing is their only consumer): inject a
// <script> into served HTML, and parse/serialize a Content-Security-Policy.

// headOpenPattern matches the opening <head ...> tag (case-insensitive).
var headOpenPattern = regexp.MustCompile(`(?i)<head[^>]*>`)

// bodyOpenPattern is the fallback anchor when a document has no <head>.
var bodyOpenPattern = regexp.MustCompile(`(?i)<body[^>]*>`)

// injectHeadScript inserts script just after <head> (or <body> as a fallback,
// or prefixes the document when neither exists).
func injectHeadScript(body []byte, script string) []byte {
	inject := []byte(script + "\n")
	if loc := headOpenPattern.FindIndex(body); loc != nil {
		return insertAt(body, loc[1], inject)
	}
	if loc := bodyOpenPattern.FindIndex(body); loc != nil {
		return insertAt(body, loc[1], inject)
	}
	return append(inject, body...)
}

// insertAt returns body with ins spliced in at byte offset at.
func insertAt(body []byte, at int, ins []byte) []byte {
	out := make([]byte, 0, len(body)+len(ins))
	out = append(out, body[:at]...)
	out = append(out, ins...)
	out = append(out, body[at:]...)
	return out
}

// cspDirective is one CSP directive, name plus its source-list tokens, kept in
// document order so the serialized policy round-trips predictably.
type cspDirective struct {
	name    string
	sources []string
}

// parseCSP splits a policy string into ordered directives (lowercased names).
func parseCSP(raw string) []*cspDirective {
	var dirs []*cspDirective
	for _, part := range strings.Split(raw, ";") {
		fields := strings.Fields(part)
		if len(fields) == 0 {
			continue
		}
		dirs = append(dirs, &cspDirective{
			name:    strings.ToLower(fields[0]),
			sources: fields[1:],
		})
	}
	return dirs
}

// serializeCSP renders directives back to a policy string.
func serializeCSP(dirs []*cspDirective) string {
	parts := make([]string, 0, len(dirs))
	for _, d := range dirs {
		if len(d.sources) == 0 {
			parts = append(parts, d.name)
			continue
		}
		parts = append(parts, d.name+" "+strings.Join(d.sources, " "))
	}
	return strings.Join(parts, "; ")
}
