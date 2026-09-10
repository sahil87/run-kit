package promptscan

import (
	"strings"
	"testing"
)

func TestScanClasses(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    Result
	}{
		// Class 1: question mark — last non-empty line only.
		{"question mark last line", "working...\nContinue?", Result{Indicator: IndicatorQuestionMark, Snippet: "Continue?"}},
		{"question mark earlier line only", "Everything ok?\nplain output", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark 119 chars matches", strings.Repeat("x", 118) + "?", Result{Indicator: IndicatorQuestionMark, Snippet: strings.Repeat("x", 118) + "?"}},
		{"question mark 120 chars too long", strings.Repeat("x", 119) + "?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark hash comment", "# is this done?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark slash comment", "// is this done?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark star bullet", "* is this done?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark quote", "> is this done?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark timestamped", "12:34 is this done?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"question mark trailing whitespace tolerated", "Continue?  ", Result{Indicator: IndicatorQuestionMark, Snippet: "Continue?  "}},
		// Classes 2–7.
		{"yes no bracket", "Overwrite file [y/N]", Result{Indicator: IndicatorYesNo, Snippet: "Overwrite file [y/N]"}},
		{"yes no parens", "continue (YES/NO)", Result{Indicator: IndicatorYesNo, Snippet: "continue (YES/NO)"}},
		{"action word above plain last line", "Allow?\nprocessing done", Result{Indicator: IndicatorActionWord, Snippet: "Allow?"}},
		{"action word case sensitive", "allow?\nprocessing done", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"imperative question", "Do you want to proceed", Result{Indicator: IndicatorImperativeQuestion, Snippet: "Do you want to proceed"}},
		{"imperative question case-insensitive", "should I continue", Result{Indicator: IndicatorImperativeQuestion, Snippet: "should I continue"}},
		{"colon prompt", "Enter your name:", Result{Indicator: IndicatorColonPrompt, Snippet: "Enter your name:"}},
		{"enumerated options", "1) yes  2) no", Result{Indicator: IndicatorEnumeratedOptions, Snippet: "1) yes  2) no"}},
		{"press key", "Press any key to continue", Result{Indicator: IndicatorPressKey, Snippet: "Press any key to continue"}},
		{"hit enter", "hit enter to accept", Result{Indicator: IndicatorPressKey, Snippet: "hit enter to accept"}},
		// Ordering rules.
		{"bottom-most wins", "Allow?\n1) yes  2) no", Result{Indicator: IndicatorEnumeratedOptions, Snippet: "1) yes  2) no"}},
		{"last line class 1 beats yes_no", "Continue [Y/n]?", Result{Indicator: IndicatorQuestionMark, Snippet: "Continue [Y/n]?"}},
		{"class order within a line", "Proceed? [y/n]", Result{Indicator: IndicatorYesNo, Snippet: "Proceed? [y/n]"}},
		// Blank lines skipped; trailing newline tolerated.
		{"blank lines ignored", "first\n\nContinue?\n\n", Result{Indicator: IndicatorQuestionMark, Snippet: "Continue?"}},
		{"no indicator", "building...\ndone", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Scan(tc.content); got != tc.want {
				t.Errorf("Scan(%q) = %+v, want %+v", tc.content, got, tc.want)
			}
		})
	}
}

func TestScanGuards(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    Result
	}{
		{"empty", "", Result{Indicator: IndicatorNone, Reason: ReasonBlankCapture}},
		{"whitespace only", "  \n \t\n  ", Result{Indicator: IndicatorNone, Reason: ReasonBlankCapture}},
		{"last line bare prompt", "Continue?\n>\n", Result{Indicator: IndicatorNone, Reason: ReasonTurnBoundary}},
		{"second-to-last bare prompt padded", "output\n > \ntrailing", Result{Indicator: IndicatorNone, Reason: ReasonTurnBoundary}},
		{"prompt above last two lines is not a boundary", ">\nline1\nline2\nContinue?", Result{Indicator: IndicatorQuestionMark, Snippet: "Continue?"}},
		{"prompt with text is not a boundary", "output\n> echo hi?", Result{Indicator: IndicatorNone, Reason: ReasonNoIndicator}},
		{"blank guard precedes turn boundary", "\n\n", Result{Indicator: IndicatorNone, Reason: ReasonBlankCapture}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Scan(tc.content); got != tc.want {
				t.Errorf("Scan(%q) = %+v, want %+v", tc.content, got, tc.want)
			}
		})
	}
}
