package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/settings"

	"github.com/spf13/cobra"
)

// wmCmdWith builds a bare command carrying the wm verb's --force/--restart
// flags.
func wmCmdWith(out, errOut *bytes.Buffer, force, restart bool) *cobra.Command {
	cmd := bareCmdIn(out, errOut, nil)
	cmd.Flags().Bool("force", false, "")
	cmd.Flags().Bool("restart", false, "")
	if force {
		_ = cmd.Flags().Set("force", "true")
	}
	if restart {
		_ = cmd.Flags().Set("restart", "true")
	}
	return cmd
}

// seedGuiWMPin persists the gui.wm pin through the isolated config dir.
func seedGuiWMPin(t *testing.T, pin string) {
	t.Helper()
	st := settings.Load()
	st.GUIWM = pin
	if err := settings.Save(st); err != nil {
		t.Fatalf("seed settings: %v", err)
	}
}

func TestGuiWMAliasResolution(t *testing.T) {
	for arg, want := range map[string]string{
		"auto":          "",
		"icewm":         "icewm-session",
		"lxqt":          "startlxqt",
		"xfce":          "startxfce4",
		"icewm-session": "icewm-session",
		"openbox":       "openbox",
	} {
		if got, err := guiWMResolveName(arg); err != nil || got != want {
			t.Errorf("guiWMResolveName(%q) = %q, %v, want %q, nil", arg, got, err, want)
		}
	}
}

func TestGuiWMLiteralNameValidation(t *testing.T) {
	for _, arg := range []string{"foo/bar", "/usr/bin/openbox", "my wm", "wm\tname"} {
		_, err := guiWMResolveName(arg)
		if err == nil || err.Error() != "window manager name must be a bare binary name" {
			t.Errorf("guiWMResolveName(%q) err = %v, want the bare-name refusal", arg, err)
		}
		if code := exitCode(err); code != exitUsage {
			t.Errorf("guiWMResolveName(%q) exit code = %d, want %d (usage)", arg, code, exitUsage)
		}
	}
}

func TestGuiWMTwoPositionalsIsUsage(t *testing.T) {
	if err := guiWmCmd.Args(guiWmCmd, []string{"lxqt", "xfce"}); err == nil || exitCode(err) != exitUsage {
		t.Errorf("two positionals: err = %v, exit code = %d, want %d (usage)", err, exitCode(err), exitUsage)
	}
}

func TestGuiWMPathMissRefusesWithDEHint(t *testing.T) {
	_, _, restarts := withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) {
		if name == "startlxqt" {
			return "", errors.New("not found")
		}
		return "/usr/bin/" + name, nil
	}

	err := runGuiWM(wmCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false, false), []string{"lxqt"})
	want := "startlxqt not on PATH — sudo apt install --no-install-recommends lxqt-core (pass --force to pin anyway)"
	if err == nil || err.Error() != want {
		t.Errorf("err = %v, want exactly %q", err, want)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if got := settings.Load().GUIWM; got != "" {
		t.Errorf("gui.wm = %q after the refusal, want unchanged", got)
	}
	if *restarts != 0 {
		t.Errorf("restart seam called %d times on a refusal", *restarts)
	}
}

func TestGuiWMForcePinsOnPathMiss(t *testing.T) {
	withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) { return "", errors.New("not found") }

	var out bytes.Buffer
	if err := runGuiWM(wmCmdWith(&out, &bytes.Buffer{}, true, false), []string{"lxqt"}); err != nil {
		t.Fatal(err)
	}
	if got := settings.Load().GUIWM; got != "startlxqt" {
		t.Errorf("gui.wm = %q, want startlxqt (--force pins anyway)", got)
	}
	want := "set gui.wm=startlxqt — takes effect on rk gui restart (kills apps on the display)\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

// A bare set succeeds while the GUI is off and takes effect on the next start.
func TestGuiWMSetWhileOffSucceeds(t *testing.T) {
	_, _, restarts := withGuiCLISeams(t)

	var out bytes.Buffer
	if err := runGuiWM(wmCmdWith(&out, &bytes.Buffer{}, false, false), []string{"lxqt"}); err != nil {
		t.Fatal(err)
	}
	if got := settings.Load().GUIWM; got != "startlxqt" {
		t.Errorf("gui.wm = %q, want startlxqt", got)
	}
	want := "set gui.wm=startlxqt — takes effect on rk gui restart (kills apps on the display)\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	if *restarts != 0 {
		t.Errorf("restart seam called %d times without --restart", *restarts)
	}
}

