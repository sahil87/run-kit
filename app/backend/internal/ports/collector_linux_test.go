//go:build linux

package ports

import (
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

	services := readListeningPorts()

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
