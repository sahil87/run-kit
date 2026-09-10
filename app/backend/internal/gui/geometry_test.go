package gui

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"
)

func TestParseGeometry(t *testing.T) {
	t.Run("auto", func(t *testing.T) {
		w, h, auto, err := ParseGeometry("auto")
		if err != nil || !auto || w != 0 || h != 0 {
			t.Errorf(`ParseGeometry("auto") = (%d, %d, %v, %v), want (0, 0, true, nil)`, w, h, auto, err)
		}
	})

	t.Run("valid fixed sizes", func(t *testing.T) {
		for _, c := range []struct {
			s    string
			w, h int
		}{
			{"320x320", 320, 320},
			{"7680x7680", 7680, 7680},
			{"1920x1080", 1920, 1080},
			{"1080x1920", 1080, 1920},
		} {
			w, h, auto, err := ParseGeometry(c.s)
			if err != nil || auto || w != c.w || h != c.h {
				t.Errorf("ParseGeometry(%q) = (%d, %d, %v, %v), want (%d, %d, false, nil)", c.s, w, h, auto, err, c.w, c.h)
			}
		}
	})

	t.Run("out of range", func(t *testing.T) {
		for _, s := range []string{"319x1080", "1920x7681", "100x100"} {
			_, _, _, err := ParseGeometry(s)
			want := "geometry " + s + " out of range (320–7680 per side)"
			if err == nil || err.Error() != want {
				t.Errorf("ParseGeometry(%q) err = %v, want %q", s, err, want)
			}
		}
	})

	t.Run("shape errors", func(t *testing.T) {
		for _, s := range []string{"1920×1080", "1920 1080", "AUTO", "1920x", "x1080", "-5x600", ""} {
			_, _, _, err := ParseGeometry(s)
			want := `geometry must be WxH (320–7680 per side) or auto, got "` + s + `"`
			if err == nil || err.Error() != want {
				t.Errorf("ParseGeometry(%q) err = %v, want %q", s, err, want)
			}
		}
	})
}

func TestValidateGeometry(t *testing.T) {
	for _, s := range []string{"auto", "1920x1080", "320x320", "7680x7680"} {
		if msg := ValidateGeometry(s); msg != "" {
			t.Errorf("ValidateGeometry(%q) = %q, want empty", s, msg)
		}
	}
	if got, want := ValidateGeometry("100x100"), "geometry 100x100 out of range (320–7680 per side)"; got != want {
		t.Errorf("ValidateGeometry(100x100) = %q, want %q", got, want)
	}
}

func TestFormatGeometry(t *testing.T) {
	if got := FormatGeometry(1280, 720); got != "1280x720" {
		t.Errorf("FormatGeometry(1280, 720) = %q, want %q", got, "1280x720")
	}
}

// xrandrQueryFixture is a `xrandr --query` capture from an Xtigervnc display
// with -AcceptSetDesktopSize: the connected output plus its mode table.
const xrandrQueryFixture = `Screen 0: minimum 32 x 32, current 1920 x 1080, maximum 32767 x 32767
VNC-0 connected 1920x1080+0+0 0mm x 0mm
   1920x1080     60.00*+
   1920x1200     60.00
   1600x1200     60.00
   1680x1050     60.00
   1400x1050     60.00
   1360x768      60.00
   1280x1024     60.00
   1280x960      60.00
   1280x800      60.00
   1280x720      60.00
   1024x768      60.00
   800x600       60.00
   640x480       60.00
`

func TestXrandrQueryArgv(t *testing.T) {
	if got, want := XrandrQueryArgv(), []string{"xrandr", "--query"}; !reflect.DeepEqual(got, want) {
		t.Errorf("XrandrQueryArgv() = %v, want %v", got, want)
	}
}

func TestParseXrandrQuery(t *testing.T) {
	t.Run("fixture", func(t *testing.T) {
		output, modes, err := ParseXrandrQuery(xrandrQueryFixture)
		if err != nil {
			t.Fatalf("ParseXrandrQuery: %v", err)
		}
		if output != "VNC-0" {
			t.Errorf("output = %q, want %q", output, "VNC-0")
		}
		for _, mode := range []string{"1920x1080", "1280x720"} {
			if !slices.Contains(modes, mode) {
				t.Errorf("modes %v lacks %q", modes, mode)
			}
		}
		if slices.Contains(modes, "1600x900") {
			t.Errorf("modes %v unexpectedly contains 1600x900", modes)
		}
	})

	t.Run("no connected output", func(t *testing.T) {
		fixture := "Screen 0: minimum 32 x 32, current 1920 x 1080, maximum 32767 x 32767\n" +
			"VNC-0 disconnected 0mm x 0mm\n"
		_, _, err := ParseXrandrQuery(fixture)
		if err == nil || err.Error() != "xrandr reports no connected output" {
			t.Errorf("err = %v, want %q", err, "xrandr reports no connected output")
		}
	})
}

