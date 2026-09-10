package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

// waitCmdWith builds a bare command carrying the wait verb's flags.
func waitCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().String("window", "", "")
	cmd.Flags().Bool("stable", false, "")
	cmd.Flags().Duration("timeout", guiWaitDefaultTimeout, "")
	cmd.Flags().Duration("interval", guiWaitStableInterval, "")
	setFlags(cmd, flags)
	return cmd
}

func TestGuiWaitExactlyOneModeIsUsage(t *testing.T) {
	cases := []struct {
		name  string
		flags map[string]string
	}{
		{"neither", nil},
		{"both", map[string]string{"window": "x", "stable": "true"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withGuiCLISeams(t)
			seedGuiOn(t)

			err := runGuiWait(waitCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, tc.flags), nil)
			if err == nil || exitCode(err) != exitUsage {
				t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
			}
		})
	}
}

// shrinkGuiWaitPoll speeds up the window poll loop for tests.
func shrinkGuiWaitPoll(t *testing.T) {
	t.Helper()
	orig := guiWaitPoll
	guiWaitPoll = time.Millisecond
	t.Cleanup(func() { guiWaitPoll = orig })
}

func TestGuiWaitWindowPrintsFirstMatch(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name x": {
			{out: "", err: errors.New("exit status 1")}, // not yet
			{out: "42"},
		},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)
	shrinkGuiWaitPoll(t)

	var out bytes.Buffer
	err := runGuiWait(waitCmdWith(&out, &bytes.Buffer{}, map[string]string{"window": "x", "timeout": "5s"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := out.String(), "42\n"; got != want {
		t.Errorf("stdout = %q, want %q (the first matching id is the datum)", got, want)
	}
}

func TestGuiWaitWindowTimeout(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name x": {{out: "", err: errors.New("exit status 1")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)
	shrinkGuiWaitPoll(t)

	err := runGuiWait(waitCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"window": "x", "timeout": "50ms"}), nil)
	if err == nil || err.Error() != "timed out after 50ms" {
		t.Errorf("err = %v, want the timeout naming the configured duration", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// --- guiPixelHash ---

// testPNG returns the encoded bytes of a small image with deterministic
// pixels; flip changes one pixel.
func testPNG(t *testing.T, flip bool) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for i := range img.Pix {
		img.Pix[i] = byte(i*7 + 1)
	}
	if flip {
		img.Pix[0]++
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// injectPNGTextChunk inserts a tEXt chunk before IEND (ImageMagick stamps
// date:create/date:modify this way — two captures of an identical screen
// differ in file bytes, so the stability hash must see pixels only).
func injectPNGTextChunk(t *testing.T, data []byte, keyword, text string) []byte {
	t.Helper()
	if len(data) < 8 {
		t.Fatal("not a PNG")
	}
	off := 8
	for {
		length := int(binary.BigEndian.Uint32(data[off : off+4]))
		ctype := string(data[off+4 : off+8])
		if ctype == "IEND" {
			break
		}
		off += 12 + length
		if off >= len(data) {
			t.Fatal("no IEND chunk")
		}
	}
	payload := append([]byte(keyword), append([]byte{0}, []byte(text)...)...)
	chunk := make([]byte, 0, 12+len(payload))
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(payload)))
	chunk = append(chunk, lenBuf[:]...)
	chunk = append(chunk, "tEXt"...)
	chunk = append(chunk, payload...)
	var crcBuf [4]byte
	binary.BigEndian.PutUint32(crcBuf[:], crc32.ChecksumIEEE(append([]byte("tEXt"), payload...)))
	chunk = append(chunk, crcBuf[:]...)
	out := make([]byte, 0, len(data)+len(chunk))
	out = append(out, data[:off]...)
	out = append(out, chunk...)
	out = append(out, data[off:]...)
	return out
}

func TestGuiPixelHashIgnoresTextChunks(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.png")
	stamped := filepath.Join(dir, "stamped.png")
	if err := os.WriteFile(plain, testPNG(t, false), 0o600); err != nil {
		t.Fatal(err)
	}
	stampedBytes := injectPNGTextChunk(t, testPNG(t, false), "date:create", "2026-09-10T10:00:00+00:00")
	if err := os.WriteFile(stamped, stampedBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(mustRead(t, plain), mustRead(t, stamped)) {
		t.Fatal("fixture bug: the two PNGs have identical file bytes")
	}
	hPlain, err := guiPixelHash(plain)
	if err != nil {
		t.Fatal(err)
	}
	hStamped, err := guiPixelHash(stamped)
	if err != nil {
		t.Fatal(err)
	}
	if hPlain != hStamped {
		t.Error("hashes differ for PNGs with identical pixels — the hash must ignore text chunks")
	}
}

func TestGuiPixelHashSeesPixelChanges(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.png")
	b := filepath.Join(dir, "b.png")
	if err := os.WriteFile(a, testPNG(t, false), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(b, testPNG(t, true), 0o600); err != nil {
		t.Fatal(err)
	}
	ha, err := guiPixelHash(a)
	if err != nil {
		t.Fatal(err)
	}
	hb, err := guiPixelHash(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha == hb {
		t.Error("hashes equal for PNGs differing by one pixel")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// --- wait --stable ---

// TestGuiWaitStableConvergesOnIdenticalCaptures stubs the capture runner to
// write the same fixture PNG to each requested out path; two identical pixel
// hashes converge the wait.
func TestGuiWaitStableConvergesOnIdenticalCaptures(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	fixture := testPNG(t, false)
	guiShotRunFn = func(_ context.Context, stages []guiShotStage) error {
		*ranStages = append(*ranStages, stages)
		argv := stages[len(stages)-1].argv
		return os.WriteFile(argv[len(argv)-1], fixture, 0o600)
	}

	err := runGuiWait(waitCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{
		"stable":   "true",
		"interval": "1ms",
		"timeout":  "5s",
	}), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(*ranStages) != 2 {
		t.Errorf("captures = %d, want exactly 2 (converge on the second)", len(*ranStages))
	}
	// The capture ran through the shot ladder at the stability scale.
	joined := ""
	for _, stage := range (*ranStages)[0] {
		for _, arg := range stage.argv {
			joined += arg + " "
		}
	}
	if got := joined; !containsAll(got, "import", "-resize", "25%") {
		t.Errorf("capture argv = %q, want the shot ladder at scale 0.25", got)
	}
	leftovers, _ := filepath.Glob(filepath.Join(os.TempDir(), "rk-gui-wait-"+strconv.Itoa(os.Getpid())+"-*.png"))
	if len(leftovers) != 0 {
		t.Errorf("temp captures left behind: %v", leftovers)
	}
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !bytes.Contains([]byte(s), []byte(sub)) {
			return false
		}
	}
	return true
}
