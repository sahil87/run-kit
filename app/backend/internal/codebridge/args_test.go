package codebridge

import (
	"encoding/json"
	"testing"
)

func TestParseArgs(t *testing.T) {
	got := ParseArgs([]string{
		"2908",                 // number stays a number
		"-5",                   // negative number stays a number
		"3.14",                 // float
		`{"$uri":"file:///x"}`, // object carried verbatim
		"[1,2]",                // array carried verbatim
		"true",                 // boolean literal
		"null",                 // null literal
		"bare",                 // bare word → string
		`"already quoted"`,     // valid JSON string stays as-is
		"{broken",              // invalid JSON → string
	})
	want := []string{
		`2908`,
		`-5`,
		`3.14`,
		`{"$uri":"file:///x"}`,
		`[1,2]`,
		`true`,
		`null`,
		`"bare"`,
		`"already quoted"`,
		`"{broken"`,
	}
	if len(got) != len(want) {
		t.Fatalf("ParseArgs returned %d args, want %d", len(got), len(want))
	}
	for i := range want {
		if string(got[i]) != want[i] {
			t.Errorf("arg %d = %s, want %s", i, got[i], want[i])
		}
		if !json.Valid(got[i]) {
			t.Errorf("arg %d is not valid JSON: %s", i, got[i])
		}
	}
}

func TestParseArgsEmpty(t *testing.T) {
	if got := ParseArgs(nil); len(got) != 0 {
		t.Errorf("ParseArgs(nil) = %v, want empty", got)
	}
}
