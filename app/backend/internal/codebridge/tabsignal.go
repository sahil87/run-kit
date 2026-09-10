package codebridge

import "time"

// tabStamped is the shared shape of a pid-stamped, tab-keyed registry entry —
// a host record (the good-boot confirmation) or a boot marker (the empty-boot
// signal). Both feed the one newest-wins stamp walk, newestTabStamp.
type tabStamped interface {
	tabKey() (tab, server string)
	pid() int
	stamp() string
}

func (r HostRecord) tabKey() (string, string) { return r.Tab, r.Server }
func (r HostRecord) pid() int                 { return r.PID }
func (r HostRecord) stamp() string            { return r.StartedAt }

func (m BootMarker) tabKey() (string, string) { return m.Tab, m.Server }
func (m BootMarker) pid() int                 { return m.PID }
func (m BootMarker) stamp() string            { return m.StartedAt }

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
	return newestTabStamp(records, server, tab, alive)
}

// TabEmptyBootAt returns the newest startedAt among boot markers whose tab
// AND server match the key and whose pid passes the alive probe — the rescue's
// positive empty-boot oracle: only an extension host that activated with zero
// folders writes a marker, so a live marker newer than a mount-time baseline
// proves THIS boot is the broken one. TabStartedAt's exact rules apply
// (unparseable stamps skipped, newest wins, "" when none); the pid-alive
// filter neutralizes markers a dead host left behind.
func TabEmptyBootAt(markers []BootMarker, server, tab string, alive func(pid int) bool) string {
	return newestTabStamp(markers, server, tab, alive)
}

// newestTabStamp is the one parse/compare/newest-wins walk over tab-keyed,
// pid-stamped registry entries. Tab AND server must match, the pid must pass
// the injected alive probe, and unparseable stamps are skipped, never fatal.
func newestTabStamp[T tabStamped](entries []T, server, tab string, alive func(pid int) bool) string {
	best := ""
	var bestTime time.Time
	for _, e := range entries {
		eTab, eServer := e.tabKey()
		if eTab != tab || eServer != server {
			continue
		}
		if !alive(e.pid()) {
			continue
		}
		stamp, err := time.Parse(time.RFC3339Nano, e.stamp())
		if err != nil {
			continue
		}
		if best == "" || stamp.After(bestTime) {
			best, bestTime = e.stamp(), stamp
		}
	}
	return best
}

// PIDAlive exposes the kill-0 liveness probe (EPERM counts as alive) for
// consumers — like the code-bridge status route — that verify records on a
// request path where LiveHosts' socket dial and registry prune are
// off-limits.
func PIDAlive(pid int) bool { return pidAlive(pid) }
