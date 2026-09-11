package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// withGuiShotSeams points the shot verb's seams at capturing stubs and
// restores them on cleanup. lookPath stub resolves every tool by default;
// tests override it per ladder case. ranStages holds the pipelines the runner
// was asked to execute.
func withGuiShotSeams(t *testing.T) (ranStages *[][]guiShotStage) {
	t.Helper()
	ranStages = new([][]guiShotStage)

	origLookPath, origRun, origNow := guiShotLookPathFn, guiShotRunFn, guiShotNowFn
	origGOOS := guiGOOS
	origXdo := guiXdoRunFn
	t.Cleanup(func() {
		guiShotLookPathFn, guiShotRunFn, guiShotNowFn = origLookPath, origRun, origNow
		guiGOOS = origGOOS
		guiXdoRunFn = origXdo
	})

	guiShotLookPathFn = func(name string) (string, error) { return "/usr/bin/" + name, nil }
	guiShotRunFn = func(_ context.Context, stages []guiShotStage) error {
		*ranStages = append(*ranStages, stages)
		return nil
	}
	guiShotNowFn = func() time.Time { return time.Date(2026, 9, 9, 14, 5, 6, 0, time.Local) }
	guiGOOS = "linux"
	// --window resolves geometry through xdotool; the default answers empty so
	// a shot test can never exec the real tool. Tests script responses with
	// withGuiXdoSeams.
	guiXdoRunFn = func(context.Context, string, []string, string) (string, error) { return "", nil }
	return ranStages
}

// shotCmdWith builds a bare command carrying the shot verb's --out flag.
func shotCmdWith(out, errOut *bytes.Buffer, outPath string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().StringP("out", "o", "", "")
	if outPath != "" {
		_ = cmd.Flags().Set("out", outPath)
	}
	return cmd
}

// lookPathOnly returns a LookPath stub resolving exactly the named tools.
func lookPathOnly(tools ...string) func(string) (string, error) {
	return func(name string) (string, error) {
		for _, tool := range tools {
			if name == tool {
				return "/usr/bin/" + name, nil
			}
		}
		return "", errors.New("not found")
	}
}

func TestGuiShotOffRefuses(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)

	err := runGuiShot(shotCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, ""), nil)
	if err == nil || err.Error() != guiErrOff {
		t.Errorf("err = %v, want the off refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*ranStages) != 0 {
		t.Errorf("runner called %d times while off — no file may be written", len(*ranStages))
	}
}

func TestGuiShotNotRunningRefuses(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}

	err := runGuiShot(shotCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, ""), nil)
	if err == nil || err.Error() != guiErrNotRunning {
		t.Errorf("err = %v, want the not-running refusal", err)
	}
	if len(*ranStages) != 0 {
		t.Errorf("runner called %d times while not running", len(*ranStages))
	}
}

func TestGuiShotDarwinRefuses(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	guiGOOS = "darwin"
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted on darwin — the OS refusal must fire first")
		return false
	}

	err := runGuiShot(shotCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, ""), nil)
	if err == nil || err.Error() != "gui shot is not supported on macOS in v1 — the GUI mirrors your live session view-only" {
		t.Errorf("err = %v, want the macOS refusal", err)
	}
	if len(*ranStages) != 0 {
		t.Errorf("runner called %d times on darwin", len(*ranStages))
	}
}

