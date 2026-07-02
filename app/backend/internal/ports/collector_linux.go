//go:build linux

package ports

import (
	"bufio"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

// procNetTCPFiles are the procfs sources enumerated for listening sockets.
// A port bound on both v4 and v6 appears in both files and is deduplicated.
var procNetTCPFiles = []string{"/proc/net/tcp", "/proc/net/tcp6"}

// tcpStateListen is the /proc/net/tcp `st` column value for a LISTEN socket.
const tcpStateListen = "0A"

// readListeningPorts parses the procfs TCP tables and returns the set of
// listening ports as Services, sorted by port ascending. Any error (file
// missing, unreadable) degrades gracefully to whatever was parsed so far —
// mirroring the metrics collector's zero-on-error discipline.
func readListeningPorts() []Service {
	seen := make(map[int]struct{})

	for _, path := range procNetTCPFiles {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		for _, port := range parseListeningPorts(f) {
			seen[port] = struct{}{}
		}
		f.Close()
	}

	services := make([]Service, 0, len(seen))
	for port := range seen {
		services = append(services, Service{Port: port})
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].Port < services[j].Port
	})
	return services
}

// parseListeningPorts scans a /proc/net/tcp{,6}-formatted stream and returns
// the local ports of sockets in the LISTEN state. The header line and any
// malformed rows are skipped. Ports are returned in file order (dedup + sort
// happens in readListeningPorts).
func parseListeningPorts(r io.Reader) []int {
	var ports []int
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		// Columns: sl(0) local_address(1) rem_address(2) st(3) ...
		if len(fields) < 4 {
			continue
		}
		if fields[3] != tcpStateListen {
			continue
		}
		port, ok := parseHexLocalPort(fields[1])
		if !ok {
			continue
		}
		ports = append(ports, port)
	}
	return ports
}

// parseHexLocalPort extracts the port from a `HEXIP:HEXPORT` local_address
// field. The port is the hex value after the last colon.
func parseHexLocalPort(localAddr string) (int, bool) {
	idx := strings.LastIndex(localAddr, ":")
	if idx < 0 || idx == len(localAddr)-1 {
		return 0, false
	}
	v, err := strconv.ParseUint(localAddr[idx+1:], 16, 32)
	if err != nil {
		return 0, false
	}
	return int(v), true
}
