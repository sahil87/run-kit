// Package archive is the shared extraction core for rk-managed installers:
// unpacking downloaded release archives (tar.gz / zip) with two-layer
// destination containment. Layer one is lexical: raw entry names and symlink
// targets with absolute paths or ".." components are refused (cleaning before
// checking would collapse a malicious ".." into an innocent-looking relative
// path). Layer two exists because lexical checks cannot see a symlink a
// PREVIOUS entry created: every write resolves its parent directory
// component-by-component (SafeMkdirParents), refusing any component whose
// resolution leaves the destination. Archives here are digest-verified
// upstream, but dest-escape is cheap to guarantee.
package archive

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Entry is one extracted node: a directory, a regular file (Body non-nil), or
// a symlink (LinkTarget non-empty). Name is the raw archive name.
type Entry struct {
	Name       string
	Mode       os.FileMode
	Dir        bool
	LinkTarget string
	Body       io.Reader
}

// Extract unpacks the archive at src into dest by format suffix (.zip,
// .tar.gz/.tgz), anchoring all containment checks at dest's REAL path so a
// dest behind a symlink (macOS /tmp) never false-positives.
func Extract(src, dest string) error {
	realDest, err := filepath.EvalSymlinks(dest)
	if err != nil {
		return err
	}
	switch {
	case strings.HasSuffix(src, ".zip"):
		return extractZip(src, realDest)
	default:
		return ExtractTarGz(src, realDest)
	}
}

// ExtractTarGz unpacks a .tar.gz stream entry by entry with full containment.
// The destination must already be symlink-resolved (Extract does this; direct
// callers must too).
func ExtractTarGz(src, realDest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		entry := Entry{Name: hdr.Name, Mode: hdr.FileInfo().Mode()}
		switch hdr.Typeflag {
		case tar.TypeDir:
			entry.Dir = true
		case tar.TypeReg:
			entry.Body = tr
		case tar.TypeSymlink:
			entry.LinkTarget = hdr.Linkname
		default:
			// Hardlinks, devices, fifos: not expected in a release archive —
			// skip rather than invent a filesystem node.
			continue
		}
		if err := WriteEntry(realDest, entry); err != nil {
			return err
		}
	}
}

// extractZip unpacks a .zip archive entry by entry. Symlink entries (unix mode
// bits) carry their target as the entry body.
func extractZip(src, realDest string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()

	for _, f := range zr.File {
		entry := Entry{Name: f.Name, Mode: f.Mode()}
		switch {
		case f.FileInfo().IsDir():
			entry.Dir = true
		case f.Mode()&os.ModeSymlink != 0:
			body, err := readZipEntry(f)
			if err != nil {
				return err
			}
			entry.LinkTarget = string(body)
		default:
			body, err := f.Open()
			if err != nil {
				return err
			}
			entry.Body = body
			err = WriteEntry(realDest, entry)
			_ = body.Close()
			if err != nil {
				return err
			}
			continue
		}
		if err := WriteEntry(realDest, entry); err != nil {
			return err
		}
	}
	return nil
}

func readZipEntry(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, 1<<20))
}

// WriteEntry materializes one entry under realDest (already symlink-resolved)
// with the two-layer containment described on the package.
func WriteEntry(realDest string, e Entry) error {
	name := filepath.ToSlash(e.Name)
	for _, comp := range strings.Split(name, "/") {
		if comp == ".." {
			return fmt.Errorf("refusing archive entry escaping the install dir: %q", e.Name)
		}
	}
	rel := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(name)), "./")
	if rel == "" || rel == "." {
		return nil // the archive root itself
	}
	if filepath.IsAbs(rel) {
		return fmt.Errorf("refusing archive entry escaping the install dir: %q", e.Name)
	}

	// Create/resolve the parent chain without ever following a symlink out of
	// dest, then join the final component onto the RESOLVED parent so the
	// write lands where the check looked.
	comps := strings.Split(rel, "/")
	parentDir, err := SafeMkdirParents(realDest, comps[:len(comps)-1], e.Name)
	if err != nil {
		return err
	}
	target := filepath.Join(parentDir, comps[len(comps)-1])

	switch {
	case e.Dir:
		if fi, err := os.Lstat(target); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			// A directory entry over an existing symlink is traversal bait for
			// later entries beneath it — refuse.
			return fmt.Errorf("refusing archive entry escaping the install dir: %q", e.Name)
		}
		return os.MkdirAll(target, e.Mode.Perm())
	case e.LinkTarget != "":
		// Relative symlink targets with ".." components are legitimate, so a
		// prefix ban is wrong — the check is CONTAINMENT: resolve the target
		// against the link's own (already-resolved) parent dir and require it
		// to stay under dest.
		link := e.LinkTarget
		if filepath.IsAbs(link) || !Within(realDest, filepath.Clean(filepath.Join(parentDir, link))) {
			return fmt.Errorf("refusing symlink escaping the install dir: %q -> %q", e.Name, link)
		}
		if err := os.Symlink(link, target); err != nil {
			return err
		}
		// A lexically tame target can still RESOLVE outside dest through
		// earlier symlinks (e.g. self->. then up->self/..). Verify the created
		// link when it resolves; a dangling link (target not yet extracted) is
		// fine — any later write through it re-verifies.
		if resolved, err := filepath.EvalSymlinks(target); err == nil && !Within(realDest, resolved) {
			return fmt.Errorf("refusing symlink escaping the install dir: %q -> %q", e.Name, link)
		}
		return nil
	default:
		// OpenFile follows a final-component symlink; replace any such link so
		// the write cannot be redirected.
		if fi, err := os.Lstat(target); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			if err := os.Remove(target); err != nil {
				return err
			}
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, e.Mode.Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, e.Body)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	}
}