func TestGuiShotArgvLadder(t *testing.T) {
	cases := []struct {
		name     string
		tools    []string
		wantArgv [][]string
		wantEnv  []string // stage 0's extra env
		wantTool string
		wantOK   bool
	}{
		{
			name:     "import wins",
			tools:    []string{"import", "scrot", "xwd", "convert"},
			wantArgv: [][]string{{"import", "-display", ":10", "-window", "root", "/tmp/a.png"}},
			wantTool: "import",
			wantOK:   true,
		},
		{
			name:     "scrot carries DISPLAY in env",
			tools:    []string{"scrot", "xwd", "convert"},
			wantArgv: [][]string{{"scrot", "/tmp/a.png"}},
			wantEnv:  []string{"DISPLAY=:10"},
			wantTool: "scrot",
			wantOK:   true,
		},
		{
			name:  "xwd pipes into convert",
			tools: []string{"xwd", "convert"},
			wantArgv: [][]string{
				{"xwd", "-display", ":10", "-root", "-silent"},
				{"convert", "xwd:-", "/tmp/a.png"},
			},
			wantTool: "xwd+convert",
			wantOK:   true,
		},
		{
			name:   "xwd without convert falls through",
			tools:  []string{"xwd"},
			wantOK: false,
		},
		{
			name:   "no tools",
			tools:  nil,
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stages, tool, err := guiShotArgv(lookPathOnly(tc.tools...), ":10", "/tmp/a.png", guiShotOpts{})
			if err != nil {
				t.Fatalf("ladder err = %v, want nil with no capture modifiers", err)
			}
			ok := tool != ""
			if ok != tc.wantOK || tool != tc.wantTool {
				t.Fatalf("ladder = (ok=%v, tool=%q), want (ok=%v, tool=%q)", ok, tool, tc.wantOK, tc.wantTool)
			}
			if !ok {
				return
			}
			if len(stages) != len(tc.wantArgv) {
				t.Fatalf("stages = %v, want %v", stages, tc.wantArgv)
			}
			for i, want := range tc.wantArgv {
				if strings.Join(stages[i].argv, " ") != strings.Join(want, " ") {
					t.Errorf("stage %d argv = %v, want %v", i, stages[i].argv, want)
				}
			}
			if strings.Join(stages[0].env, " ") != strings.Join(tc.wantEnv, " ") {
				t.Errorf("stage 0 env = %v, want %v", stages[0].env, tc.wantEnv)
			}
		})
	}
}

func TestGuiShotNoToolError(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiShotLookPathFn = lookPathOnly()

	err := runGuiShot(shotCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, ""), nil)
	if err == nil || err.Error() != guiShotNoToolError {
		t.Errorf("err = %v, want the no-tool error", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*ranStages) != 0 {
		t.Errorf("runner called %d times with no tool", len(*ranStages))
	}
}

