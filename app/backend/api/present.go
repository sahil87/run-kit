package api

// The /present/ content route (260813-becu-rk-present-attach-verb; the
// (server, roothash) re-key is 260901-ei4t-present-url-server-root-hash).
// It serves files for `rk present` file/dir targets with NO registration
// state: the serve root is read from tmux AT REQUEST TIME (Constitution
// II/X — derive from tmux; the root lives in tmux and dies with the window).
// A dead window or unset option is a 404.
//
// ONE handler serves TWO arms, sniffed on the first path segment's shape:
//
//   - LEGACY slot form /present/@N/{n}/{path}?server= (one release). The
//     first segment matches ^@[0-9]+$ (a tmux window id). The handler's
//     legacy arm is byte-for-byte the pre-change behavior: the windowId
//     gate, the slot sniff (first remainder segment ^[1-8]$ → that slot;
//     n-less → slot 1), ?server= resolution, the slot-1
//     @rk_win_present_root dual-read, 400 on an invalid windowId.
//   - NEW content-keyed form /present/{server}/{roothash}/{path}. The
//     first segment does NOT match ^@[0-9]+$ (the server name, validated
//     by validate.ValidateServerName). The hash segment is gated
//     ^[0-9a-f]{8,64}$ BEFORE any tmux call; the handler then enumerates
//     every root any window on the server declares (one list-windows -a
//     call), sha256-prefix-matches exactly one (zero or more than one →
//     404, fail-closed), and serves through the SAME symlink-resolved
//     containment as the legacy arm.
//
// A slash-less directory form on either arm 308-redirects to the
// trailing-slash form with the query preserved (the /proxy/{port} rule).
// chi cannot distinguish the two forms (/present/{seg}/* either way), so
// the in-handler sniff is the disambiguator — exactly like the existing
// n-less sniff.
//
// Security (Constitution I, critical): serve only when the option is present
// and absolute, and verify the symlink-RESOLVED requested file stays contained
// under the symlink-RESOLVED root (filepath.Rel on the two EvalSymlinks
// results) — a containment check, never a lexical prefix/`..` ban (the
// code-server tarball lesson: intra-tree symlinks are legitimate; escaping
// ones are not). The tmux socket is already the trust boundary — anyone who
// can set window options can run code in panes — but path traversal through
// the web server must be impossible.

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"rk/internal/tmux"
	"rk/internal/validate"
)

// presentWindowIDPattern gates the {windowId} path param before any tmux
// subprocess runs (tmux window ids are @N).
var presentWindowIDPattern = regexp.MustCompile(`^@[0-9]+$`)

// presentSlotPattern gates the web-tab slot segment: the first path segment
// after the window id is the slot iff it matches, n-less otherwise (slot 1).
var presentSlotPattern = regexp.MustCompile(`^[1-8]$`)

// presentHashPattern gates the new-form {roothash} segment BEFORE any tmux
// call: 8–64 lowercase hex chars (the sha256 is 64; the composed form is 12).
var presentHashPattern = regexp.MustCompile(`^[0-9a-f]{8,64}$`)

// getWindowOptionFn is the handler's tmux read seam, so the containment table
// is testable without a live server.
var getWindowOptionFn = tmux.GetWindowOption

// listDeclaredWebRootsFn is the new arm's tmux read seam (one list-windows
// -a call per request — derivation-only, no cache).
var listDeclaredWebRootsFn = tmux.ListDeclaredWebRoots

// handlePresent serves GET /present/{windowId}/* and /present/{windowId}/{n}/*
// from the window's request-time @rk_win_web_<n>_root.
func (s *Server) handlePresent(w http.ResponseWriter, r *http.Request) {
	first := chi.URLParam(r, "windowId")
	if presentWindowIDPattern.MatchString(first) {
		s.handlePresentLegacy(w, r, first)
		return
	}
	s.handlePresentContentKeyed(w, r, first)
}

