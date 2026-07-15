//go:build linux || darwin

package ports

import "testing"

// A realistic lsof -FpcPn stream: one process (pid 3073862, "python3") holding
// three listening sockets — IPv4, IPv4 wildcard, and bracketed IPv6 — plus a
// second process on a duplicate port to exercise first-wins dedup.
const lsofFixture = `p3073862
cpython3
PTCP
n127.0.0.1:7000
PTCP
n*:8080
PTCP
n[::1]:9090
p42
cnode
PTCP
n127.0.0.1:7000
PTCP
n[::]:3000
`

func TestParseLsof_ExtractsPortsWithAttribution(t *testing.T) {
	got := parseLsof([]byte(lsofFixture))

	// 7000/8080/9090 from python3, 3000 from node. The duplicate 7000 (node) is
	// dropped — the first process seen for a port (python3) wins.
	want := map[int]Service{
		3000: {Port: 3000, Process: "node", PID: 42},
		7000: {Port: 7000, Process: "python3", PID: 3073862},
		8080: {Port: 8080, Process: "python3", PID: 3073862},
		9090: {Port: 9090, Process: "python3", PID: 3073862},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d services, want %d: %+v", len(got), len(want), got)
	}
	for port, wantSvc := range want {
		if got[port] != wantSvc {
			t.Errorf("service[%d] = %+v, want %+v", port, got[port], wantSvc)
		}
	}
}

func TestParseLsofPort(t *testing.T) {
	cases := []struct {
		name   string
		in     string
		want   int
		wantOK bool
	}{
		{"ipv4", "127.0.0.1:7000", 7000, true},
		{"wildcard", "*:8080", 8080, true},
		{"ipv6 loopback", "[::1]:9090", 9090, true},
		{"ipv6 wildcard", "[::]:3000", 3000, true},
		{"no colon", "127.0.0.1", 0, false},
		{"trailing colon", "127.0.0.1:", 0, false},
		{"non-numeric port", "127.0.0.1:http", 0, false},
		{"port zero", "*:0", 0, false},
		{"port too high", "*:70000", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseLsofPort(tc.in)
			if ok != tc.wantOK || (ok && got != tc.want) {
				t.Errorf("parseLsofPort(%q) = (%d,%v), want (%d,%v)", tc.in, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestParseLsof_EmptyInput(t *testing.T) {
	if got := parseLsof(nil); len(got) != 0 {
		t.Errorf("parseLsof(nil) = %+v, want empty", got)
	}
	if got := parseLsof([]byte("")); len(got) != 0 {
		t.Errorf("parseLsof(empty) = %+v, want empty", got)
	}
}