func TestGuiShotRunnerFailure(t *testing.T) {
	_ = withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiShotLookPathFn = lookPathOnly("import")
	guiShotRunFn = func(context.Context, []guiShotStage) error { return errors.New("unable to open X display") }

	err := runGuiShot(shotCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, ""), nil)
	if err == nil || err.Error() != "error: import failed: unable to open X display" {
		t.Errorf("err = %v, want error: <tool> failed: <stderr tail>", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiShotDefaultPathShape(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiShot(shotCmdWith(&out, &bytes.Buffer{}, ""), nil); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(os.TempDir(), "rk-gui-shot-20260909-140506.png") + "\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	got := (*ranStages)[0]
	last := got[len(got)-1].argv
	if last[len(last)-1] != strings.TrimSuffix(want, "\n") {
		t.Errorf("runner out path = %q, want the printed path", last[len(last)-1])
	}
}

func TestGuiShotOutCreatesParent(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	dir := filepath.Join(t.TempDir(), "x", "y")
	outPath := filepath.Join(dir, "shot.png")
	var out bytes.Buffer
	if err := runGuiShot(shotCmdWith(&out, &bytes.Buffer{}, outPath), nil); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Errorf("--out parent %s not created: %v", dir, err)
	}
	if got, want := out.String(), outPath+"\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	stages := (*ranStages)[0]
	if got := stages[len(stages)-1].argv; got[len(got)-1] != outPath {
		t.Errorf("runner out path = %v, want %q", got, outPath)
	}
}

// TestGuiShotOutMadeAbsolute pins the relative-path contract: --out is echoed
// absolute, so an agent can hand the path to a reader regardless of its cwd.
func TestGuiShotOutMadeAbsolute(t *testing.T) {
	_ = withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	dir := t.TempDir()
	rel, err := filepath.Rel(mustGetwd(t), filepath.Join(dir, "shot.png"))
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := runGuiShot(shotCmdWith(&out, &bytes.Buffer{}, rel), nil); err != nil {
		t.Fatal(err)
	}
	if got, want := out.String(), filepath.Join(dir, "shot.png")+"\n"; got != want {
		t.Errorf("stdout = %q, want the absolute %q", got, want)
	}
}

func mustGetwd(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return wd
}

func TestGuiShotRegisteredOnGuiTree(t *testing.T) {
	var shotCmd *cobra.Command
	for _, c := range guiCmd.Commands() {
		if c.Name() == "shot" {
			shotCmd = c
		}
	}
	if shotCmd == nil {
		t.Fatal("shot is not registered on the gui family")
	}
	if shotCmd.Long == "" {
		t.Error("shot has no Long block")
	}
	if err := shotCmd.Args(shotCmd, []string{"stray"}); exitCode(err) != exitUsage {
		t.Errorf("positional arg exit code = %d, want %d (usage)", exitCode(err), exitUsage)
	}
}

// TestGuiShotRunStagesPipeline exercises the real two-stage runner with
// stand-in tools: `printf` into `cat`, proving the Go-side stdout→stdin
// wiring and the non-zero-exit stderr contract without an X server.
func TestGuiShotRunStagesPipeline(t *testing.T) {
	out := filepath.Join(t.TempDir(), "pipe.png")
	stages := []guiShotStage{
		{argv: []string{"printf", "png-bytes"}},
		{argv: []string{"sh", "-c", "cat > \"$1\"", "sh", out}},
	}
	if err := guiShotRunStages(context.Background(), stages); err != nil {
		t.Fatalf("pipeline run: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "png-bytes" {
		t.Errorf("piped content = %q, want %q", data, "png-bytes")
	}

	fail := []guiShotStage{{argv: []string{"sh", "-c", "echo bad display >&2; exit 3"}}}
	err = guiShotRunStages(context.Background(), fail)
	if err == nil || err.Error() != "bad display" {
		t.Errorf("failing stage err = %v, want the stderr tail", err)
	}
}

// A producer that exits non-zero WITHOUT writing stderr must still fail the
// run — otherwise the consumer's success stands for a capture that never
// happened and a path to an empty file prints.
func TestGuiShotRunStagesSilentProducerFailureFails(t *testing.T) {
	out := filepath.Join(t.TempDir(), "silent.png")
	stages := []guiShotStage{
		{argv: []string{"false"}},
		{argv: []string{"sh", "-c", "cat > \"$1\"", "sh", out}},
	}
	if err := guiShotRunStages(context.Background(), stages); err == nil {
		t.Fatal("silent producer failure returned nil, want an error")
	}
}

// os.TempDir returns $TMPDIR verbatim, so a relative TMPDIR must still yield
// the absolute path stdout promises.
func TestGuiShotDefaultPathIsAbsoluteUnderRelativeTMPDIR(t *testing.T) {
	_ = withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	t.Setenv("TMPDIR", "rel-tmp")

	var out bytes.Buffer
	if err := runGuiShot(shotCmdWith(&out, &bytes.Buffer{}, ""), nil); err != nil {
		t.Fatal(err)
	}
	got := strings.TrimSuffix(out.String(), "\n")
	if !filepath.IsAbs(got) {
		t.Errorf("default path = %q, want absolute", got)
	}
	if !strings.HasSuffix(got, filepath.Join("rel-tmp", "rk-gui-shot-20260909-140506.png")) {
		t.Errorf("default path = %q, want the TMPDIR-relative name resolved against the cwd", got)
	}
}

// --- --scale / --max-width / --window (R5) ---

// shotFlagsCmdWith builds a bare command carrying the shot verb's capture
// modifier flags (out is registered by shotCmdWith).
func shotFlagsCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := shotCmdWith(out, errOut, "")
	cmd.Flags().Float64("scale", 0, "")
	cmd.Flags().Int("max-width", 0, "")
	cmd.Flags().Uint64("window", 0, "")
	setFlags(cmd, flags)
	return cmd
}

func TestGuiShotArgvScaleWindowRungs(t *testing.T) {
	cases := []struct {
		name     string
		tools    []string
		opts     guiShotOpts
		wantArgv [][]string
		wantEnv  []string // stage 0's extra env
		wantTool string
		wantErr  string
	}{
		{
			name:     "import resizes inline",
			tools:    []string{"import"},
			opts:     guiShotOpts{scale: 0.5},
			wantArgv: [][]string{{"import", "-display", ":10", "-window", "root", "-resize", "50%", "/tmp/a.png"}},
			wantTool: "import",
		},
		{
			name:  "scrot resizes via a convert post-stage",
			tools: []string{"scrot", "convert"},
			opts:  guiShotOpts{scale: 0.5},
			wantArgv: [][]string{
				{"scrot", "/tmp/a.png"},
				{"convert", "/tmp/a.png", "-resize", "50%", "/tmp/a.png"},
			},
			wantEnv:  []string{"DISPLAY=:10"},
			wantTool: "scrot",
		},
		{
			name:    "scrot scale without convert refuses",
			tools:   []string{"scrot"},
			opts:    guiShotOpts{scale: 0.5},
			wantErr: "--scale needs imagemagick — sudo apt install imagemagick",
		},
		{
			name:    "scrot has no by-id capture",
			tools:   []string{"scrot", "convert"},
			opts:    guiShotOpts{window: 42, windowSet: true},
			wantErr: "--window needs imagemagick (import or convert) — sudo apt install imagemagick",
		},
		{
			name:  "xwd maps --window to -id and resizes in convert",
			tools: []string{"xwd", "convert"},
			opts:  guiShotOpts{scale: 0.5, window: 42, windowSet: true},
			wantArgv: [][]string{
				{"xwd", "-display", ":10", "-id", "42", "-silent"},
				{"convert", "xwd:-", "-resize", "50%", "/tmp/a.png"},
			},
			wantTool: "xwd+convert",
		},
		{
			name:     "import takes --window inline",
			tools:    []string{"import"},
			opts:     guiShotOpts{window: 42, windowSet: true},
			wantArgv: [][]string{{"import", "-display", ":10", "-window", "42", "/tmp/a.png"}},
			wantTool: "import",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stages, tool, err := guiShotArgv(lookPathOnly(tc.tools...), ":10", "/tmp/a.png", tc.opts)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ladder err = %v, want nil", err)
			}
			if tool != tc.wantTool {
				t.Fatalf("tool = %q, want %q", tool, tc.wantTool)
			}
			if len(stages) != len(tc.wantArgv) {
				t.Fatalf("stages = %v, want %v", stages, tc.wantArgv)
			}
			for i, want := range tc.wantArgv {
				if strings.Join(stages[i].argv, " ") != strings.Join(want, " ") {
					t.Errorf("stage %d argv = %v, want %v", i, stages[i].argv, want)
				}
			}
			if strings.Join(stages[0].env, " ") != strings.Join(tc.wantEnv, " ") {
				t.Errorf("stage 0 env = %v, want %v", stages[0].env, tc.wantEnv)
			}
		})
	}
}

