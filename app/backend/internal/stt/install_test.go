package stt

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	rkarchive "rk/internal/archive"
)

// archiveSpec describes one in-test archive entry: a directory (dir), a
// regular file (body), or a symlink (link).
type archiveSpec struct {
	name string
	body string
	mode os.FileMode
	dir  bool
	link string
}

// makeZip builds a .zip archive in memory. Symlink entries carry their target
// as the entry body under unix mode bits.
func makeZip(t *testing.T, entries []archiveSpec) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		hdr := &zip.FileHeader{Name: e.name, Method: zip.Deflate, Modified: time.Now()}
		mode := e.mode
		if mode == 0 {
			mode = 0o644
		}
		if e.dir {
			hdr.Name = strings.TrimSuffix(e.name, "/") + "/"
			hdr.SetMode(os.ModeDir | mode)
			if _, err := zw.CreateHeader(hdr); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if e.link != "" {
			hdr.SetMode(os.ModeSymlink | 0o777)
			w, err := zw.CreateHeader(hdr)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := w.Write([]byte(e.link)); err != nil {
				t.Fatal(err)
			}
			continue
		}
		hdr.SetMode(mode)
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(e.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// makeTarGz builds a .tar.gz archive in memory, in entry order (the symlink
// parent-resolution cases depend on link-before-child ordering).
func makeTarGz(t *testing.T, entries []archiveSpec) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		mode := int64(e.mode)
		if mode == 0 {
			mode = 0o644
		}
		hdr := &tar.Header{Name: e.name, Mode: mode}
		switch {
		case e.dir:
			hdr.Typeflag = tar.TypeDir
		case e.link != "":
			hdr.Typeflag = tar.TypeSymlink
			hdr.Linkname = e.link
		default:
			hdr.Typeflag = tar.TypeReg
			hdr.Size = int64(len(e.body))
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if hdr.Typeflag == tar.TypeReg {
			if _, err := tw.Write([]byte(e.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// sha256Hex returns the hex digest of data — the pinned digest a test records
// for its fake archive.
func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// stageStateRoot points the state-dir layout at a temp dir and returns it.
func stageStateRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Setenv("XDG_STATE_HOME", root)
	return filepath.Join(root, "run-kit", "whisper")
}

// fakeReleaseServer serves the given files (name → contents) and counts
// requests per path.
func fakeReleaseServer(t *testing.T, files map[string][]byte) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		data, ok := files[strings.TrimPrefix(r.URL.Path, "/")]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write(data)
	}))
	t.Cleanup(srv.Close)
	return srv, &hits
}

// testInstaller wires an installer at the fake server for the given platform.
func testInstaller(srv *httptest.Server, goos, goarch string, assets map[string]whisperAsset) *installer {
	return &installer{
		client:       srv.Client(),
		goos:         goos,
		goarch:       goarch,
		binBase:      srv.URL + "/",
		modelBase:    srv.URL + "/",
		assets:       assets,
		modelDigests: map[string]string{},
		progress:     func(string) {},
	}
}

// TestInstallUnsupportedPlatform: a GOOS/GOARCH with no published prebuilt
// archive and no whisper-cli on PATH fails closed with the actionable gap
// message — never a source build, never an unpinned fetch.
func TestInstallUnsupportedPlatform(t *testing.T) {
	stageStateRoot(t)
	// Scrub PATH so no host whisper-cli downgrades this to the model-only arm.
	t.Setenv("PATH", t.TempDir())
	ins := &installer{
		client:       &http.Client{},
		goos:         "darwin",
		goarch:       "arm64",
		assets:       whisperAssets,
		modelDigests: modelSHA256,
	}
	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "darwin/arm64") {
		t.Fatalf("err = %v, want the platform gap named", err)
	}
	if !strings.Contains(err.Error(), "no prebuilt binary") {
		t.Errorf("err = %v, want the no-prebuilt-binary gap", err)
	}
	if !strings.Contains(err.Error(), "brew install whisper-cpp") {
		t.Errorf("err = %v, want the actionable brew remediation", err)
	}
}

