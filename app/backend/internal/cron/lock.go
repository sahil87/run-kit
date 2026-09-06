package cron

import (
	"errors"
	"os"
	"syscall"
)

// lock.go — tick serialization (R14): a non-blocking flock on cron/.lock.
// Ticks are idempotent by contract, so skip-on-contention is correct: a held
// lock means another invoker is mid-tick and this tick exits cleanly and
// quietly (no fires, no writes, no error).

// ErrTickHeld is the sentinel returned when another invoker holds the tick
// lock. Callers treat it as a clean, quiet no-op.
var ErrTickHeld = errors.New("cron: tick lock held by another invoker")

// acquireLock takes the non-blocking exclusive flock on path. The returned
// release func unlocks and closes. The parent dir must exist.
func acquireLock(path string) (release func(), err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, fileMode)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrTickHeld
		}
		return nil, err
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