func TestGuiShotScalePrintsGeometryLine(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotFlagsCmdWith(&out, &errOut, map[string]string{"scale": "0.5"}), nil); err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(os.TempDir(), "rk-gui-shot-20260909-140506.png") + "\n"
	if got := out.String(); got != wantPath {
		t.Errorf("stdout = %q, want the bare path %q", got, wantPath)
	}
	if got, want := errOut.String(), "geometry 1920x1080 scale 0.5\n"; got != want {
		t.Errorf("stderr = %q, want %q", got, want)
	}
	argv := (*ranStages)[0][0].argv
	if got, want := strings.Join(argv, " "), "import -display :10 -window root -resize 50% "+strings.TrimSuffix(wantPath, "\n"); got != want {
		t.Errorf("capture argv = %q, want %q", got, want)
	}
}

// The no-flag contract: stdout stays the bare default path (byte-identical to
// before the capture modifiers) and stderr reports scale 1.
func TestGuiShotDefaultPrintsScaleOne(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotFlagsCmdWith(&out, &errOut, nil), nil); err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(os.TempDir(), "rk-gui-shot-20260909-140506.png") + "\n"
	if got := out.String(); got != wantPath {
		t.Errorf("stdout = %q, want the unchanged default %q", got, wantPath)
	}
	if got, want := errOut.String(), "geometry 1920x1080 scale 1\n"; got != want {
		t.Errorf("stderr = %q, want %q", got, want)
	}
	argv := (*ranStages)[0][0].argv
	if got, want := strings.Join(argv, " "), "import -display :10 -window root "+strings.TrimSuffix(wantPath, "\n"); got != want {
		t.Errorf("capture argv = %q, want %q (no -resize without a scale)", got, want)
	}
}

func TestGuiShotScaleUsageErrors(t *testing.T) {
	cases := []struct {
		name  string
		flags map[string]string
	}{
		{"scale zero", map[string]string{"scale": "0"}},
		{"scale above one", map[string]string{"scale": "1.5"}},
		{"scale with max-width", map[string]string{"scale": "0.5", "max-width": "960"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ranStages := withGuiShotSeams(t)
			withGuiCLISeams(t)
			seedGuiOn(t)

			err := runGuiShot(shotFlagsCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, tc.flags), nil)
			if err == nil || exitCode(err) != exitUsage {
				t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
			}
			if len(*ranStages) != 0 {
				t.Errorf("runner called %d times on a usage error", len(*ranStages))
			}
		})
	}
}

