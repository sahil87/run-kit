package tmux

import (
	"context"
	"errors"
	"slices"
	"testing"
)

// stubSocketPathQuery substitutes the SocketPath exec seam for the test's
// duration (the sweep-var stub pattern) and returns a recorder for the
// (server, args) pairs the seam observed.
func stubSocketPathQuery(t *testing.T, fn func(ctx context.Context, server string, args ...string) (string, error)) {
	t.Helper()
	orig := socketPathQuery
	socketPathQuery = fn
	t.Cleanup(func() { socketPathQuery = orig })
}

func TestSocketPath(t *testing.T) {
	t.Run("queries #{socket_path} addressed at the named server, trimmed", func(t *testing.T) {
		var gotServer string
		var gotArgs []string
		stubSocketPathQuery(t, func(_ context.Context, server string, args ...string) (string, error) {
			gotServer = server
			gotArgs = append([]string(nil), args...)
			return "  /tmp/tmux-1001/runKit\n", nil
		})

		got, err := SocketPath(context.Background(), "runKit")
		if err != nil {
			t.Fatalf("SocketPath() error: %v", err)
		}
		if got != "/tmp/tmux-1001/runKit" {
			t.Errorf("SocketPath() = %q, want %q (trimmed)", got, "/tmp/tmux-1001/runKit")
		}
		// The seam sees the trailing argv; the exec core prepends the package's
		// server prefix (serverArgs), so the full production argv is pinned here.
		fullArgv := append(serverArgs(gotServer), gotArgs...)
		wantArgv := []string{"-L", "runKit", "display-message", "-p", "#{socket_path}"}
		if !slices.Equal(fullArgv, wantArgv) {
			t.Errorf("full argv = %v, want %v", fullArgv, wantArgv)
		}
	})

	t.Run("default server addresses bare (no -L prefix)", func(t *testing.T) {
		var gotServer string
		var gotArgs []string
		stubSocketPathQuery(t, func(_ context.Context, server string, args ...string) (string, error) {
			gotServer = server
			gotArgs = append([]string(nil), args...)
			return "/tmp/tmux-1000/default\n", nil
		})

		if _, err := SocketPath(context.Background(), "default"); err != nil {
			t.Fatalf("SocketPath() error: %v", err)
		}
		fullArgv := append(serverArgs(gotServer), gotArgs...)
		wantArgv := []string{"display-message", "-p", "#{socket_path}"}
		if !slices.Equal(fullArgv, wantArgv) {
			t.Errorf("full argv = %v, want %v", fullArgv, wantArgv)
		}
	})

	t.Run("error propagates verbatim", func(t *testing.T) {
		sentinel := errors.New("exit status 1: no server running")
		stubSocketPathQuery(t, func(context.Context, string, ...string) (string, error) {
			return "", sentinel
		})

		got, err := SocketPath(context.Background(), "gone")
		if !errors.Is(err, sentinel) {
			t.Errorf("SocketPath() error = %v, want the sentinel verbatim", err)
		}
		if got != "" {
			t.Errorf("SocketPath() = %q, want empty on error", got)
		}
	})
}
