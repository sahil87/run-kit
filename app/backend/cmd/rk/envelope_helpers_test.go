package main

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

// assertEnvelopeResult parses the one indented envelope document a --json
// success path writes and compares its result to want. Receipts are compared
// as decoded JSON, not as bytes: the encoder's indentation is
// outputSink.writeEnvelope's concern, the field set is the verb's.
func assertEnvelopeResult(t *testing.T, stdout string, want map[string]any) {
	t.Helper()
	var doc struct {
		OK     bool           `json:"ok"`
		Result map[string]any `json:"result"`
	}
	if err := json.Unmarshal([]byte(stdout), &doc); err != nil {
		t.Fatalf("stdout is not one JSON document: %v (%q)", err, stdout)
	}
	if !doc.OK || !reflect.DeepEqual(doc.Result, want) {
		t.Errorf("envelope = %q, want ok:true with result %v", stdout, want)
	}
}

// centralFailureEnvelope asserts the RunE wrote nothing to stdout on a --json
// failure (the envelope is execute()'s central writer's job, not the verb's)
// and returns the document that writer would emit for err, so a test can
// assert the code and message the model would see.
func centralFailureEnvelope(t *testing.T, stdout string, err error) string {
	t.Helper()
	if stdout != "" {
		t.Errorf("RunE wrote %q to stdout on a failure; the envelope is execute()'s central writer's", stdout)
	}
	var buf bytes.Buffer
	_ = outputSink{data: &buf}.Envelope(nil, err)
	return buf.String()
}

// parseFailureEnvelope decodes a failure envelope's error object.
func parseFailureEnvelope(t *testing.T, stdout string) envelopeError {
	t.Helper()
	var doc struct {
		OK    bool          `json:"ok"`
		Error envelopeError `json:"error"`
	}
	if err := json.Unmarshal([]byte(stdout), &doc); err != nil {
		t.Fatalf("stdout is not one JSON document: %v (%q)", err, stdout)
	}
	if doc.OK {
		t.Errorf("envelope = %q, want ok:false", stdout)
	}
	return doc.Error
}
