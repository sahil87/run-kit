package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui wait — the two waits an agent loop needs that X11 has no verb for:
// a window appearing, and the screen going quiet. Neither is an input verb;
// the human-input guard never applies.

var (
	// guiWaitDefaultTimeout / guiWaitPoll / guiWaitStableInterval are the
	// wait budgets. Vars, not consts, so tests shrink them (the
	// guiStampWaitTimeout idiom).
	guiWaitDefaultTimeout = 10 * time.Second
	guiWaitPoll           = 250 * time.Millisecond
	guiWaitStableInterval = 500 * time.Millisecond
	guiWaitStableScale    = 0.25 // small captures — the hash sees pixels, not detail
)

var guiWaitCmd = &cobra.Command{
	Use:   "wait (--window <substr> | --stable)",
	Short: "Wait for a window to appear or the screen to go quiet",
	Long: `Wait for one of two conditions:

  --window <substr>   a visible window whose title contains the substring
                      (case-sensitive) appears; prints its X id on stdout —
                      the datum a loop reuses instead of re-matching a
                      drifting title
  --stable            two consecutive captures of the display (at scale 0.25)
                      are pixel-identical

--timeout bounds the wait (default 10s; expiry is 'timed out after <d>',
exit 1); --interval sets the capture cadence for --stable (default 500ms).
Exactly one of the two flags is required.

Refuses (exit 1) when the GUI is off or enabled but not running.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiWait,
}

func init() {
	guiWaitCmd.Flags().String("window", "", "Wait for a visible window with this title substring")
	guiWaitCmd.Flags().Bool("stable", false, "Wait for two pixel-identical captures")
	guiWaitCmd.Flags().Duration("timeout", guiWaitDefaultTimeout, "Give up after this long (exit 1)")
	guiWaitCmd.Flags().Duration("interval", guiWaitStableInterval, "Capture cadence for --stable")
}

func runGuiWait(cmd *cobra.Command, _ []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("wait")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Minute)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	substr, _ := cmd.Flags().GetString("window")
	stable, _ := cmd.Flags().GetBool("stable")
	if (substr != "") == stable {
		return usageError(errors.New("wait needs exactly one of --window or --stable"))
	}
	timeout, _ := cmd.Flags().GetDuration("timeout")
	interval, _ := cmd.Flags().GetDuration("interval")

	sink := newSink(cmd)
	if substr != "" {
		if err := guiRequireXTool("xdotool", guiXdoMissingHint); err != nil {
			return err
		}
		return guiWaitWindow(ctx, sink, st.Display, substr, timeout)
	}
	return guiWaitStable(ctx, st, interval, timeout)
}

// guiWaitWindow polls the visible-window search until a title matches;
// xdotool exits 1 on no match, which the poll treats as "not yet".
func guiWaitWindow(ctx context.Context, sink outputSink, display, substr string, timeout time.Duration) error {
	deadline := guiNowFn().Add(timeout)
	// --name's argument is a regex; QuoteMeta keeps the substring literal.
	quoted := regexp.QuoteMeta(substr)
	for {
		ids, err := guiXdoSearchIDs(ctx, display, quoted)
		if err == nil && len(ids) > 0 {
			sink.Dataf("%d\n", ids[0])
			return nil
		}
		if !guiNowFn().Before(deadline) {
			return fmt.Errorf("timed out after %s", timeout)
		}
		time.Sleep(guiWaitPoll)
	}
}

// guiWaitStable captures the root at guiWaitStableScale every interval and
// exits when two consecutive captures hash equal. The hash covers DECODED
// PIXELS, never the PNG file bytes — ImageMagick stamps date:create /
// date:modify text chunks that differ between two captures of an identical
// screen, so a file-byte hash would never converge. Temp captures are removed.
func guiWaitStable(ctx context.Context, st gui.Status, interval, timeout time.Duration) error {
	dir := os.TempDir()
	deadline := guiNowFn().Add(timeout)
	var prev [32]byte
	n := 0
	for {
		out := filepath.Join(dir, fmt.Sprintf("rk-gui-wait-%d-%d.png", os.Getpid(), n))
		_, _, _, err := guiShotCapture(ctx, st, out, guiShotOpts{scale: guiWaitStableScale, scaleSet: true})
		if err != nil {
			return err
		}
		hash, herr := guiPixelHash(out)
		_ = os.Remove(out)
		if herr != nil {
			return fmt.Errorf("error: reading the capture: %w", herr)
		}
		n++
		if n > 1 && hash == prev {
			return nil
		}
		prev = hash
		if !guiNowFn().Before(deadline) {
			return fmt.Errorf("timed out after %s", timeout)
		}
		time.Sleep(interval)
	}
}

// guiPixelHash decodes a PNG and SHA-256s its pixels (normalized to RGBA, row
// by row). Two files differing only in text chunks hash equal.
func guiPixelHash(path string) ([32]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return [32]byte{}, err
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		return [32]byte{}, err
	}
	rgba, ok := img.(*image.RGBA)
	if !ok {
		b := img.Bounds()
		rgba = image.NewRGBA(b)
		draw.Draw(rgba, b, img, b.Min, draw.Src)
	}
	h := sha256.New()
	h.Write(rgba.Pix)
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum, nil
}
