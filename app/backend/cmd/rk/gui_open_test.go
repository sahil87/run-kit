package main

import (
	"bytes"
	"io/fs"
	"os"
	"strings"
	"testing"
)

// withGuiOpenSeams captures the detached-start calls and stubs the file stat
// (files exist by default; override guiStatFn for the missing-file case).
// Restores via t.Cleanup.
func withGuiOpenSeams(t *testing.T) (starts *[][]string) {
	t.Helper()
	starts = new([][]string)

	origStart, origStat := guiOpenStartFn, guiStatFn
	t.Cleanup(func() { guiOpenStartFn, guiStatFn = origStart, origStat })

	guiOpenStartFn = func(argv []string, env []string) (int, error) {
		*starts = append(*starts, append(argv, env...))
		return 4321, nil
	}
	guiStatFn = func(string) (os.FileInfo, error) { return nil, nil }
	return starts
}

func TestGuiOpenURLClassification(t *testing.T) {
	cases := map[string]bool{
		"https://example.com": true,
		"rdp://host":          true,
		"foo.png":             false,
		"./a b":               false,
		"/etc/hosts":          false,
	}
	for arg, want := range cases {
		if got := guiOpenURLPattern.MatchString(arg); got != want {
			t.Errorf("guiOpenURLPattern(%q) = %v, want %v", arg, got, want)
		}
	}
}

func TestGuiOpenURLViaXdgOpen(t *testing.T) {
	starts := withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	// The default lookPath resolves every tool, xdg-open included.

	var out bytes.Buffer
	if err := runGuiOpen(bareCmd(&out, &bytes.Buffer{}), []string{"https://example.com"}); err != nil {
		t.Fatal(err)
	}
	if got, want := (*starts)[0][0:2], []string{"xdg-open", "https://example.com"}; strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("start argv = %v, want %v", got, want)
	}
	if got, want := out.String(), "started 4321 on :10\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiOpenMissingFile(t *testing.T) {
	starts := withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiStatFn = func(string) (os.FileInfo, error) { return nil, fs.ErrNotExist }

	err := runGuiOpen(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"nope.png"})
	if err == nil || err.Error() != "open: nope.png: no such file" {
		t.Errorf("err = %v, want the missing-file refusal naming the path as given", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*starts) != 0 {
		t.Errorf("start called %d times for a missing file", len(*starts))
	}
}

func TestGuiOpenURLFallsBackToBrowserLadder(t *testing.T) {
	starts := withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("chromium")

	var out bytes.Buffer
	if err := runGuiOpen(bareCmd(&out, &bytes.Buffer{}), []string{"https://example.com"}); err != nil {
		t.Fatal(err)
	}
	if got, want := (*starts)[0][0:2], []string{"/usr/bin/chromium", "https://example.com"}; strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("start argv = %v, want %v", got, want)
	}
	if got, want := out.String(), "started 4321 on :10\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiOpenURLNoBrowserPrintsHint(t *testing.T) {
	starts := withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("apt-get")

	err := runGuiOpen(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"https://example.com"})
	if err == nil || err.Error() != "no browser on the GUI host — sudo apt install chromium-browser" {
		t.Errorf("err = %v, want the browser install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*starts) != 0 {
		t.Errorf("start called %d times after a ladder miss", len(*starts))
	}
}

func TestGuiOpenFileWithoutXdgOpenRefuses(t *testing.T) {
	starts := withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly()

	err := runGuiOpen(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"foo.png"})
	if err == nil || err.Error() != "xdg-open not found — sudo apt install xdg-utils" {
		t.Errorf("err = %v, want the xdg-utils install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*starts) != 0 {
		t.Errorf("start called %d times without xdg-open for a file", len(*starts))
	}
}

func TestGuiOpenStatErrorIsNotMissingFile(t *testing.T) {
	withGuiOpenSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiStatFn = func(string) (os.FileInfo, error) { return nil, fs.ErrPermission }

	err := runGuiOpen(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"locked.png"})
	if err == nil || !strings.Contains(err.Error(), "error: open locked.png: ") || strings.Contains(err.Error(), "no such file") {
		t.Errorf("err = %v, want a wrapped operational error, not the missing-file refusal", err)
	}
}
