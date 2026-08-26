package codebridge

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// pingTimeout bounds the __ping half of the liveness check: a record counts
// as live only if its socket answers within this window.
const pingTimeout = 2 * time.Second

// Sentinel errors carried by HostListError so callers can errors.Is the
// failure class and still print the candidate hosts.
var (
	ErrNoHost    = errors.New("no code-bridge host")
	ErrAmbiguous = errors.New("multiple code-bridge hosts")
)

// HostListError pairs ErrNoHost/ErrAmbiguous with the live hosts known at
// resolution time, so the CLI can list candidates without a second liveness
// pass.
type HostListError struct {
	Err   error
	Hosts []HostRecord
}

func (e *HostListError) Error() string { return e.Err.Error() }
func (e *HostListError) Unwrap() error { return e.Err }

// Selector picks one host out of the live set. HostID is the --host flag
// (exact match on host id); Folder is the target folder (--folder or the
// cwd's git toplevel, resolved by the caller).
type Selector struct {
	HostID string
	Folder string
}

// pidAlive is the kill-0 liveness probe: EPERM counts as alive — the process
// exists, it is just not signal-able by us, and false-pruning a live host is
// worse than keeping it.
func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// pingable reports whether the host's socket answers a __ping within
// pingTimeout.
func pingable(ctx context.Context, sock string) bool {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	_, err := Ping(ctx, sock)
	return err == nil
}

// LiveHosts enumerates dir's host records and returns the live ones plus the
// pruned ones. A record is live only if kill-0 on its pid succeeds (or EPERM)
// AND a __ping over its socket answers within pingTimeout; a record failing
// either check is deleted from the registry and reported in pruned. The
// registry file is never treated as proof of life (Constitution II).
func LiveHosts(ctx context.Context, dir string) (live, pruned []HostRecord, err error) {
	records, err := ReadRecords(dir)
	if err != nil {
		return nil, nil, err
	}
	for _, rec := range records {
		if !pidAlive(rec.PID) || !pingable(ctx, rec.Sock) {
			// Best-effort prune: a removal failure must not hide that the
			// record is already excluded from the live set.
			_ = os.Remove(recordPath(dir, rec.HostID))
			pruned = append(pruned, rec)
			continue
		}
		live = append(live, rec)
	}
	return live, pruned, nil
}

// folderPrefixMatch reports whether folder equals target or is a
// path-component-aware prefix of it: /repo matches /repo/x but NOT
// /repository (a shared string prefix is not a containment).
func folderPrefixMatch(folder, target string) bool {
	folder = filepath.Clean(folder)
	target = filepath.Clean(target)
	return target == folder || strings.HasPrefix(target, folder+string(os.PathSeparator))
}

// Resolve picks the single host a verb should act on, in order: (1) an exact
// HostID match when given (no fallback — an unmatched explicit --host is an
// error); (2) exact Folder match, then the record whose folder is the longest
// path-component-aware prefix of the target; (3) no match and exactly one
// live host → that host with fallback=true so the caller can print the
// "using host …" note; several → ErrAmbiguous, none → ErrNoHost, both as a
// *HostListError carrying the live set. The ctx parameter is reserved; the
// hosts slice is expected to be pre-verified by LiveHosts.
func Resolve(ctx context.Context, hosts []HostRecord, sel Selector) (HostRecord, bool, error) {
	_ = ctx
	if sel.HostID != "" {
		for _, h := range hosts {
			if h.HostID == sel.HostID {
				return h, false, nil
			}
		}
		return HostRecord{}, false, &HostListError{Err: ErrNoHost, Hosts: hosts}
	}
	if sel.Folder != "" {
		target := filepath.Clean(sel.Folder)
		for _, h := range hosts {
			if filepath.Clean(h.Folder) == target {
				return h, false, nil
			}
		}
		best, bestLen := -1, -1
		for i, h := range hosts {
			if !folderPrefixMatch(h.Folder, target) {
				continue
			}
			if l := len(filepath.Clean(h.Folder)); l > bestLen {
				best, bestLen = i, l
			}
		}
		if best >= 0 {
			return hosts[best], false, nil
		}
	}
	switch len(hosts) {
	case 0:
		return HostRecord{}, false, &HostListError{Err: ErrNoHost}
	case 1:
		return hosts[0], true, nil
	default:
		return HostRecord{}, false, &HostListError{Err: ErrAmbiguous, Hosts: hosts}
	}
}
