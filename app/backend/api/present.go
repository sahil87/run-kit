package api

// The /present/{windowId}/ content route (260813-becu-rk-present-attach-verb).
// It serves files for `rk present` file/dir targets with NO registration
// state: the serve root is read from the window's @rk_present_root tmux option
// AT REQUEST TIME (Constitution II/X — derive from tmux; the root lives in
// tmux and dies with the window). A dead window or unset option is a 404.
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
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"rk/internal/tmux"
)

// presentWindowIDPattern gates the {windowId} path param before any tmux
// subprocess runs (tmux window ids are @N).
var presentWindowIDPattern = regexp.MustCompile(`^@[0-9]+$`)

// presentRootOption is the window user option carrying the absolute serve root
// for /present/ requests, set by `rk present` for file/dir targets.
const presentRootOption = "@rk_present_root"

// getWindowOptionFn is the handler's tmux read seam, so the containment table
// is testable without a live server.
var getWindowOptionFn = tmux.GetWindowOption

// handlePresent serves GET /present/{windowId}/* from the window's
// request-time @rk_present_root.
func (s *Server) handlePresent(w http.ResponseWriter, r *http.Request) {
	windowID := chi.URLParam(r, "windowId")
	if !presentWindowIDPattern.MatchString(windowID) {
		writeError(w, http.StatusBadRequest, "invalid windowId")
		return
	}

	prefix := "/present/" + windowID
	// Redirect /present/{windowId} → /present/{windowId}/ (308, query
	// preserved) — the same relative-base rule as /proxy/{port}: apps resolve
	// "./x" against the trailing-slash form.
	if r.URL.Path == prefix {
		target := r.URL.Path + "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
		return
	}

	server := serverFromRequest(r)
	root, err := getWindowOptionFn(r.Context(), windowID, server, presentRootOption)
	if err != nil || root == "" || !filepath.IsAbs(root) {
		http.NotFound(w, r)
		return
	}

	rel := strings.TrimPrefix(r.URL.Path, prefix+"/")
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
