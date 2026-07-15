//go:build linux

package ports

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

// A /proc/net/tcp-shaped fixture: header + LISTEN sockets on 8080 (0x1F90) and
// 3000 (0x0BB8), plus an ESTABLISHED (st=01) socket on 5432 that must be ignored.
const tcpV4Fixture = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000   101        0 12345 1 0000000000000000 100 0 0 10 5
   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1538 0100007F:C000 01 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
`

// A /proc/net/tcp6-shaped fixture: LISTEN on 8080 again (v6 dup of the v4 entry)
// and a fresh LISTEN on 5173 (0x1435).
const tcpV6Fixture = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22345 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22346 1 0000000000000000 100 0 0 10 0
`

func TestParseListeningPorts_ExtractsListenOnly(t *testing.T) {
	ports := parseListeningPorts(strings.NewReader(tcpV4Fixture))

	// 8080 and 3000 are LISTEN; 5432 is ESTABLISHED (st=01) and must be excluded.
	want := map[int]bool{8080: true, 3000: true}
	if len(ports) != len(want) {
		t.Fatalf("expected %d listening ports, got %d (%v)", len(want), len(ports), ports)
	}
	for _, p := range ports {
		if !want[p] {
			t.Errorf("unexpected port %d in %v", p, ports)
		}
	}
	for _, p := range ports {
		if p == 5432 {
			t.Errorf("ESTABLISHED socket on 5432 should have been ignored")
		}
	}
}

func TestParseListeningPorts_SkipsHeaderAndMalformed(t *testing.T) {
	in := "  sl  local_address rem_address   st\ngarbage line\n"
	if got := parseListeningPorts(strings.NewReader(in)); len(got) != 0 {
		t.Errorf("expected no ports from header+garbage, got %v", got)
	}
}

func TestParseHexLocalPort(t *testing.T) {
	cases := map[string]int{
		"0100007F:1F90": 8080,
		"00000000:0BB8": 3000,
		"00000000000000000000000000000000:1435": 5173,
	}
	for in, want := range cases {
		got, ok := parseHexLocalPort(in)
		if !ok || got != want {
			t.Errorf("parseHexLocalPort(%q) = %d,%v; want %d,true", in, got, ok, want)
		}
	}
	if _, ok := parseHexLocalPort("nocolon"); ok {
		t.Error("expected failure for address with no colon")
	}
	if _, ok := parseHexLocalPort("0100007F:"); ok {
		t.Error("expected failure for empty port")
	}
}

// TestReadListeningPorts_DedupesAndSorts drives the whole procfs read against
// temp fixture files (overriding procNetTCPFiles) to prove v4/v6 dedupe and
// ascending sort end-to-end.
func TestReadListeningPorts_DedupesAndSorts(t *testing.T) {
	v4 := writeTempFixture(t, tcpV4Fixture)
	v6 := writeTempFixture(t, tcpV6Fixture)

	orig := procNetTCPFiles
	procNetTCPFiles = []string{v4, v6}
	t.Cleanup(func() { procNetTCPFiles = orig })

	services := readListeningPorts(context.Background())

	// Union: {8080, 3000} from v4, {8080, 5173} from v6 → deduped {3000, 5173, 8080}.
	var got []int
	for _, s := range services {
		got = append(got, s.Port)
	}
	want := []int{3000, 5173, 8080}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected sorted+deduped %v, got %v", want, got)
		}
	}
}

func writeTempFixture(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := dir + "/proc_net_tcp"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}

// stubProcfs points procNetTCPFiles at temp files with the given content.
func stubProcfs(t *testing.T, contents ...string) {
	t.Helper()
	paths := make([]string, len(contents))
	for i, c := range contents {
		paths[i] = writeTempFixture(t, c)
	}
	orig := procNetTCPFiles
	procNetTCPFiles = paths
	t.Cleanup(func() { procNetTCPFiles = orig })
}

// stubLsof swaps the lsofRun seam for the duration of a test.
func stubLsof(t *testing.T, fn func(context.Context) ([]byte, error)) {
	t.Helper()
	orig := lsofRun
	lsofRun = fn
	t.Cleanup(func() { lsofRun = orig })
}

// TestReadListeningPorts_JoinsLsofAttribution proves the load-bearing join:
// procfs is the authoritative port set (all listening ports appear), and lsof
// attribution is joined by port. A port lsof CANNOT attribute — e.g. a
// root-owned listener invisible to a non-root lsof — still appears, bare. The
// v4 fixture lists LISTEN on 8080 (0x1F90) and 3000 (0x0BB8); lsof attributes
// only 3000 here.
func TestReadListeningPorts_JoinsLsofAttribution(t *testing.T) {
	stubProcfs(t, tcpV4Fixture) // procfs: {8080, 3000}
	stubLsof(t, func(context.Context) ([]byte, error) {
		// lsof sees only 3000 (node) — 8080 is, say, a root-owned listener the
		// non-root lsof cannot see.
		return []byte("p42\ncnode\nPTCP\nn*:3000\n"), nil
	})

	services := readListeningPorts(context.Background())

	byPort := make(map[int]Service, len(services))
	for _, s := range services {
		byPort[s.Port] = s
	}
	if len(services) != 2 {
		t.Fatalf("expected 2 services (full procfs set), got %d: %+v", len(services), services)
	}
	// 3000 is attributed from the lsof join.
	if got := byPort[3000]; got.Process != "node" || got.PID != 42 {
		t.Errorf("port 3000 = %+v; want attribution {node, 42} from the lsof join", got)
	}
	// 8080 is present (procfs is authoritative) but bare — lsof couldn't see it.
	if got := byPort[8080]; got.Process != "" || got.PID != 0 {
		t.Errorf("port 8080 = %+v; want bare (unattributed procfs port stays zero-valued)", got)
	}
	// Sorted ascending.
	if services[0].Port != 3000 || services[1].Port != 8080 {
		t.Errorf("ports not sorted ascending: %+v", services)
	}
}

// TestReadListeningPorts_LsofMissingDegradesToBareProcfs proves that when lsof
// fails/absents (empty output + error), the FULL procfs port set is still
// published, all bare — the enumeration is unaffected by the attribution
// failure.
func TestReadListeningPorts_LsofMissingDegradesToBareProcfs(t *testing.T) {
	stubProcfs(t, tcpV4Fixture, tcpV6Fixture) // {8080, 3000} ∪ {8080, 5173}
	stubLsof(t, func(context.Context) ([]byte, error) {
		return nil, errors.New("lsof: not found")
	})

	services := readListeningPorts(context.Background())

	got := make([]int, len(services))
	for i, s := range services {
		got[i] = s.Port
		if s.Process != "" || s.PID != 0 {
			t.Errorf("port %d attributed despite lsof failure: %+v", s.Port, s)
		}
	}
	want := []int{3000, 5173, 8080} // deduped, sorted, all bare
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}