// TestInstallModelOnlyWithPathBinary: on a platform with no published archive,
// a whisper-cli already on PATH downgrades the run to a model-only fetch — no
// binary download, no bin/ promotion, and the probe reports installed against
// the PATH binary.
func TestInstallModelOnlyWithPathBinary(t *testing.T) {
	stageStateRoot(t)
	pathDir := t.TempDir()
	pathBin := filepath.Join(pathDir, "whisper-cli")
	if err := os.WriteFile(pathBin, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv("PATH", pathDir)
	model := []byte("fake-model-bytes")
	srv, hits := fakeReleaseServer(t, map[string][]byte{"ggml-small.en-q5_1.bin": model})
	ins := testInstaller(srv, "darwin", "arm64", whisperAssets)

	st, err := ins.install(context.Background(), "")
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !st.Installed {
		t.Fatalf("probe reports not installed after a model-only install: %+v", st)
	}
	if st.BinPath != pathBin {
		t.Errorf("BinPath = %q, want the PATH binary %q", st.BinPath, pathBin)
	}
	if hits.Load() != 1 {
		t.Errorf("requests = %d, want exactly 1 (the model only)", hits.Load())
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(filepath.Dir(st.ModelPath)), "bin")); !os.IsNotExist(err) {
		t.Errorf("bin/ exists after a model-only install: %v", err)
	}
}

// TestInstallFailsClosedOnEmptyDigest: a supported platform whose pinned
// digest constant is empty refuses before any download.
func TestInstallFailsClosedOnEmptyDigest(t *testing.T) {
	stageStateRoot(t)
	srv, hits := fakeReleaseServer(t, map[string][]byte{"whisper-bin-x64.zip": makeZip(t, []archiveSpec{{name: "whisper-cli", body: "bin", mode: 0o755}})})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: ""},
	})
	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "refusing to install an unverified binary") {
		t.Fatalf("err = %v, want the fail-closed unverified-binary refusal", err)
	}
	if hits.Load() != 0 {
		t.Errorf("downloads ran (%d) with no pinned digest", hits.Load())
	}
}

// TestInstallSuccess: a verified zip archive and model land in the state-dir
// layout — executable binary, VERSION recorded, probe reporting installed.
func TestInstallSuccess(t *testing.T) {
	root := stageStateRoot(t)
	archive := makeZip(t, []archiveSpec{
		{name: "whisper-cli", body: "#!fake whisper\n", mode: 0o644},
		{name: "ggml.dll", body: "dll-bytes"},
	})
	model := []byte("fake-model-bytes")
	srv, _ := fakeReleaseServer(t, map[string][]byte{
		"whisper-bin-x64.zip":    archive,
		"ggml-small.en-q5_1.bin": model,
	})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: sha256Hex(archive)},
	})

	st, err := ins.install(context.Background(), "")
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !st.Installed {
		t.Fatalf("probe reports not installed after a successful install: %+v", st)
	}
	if st.Version != whisperVersion {
		t.Errorf("Version = %q, want %q", st.Version, whisperVersion)
	}
	bin := filepath.Join(root, "bin", "whisper-cli")
	info, err := os.Stat(bin)
	if err != nil {
		t.Fatalf("binary missing at %s: %v", bin, err)
	}
	if info.Mode()&0o111 == 0 {
		t.Errorf("binary mode = %v, want executable", info.Mode())
	}
	data, err := os.ReadFile(filepath.Join(root, "models", "ggml-small.en-q5_1.bin"))
	if err != nil || !bytes.Equal(data, model) {
		t.Errorf("model file = %q, %v — want the downloaded bytes", data, err)
	}
}

// TestInstallSuccessTarGz: the tar.gz arm lands a bin/-nested binary the same
// way (the zip arm is covered by TestInstallSuccess).
func TestInstallSuccessTarGz(t *testing.T) {
	root := stageStateRoot(t)
	archive := makeTarGz(t, []archiveSpec{
		{name: "bin", dir: true, mode: 0o755},
		{name: "bin/whisper-cli", body: "#!fake whisper\n", mode: 0o755},
	})
	srv, _ := fakeReleaseServer(t, map[string][]byte{
		"whisper.tar.gz":         archive,
		"ggml-small.en-q5_1.bin": []byte("fake-model-bytes"),
	})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper.tar.gz", SHA256: sha256Hex(archive)},
	})

	st, err := ins.install(context.Background(), "")
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !st.Installed || st.Version != whisperVersion {
		t.Errorf("probe = %+v, want installed at %s", st, whisperVersion)
	}
	if _, err := os.Stat(filepath.Join(root, "bin", "whisper-cli")); err != nil {
		t.Errorf("binary missing at the canonical path after promotion: %v", err)
	}
}

