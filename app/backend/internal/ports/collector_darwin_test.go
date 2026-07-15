//go:build darwin

package ports

import (
	"context"
	"errors"
	"testing"
)

// TestReadListeningPorts_LsofSeam covers darwin's lsof-only enumeration: the
// slice output of readListeningPorts (sorted, attributed) and the graceful
// degradation of the lsofRun seam. (parseLsof/parseLsofPort themselves are
// tested in the shared lsof_test.go, which runs on both platforms.)
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
