// Tests for the exported registry metadata (Registry/KeyInfo) and the generic
// JSON value read/apply surface (ReadValue/ApplyValue) that GET/POST
// /api/settings ride on.
package settings

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestRegistry_orderAndMetadata(t *testing.T) {
	infos := Registry()
	wantKeys := []string{
		"theme", "theme_dark", "theme_light", "instance_color", "ssh_host",
		"instance_name", "auto_name", "tmux_conf", "log_level",
		"server_colors", "server_flairs", "board_order",
	}
	if len(infos) != len(wantKeys) {
		t.Fatalf("Registry() returned %d entries, want %d", len(infos), len(wantKeys))
	}
	for i, key := range wantKeys {
		if infos[i].Key != key {
			t.Errorf("Registry()[%d].Key = %q, want %q", i, infos[i].Key, key)
		}
	}
	// Metadata is verbatim from the registry table — spot-check one entry of
	// each kind plus the ui/live split.
	byKey := make(map[string]KeyInfo, len(infos))
	for _, info := range infos {
		byKey[info.Key] = info
	}
	checks := []struct {
		key, kind, def, category string
		ui, live                 bool
	}{
		{"theme", "enum", "system", "appearance", true, true},
		{"instance_color", "color", "", "appearance", true, true},
		{"auto_name", "bool", "false", "behavior", true, false},
		{"log_level", "enum", "info", "advanced", true, false},
		{"server_colors", "map", "{}", "appearance", true, true},
		{"server_flairs", "map", "{}", "appearance", true, true},
		{"board_order", "list", "[]", "layout", true, true},
	}
	for _, c := range checks {
		info, ok := byKey[c.key]
		if !ok {
			t.Errorf("Registry() missing key %q", c.key)
			continue
		}
		if info.Kind != c.kind || info.Default != c.def || info.Category != c.category || info.UI != c.ui || info.Live != c.live {
			t.Errorf("Registry()[%q] = %+v, want kind=%q default=%q category=%q ui=%v live=%v",
				c.key, info, c.kind, c.def, c.category, c.ui, c.live)
		}
		if info.Description == "" {
			t.Errorf("Registry()[%q].Description is empty", c.key)
		}
	}
}

func TestReadValue_defaultSettings(t *testing.T) {
	s := Default()
	cases := []struct {
		key  string
		want any
	}{
		{"theme", ptr("system")},
		{"theme_dark", ptr("default-dark")},
		{"theme_light", ptr("default-light")},
		{"instance_color", (*string)(nil)},
		{"ssh_host", (*string)(nil)},
		{"instance_name", (*string)(nil)},
		{"auto_name", false},
		{"tmux_conf", (*string)(nil)},
		{"log_level", ptr("info")},
		{"server_colors", map[string]string(nil)},
		{"server_flairs", map[string]string(nil)},
		{"board_order", []string(nil)},
	}
	for _, c := range cases {
		got, ok := ReadValue(&s, c.key)
		if !ok {
			t.Errorf("ReadValue(%q): ok = false, want true", c.key)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("ReadValue(%q) = %#v, want %#v", c.key, got, c.want)
		}
	}
}

func TestReadValue_nullForUnsetJSONRoundTrip(t *testing.T) {
	// An unset scalar marshals to JSON null — the null-means-unset contract
	// the API preserves from the folded per-key GETs.
	s := Default()
	got, _ := ReadValue(&s, "instance_color")
	data, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != "null" {
		t.Errorf("marshaled unset instance_color = %s, want null", data)
	}
}

func TestReadValue_unknownKey(t *testing.T) {
	s := Default()
	if _, ok := ReadValue(&s, "bogus"); ok {
		t.Error("ReadValue(bogus): ok = true, want false")
	}
}

func ptr(v string) *string { return &v }

func TestApplyValue_scalars(t *testing.T) {
	s := Default()

	if err := ApplyValue(&s, "theme", json.RawMessage(`"midnight"`)); err != nil {
		t.Fatalf("apply theme: %v", err)
	}
	if s.Theme != "midnight" {
		t.Errorf("theme = %q, want %q", s.Theme, "midnight")
	}

	// Null unsets to the registry default.
	if err := ApplyValue(&s, "theme", json.RawMessage(`null`)); err != nil {
		t.Fatalf("apply theme null: %v", err)
	}
	if s.Theme != "system" {
		t.Errorf("theme after null = %q, want %q", s.Theme, "system")
	}

	// Trim + validate path on ssh_host.
	if err := ApplyValue(&s, "ssh_host", json.RawMessage(`"  devbox  "`)); err != nil {
		t.Fatalf("apply ssh_host: %v", err)
	}
	if s.SSHHost != "devbox" {
		t.Errorf("ssh_host = %q, want %q", s.SSHHost, "devbox")
	}

	// Trimmed-to-empty is treated as null (unset).
	if err := ApplyValue(&s, "ssh_host", json.RawMessage(`"   "`)); err != nil {
		t.Fatalf("apply ssh_host empty: %v", err)
	}
	if s.SSHHost != "" {
		t.Errorf("ssh_host after empty = %q, want unset", s.SSHHost)
	}
	got, _ := ReadValue(&s, "ssh_host")
	if got != (*string)(nil) {
		t.Errorf("ReadValue(ssh_host) after empty = %#v, want nil", got)
	}

	// Bool.
	if err := ApplyValue(&s, "auto_name", json.RawMessage(`true`)); err != nil {
		t.Fatalf("apply auto_name: %v", err)
	}
	if !s.AutoName {
		t.Error("auto_name = false, want true")
	}
}

