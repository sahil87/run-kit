//go:build darwin

package ports

import (
	"context"
	"errors"
	"testing"
)

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

	// Ports sorted ascending; 7000/8080/9090 from python3, 3000 from node.
	// The duplicate 7000 (node) is dropped — first process (python3) wins.
	want := []Service{
		{Port: 3000, Process: "node", PID: 42},
		{Port: 7000, Process: "python3", PID: 3073862},
		{Port: 8080, Process: "python3", PID: 3073862},
		{Port: 9090, Process: "python3", PID: 3073862},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d services, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("service[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestParseLsofPort(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    int
		wantOK  bool
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

func TestReadListeningPorts_LsofSeam(t *testing.T) {
	orig := lsofRun
	t.Cleanup(func() { lsofRun = orig })

	t.Run("parses stubbed lsof output", func(t *testing.T) {
		lsofRun = func(context.Context) ([]byte, error) { return []byte(lsofFixture), nil }
		got := readListeningPorts()
		if len(got) != 4 {
			t.Fatalf("got %d services, want 4: %+v", len(got), got)
		}
		if got[0].Port != 3000 || got[3].Port != 9090 {
			t.Errorf("unexpected sort/content: %+v", got)
		}
	})

	t.Run("error with empty stdout degrades to empty slice (non-nil)", func(t *testing.T) {
		lsofRun = func(context.Context) ([]byte, error) { return nil, errors.New("lsof: not found") }
		got := readListeningPorts()
		if got == nil {
			t.Fatal("readListeningPorts returned nil; want empty non-nil slice")
		}
		if len(got) != 0 {
			t.Errorf("got %+v, want empty", got)
		}
	})

	t.Run("error with partial stdout is still parsed", func(t *testing.T) {
		// lsof exits non-zero when a socket vanishes mid-scan but still prints
		// usable records — we parse what we got rather than discard it.
		lsofRun = func(context.Context) ([]byte, error) {
			return []byte("p1\ncredis-server\nPTCP\nn*:6380\n"), errors.New("lsof: warning")
		}
		got := readListeningPorts()
		if len(got) != 1 || got[0].Port != 6380 || got[0].Process != "redis-server" {
			t.Errorf("got %+v, want one service :6380 redis-server", got)
		}
	})
}
