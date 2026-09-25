package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"rk/internal/config"
)

// captureSlog swaps the default slog logger for one writing to a buffer and
// restores it on cleanup — serve's collision warning rides the default
// logger (warnReservedPorts runs before serve installs its own).
func captureSlog(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := new(bytes.Buffer)
	orig := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(orig) })
	return buf
}

func TestWarnReservedPorts(t *testing.T) {
	// version is the ldflags build var; flip it per case (restored on
	// cleanup) to cover the dev-build rig-block exemption. Empty means the
	// test binary's default "dev".
	cases := []struct {
		name      string
		version   string
		cfg       config.Config
		wantWarns int
		want      []string
	}{
		{name: "default port stays silent", cfg: config.Config{Port: 3000}},
		{name: "dev build on a rig port stays silent", cfg: config.Config{Port: 21000}},
		{name: "released build on a rig port warns", version: "1.2.3", cfg: config.Config{Port: 21000}, wantWarns: 1,
			want: []string{"port=21000", "block=rig", "start=21000", "end=21299", "RK_PORT"}},
		{name: "dev build on a tunnel port warns", cfg: config.Config{Port: 3150}, wantWarns: 1,
			want: []string{"port=3150", "block=tunnel", "start=3100", "end=3199", "RK_PORT"}},
		{name: "dev build on the sentinel warns", cfg: config.Config{Port: 21999}, wantWarns: 1,
			want: []string{"port=21999", "block=sentinel", "start=21999", "end=21999"}},
		{name: "code-server straddles into tunnel", cfg: config.Config{Port: 3098, CodeServerPort: 3100}, wantWarns: 1,
			want: []string{"port=3098", "block=tunnel"}},
		{name: "released build: one warning per non-rig block", version: "1.2.3", cfg: config.Config{Port: 21000, CodeServerPort: 3100}, wantWarns: 2,
			want: []string{"block=rig", "block=tunnel"}},
		{name: "dev build: rig dropped, tunnel still warns", cfg: config.Config{Port: 21000, CodeServerPort: 3100}, wantWarns: 1,
			want: []string{"block=tunnel"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.version != "" {
				orig := version
				version = tc.version
				t.Cleanup(func() { version = orig })
			}
			buf := captureSlog(t)
			warnReservedPorts(tc.cfg)
			out := buf.String()
			if got := strings.Count(out, "level=WARN"); got != tc.wantWarns {
				t.Fatalf("warn count = %d, want %d (output %q)", got, tc.wantWarns, out)
			}
			for _, want := range tc.want {
				if !strings.Contains(out, want) {
					t.Errorf("output missing %q (got %q)", want, out)
				}
			}
		})
	}
}