func TestApplyValue_perEntryMapMerge(t *testing.T) {
	s := Default()
	s.ServerColors = map[string]string{"dev": "4", "prod": "2"}

	err := ApplyValue(&s, "server_colors", json.RawMessage(`{"dev": null, "stage": "1+3"}`))
	if err != nil {
		t.Fatalf("apply server_colors: %v", err)
	}
	want := map[string]string{"prod": "2", "stage": "1+3"}
	if !reflect.DeepEqual(s.ServerColors, want) {
		t.Errorf("server_colors = %v, want %v", s.ServerColors, want)
	}

	// Top-level null clears the whole map.
	if err := ApplyValue(&s, "server_colors", json.RawMessage(`null`)); err != nil {
		t.Fatalf("apply server_colors null: %v", err)
	}
	if s.ServerColors != nil {
		t.Errorf("server_colors after top-level null = %v, want nil", s.ServerColors)
	}

	// Empty-string entry unsets, like null.
	s.ServerFlairs = map[string]string{"a": "rain", "b": "cube"}
	if err := ApplyValue(&s, "server_flairs", json.RawMessage(`{"a": ""}`)); err != nil {
		t.Fatalf("apply server_flairs empty: %v", err)
	}
	if !reflect.DeepEqual(s.ServerFlairs, map[string]string{"b": "cube"}) {
		t.Errorf("server_flairs = %v, want {b: cube}", s.ServerFlairs)
	}
}

func TestApplyValue_listReplace(t *testing.T) {
	s := Default()
	s.BoardOrder = []string{"deploys"}

	if err := ApplyValue(&s, "board_order", json.RawMessage(`["reviews","deploys"]`)); err != nil {
		t.Fatalf("apply board_order: %v", err)
	}
	if !reflect.DeepEqual(s.BoardOrder, []string{"reviews", "deploys"}) {
		t.Errorf("board_order = %v, want [reviews deploys]", s.BoardOrder)
	}

	for _, clear := range []string{`null`, `[]`} {
		if err := ApplyValue(&s, "board_order", json.RawMessage(clear)); err != nil {
			t.Fatalf("apply board_order %s: %v", clear, err)
		}
		if s.BoardOrder != nil {
			t.Errorf("board_order after %s = %v, want nil", clear, s.BoardOrder)
		}
	}
}

func TestApplyValue_rejectsInvalidWithoutMutation(t *testing.T) {
	cases := []struct {
		name  string
		key   string
		patch string
		check func(s *Settings) any // value to compare against its pre-apply state
	}{
		{"malformed color", "instance_color", `"99"`, func(s *Settings) any { return s.InstanceColor }},
		{"unknown flair token", "server_flairs", `{"dev": "sparkle"}`, func(s *Settings) any { return s.ServerFlairs }},
		{"invalid ssh host", "ssh_host", `"dev box"`, func(s *Settings) any { return s.SSHHost }},
		{"invalid instance name", "instance_name", `"my\u0007box"`, func(s *Settings) any { return s.InstanceName }},
		{"log_level outside enum", "log_level", `"trace"`, func(s *Settings) any { return s.LogLevel }},
		{"empty theme", "theme", `"  "`, func(s *Settings) any { return s.Theme }},
		{"non-bool auto_name", "auto_name", `"yes"`, func(s *Settings) any { return s.AutoName }},
		{"wrong type for map", "server_colors", `"4"`, func(s *Settings) any { return s.ServerColors }},
		{"wrong type for list", "board_order", `{"a":1}`, func(s *Settings) any { return s.BoardOrder }},
		{"wrong type for scalar", "theme", `42`, func(s *Settings) any { return s.Theme }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := Default()
			s.InstanceColor = "4"
			s.ServerFlairs = map[string]string{"dev": "rain"}
			s.SSHHost = "devbox"
			s.InstanceName = "my-box"
			s.BoardOrder = []string{"a"}
			before := c.check(&s)

			if err := ApplyValue(&s, c.key, json.RawMessage(c.patch)); err == nil {
				t.Fatalf("ApplyValue(%q, %s) succeeded, want error", c.key, c.patch)
			}
			if after := c.check(&s); !reflect.DeepEqual(after, before) {
				t.Errorf("value mutated on rejection: before=%#v after=%#v", before, after)
			}
		})
	}
}

func TestApplyValue_unknownKey(t *testing.T) {
	s := Default()
	if err := ApplyValue(&s, "bogus_key", json.RawMessage(`1`)); err == nil {
		t.Fatal("ApplyValue(bogus_key) succeeded, want error")
	}
}