// handlePresentLegacy serves the pre-change slot form /present/@N/{n}/{path}?
// server= byte-for-byte: the windowId gate, the slot sniff, ?server=
// resolution, the slot-1 @rk_win_present_root dual-read, 400 on an invalid
// windowId. Kept for one release.
func (s *Server) handlePresentLegacy(w http.ResponseWriter, r *http.Request, windowID string) {
	// Slot sniff: the first segment after the window id is the slot iff it
	// matches ^[1-8]$; everything else is a file path under slot 1 (n-less
	// compat). A bare /present/@N/9 is a file named "9" under slot 1, never a
	// slot-9 read.
	n := 1
	rel := chi.URLParam(r, "*")
	if first, remainder, found := strings.Cut(rel, "/"); found {
		if presentSlotPattern.MatchString(first) {
			n, _ = strconv.Atoi(first)
			rel = remainder
		}
	} else if presentSlotPattern.MatchString(rel) {
		n, _ = strconv.Atoi(rel)
		rel = ""
	}

	// Redirect the slash-less forms → trailing slash (308, query preserved) —
	// the same relative-base rule as /proxy/{port}: apps resolve "./x" against
	// the trailing-slash form. The wildcard route matches the trailing-slash
	// form with rel == "" (serves the root's index.html below).
	if rel == "" && !strings.HasSuffix(r.URL.Path, "/") {
		target := r.URL.Path + "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
		return
	}

	server := serverFromRequest(r)
	root, err := getWindowOptionFn(r.Context(), windowID, server, tmux.WebTabRootOption(n))
	// Slot 1 dual-reads the retired @rk_win_present_root: external writers
	// stamp it live mid-session, where the once-per-server migration sweep
	// cannot see it (the same rule as the @rk_win_url read-side fallback).
	if err == nil && root == "" && n == 1 {
		root, err = getWindowOptionFn(r.Context(), windowID, server, tmux.LegacyWinPresentRootOption)
	}
	if err != nil || root == "" || !filepath.IsAbs(root) {
		http.NotFound(w, r)
		return
	}

	servePresentFile(w, r, root, rel)
}

// handlePresentContentKeyed serves the new content-keyed form
// /present/{server}/{roothash}/{path}: the server segment is validated by
// validate.ValidateServerName (400 on shape violation) and the hash segment
// by presentHashPattern (400) BEFORE any tmux call; the handler then
// enumerates the server's declared roots (one list-windows -a call), matches
// the hash segment as a prefix against the sha256 of each declared root —
// exactly one match, zero or more than one → 404 (fail-closed) — and serves
// through the same symlink-resolved containment as the legacy arm. The hash
// is an identifier, never a secret; it never appears in an error body
// alongside a root path.
func (s *Server) handlePresentContentKeyed(w http.ResponseWriter, r *http.Request, server string) {
	if errMsg := validate.ValidateServerName(server); errMsg != "" {
		writeError(w, http.StatusBadRequest, "invalid server")
		return
	}
	rel := chi.URLParam(r, "*")
	hash, tail, found := strings.Cut(rel, "/")
	if !found {
		// A slash-less directory form (/present/{server}/{hash}) — 308 to the
		// trailing-slash form, query preserved (the /proxy/{port} rule).
		hash = rel
		tail = ""
	}
	if !presentHashPattern.MatchString(hash) {
		writeError(w, http.StatusBadRequest, "invalid roothash")
		return
	}
	if tail == "" && !strings.HasSuffix(r.URL.Path, "/") {
		target := r.URL.Path + "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
		return
	}

	roots, err := listDeclaredWebRootsFn(r.Context(), server)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var matched string
	matches := 0
	for _, root := range roots {
		sum := sha256.Sum256([]byte(root))
		if strings.HasPrefix(hex.EncodeToString(sum[:]), hash) {
			matched = root
			matches++
		}
	}
	if matches != 1 {
		http.NotFound(w, r)
		return
	}

	servePresentFile(w, r, matched, tail)
}

// servePresentFile resolves rel under root with containment and serves the
// file (or its directory's index.html) — the shared tail of both /present/
// arms. Every miss, escape, or error is a 404 without touching files outside
// the root.
func servePresentFile(w http.ResponseWriter, r *http.Request, root, rel string) {
	file, err := resolvePresentFile(root, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// ServeContent derives MIME from the name's extension (stdlib serving).
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

// resolvePresentFile resolves rel under root with containment: both sides are
// symlink-evaluated and the result must stay under the resolved root. A path
// resolving to a directory serves that directory's index.html (never a
// listing). Every miss, escape, or error yields an error — the handler maps
// them all to 404 without touching files outside the root.
func resolvePresentFile(root, rel string) (*os.File, error) {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	return resolveContained(resolvedRoot, rel, 0)
}

// resolveContained joins rel onto resolvedRoot (already symlink-evaluated),
// evaluates symlinks on the result, and verifies containment. depth bounds the
// single index.html recursion.
func resolveContained(resolvedRoot, rel string, depth int) (*os.File, error) {
	candidate := filepath.Join(resolvedRoot, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return nil, err
	}
	if !containedIn(resolvedRoot, resolved) {
		return nil, os.ErrNotExist
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		if depth > 0 {
			return nil, os.ErrNotExist // index.html resolving to a dir: no listing
		}
		return resolveContained(resolved, "index.html", depth+1)
	}
	if !info.Mode().IsRegular() {
		return nil, os.ErrNotExist
	}
	return os.Open(resolved)
}

// containedIn reports whether resolved stays under resolvedRoot, comparing
// symlink-evaluated absolute paths via filepath.Rel — containment semantics,
// not a lexical prefix check.
func containedIn(resolvedRoot, resolved string) bool {
	rel, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
