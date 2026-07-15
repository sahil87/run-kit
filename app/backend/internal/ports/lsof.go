//go:build linux || darwin

package ports

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// lsofTimeout bounds the lsof subprocess so a hung invocation can never block
// the collector's poll goroutine (Constitution I — exec.CommandContext with a
// timeout, explicit argument slice, no shell string, no user input in argv).
const lsofTimeout = 5 * time.Second

// lsofRun executes lsof and returns its stdout. It is a package var so tests can
// substitute the subprocess with a fixture. Default: list listening TCP sockets
// in field-output mode (-F) emitting the pid (p), command (c), protocol (P), and
// name (n) fields. -nP skips DNS/port-name resolution (faster, numeric ports).
// Shared by darwin (sole enumeration source) and Linux (attribution join onto
// the authoritative procfs port set).
var lsofRun = func(ctx context.Context) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcPn")
	return cmd.Output()
}

// parseLsof parses lsof -FpcPn field output into a map from port to Service
// (with Process/PID attribution). Field output is a flat stream of lines, each
// prefixed by a one-char field id: `p<pid>` opens a process set, `c<command>`
// names it, and each subsequent `n<addr>` is a listening socket belonging to the
// current process (`P<proto>` is present but unused — the -iTCP filter already
// scoped it). A port bound on several addresses (v4 + v6, multiple interfaces)
// is one service; the first process seen for a port wins.
func parseLsof(out []byte) map[int]Service {
	byPort := make(map[int]Service)

	var curPID int
	var curCmd string

	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 1 {
			continue
		}
		switch line[0] {
		case 'p':
			curPID, _ = strconv.Atoi(line[1:]) // 0 on parse failure — acceptable
			curCmd = ""
		case 'c':
			curCmd = line[1:]
		case 'n':
			port, ok := parseLsofPort(line[1:])
			if !ok {
				continue
			}
			if _, exists := byPort[port]; exists {
				continue // first process seen for this port wins
			}
			byPort[port] = Service{Port: port, Process: curCmd, PID: curPID}
		}
	}

	return byPort
}

// parseLsofPort extracts the port from an lsof name field. Forms observed:
//
//	127.0.0.1:7000   → 7000   (IPv4)
//	*:7000           → 7000   (wildcard)
//	[::1]:8080       → 8080   (IPv6, bracketed)
//	[::]:8080        → 8080   (IPv6 wildcard)
//
// The port is the decimal value after the last colon. A name with no colon, or
// a non-numeric port (e.g. an unresolved service name — guarded against by -P),
// is skipped.
func parseLsofPort(name string) (int, bool) {
	idx := strings.LastIndex(name, ":")
	if idx < 0 || idx == len(name)-1 {
		return 0, false
	}
	v, err := strconv.Atoi(name[idx+1:])
	if err != nil || v < 1 || v > 65535 {
		return 0, false
	}
	return v, true
}

// lsofAttribution runs lsof and returns port→Service attribution, or an empty
// map on any error/absence (best-effort — the caller degrades gracefully). Used
// on Linux to join attribution onto the authoritative procfs port set; darwin
// uses parseLsof directly as its enumeration source.
func lsofAttribution() map[int]Service {
	ctx, cancel := context.WithTimeout(context.Background(), lsofTimeout)
	defer cancel()

	out, err := lsofRun(ctx)
	if err != nil && len(out) == 0 {
		// lsof missing/failing with no output → no attribution. A non-zero exit
		// WITH partial stdout still carries usable records (lsof reports partial
		// results + a warning), so fall through and parse in that case.
		return map[int]Service{}
	}
	return parseLsof(out)
}
