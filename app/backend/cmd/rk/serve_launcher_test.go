package main

import (
	"io/fs"
	"os"
	"testing"
)

// serveLauncherSeams records every re-point seam interaction and restores the
// production defaults on cleanup. lstatInfo/lstatErr model what sits at the
// launcher path; linkTarget/linkErr model its Readlink.
type serveLauncherSeams struct {
	lstatInfo  os.FileInfo
	lstatErr   error
	linkTarget string
	linkErr    error
	resolved   string
	resolveErr error

	launcherCalled bool
	replaceCalled  bool
	replaceTarget  string
	replaceLink    string
}

// stubServeLauncherSeams points every serve-time re-point seam at the fake
// state; the launcher path is a fixed stand-in.
func stubServeLauncherSeams(t *testing.T, st *serveLauncherSeams) {
	t.Helper()
	origResolve, origLauncher := serveResolveSelf, serveLauncherPath
	origLstat, origReadlink, origReplace := serveLstat, serveReadlink, serveReplaceSymlink
	t.Cleanup(func() {
		serveResolveSelf, serveLauncherPath = origResolve, origLauncher
		serveLstat, serveReadlink, serveReplaceSymlink = origLstat, origReadlink, origReplace
	})
	serveResolveSelf = func() (string, error) { return st.resolved, st.resolveErr }
	serveLauncherPath = func() (string, error) {
		st.launcherCalled = true
		return "/h/.local/share/rk/bin/run-kit", nil
	}
	serveLstat = func(string) (os.FileInfo, error) { return st.lstatInfo, st.lstatErr }
	serveReadlink = func(string) (string, error) { return st.linkTarget, st.linkErr }
	serveReplaceSymlink = func(target, linkPath string) error {
		st.replaceCalled = true
		st.replaceTarget, st.replaceLink = target, linkPath
		return nil
	}
}

func TestRepointLauncherNonBrewTouchesNothing(t *testing.T) {
	st := &serveLauncherSeams{}
	stubServeLauncherSeams(t, st)
	repointLauncher(false)
	if st.launcherCalled || st.replaceCalled {
		t.Errorf("non-brew daemon must not touch the launcher (launcherCalled=%v replaceCalled=%v)", st.launcherCalled, st.replaceCalled)
	}
}

func TestRepointLauncherAbsentDoesNothing(t *testing.T) {
	st := &serveLauncherSeams{lstatErr: fs.ErrNotExist, resolved: "/cellar/rk"}
	stubServeLauncherSeams(t, st)
	repointLauncher(true)
	if st.replaceCalled {
		t.Error("an absent launcher is the installer's to create — serve must not replace it")
	}
}

func TestRepointLauncherForeignNonSymlinkUntouched(t *testing.T) {
	st := &serveLauncherSeams{lstatInfo: fakeFileInfo{mode: 0o755}, resolved: "/cellar/rk"}
	stubServeLauncherSeams(t, st)
	repointLauncher(true)
	if st.replaceCalled {
		t.Error("a non-symlink at the launcher path is the user's — never replaced")
	}
}

func TestRepointLauncherCurrentIsNoOp(t *testing.T) {
	st := &serveLauncherSeams{
		lstatInfo:  fakeFileInfo{mode: os.ModeSymlink},
		linkTarget: "/cellar/rk",
		resolved:   "/cellar/rk",
	}
	stubServeLauncherSeams(t, st)
	repointLauncher(true)
	if st.replaceCalled {
		t.Error("an already-current launcher must not be rewritten")
	}
}

func TestRepointLauncherStaleRepoints(t *testing.T) {
	st := &serveLauncherSeams{
		lstatInfo:  fakeFileInfo{mode: os.ModeSymlink},
		linkTarget: "/cellar/old-rk",
		resolved:   "/cellar/rk",
	}
	stubServeLauncherSeams(t, st)
	repointLauncher(true)
	if !st.replaceCalled {
		t.Fatal("a stale launcher must be re-pointed at the running daemon's binary")
	}
	if st.replaceTarget != "/cellar/rk" || st.replaceLink != "/h/.local/share/rk/bin/run-kit" {
		t.Errorf("replace called with (%q, %q), want (/cellar/rk, /h/.local/share/rk/bin/run-kit)", st.replaceTarget, st.replaceLink)
	}
}