func TestXrandrResizeArgv(t *testing.T) {
	_, modes, err := ParseXrandrQuery(xrandrQueryFixture)
	if err != nil {
		t.Fatalf("ParseXrandrQuery: %v", err)
	}

	t.Run("listed mode is one step", func(t *testing.T) {
		want := [][]string{{"xrandr", "--output", "VNC-0", "--mode", "1280x720"}}
		if got := XrandrResizeArgv("VNC-0", modes, 1280, 720); !reflect.DeepEqual(got, want) {
			t.Errorf("XrandrResizeArgv(1280x720) = %v, want %v", got, want)
		}
	})

	t.Run("unlisted mode is three steps", func(t *testing.T) {
		want := [][]string{
			{"xrandr", "--newmode", "1600x900", "0", "1600", "0", "0", "0", "900", "0", "0", "0"},
			{"xrandr", "--addmode", "VNC-0", "1600x900"},
			{"xrandr", "--output", "VNC-0", "--mode", "1600x900"},
		}
		if got := XrandrResizeArgv("VNC-0", modes, 1600, 900); !reflect.DeepEqual(got, want) {
			t.Errorf("XrandrResizeArgv(1600x900) = %v, want %v", got, want)
		}
	})
}

// fakeDisplayRunner scripts the query reply, records every argv, and fails on
// a named step with a scripted error.
type fakeDisplayRunner struct {
	queryOut string
	failOn   string
	failErr  error
	calls    [][]string
}

func (f *fakeDisplayRunner) run(_ context.Context, _ string, argv []string) (string, error) {
	f.calls = append(f.calls, argv)
	if len(argv) > 1 && argv[1] == "--query" {
		return f.queryOut, nil
	}
	if f.failOn != "" && len(argv) > 1 && argv[1] == f.failOn {
		return "", f.failErr
	}
	return "", nil
}

func TestResize(t *testing.T) {
	ctx := context.Background()

	t.Run("unlisted size runs query then the three steps", func(t *testing.T) {
		fake := &fakeDisplayRunner{queryOut: xrandrQueryFixture}
		if err := Resize(ctx, fake.run, ":10", 2560, 1440); err != nil {
			t.Fatalf("Resize: %v", err)
		}
		want := [][]string{
			{"xrandr", "--query"},
			{"xrandr", "--newmode", "2560x1440", "0", "2560", "0", "0", "0", "1440", "0", "0", "0"},
			{"xrandr", "--addmode", "VNC-0", "2560x1440"},
			{"xrandr", "--output", "VNC-0", "--mode", "2560x1440"},
		}
		if !reflect.DeepEqual(fake.calls, want) {
			t.Errorf("calls = %v, want %v", fake.calls, want)
		}
	})

	t.Run("listed size runs query then the single step", func(t *testing.T) {
		fake := &fakeDisplayRunner{queryOut: xrandrQueryFixture}
		if err := Resize(ctx, fake.run, ":10", 1280, 720); err != nil {
			t.Fatalf("Resize: %v", err)
		}
		want := [][]string{
			{"xrandr", "--query"},
			{"xrandr", "--output", "VNC-0", "--mode", "1280x720"},
		}
		if !reflect.DeepEqual(fake.calls, want) {
			t.Errorf("calls = %v, want %v", fake.calls, want)
		}
	})

	t.Run("addmode failure stops before the output step", func(t *testing.T) {
		fake := &fakeDisplayRunner{
			queryOut: xrandrQueryFixture,
			failOn:   "--addmode",
			failErr:  errors.New("X Error"),
		}
		err := Resize(ctx, fake.run, ":10", 2560, 1440)
		if err == nil || err.Error() != "xrandr: X Error" {
			t.Fatalf("Resize err = %v, want %q", err, "xrandr: X Error")
		}
		for _, argv := range fake.calls {
			if len(argv) > 1 && argv[1] == "--output" {
				t.Errorf("the --output step ran after the --addmode failure: %v", fake.calls)
			}
		}
	})
}
