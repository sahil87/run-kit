package prreview

import "context"

// LineRow is the wire shape of one rendered row. The response is an ARRAY of
// these, never one HTML blob per file (R6): a blob cannot be interleaved, and
// interleaving a composer, a thread card and an expander between line N and
// line N+1 is the comment layer's whole job.
//
// Side + L are GitHub's own (side, line) half of a comment address; At carries
// a deleted row's post-image anchor. Together with the file's path they are the
// anchoring contract the client renders as data-side / data-l / data-at.
type LineRow struct {
	Kind   string `json:"kind"`
	Side   string `json:"side,omitempty"`
	L      int    `json:"l,omitempty"`
	Left   int    `json:"left,omitempty"`
	Right  int    `json:"right,omitempty"`
	At     int    `json:"at,omitempty"`
	Header string `json:"header,omitempty"`
	Spans  []Span `json:"spans,omitempty"`
}

// FileBody is one file's rows plus the refinement flag and the bounds the
// client needs to render context expanders.
type FileBody struct {
	Path string    `json:"path"`
	Rows []LineRow `json:"rows"`
	// Refine is true when any row in this response came from a tier-1 window
	// that may have guessed. The client re-requests the file once to swap the
	// corrected lines in place (R5).
	Refine bool `json:"refine"`
	// TotalLines is the post-image line count, so the expander can offer
	// `↕ All N lines` without a second read.
	TotalLines int    `json:"totalLines"`
	HeadSha    string `json:"headSha"`
	BaseSha    string `json:"baseSha"`
	// Highlighted is false when no Chroma lexer matched the path or the blob
	// could not be read — the rows still render, just without colour.
	Highlighted bool `json:"highlighted"`
}

// FileRows builds one file's diff rows from its patch, highlighting each row
// against the image it belongs to: added and context rows against the
// POST-image (head sha) blob, deleted rows against the PRE-image (base sha).
//
// Lexing a hunk body as a standalone fragment is not permitted — it starts the
// lexer mid-file with the wrong state, which is exactly what the context pads
// in lexWindow exist to prevent (R5).
// LineRowsFromPatch turns parsed patch rows into wire rows — the diff's whole
// STRUCTURE (kinds, both sides' line numbers, hunk headers, the anchor address
// every comment hangs off) with no token spans.
//
// This half costs nothing: the patch is already in the cached Review document,
// so structure is pure in-memory work. Only spansFor below reaches the network,
// which is why the list path can ship rows for every file within its budget
// without a single extra gh subprocess, and colour can arrive afterwards.
func LineRowsFromPatch(patchRows []PatchRow) []LineRow {
	rows := make([]LineRow, len(patchRows))
	for i, row := range patchRows {
		rows[i] = LineRow{
			Kind:   row.Kind,
			Left:   row.Left,
			Right:  row.Right,
			At:     row.At,
			Header: row.Header,
		}
		switch row.Kind {
		case RowAdd, RowCtx:
			rows[i].Side = SideRight
			rows[i].L = row.Right
		case RowDel:
			rows[i].Side = SideLeft
			rows[i].L = row.Left
		}
	}
	return rows
}

func (f *Fetcher) FileRows(ctx context.Context, review *Review, path string) (FileBody, error) {
	ref, err := ParsePRURL(review.URL)
	if err != nil {
		return FileBody{}, err
	}
	file := review.FindFile(path)
	if file == nil {
		return FileBody{}, ErrNoPR
	}

	patchRows := ParsePatch(file.Patch)
	body := FileBody{
		Path:    path,
		Rows:    LineRowsFromPatch(patchRows),
		HeadSha: review.HeadSha,
		BaseSha: review.BaseSha,
	}

	for _, run := range collectRuns(patchRows) {
		sha := review.HeadSha
		if run.side == SideLeft {
			sha = review.BaseSha
		}
		spans, refine, coloured := f.spansFor(ctx, ref, path, sha, run.start, run.count)
		if refine {
			body.Refine = true
		}
		if spans == nil {
			continue
		}
		if coloured {
			body.Highlighted = true
		}
		for offset, rowIndex := range run.rows {
			if offset < len(spans) {
				body.Rows[rowIndex].Spans = spans[offset]
			}
		}
	}

	// Rows the highlighter could not cover still ship their text — the ladder
	// degrades colour, never content.
	for i, row := range patchRows {
		if body.Rows[i].Spans == nil && row.Kind != RowHunk && row.Text != "" {
			body.Rows[i].Spans = []Span{{Text: row.Text}}
		}
	}

	if lines, err := f.blobLines(ctx, ref, path, review.HeadSha); err == nil {
		body.TotalLines = len(lines)
	}
	return body, nil
}

// contextExpandMaxLines bounds one context-expansion response. It is
// deliberately larger than the lexing window (which the highlighter applies
// internally, per hunk) because the expander's unit is what a human asked to
// see: `↕ All N lines` on a file longer than this serves the first page and the
// next `↑` continues. A single unbounded response is what this prevents — the
// blob can be a generated file.
const contextExpandMaxLines = 1000

// ContextRows serves a post-image line range as context rows — the
// `↕ All N lines` / `↑ 5 lines` expanders. It reads the SAME cached blob the
// lexer uses, so expansion costs no extra gh call once a file has been opened.
//
// The FindFile gate is the endpoint's whole authorization story and is not
// optional: without it the route would serve ANY blob in the repository at the
// head sha, because `path` arrives from the query string and the contents route
// takes it as a route segment. The PR's own changed-file list is the closed set
// a review tile may read.
func (f *Fetcher) ContextRows(ctx context.Context, review *Review, path string, start, count int) (FileBody, error) {
	ref, err := ParsePRURL(review.URL)
	if err != nil {
		return FileBody{}, err
	}
	if review.FindFile(path) == nil {
		return FileBody{}, ErrNoPR
	}
	lines, err := f.blobLines(ctx, ref, path, review.HeadSha)
	if err != nil {
		return FileBody{}, err
	}
	if start < 1 {
		start = 1
	}
	if count <= 0 || count > contextExpandMaxLines {
		count = contextExpandMaxLines
	}
	if start > len(lines) {
		return FileBody{Path: path, TotalLines: len(lines), HeadSha: review.HeadSha, BaseSha: review.BaseSha}, nil
	}
	end := start + count - 1
	if end > len(lines) {
		end = len(lines)
	}

	spans, refine, coloured := f.spansFor(ctx, ref, path, review.HeadSha, start, end-start+1)
	body := FileBody{
		Path:        path,
		Refine:      refine,
		TotalLines:  len(lines),
		HeadSha:     review.HeadSha,
		BaseSha:     review.BaseSha,
		Highlighted: coloured,
		Rows:        make([]LineRow, 0, end-start+1),
	}
	for i := start; i <= end; i++ {
		row := LineRow{Kind: RowCtx, Side: SideRight, L: i, Right: i, At: i}
		if offset := i - start; spans != nil && offset < len(spans) {
			row.Spans = spans[offset]
		} else if lines[i-1] != "" {
			row.Spans = []Span{{Text: lines[i-1]}}
		}
		body.Rows = append(body.Rows, row)
	}
	return body, nil
}
