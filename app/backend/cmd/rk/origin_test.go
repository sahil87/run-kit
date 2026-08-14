package main

import (
	"context"
	"errors"
	"slices"
	"testing"
)

// NOTE (tmux safety): these tests never start, attach to, or kill any tmux
// server. Every tmux invocation routes through the originRunOutputFn seam,
// which the tests stub; the $TMUX value comes from the originOriginalTMUXFn
// seam (the real tmux.OriginalTMUX is fixed at package-init time).

const originTestSocket = "/tmp/rk-test.sock"

// stubOriginSeams installs recording stubs for the resolver's tmux seams.
// optionValue/optionErr drive the stubbed show-option read; tmuxEnv is what
// the $TMUX seam serves ("" = not inside a pane). Returns the recorded argv
// calls so tests can assert subprocess counts.
func stubOriginSeams(t *testing.T, tmuxEnv, optionValue string, optionErr error) *[][]string {
	t.Helper()
	recorded := [][]string{}
	origTMUX := originOriginalTMUXFn
	originOriginalTMUXFn = func() string { return tmuxEnv }
	origOut := originRunOutputFn
	originRunOutputFn = func(_ context.Context, args []string) ([]byte, error) {
		recorded = append(recorded, args)
		if optionErr != nil {
			return nil, optionErr
		}
		return []byte(optionValue), nil
	}
	t.Cleanup(func() {
		originOriginalTMUXFn = origTMUX
		originRunOutputFn = origOut
	})
	return &recorded
}

func TestResolveOrigin(t *testing.T) {
	cases := []struct {
		name string
		// env
		rkHost, rkPort string
		// pane state
		tmuxEnv     string
		optionValue string
		optionErr   error
		// expectations
		want       string
		wantPrefix []string // expected tmux argv prefix (nil = zero subprocess calls)
	}{
		{
			name:        "env wins over option",
			rkPort:      "4000",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "http://127.0.0.1:3001\n",
			want:        "http://127.0.0.1:4000",
			wantPrefix:  nil, // env short-circuits: zero tmux subprocess calls
		},
		{
			name:        "RK_HOST alone also short-circuits",
			rkHost:      "10.0.0.1",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "http://127.0.0.1:3001\n",
			want:        "http://10.0.0.1:3000",
			wantPrefix:  nil,
		},
		{
			name:        "option wins over default",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "http://127.0.0.1:3001\n",
			want:        "http://127.0.0.1:3001",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "https option accepted",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "https://rk.example.com\n",
			want:        "https://rk.example.com",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "unset option falls through to default",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionErr:   errors.New("exit status 1: invalid option"),
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "empty option falls through to default",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "\n",
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "malformed option falls through to default",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "not a url\n",
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "hostile scheme rejected",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "javascript:alert(1)\n",
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "empty host rejected",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "http://\n",
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:        "path/query/fragment rejected (not an origin)",
			tmuxEnv:     originTestSocket + ",1234,0",
			optionValue: "http://127.0.0.1:3001/\n",
			want:        "http://127.0.0.1:3000",
			wantPrefix:  []string{"-S", originTestSocket, "show-option", "-sv", "@rk_origin"},
		},
		{
			name:       "no $TMUX falls through with zero subprocess calls",
			tmuxEnv:    "",
			want:       "http://127.0.0.1:3000",
			wantPrefix: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("RK_HOST", tc.rkHost)
			t.Setenv("RK_PORT", tc.rkPort)
			calls := stubOriginSeams(t, tc.tmuxEnv, tc.optionValue, tc.optionErr)

			got := resolveOrigin(context.Background())
			if got != tc.want {
				t.Errorf("resolveOrigin() = %q, want %q", got, tc.want)
			}

			if tc.wantPrefix == nil {
				if len(*calls) != 0 {
					t.Errorf("expected zero tmux subprocess calls, got %v", *calls)
				}
				return
			}
			if len(*calls) != 1 || !slices.Equal((*calls)[0], tc.wantPrefix) {
				t.Errorf("tmux calls = %v, want one call %v", *calls, tc.wantPrefix)
			}
		})
	}
}
