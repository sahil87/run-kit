//go:build darwin

package ports

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
	"sort"
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
var lsofRun = func(ctx context.Context) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcPn")
	return cmd.Output()
}

// readListeningPorts enumerates listening TCP ports on macOS via lsof. procfs
// (/proc/net/tcp) does not exist on Darwin, so unlike the Linux path this shells
// out. lsof is preinstalled on macOS. Any error (lsof missing, timeout, no
// listeners) degrades gracefully to an empty slice — mirroring the collector's
// zero-on-error discipline. Unlike the Linux path, lsof yields process
// attribution for free, so Service.Process/PID are populated here.
func readListeningPorts() []Service {
	ctx, cancel := context.WithTimeout(context.Background(), lsofTimeout)
	defer cancel()

	out, err := lsofRun(ctx)
	if err != nil {
		// lsof exits non-zero when it finds nothing to report; in that case
		// stdout is empty and parseLsof returns nothing. A genuine failure
		// (binary missing, timeout) also lands here — both degrade to empty.
		if len(out) == 0 {
			return []Service{}
		}
		// Non-empty stdout with a non-zero exit still carries usable records
		// (lsof reports partial results + a warning), so fall through and parse.
	}
	return parseLsof(out)
}

// parseLsof parses lsof -FpcPn field output into deduplicated Services sorted by
// port ascending. Field output is a flat stream of lines, each prefixed by a
// one-char field id: `p<pid>` opens a process set, `c<command>` names it, and
// each subsequent `n<addr>` is a listening socket belonging to the current
// process (`P<proto>` is present but unused — the -iTCP filter already scoped
// it). A port bound on several addresses (v4 + v6, multiple interfaces) is one
// service; the first process seen for a port wins.
func parseLsof(out []byte) []Service {
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

	services := make([]Service, 0, len(byPort))
	for _, svc := range byPort {
		services = append(services, svc)
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].Port < services[j].Port
	})
	return services
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