func TestGuiWMRestartChains(t *testing.T) {
	_, _, restarts := withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiWM(wmCmdWith(&out, &errOut, false, true), []string{"lxqt"}); err != nil {
		t.Fatal(err)
	}
	if got := settings.Load().GUIWM; got != "startlxqt" {
		t.Errorf("gui.wm = %q, want startlxqt", got)
	}
	if *restarts != 1 {
		t.Errorf("restart calls = %d, want 1", *restarts)
	}
	want := "set gui.wm=startlxqt\nrestarted (Xtigervnc :10)\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiWMRestartWhileOffWritesPinThenRefuses(t *testing.T) {
	_, _, restarts := withGuiCLISeams(t)

	var out bytes.Buffer
	err := runGuiWM(wmCmdWith(&out, &bytes.Buffer{}, false, true), []string{"lxqt"})
	if err == nil || err.Error() != guiErrOff {
		t.Errorf("err = %v, want the gui-off refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if got := settings.Load().GUIWM; got != "startlxqt" {
		t.Errorf("gui.wm = %q, want startlxqt (the write precedes the chain)", got)
	}
	if *restarts != 0 {
		t.Errorf("restart seam called %d times while off (the refusal fires first)", *restarts)
	}
	if got, want := out.String(), "set gui.wm=startlxqt\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiWMAutoNeverProbesPath(t *testing.T) {
	withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) {
		t.Errorf("LookPath(%q) called for auto — the ladder never probes", name)
		return "", errors.New("not found")
	}
	seedGuiWMPin(t, "startlxqt")

	var out bytes.Buffer
	if err := runGuiWM(wmCmdWith(&out, &bytes.Buffer{}, false, false), []string{"auto"}); err != nil {
		t.Fatal(err)
	}
	if got := settings.Load().GUIWM; got != "" {
		t.Errorf("gui.wm = %q, want cleared", got)
	}
	want := "set gui.wm= (ladder) — takes effect on rk gui restart (kills apps on the display)\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiWMSaveErrorFails(t *testing.T) {
	withGuiCLISeams(t)
	orig := guiSettingsSave
	guiSettingsSave = func(settings.Settings) error { return errors.New("disk full") }
	t.Cleanup(func() { guiSettingsSave = orig })

	err := runGuiWM(wmCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false, false), []string{"lxqt"})
	if err == nil || !strings.Contains(err.Error(), "saving settings: disk full") {
		t.Errorf("err = %v, want the save error", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiWMReport(t *testing.T) {
	cases := []struct {
		name    string
		pin     string
		on      bool
		stampWM string
		want    string
	}{
		{"auto running", "", true, "icewm-session", "wm: auto → icewm-session (running)\n"},
		{"auto bare", "", true, "", "wm: auto (running bare)\n"},
		{"auto not running", "", false, "", "wm: auto (not running)\n"},
		{"pinned equal", "startlxqt", true, "startlxqt", "wm: startlxqt (pinned; running)\n"},
		{"pinned differs", "startlxqt", true, "icewm-session", "wm: startlxqt (pinned; running icewm-session)\n"},
		{"pinned not running", "startlxqt", false, "", "wm: startlxqt (pinned; not running)\n"},
		{"pinned bare", "startlxqt", true, "", "wm: startlxqt (pinned; running bare)\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withGuiCLISeams(t)
			if tc.on {
				seedGuiOn(t)
			}
			if tc.pin != "" {
				seedGuiWMPin(t, tc.pin)
			}
			guiSessionOptionsFn = func(context.Context) (string, string, string, bool) {
				return ":10", "Xtigervnc", tc.stampWM, true
			}

			var out bytes.Buffer
			if err := runGuiWM(wmCmdWith(&out, &bytes.Buffer{}, false, false), nil); err != nil {
				t.Fatal(err)
			}
			if got := out.String(); got != tc.want {
				t.Errorf("stdout = %q, want %q", got, tc.want)
			}
			if got := settings.Load().GUIWM; got != tc.pin {
				t.Errorf("gui.wm = %q after a read-only report, want %q (never writes)", got, tc.pin)
			}
		})
	}
}
