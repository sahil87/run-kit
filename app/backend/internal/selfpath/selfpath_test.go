package selfpath

import "testing"

func TestStableForMapsCellarPathToBrewPrefixSymlink(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"linuxbrew cellar", "/home/linuxbrew/.linuxbrew/Cellar/run-kit/3.19.42/bin/run-kit", "/home/linuxbrew/.linuxbrew/bin/run-kit"},
		{"macos cellar", "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", "/opt/homebrew/bin/run-kit"},
		{"usr local rk", "/usr/local/bin/rk", "/usr/local/bin/rk"},
		{"go bin rk", "/home/u/go/bin/rk", "/home/u/go/bin/rk"},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StableFor(tc.in); got != tc.want {
				t.Errorf("StableFor(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestStableComposesResolveAndStableFor(t *testing.T) {
	resolved, err := Resolve()
	if err != nil {
		t.Fatal(err)
	}
	got, err := Stable()
	if err != nil {
		t.Fatal(err)
	}
	if got == "" {
		t.Fatal("Stable() returned an empty path")
	}
	if want := StableFor(resolved); got != want {
		t.Errorf("Stable() = %q, want StableFor(Resolve()) = %q", got, want)
	}
}
