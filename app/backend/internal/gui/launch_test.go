package gui

import (
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// stubStat succeeds only for the listed paths — the dangling-alternative
// guard's second half (lookPath may resolve a symlink whose target is gone).
func stubStat(paths ...string) func(string) (os.FileInfo, error) {
	present := make(map[string]bool, len(paths))
	for _, p := range paths {
		present[p] = true
	}
	return func(path string) (os.FileInfo, error) {
		if present[path] {
			return fakeFileInfo{path}, nil
		}
		return nil, errors.New("no such file: " + path)
	}
}

// fakeFileInfo is the minimal os.FileInfo for the stat seam.
type fakeFileInfo struct{ name string }

func (f fakeFileInfo) Name() string       { return f.name }
func (f fakeFileInfo) Size() int64        { return 0 }
func (f fakeFileInfo) Mode() os.FileMode  { return 0o755 }
func (f fakeFileInfo) ModTime() time.Time { return time.Time{} }
func (f fakeFileInfo) IsDir() bool        { return false }
func (f fakeFileInfo) Sys() any           { return nil }

func TestParseAppRole(t *testing.T) {
	for _, s := range []string{"terminal", "browser"} {
		if role, err := ParseAppRole(s); err != nil || string(role) != s {
			t.Errorf("ParseAppRole(%q) = (%q, %v), want (%q, nil)", s, role, err, s)
		}
	}
	for _, s := range []string{"xterm", "", "Terminal", "browser "} {
		if _, err := ParseAppRole(s); err == nil || err.Error() != "app must be terminal or browser" {
			t.Errorf("ParseAppRole(%q) err = %v, want 'app must be terminal or browser'", s, err)
		}
	}
}

func TestResolveAppLadderOrder(t *testing.T) {
	// Every rung present: the ladder head must win per role.
	allTerminal := appLadders[AppTerminal]
	allBrowser := appLadders[AppBrowser]
	lookPath := stubLookPath(append(append([]string{}, allTerminal...), allBrowser...)...)
	stat := func(p string) (os.FileInfo, error) { return fakeFileInfo{p}, nil }

	name, path, ok := ResolveApp(AppTerminal, lookPath, stat)
	if !ok || name != "x-terminal-emulator" || path != "/usr/bin/x-terminal-emulator" {
		t.Errorf("ResolveApp(terminal) = (%q, %q, %v), want the ladder head", name, path, ok)
	}
	name, _, ok = ResolveApp(AppBrowser, lookPath, stat)
	if !ok || name != "chromium" {
		t.Errorf("ResolveApp(browser) = (%q, %v), want chromium first", name, ok)
	}
	// With the head absent the next rung wins.
	name, _, ok = ResolveApp(AppTerminal, stubLookPath("xterm"), stat)
	if !ok || name != "xterm" {
		t.Errorf("ResolveApp(terminal, xterm only) = (%q, %v), want xterm", name, ok)
	}
	name, _, ok = ResolveApp(AppBrowser, stubLookPath("firefox"), stat)
	if !ok || name != "firefox" {
		t.Errorf("ResolveApp(browser, firefox only) = (%q, %v), want firefox", name, ok)
	}
}

func TestResolveAppSkipsDanglingAlternative(t *testing.T) {
	// x-www-browser resolves via lookPath but the alternative target is gone;
	// firefox resolves and stats — it must win.
	name, _, ok := ResolveApp(AppBrowser,
		stubLookPath("x-www-browser", "firefox"),
		stubStat("/usr/bin/firefox"))
	if !ok || name != "firefox" {
		t.Errorf("ResolveApp(browser) = (%q, %v), want firefox — the dangling x-www-browser must be skipped", name, ok)
	}
}

func TestResolveAppWholeLadderMiss(t *testing.T) {
	stat := func(p string) (os.FileInfo, error) { return fakeFileInfo{p}, nil }
	for _, role := range []AppRole{AppTerminal, AppBrowser} {
		if name, path, ok := ResolveApp(role, stubLookPath(), stat); ok || name != "" || path != "" {
			t.Errorf("ResolveApp(%s, nothing on PATH) = (%q, %q, %v), want (\"\", \"\", false)", role, name, path, ok)
		}
	}
	// Every rung resolves but every stat fails: still a miss.
	all := append(append([]string{}, appLadders[AppTerminal]...), appLadders[AppBrowser]...)
	if _, _, ok := ResolveApp(AppTerminal, stubLookPath(all...), stubStat()); ok {
		t.Error("ResolveApp(terminal) ok=true with every stat failing, want false")
	}
}

func TestLaunchHint(t *testing.T) {
	cases := []struct {
		role     AppRole
		managers []string
		want     string
	}{
		{AppBrowser, []string{"apt-get"}, "no browser on the GUI host — sudo apt install chromium-browser"},
		{AppBrowser, []string{"dnf"}, "no browser on the GUI host — sudo dnf install chromium"},
		{AppBrowser, []string{"pacman"}, "no browser on the GUI host — sudo pacman -S chromium"},
		{AppBrowser, nil, "no browser on the GUI host — install a browser with your package manager"},
		{AppTerminal, []string{"apt-get"}, "no terminal on the GUI host — sudo apt install xterm"},
		{AppTerminal, []string{"dnf"}, "no terminal on the GUI host — sudo dnf install xterm"},
		{AppTerminal, []string{"pacman"}, "no terminal on the GUI host — sudo pacman -S xterm"},
		{AppTerminal, nil, "no terminal on the GUI host — install a terminal with your package manager"},
	}
	for _, c := range cases {
		if got := LaunchHint(c.role, stubLookPath(c.managers...)); got != c.want {
			t.Errorf("LaunchHint(%s, managers %v) = %q, want %q", c.role, c.managers, got, c.want)
		}
	}
}

func TestLaunchEnvReplaceNeverDuplicate(t *testing.T) {
	base := []string{"HOME=/home/u", "DISPLAY=:0", "RK_GUI_SOCKET=/old.sock", "PATH=/usr/bin"}
	env := LaunchEnv(base, ":10", "/s/host.sock")

	var displays, sockets int
	for _, kv := range env {
		switch {
		case kv == "DISPLAY=:10":
			displays++
		case strings.HasPrefix(kv, "DISPLAY="):
			t.Errorf("stale DISPLAY entry survived: %q", kv)
		case kv == "RK_GUI_SOCKET=/s/host.sock":
			sockets++
		case strings.HasPrefix(kv, "RK_GUI_SOCKET="):
			t.Errorf("stale RK_GUI_SOCKET entry survived: %q", kv)
		}
	}
	if displays != 1 || sockets != 1 {
		t.Errorf("env carries DISPLAY ×%d, RK_GUI_SOCKET ×%d, want exactly one each: %v", displays, sockets, env)
	}
	// A base without either key gains both.
	env = LaunchEnv([]string{"HOME=/home/u"}, ":10", "/s/host.sock")
	if !reflect.DeepEqual(env, []string{"HOME=/home/u", "DISPLAY=:10", "RK_GUI_SOCKET=/s/host.sock"}) {
		t.Errorf("LaunchEnv(no prior keys) = %v, want both appended", env)
	}
}