// TestInstallStripsWrapperDir: the published archives wrap their payload in a
// single top-level directory (whisper-bin-ubuntu-x64/, Release/); the install
// collapses that nesting so the binary lands at the canonical path with its
// sibling shared libraries beside it.
func TestInstallStripsWrapperDir(t *testing.T) {
	root := stageStateRoot(t)
	archive := makeTarGz(t, []archiveSpec{
		{name: "whisper-bin-ubuntu-x64", dir: true, mode: 0o755},
		{name: "whisper-bin-ubuntu-x64/whisper-cli", body: "#!fake whisper\n", mode: 0o755},
		{name: "whisper-bin-ubuntu-x64/libggml.so", body: "lib-bytes", mode: 0o644},
	})
	srv, _ := fakeReleaseServer(t, map[string][]byte{
		"whisper-bin-ubuntu-x64.tar.gz": archive,
		"ggml-small.en-q5_1.bin":        []byte("fake-model-bytes"),
	})
	ins := testInstaller(srv, "linux", "amd64", map[string]whisperAsset{
		"linux/amd64": {Name: "whisper-bin-ubuntu-x64.tar.gz", SHA256: sha256Hex(archive)},
	})

	st, err := ins.install(context.Background(), "")
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !st.Installed || st.Version != whisperVersion {
		t.Errorf("probe = %+v, want installed at %s", st, whisperVersion)
	}
	for _, name := range []string{"whisper-cli", "libggml.so"} {
		if _, err := os.Stat(filepath.Join(root, "bin", name)); err != nil {
			t.Errorf("%s missing beside the binary after promotion: %v", name, err)
		}
	}
}

// TestInstallDigestMismatch: a checksum mismatch fails closed — no promotion,
// no model download, previous state untouched.
func TestInstallDigestMismatch(t *testing.T) {
	root := stageStateRoot(t)
	archive := makeZip(t, []archiveSpec{{name: "whisper-cli", body: "bin", mode: 0o755}})
	var modelHits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".bin") {
			modelHits.Add(1)
		}
		w.Write(archive)
	}))
	defer srv.Close()
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: strings.Repeat("0", 64)},
	})

	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("err = %v, want the checksum-mismatch refusal", err)
	}
	if modelHits.Load() != 0 {
		t.Errorf("model downloaded (%d) after a failed archive verification", modelHits.Load())
	}
	if _, statErr := os.Stat(filepath.Join(root, "bin")); !os.IsNotExist(statErr) {
		t.Errorf("bin/ exists after a failed verification — nothing may be promoted")
	}
}

// TestInstallModelDigestMismatch: a pinned model digest is verified
// fail-closed on mismatch.
func TestInstallModelDigestMismatch(t *testing.T) {
	stageStateRoot(t)
	archive := makeZip(t, []archiveSpec{{name: "whisper-cli", body: "bin", mode: 0o755}})
	srv, _ := fakeReleaseServer(t, map[string][]byte{
		"whisper-bin-x64.zip":    archive,
		"ggml-small.en-q5_1.bin": []byte("fake-model-bytes"),
	})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: sha256Hex(archive)},
	})
	ins.modelDigests = map[string]string{"ggml-small.en-q5_1.bin": strings.Repeat("0", 64)}

	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "unverified model") {
		t.Fatalf("err = %v, want the model checksum-mismatch refusal", err)
	}
}

// TestInstallIdempotent: a second run over a current install downloads nothing
// and reports the same installed status.
func TestInstallIdempotent(t *testing.T) {
	stageStateRoot(t)
	archive := makeZip(t, []archiveSpec{{name: "whisper-cli", body: "bin", mode: 0o755}})
	srv, hits := fakeReleaseServer(t, map[string][]byte{
		"whisper-bin-x64.zip":    archive,
		"ggml-small.en-q5_1.bin": []byte("fake-model-bytes"),
	})
	assets := map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: sha256Hex(archive)},
	}

	st, err := testInstaller(srv, "windows", "amd64", assets).install(context.Background(), "")
	if err != nil || !st.Installed {
		t.Fatalf("first install: st=%+v err=%v", st, err)
	}
	firstHits := hits.Load()

	var notes []string
	ins := testInstaller(srv, "windows", "amd64", assets)
	ins.progress = func(msg string) { notes = append(notes, msg) }
	st, err = ins.install(context.Background(), "")
	if err != nil || !st.Installed {
		t.Fatalf("second install: st=%+v err=%v", st, err)
	}
	if hits.Load() != firstHits {
		t.Errorf("second install made %d new request(s), want 0 (already current)", hits.Load()-firstHits)
	}
	joined := strings.Join(notes, "\n")
	if !strings.Contains(joined, "already current") {
		t.Errorf("progress notes = %q, want the already-current skip", joined)
	}
}

