package codebridge

import "time"

// TabStartedAt returns the newest startedAt among records whose tab AND
// server match the key and whose pid passes the alive probe — the
// boot-confirmation signal for one tab: only an activation that saw a
// workspace folder ever writes a tab-keyed record, so a live record newer
// than a mount-time baseline proves the boot loaded the folder. Records
// missing Tab or Server (folder-opened hosts) never match, and a record with
// an unparseable startedAt is skipped, never fatal. Two records for one tab
// (a code-root change hashed to a new hostId while the old host still lives)
// resolve to the newer.
//
// The alive probe is INJECTED because request-path consumers must use kill-0
// only: LiveHosts additionally dials every socket and prunes the registry —
// neither belongs on a read path, and the newer-than-baseline compare
// neutralises stale records on its own.
func TabStartedAt(records []HostRecord, server, tab string, alive func(pid int) bool) string {
	best := ""
	var bestTime time.Time
	for _, rec := range records {
		if rec.Tab != tab || rec.Server != server {
			continue
		}
		if !alive(rec.PID) {
			continue
		}
		stamp, err := time.Parse(time.RFC3339Nano, rec.StartedAt)
		if err != nil {
			continue
		}
		if best == "" || stamp.After(bestTime) {
			best, bestTime = rec.StartedAt, stamp
		}
	}
	return best
}

// PIDAlive exposes the kill-0 liveness probe (EPERM counts as alive) for
// consumers — like the code-bridge status route — that verify records on a
// request path where LiveHosts' socket dial and registry prune are
// off-limits.
func PIDAlive(pid int) bool { return pidAlive(pid) }
