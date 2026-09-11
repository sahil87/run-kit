package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"rk/internal/gui"
	"rk/internal/settings"

	"github.com/spf13/cobra"
)

// wmCmdWith builds a bare command carrying the wm verb's flags.
func wmCmdWith(out, errOut *bytes.Buffer, force, restart bool) *cobra.Command {
	cmd := bareCmdIn(out, errOut, nil)
	cmd.Flags().Bool("force", false, "")
	cmd.Flags().Bool("restart", false, "")
	cmd.Flags().Bool("list", false, "")
	cmd.Flags().Bool("json", false, "")
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
		"plasma":        "startplasma-x11",
		"lxde":          "startlxde",
		"mate":          "mate-session",
		"cinnamon":      "cinnamon-session",
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

func TestGuiWMPathMissRefusesWithLXDEHint(t *testing.T) {
	_, _, restarts := withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) {
		if name == "startlxde" {
			return "", errors.New("not found")
		}
		return "/usr/bin/" + name, nil
	}

	err := runGuiWM(wmCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false, false), []string{"lxde"})
	want := "startlxde not on PATH — sudo apt install --no-install-recommends lxde-core (pass --force to pin anyway)"
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

func TestGuiWMListTable(t *testing.T) {
	withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) {
		switch name {
		case "icewm-session", "startlxqt", "apt-get":
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found: " + name)
	}

	var out bytes.Buffer
	cmd := wmCmdWith(&out, &bytes.Buffer{}, false, false)
	if err := cmd.Flags().Set("list", "true"); err != nil {
		t.Fatal(err)
	}
	if err := runGuiWM(cmd, nil); err != nil {
		t.Fatal(err)
	}
	want := `NAME              LABEL     KIND     INSTALLED  HINT
icewm-session     IceWM     wm       yes
startlxqt         LXQt      session  yes
startxfce4        XFCE      session  no         sudo apt install --no-install-recommends xfce4
startplasma-x11   Plasma    session  no         sudo apt install --no-install-recommends plasma-desktop
startlxde         LXDE      session  no         sudo apt install --no-install-recommends lxde-core
mate-session      MATE      session  no         sudo apt install --no-install-recommends mate-desktop-environment-core
cinnamon-session  Cinnamon  session  no         sudo apt install --no-install-recommends cinnamon-core
`
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	if got := settings.Load().GUIWM; got != "" {
		t.Errorf("gui.wm = %q after --list, want unchanged (read-only)", got)
	}
}

func TestGuiWMListJSONMatchesWMCandidates(t *testing.T) {
	withGuiCLISeams(t)
	guiLookPathFn = func(name string) (string, error) {
		switch name {
		case "icewm-session", "apt-get":
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found: " + name)
	}

	var out bytes.Buffer
	cmd := wmCmdWith(&out, &bytes.Buffer{}, false, false)
	for _, f := range []string{"list", "json"} {
		if err := cmd.Flags().Set(f, "true"); err != nil {
			t.Fatal(err)
		}
	}
	if err := runGuiWM(cmd, nil); err != nil {
		t.Fatal(err)
	}
	var got []gui.WMCandidate
	if err := json.Unmarshal(out.Bytes(), &got); err != nil {
		t.Fatalf("stdout is not the wm_candidates array: %v (%q)", err, out.String())
	}
	if want := gui.WMCandidates(guiLookPathFn); !reflect.DeepEqual(got, want) {
		t.Errorf("--json = %+v, want gui.WMCandidates' %+v", got, want)
	}
}

func TestGuiWMListUsageErrors(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		setFlag string
		wantMsg string
	}{
		{"positional", []string{"lxqt"}, "", "--list takes no argument"},
		{"restart", nil, "restart", "--list cannot be combined with --restart"},
		{"force", nil, "force", "--list cannot be combined with --force"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withGuiCLISeams(t)
			guiLookPathFn = func(name string) (string, error) { return "/usr/bin/" + name, nil }
			cmd := wmCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false, false)
			if err := cmd.Flags().Set("list", "true"); err != nil {
				t.Fatal(err)
			}
			if tc.setFlag != "" {
				if err := cmd.Flags().Set(tc.setFlag, "true"); err != nil {
					t.Fatal(err)
				}
			}
			err := runGuiWM(cmd, tc.args)
			if err == nil || err.Error() != tc.wantMsg {
				t.Errorf("err = %v, want %q", err, tc.wantMsg)
			}
			if code := exitCode(err); code != exitUsage {
				t.Errorf("exit code = %d, want %d (usage)", code, exitUsage)
			}
			if got := settings.Load().GUIWM; got != "" {
				t.Errorf("gui.wm = %q after the usage refusal, want unchanged", got)
			}
		})
	}
}

func TestGuiWMJSONWithoutListIsUsage(t *testing.T) {
	withGuiCLISeams(t)
	cmd := wmCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false, false)
	if err := cmd.Flags().Set("json", "true"); err != nil {
		t.Fatal(err)
	}
	err := runGuiWM(cmd, nil)
	if err == nil || err.Error() != "--json requires --list" {
		t.Errorf("err = %v, want the --json-without---list usage error", err)
	}
	if code := exitCode(err); code != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", code, exitUsage)
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