// TestExtractContainment: hostile archive entries — ../ escapes, absolute
// paths, and symlinks resolving outside the destination (directly or through a
// previously created symlink) — fail closed with NO writes outside dest.
func TestExtractContainment(t *testing.T) {
	cases := map[string]struct {
		name    string // archive file name (selects the format)
		entries []archiveSpec
		outside string // path (relative to the parent of dest) that must never exist
	}{
		"tar dot-dot escape": {
			name:    "a.tar.gz",
			entries: []archiveSpec{{name: "../escape", body: "x"}},
			outside: "escape",
		},
		"tar absolute path": {
			name:    "a.tar.gz",
			entries: []archiveSpec{{name: "/abs/evil", body: "x"}},
			outside: "evil",
		},
		"tar absolute symlink": {
			name:    "a.tar.gz",
			entries: []archiveSpec{{name: "link", link: "/etc"}},
			outside: "link",
		},
		"tar relative symlink escape": {
			name:    "a.tar.gz",
			entries: []archiveSpec{{name: "sub/link", link: "../../escape"}, {name: "sub", dir: true}},
			outside: "escape",
		},
		"tar write through symlinked parent": {
			name: "a.tar.gz",
			entries: []archiveSpec{
				{name: "redirect", link: "../outside"},
				{name: "redirect/evil", body: "x"},
			},
			outside: filepath.Join("outside", "evil"),
		},
		"zip dot-dot escape": {
			name:    "a.zip",
			entries: []archiveSpec{{name: "../escape", body: "x"}},
			outside: "escape",
		},
		"zip symlink escape": {
			name:    "a.zip",
			entries: []archiveSpec{{name: "link", link: "../../../etc"}},
			outside: "link",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			base := t.TempDir()
			dest := filepath.Join(base, "dest")
			if err := os.MkdirAll(dest, 0o755); err != nil {
				t.Fatal(err)
			}
			// Pre-create the symlink target dir so resolution succeeds and the
			// containment check (not a dangling link) is what fires.
			if strings.Contains(name, "symlinked parent") {
				if err := os.MkdirAll(filepath.Join(base, "outside"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			var data []byte
			if strings.HasSuffix(tc.name, ".zip") {
				data = makeZip(t, tc.entries)
			} else {
				data = makeTarGz(t, tc.entries)
			}
			src := filepath.Join(base, tc.name)
			if err := os.WriteFile(src, data, 0o644); err != nil {
				t.Fatal(err)
			}
			if err := rkarchive.Extract(src, dest); err == nil {
				t.Fatalf("archive.Extract succeeded on a hostile archive; entries: %+v", tc.entries)
			} else if !strings.Contains(err.Error(), "escaping the install dir") {
				t.Fatalf("err = %v, want the containment refusal", err)
			}
			if _, err := os.Lstat(filepath.Join(base, tc.outside)); !os.IsNotExist(err) {
				t.Errorf("hostile entry wrote outside dest: %s exists", filepath.Join(base, tc.outside))
			}
		})
	}
}

// TestExtractContainedSymlinkAllowed: a symlink whose target stays inside dest
// is legitimate (release archives carry them) and must extract.
func TestExtractContainedSymlinkAllowed(t *testing.T) {
	base := t.TempDir()
	dest := filepath.Join(base, "dest")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	data := makeTarGz(t, []archiveSpec{
		{name: "bin", dir: true, mode: 0o755},
		{name: "bin/whisper-cli", body: "x", mode: 0o755},
		{name: "bin/whisper", link: "whisper-cli"},
	})
	src := filepath.Join(base, "a.tar.gz")
	if err := os.WriteFile(src, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := rkarchive.Extract(src, dest); err != nil {
		t.Fatalf("archive.Extract refused a contained symlink: %v", err)
	}
	target, err := os.Readlink(filepath.Join(dest, "bin", "whisper"))
	if err != nil || target != "whisper-cli" {
		t.Errorf("symlink = %q, %v — want whisper-cli", target, err)
	}
}

// TestInstallArchiveWithoutBinary: an archive carrying no whisper-cli fails
// before promotion.
func TestInstallArchiveWithoutBinary(t *testing.T) {
	root := stageStateRoot(t)
	archive := makeZip(t, []archiveSpec{{name: "README.txt", body: "hello"}})
	srv, _ := fakeReleaseServer(t, map[string][]byte{
		"whisper-bin-x64.zip":    archive,
		"ggml-small.en-q5_1.bin": []byte("fake-model-bytes"),
	})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: sha256Hex(archive)},
	})
	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "no whisper-cli binary") {
		t.Fatalf("err = %v, want the missing-binary refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "bin")); !os.IsNotExist(statErr) {
		t.Errorf("bin/ exists after a binary-less archive — nothing may be promoted")
	}
}

// TestInstallOversizeBody: a download exceeding the size bound fails closed.
func TestInstallOversizeBody(t *testing.T) {
	stageStateRoot(t)
	big := make([]byte, maxArchiveBytes+1)
	srv, _ := fakeReleaseServer(t, map[string][]byte{"whisper-bin-x64.zip": big})
	ins := testInstaller(srv, "windows", "amd64", map[string]whisperAsset{
		"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: sha256Hex(big)},
	})
	_, err := ins.install(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("err = %v, want the size-bound refusal", err)
	}
}
