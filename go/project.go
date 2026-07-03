package defterparse

import (
	"strconv"
	"strings"
)

// The projection: a derived, style-stripped view of a model, for full-text
// search / RAG / an agent that only needs to *read* the data. It is never
// canonical, always regenerated, and one-way.
//
// TIER-1 BOUNDARY (Go pure-text layer): computed values are NOT materialized
// here. The reference TypeScript projectText, given a ComputedGrid, replaces
// formula cells with their evaluated display values and reformats literal
// numbers per each cell's `format` attribute. This Go layer deliberately has no
// formula engine and no number-format engine, so:
//   - a formula cell projects as its **source text** (leading `=` kept), and
//   - literal cells are emitted **verbatim** (no number-format application).
// Only the static style *rules* are stripped. Chart / conditional / validation /
// named-range declarations are retained (matching the reference, which clears
// only `sheet.styles`). Downstream, tela materializes computed values via a
// separate Node CLI.

// projectValuesModel returns a copy of the model with the static style rules
// removed. Formula and literal cells are left untouched (Tier-1: no compute).
func projectValuesModel(model *Model) *Model {
	next := &Model{Sheets: make([]*Sheet, len(model.Sheets))}
	for i, s := range model.Sheets {
		cp := *s        // shallow copy of the sheet header
		cp.Styles = nil // strip static style rules
		next.Sheets[i] = &cp
	}
	return next
}

// ProjectText renders the values-materialized-for-reading markdown projection,
// minus the compute step (see the TIER-1 BOUNDARY note above). Formula cells
// keep their source text.
func ProjectText(model *Model) string {
	return Serialize(projectValuesModel(model))
}

// ProjectProse renders a flat, prose-like projection: one line per data row,
// `header: value` pairs, prefixed by the sheet name. Ideal as RAG chunk units.
// Formula cells project as their source text (Tier-1: no compute).
func ProjectProse(model *Model) string {
	var lines []string
	for _, sheet := range model.Sheets {
		var headers []string
		if len(sheet.Grid) > 0 {
			headers = sheet.Grid[0]
		}
		for r := 1; r < len(sheet.Grid); r++ {
			var parts []string
			for c := 0; c < sheet.Width; c++ {
				header := ""
				if c < len(headers) {
					header = strings.TrimSpace(headers[c])
				}
				if header == "" {
					header = "Col" + strconv.Itoa(c+1)
				}
				value := GetCell(sheet, c, r+1)
				if strings.TrimSpace(value) != "" {
					parts = append(parts, header+": "+value)
				}
			}
			if len(parts) > 0 {
				lines = append(lines, sheet.Name+" — "+strings.Join(parts, ", "))
			}
		}
	}
	return strings.Join(lines, "\n")
}
