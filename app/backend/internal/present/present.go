// Package present resolves `rk present` targets and derives the @rk_url value
// each target kind attaches to a tmux window. It is pure (no tmux, no HTTP):
// the only I/O is os.Stat for file/dir classification and a TCP dial for the
// reachability probe, so every rule is unit-testable without a live server.
//
// The five target kinds (spec: fab change 260813-becu-rk-present-attach-verb):
//
//	file          existing regular file   → /present/<windowId>/<base>?server=<s>&v=<bust>
//	dir           existing directory      → /present/<windowId>/?server=<s>&v=<bust>
//	port          ":NNNN"                 → /proxy/<port>/
//	local URL     http://localhost…       → /proxy/<port>/<path+query>
//	external URL  any other http(s) URL   → attached verbatim
//
// File/dir targets also carry a serve Root (the file's parent dir / the dir
// itself) which the CLI sets as the @rk_present_root window option; the
// /present/{windowId}/ route reads it back from tmux at request time.
package present

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Kind classifies a parsed target.
type Kind int

const (
	KindFile        Kind = iota // existing regular file
	KindDir                     // existing directory
	KindPort                    // ":NNNN"
	KindLocalURL                // absolute http:// URL on a localhost host
	KindExternalURL             // any other absolute http(s):// URL
)

// String names the kind, for diagnostics.
func (k Kind) String() string {
	switch k {
	case KindFile:
		return "file"
	case KindDir:
		return "dir"
	case KindPort:
		return "port"
	case KindLocalURL:
		return "local URL"
	case KindExternalURL:
		return "external URL"
	}
	return "unknown"
}

// portPattern is the ":NNNN" target form (colon + digits, nothing else).
var portPattern = regexp.MustCompile(`^:([0-9]+)$`)

// localhostHosts is the closed set of URL hosts whose targets rewrite to the
// relative /proxy/<port>/ form (Hostname() strips brackets, so "::1" covers
// the "[::1]" literal).
var localhostHosts = map[string]bool{
	"localhost": true,
	"127.0.0.1": true,
	"::1":       true,
}

// Target is a resolved `rk present` argument.
type Target struct {
	Kind Kind
	// Root is the absolute serve root — the file's parent directory or the
	// directory itself. Set for KindFile/KindDir only; the CLI attaches it as
	// the @rk_present_root window option.
	Root string
	// Name is the display basename for the target: the file/dir base name,
	// "port-<port>" for port/local-URL targets, the hostname for external
	// URLs. Window-name derivation sanitizes it at the command layer.
	Name string
	// Port is the TCP port for KindPort/KindLocalURL (default 80).
	Port int
	// PathQuery is the original path+query (leading "/", empty when the URL
	// had neither) for KindLocalURL — preserved verbatim into the proxy form.
	PathQuery string
	// Verbatim is the original URL, attached unchanged, for KindExternalURL.
	Verbatim string
}

// ParseTarget resolves one CLI argument to a Target. cwd is the base for
// relative paths. A path that does not exist (and parses as neither a port
// nor an absolute URL) is an error.
func ParseTarget(arg, cwd string) (Target, error) {
	if m := portPattern.FindStringSubmatch(arg); m != nil {
		port, err := parsePort(m[1])
		if err != nil {
			return Target{}, fmt.Errorf("invalid port target %q: %w", arg, err)
		}
		return Target{Kind: KindPort, Port: port, Name: fmt.Sprintf("port-%d", port)}, nil
	}

	if strings.HasPrefix(arg, "http://") || strings.HasPrefix(arg, "https://") {
		u, err := url.Parse(arg)
		if err != nil || u.Host == "" {
			return Target{}, fmt.Errorf("invalid URL %q", arg)
		}
		// Only plaintext http on a localhost host rewrites to the relative
		// proxy form; https (even to localhost) and any remote host attach
		// verbatim — the proxy targets local http services only.
		if u.Scheme == "http" && localhostHosts[u.Hostname()] {
			port := 80
			if p := u.Port(); p != "" {
				n, err := parsePort(p)
				if err != nil {
					return Target{}, fmt.Errorf("invalid port in URL %q: %w", arg, err)
				}
				port = n
			}
			return Target{
				Kind:      KindLocalURL,
				Port:      port,
				PathQuery: u.RequestURI(),
				Name:      fmt.Sprintf("port-%d", port),
			}, nil
		}
		name := u.Hostname()
		if name == "" {
			name = "external"
		}
		return Target{Kind: KindExternalURL, Verbatim: arg, Name: name}, nil
	}

	path := arg
	if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return Target{}, fmt.Errorf("resolve %q: %w", arg, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Target{}, fmt.Errorf("target %q does not exist", arg)
	}
	if info.IsDir() {
		return Target{Kind: KindDir, Root: abs, Name: filepath.Base(abs)}, nil
	}
	if !info.Mode().IsRegular() {
		return Target{}, fmt.Errorf("target %q is not a regular file or directory", arg)
	}
	return Target{Kind: KindFile, Root: filepath.Dir(abs), Name: filepath.Base(abs)}, nil
}

// parsePort validates a decimal port string.
func parsePort(s string) (int, error) {
	port, err := strconv.Atoi(s)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("port %q out of range 1-65535", s)
	}
	return port, nil
}

// PresentURL composes the @rk_url value for a file/dir target carried by
// windowID on the named tmux server. The `?v=` cache-buster (unix seconds at
// invocation, supplied by now) makes re-presenting the same target a refresh:
// the new @rk_url differs and an open web tile re-navigates. name is the
// file basename, or empty for a directory target (serves the root's
// index.html). The form is always relative — never an absolute origin.
func PresentURL(windowID, name, server string, now func() int64) string {
	path := "/present/" + windowID + "/"
	if name != "" {
		path += url.PathEscape(name)
	}
	return fmt.Sprintf("%s?server=%s&v=%d", path, url.QueryEscape(server), now())
}

// URL derives the @rk_url value for this target carried by windowID on the
// named server. now supplies the unix-seconds cache-buster for /present/
// URLs only; port/URL targets re-set verbatim with no buster.
func (t Target) URL(windowID, server string, now func() int64) string {
	switch t.Kind {
	case KindFile:
		return PresentURL(windowID, t.Name, server, now)
	case KindDir:
		return PresentURL(windowID, "", server, now)
	case KindPort:
		return fmt.Sprintf("/proxy/%d/", t.Port)
	case KindLocalURL:
		pq := t.PathQuery
		if pq == "" || pq[0] != '/' {
			pq = "/" + pq
		}
		return fmt.Sprintf("/proxy/%d%s", t.Port, pq)
	default: // KindExternalURL
		return t.Verbatim
	}
}

// NeedsRoot reports whether the target carries a serve root (@rk_present_root)
// — file and directory targets only.
func (t Target) NeedsRoot() bool {
	return t.Kind == KindFile || t.Kind == KindDir
}

// NeedsProbe reports whether the target gets a best-effort TCP reachability
// probe — port and local-URL targets only; file/dir/external never probe.
func (t Target) NeedsProbe() bool {
	return t.Kind == KindPort || t.Kind == KindLocalURL
}

// ProbeTimeout bounds the TCP reachability probe for port/local-URL targets.
const ProbeTimeout = 1 * time.Second

// ProbePort dials 127.0.0.1:<port> with a short timeout. Connection refused
// or timeout is an operational failure naming the port.
func ProbePort(ctx context.Context, port int) error {
	d := net.Dialer{Timeout: ProbeTimeout}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("nothing is listening on port %d (127.0.0.1): %w", port, err)
	}
	_ = conn.Close()
	return nil
}