// SafeMkdirParents creates the directory chain comps under realDest one
// component at a time, resolving as it goes, so no component — pre-existing
// or created by an earlier archive entry — can be a symlink that redirects the
// chain outside realDest. It returns the RESOLVED parent directory the entry
// must be written into. rawName is the archive entry name, used only for
// errors.
func SafeMkdirParents(realDest string, comps []string, rawName string) (string, error) {
	cur := realDest
	for _, comp := range comps {
		if comp == "" || comp == "." {
			continue
		}
		next := filepath.Join(cur, comp)
		fi, err := os.Lstat(next)
		switch {
		case err == nil && fi.Mode()&os.ModeSymlink != 0:
			resolved, err := filepath.EvalSymlinks(next)
			if err != nil {
				return "", err
			}
			if !Within(realDest, resolved) {
				return "", fmt.Errorf("refusing archive entry escaping the install dir: %q", rawName)
			}
			cur = resolved
		case err == nil && fi.IsDir():
			cur = next
		case err == nil:
			return "", fmt.Errorf("archive entry %q: parent %q exists and is not a directory", rawName, next)
		case os.IsNotExist(err):
			if err := os.Mkdir(next, 0o755); err != nil {
				return "", err
			}
			cur = next
		default:
			return "", err
		}
	}
	return cur, nil
}

// Within reports whether path is realDest itself or beneath it. Both
// arguments must already be symlink-resolved.
func Within(realDest, path string) bool {
	return path == realDest || strings.HasPrefix(path, realDest+string(os.PathSeparator))
}

// FlattenSingleRootDir collapses the release-archive wrapper: when dir holds
// exactly one entry and that entry is a directory (whisper-bin-ubuntu-x64/,
// Release/, code-server-<ver>-<os>-<arch>/), its children move up one level.
// Exactly ONE level — deeper single-dir chains (a lone node_modules/ inside
// the wrapper) are payload, not wrapping. Sibling files stay together, so a
// binary keeps its shared libraries ($ORIGIN). The move changes what relative
// symlink targets resolve to (every link effectively climbs one more level),
// so all symlinks are re-verified for containment afterwards — a wrapper-root
// link to ".." that was contained inside the wrapper escapes after the move
// and fails the flatten.
func FlattenSingleRootDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	if len(entries) != 1 || !entries[0].IsDir() {
		return nil
	}
	inner := filepath.Join(dir, entries[0].Name())
	children, err := os.ReadDir(inner)
	if err != nil {
		return err
	}
	for _, c := range children {
		if err := os.Rename(filepath.Join(inner, c.Name()), filepath.Join(dir, c.Name())); err != nil {
			return err
		}
	}
	if err := os.Remove(inner); err != nil {
		return err
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return err
	}
	return verifySymlinks(realDir, dir)
}

// verifySymlinks re-checks every symlink under dir against containment —
// lexically against its parent and, when resolvable, fully resolved.
func verifySymlinks(realDir, dir string) error {
	return filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink == 0 {
			return nil
		}
		link, err := os.Readlink(p)
		if err != nil {
			return err
		}
		if filepath.IsAbs(link) || !Within(realDir, filepath.Clean(filepath.Join(filepath.Dir(p), link))) {
			return fmt.Errorf("refusing symlink escaping the install dir: %q -> %q", p, link)
		}
		if resolved, err := filepath.EvalSymlinks(p); err == nil && !Within(realDir, resolved) {
			return fmt.Errorf("refusing symlink escaping the install dir: %q -> %q", p, link)
		}
		return nil
	})
}
