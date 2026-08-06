// Package fsatomic provides crash-safe file writes for run-kit's JSON/YAML
// file stores (push, remote, snapshot). Constitution §II keeps state in plain
// files rather than a database, which makes torn writes a real corruption
// vector — WriteFile guarantees readers see either the old contents or the
// complete new contents, never a partially-written file.
package fsatomic

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
)

// maxTmpAttempts bounds the temp-name collision retry loop; collisions only
// occur against litter from a crashed earlier run with the same pid.
const maxTmpAttempts = 100

// WriteFile writes data to path via a temp file in the same directory
// followed by an atomic rename, so a crash mid-write can never leave a
// partially-written/corrupt file at path. perm applies at file creation and
// is reduced by the process umask, exactly like os.WriteFile — an explicit
// chmod would silently widen permissions on hardened-umask hosts. On any
// failure the temp file is removed. The parent directory must already exist.
func WriteFile(path string, data []byte, perm os.FileMode) error {
	var tmp *os.File
	var tmpName string
	for attempt := 0; ; attempt++ {
		tmpName = fmt.Sprintf("%s.tmp-%d-%d", path, os.Getpid(), attempt)
		f, err := os.OpenFile(tmpName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
		if err == nil {
			tmp = f
			break
		}
		if !errors.Is(err, fs.ErrExist) || attempt >= maxTmpAttempts {
			return err
		}
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}
