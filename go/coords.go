package defterparse

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// A1 coordinate system.
//
// Convention (see docs/FORMAT.md): columns are 0-based indices (A = 0) exposed
// as bijective base-26 letters; rows are the 1-based A1 row numbers (row 1 =
// header, row 2 = first data row). Array access into a sheet grid is
// grid[row-1][col].

// Ref is a single cell reference, possibly absolute in either axis and possibly
// cross-sheet. An empty Sheet means "no explicit sheet".
type Ref struct {
	Col    int
	Row    int
	ColAbs bool
	RowAbs bool
	Sheet  string
}

// Range is a rectangular range, normalized so Start is the top-left and End the
// bottom-right. An empty Sheet means "no explicit sheet".
type Range struct {
	Start Ref
	End   Ref
	Sheet string
}

// columnLabel converts a 0-based column index to its bijective base-26 label.
// 0->A, 25->Z, 26->AA.
func columnLabel(index int) (string, error) {
	if index < 0 {
		return "", fmt.Errorf("bad column index: %d", index)
	}
	label := ""
	n := index
	for n >= 0 {
		label = string(rune(65+(n%26))) + label
		n = n/26 - 1
	}
	return label, nil
}

var colLabelRe = regexp.MustCompile(`^[A-Z]+$`)

// columnIndex converts a column label (case-insensitive) to a 0-based index.
// A->0, Z->25, AA->26.
func columnIndex(label string) (int, error) {
	s := strings.ToUpper(label)
	if !colLabelRe.MatchString(s) {
		return 0, fmt.Errorf("bad column label: %s", label)
	}
	n := 0
	for i := 0; i < len(s); i++ {
		n = n*26 + int(s[i]-64)
	}
	return n - 1, nil
}

// Matches an A1 reference with optional sheet prefix and $ absolute markers.
var refRe = regexp.MustCompile(`^(?:(?:'([^']*)'|([A-Za-z_]\w*))!)?(\$?)([A-Za-z]+)(\$?)(\d+)$`)

// parseRef parses a single reference. Accepts an optional `Sheet!` or
// `'Sheet name'!` prefix and `$` absolute markers. Returns an error on malformed
// input.
func parseRef(text string) (Ref, error) {
	m := refRe.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return Ref{}, fmt.Errorf("bad cell reference: %s", text)
	}
	quotedSheet, bareSheet, colAbs, colLetters, rowAbs, rowDigits := m[1], m[2], m[3], m[4], m[5], m[6]
	sheet := quotedSheet
	if sheet == "" {
		sheet = bareSheet
	}
	row, err := strconv.Atoi(rowDigits)
	if err != nil {
		return Ref{}, err
	}
	if row < 1 {
		return Ref{}, fmt.Errorf("row must be >= 1: %s", text)
	}
	col, err := columnIndex(colLetters)
	if err != nil {
		return Ref{}, err
	}
	return Ref{Col: col, Row: row, ColAbs: colAbs == "$", RowAbs: rowAbs == "$", Sheet: sheet}, nil
}

// formatRef serializes a reference back to A1 text, including `$` markers and
// sheet prefix.
func formatRef(ref Ref) string {
	sheet := ""
	if ref.Sheet != "" {
		sheet = quoteSheet(ref.Sheet) + "!"
	}
	col, _ := columnLabel(ref.Col)
	colAbs := ""
	if ref.ColAbs {
		colAbs = "$"
	}
	rowAbs := ""
	if ref.RowAbs {
		rowAbs = "$"
	}
	return fmt.Sprintf("%s%s%s%s%d", sheet, colAbs, col, rowAbs, ref.Row)
}

var identRe = regexp.MustCompile(`^[A-Za-z_]\w*$`)

// quoteSheet quotes a sheet name in a reference if it isn't a bare identifier.
func quoteSheet(name string) string {
	if identRe.MatchString(name) {
		return name
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'"
}

// parseRange parses a range `A1:B4` (or a single cell, treated as a 1x1 range).
// Normalizes corners.
func parseRange(text string) (Range, error) {
	t := strings.TrimSpace(text)
	i := strings.IndexByte(t, ':')
	if i < 0 {
		ref, err := parseRef(t)
		if err != nil {
			return Range{}, err
		}
		end := ref
		end.Sheet = ""
		return Range{Start: ref, End: end, Sheet: ref.Sheet}, nil
	}
	start, err := parseRef(t[:i])
	if err != nil {
		return Range{}, err
	}
	end, err := parseRef(t[i+1:])
	if err != nil {
		return Range{}, err
	}
	return normalizeRange(Range{Start: start, End: end, Sheet: start.Sheet}), nil
}

// normalizeRange reorders corners so start <= end on both axes; carries the
// sheet from start when the range has none.
func normalizeRange(r Range) Range {
	minCol, maxCol := minInt(r.Start.Col, r.End.Col), maxInt(r.Start.Col, r.End.Col)
	minRow, maxRow := minInt(r.Start.Row, r.End.Row), maxInt(r.Start.Row, r.End.Row)
	sheet := r.Sheet
	if sheet == "" {
		sheet = r.Start.Sheet
	}
	return Range{
		Sheet: sheet,
		Start: Ref{Col: minCol, Row: minRow, ColAbs: r.Start.ColAbs, RowAbs: r.Start.RowAbs},
		End:   Ref{Col: maxCol, Row: maxRow, ColAbs: r.End.ColAbs, RowAbs: r.End.RowAbs},
	}
}

// formatRange serializes a range. A 1x1 range collapses to a single cell.
func formatRange(r Range) string {
	sheet := ""
	if r.Sheet != "" {
		sheet = quoteSheet(r.Sheet) + "!"
	}
	start := formatRef(Ref{Col: r.Start.Col, Row: r.Start.Row, ColAbs: r.Start.ColAbs, RowAbs: r.Start.RowAbs})
	if r.Start.Col == r.End.Col && r.Start.Row == r.End.Row {
		return sheet + start
	}
	end := formatRef(Ref{Col: r.End.Col, Row: r.End.Row, ColAbs: r.End.ColAbs, RowAbs: r.End.RowAbs})
	return sheet + start + ":" + end
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