func TestGuiShotMaxWidthDerivesScale(t *testing.T) {
	withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotFlagsCmdWith(&out, &errOut, map[string]string{"max-width": "960"}), nil); err != nil {
		t.Fatal(err)
	}
	if got, want := errOut.String(), "geometry 1920x1080 scale 0.5\n"; got != want {
		t.Errorf("stderr = %q, want %q (S = min(1, 960/1920))", got, want)
	}
}

func TestGuiShotWindowUsesWindowGeometry(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{out: "WINDOW=42\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotFlagsCmdWith(&out, &errOut, map[string]string{"window": "42"}), nil); err != nil {
		t.Fatal(err)
	}
	if got, want := errOut.String(), "geometry 800x600 scale 1\n"; got != want {
		t.Errorf("stderr = %q, want the window's geometry %q", got, want)
	}
	argv := (*ranStages)[0][0].argv
	joined := strings.Join(argv, " ")
	if !strings.Contains(joined, "-window 42") {
		t.Errorf("capture argv = %q, want -window 42", joined)
	}
}

// shotJSONCmdWith builds a bare command carrying the shot verb's capture
// modifiers plus --out and --json.
func shotJSONCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := shotFlagsCmdWith(out, errOut, flags)
	cmd.Flags().Bool("json", false, "")
	setFlags(cmd, map[string]string{"json": "true"})
	return cmd
}

// TestGuiShotJSONEmitsEnvelope pins the --json receipt on a root capture with
// --max-width: the envelope carries path/width/height/scale/display, no
// window key, and the stderr geometry line still prints.
func TestGuiShotJSONEmitsEnvelope(t *testing.T) {
	withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotJSONCmdWith(&out, &errOut, map[string]string{"max-width": "960"}), nil); err != nil {
		t.Fatal(err)
	}
	var doc struct {
		OK     bool              `json:"ok"`
		Result guiShotJSONResult `json:"result"`
	}
	if err := json.Unmarshal(out.Bytes(), &doc); err != nil {
		t.Fatalf("stdout is not the envelope: %v\n%s", err, out.String())
	}
	wantPath := filepath.Join(os.TempDir(), "rk-gui-shot-20260909-140506.png")
	want := guiShotJSONResult{Path: wantPath, Width: 1920, Height: 1080, Scale: 0.5, Display: ":10"}
	if !doc.OK || doc.Result != want {
		t.Errorf("envelope = ok:%v result:%+v, want ok:true result:%+v", doc.OK, doc.Result, want)
	}
	if strings.Contains(out.String(), `"window"`) {
		t.Errorf("a root capture must omit the window key: %q", out.String())
	}
	if got, want := errOut.String(), "geometry 1920x1080 scale 0.5\n"; got != want {
		t.Errorf("stderr = %q, want the geometry line %q even under --json", got, want)
	}
}

// TestGuiShotJSONWindowKey pins the window key on a --window capture under
// --json.
func TestGuiShotJSONWindowKey(t *testing.T) {
	withGuiShotSeams(t)
	withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{out: "WINDOW=42\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out, errOut bytes.Buffer
	if err := runGuiShot(shotJSONCmdWith(&out, &errOut, map[string]string{"window": "42"}), nil); err != nil {
		t.Fatal(err)
	}
	var doc struct {
		OK     bool              `json:"ok"`
		Result guiShotJSONResult `json:"result"`
	}
	if err := json.Unmarshal(out.Bytes(), &doc); err != nil {
		t.Fatalf("stdout is not the envelope: %v\n%s", err, out.String())
	}
	if !doc.OK || doc.Result.Window != 42 {
		t.Errorf("envelope = ok:%v window:%d, want ok:true window:42", doc.OK, doc.Result.Window)
	}
	if doc.Result.Width != 800 || doc.Result.Height != 600 {
		t.Errorf("geometry = %dx%d, want the window's 800x600", doc.Result.Width, doc.Result.Height)
	}
	if got, want := errOut.String(), "geometry 800x600 scale 1\n"; got != want {
		t.Errorf("stderr = %q, want %q", got, want)
	}
}

func TestGuiShotWindowNeedsXdotool(t *testing.T) {
	ranStages := withGuiShotSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly()

	err := runGuiShot(shotFlagsCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"window": "42"}), nil)
	if err == nil || err.Error() != "xdotool not found — sudo apt install xdotool" {
		t.Errorf("err = %v, want the xdotool install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*ranStages) != 0 {
		t.Errorf("runner called %d times without xdotool", len(*ranStages))
	}
}
