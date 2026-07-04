package defterparse

import (
	"strconv"
	"strings"
)

// Structural lint (NON-computed). Catches broken sheets before storing them.
// This is the Tier-1 host-side guard tela runs on an agent/synced body. It does
// NOT do formula-error detection (#REF!/#DIV0! etc.) — that needs evaluation and
// lives in a separate Node CLI.

// Issue is a single lint finding.
type Issue struct {
	Sheet   string // sheet name, if the issue is scoped to a sheet
	Cell    string // A1 ref / range / target text, if the issue is scoped to one
	Line    int    // 1-based source line number (0 when not derived from text)
	Message string
}

// Lint runs the structural checks that are visible in the parsed model:
// duplicate sheet names, empty sheets, and A1 ranges (in style rules, charts,
// conditionals, validations, and named ranges) that reference cells outside the
// target sheet's grid or an unknown sheet.
//
// Note: the lenient parser silently drops malformed defter-style lines (unknown
// attribute keys, unparseable targets), so those are invisible in the model. Use
// LintText to also catch them at the text layer with line numbers.
func Lint(m *Model) []Issue {
	var issues []Issue
	byName := map[string]*Sheet{}
	seen := map[string]bool{}
	for _, s := range m.Sheets {
		if seen[s.Name] {
			issues = append(issues, Issue{Sheet: s.Name, Message: "duplicate sheet name: " + s.Name})
		}
		seen[s.Name] = true
		if _, ok := byName[s.Name]; !ok {
			byName[s.Name] = s
		}
	}

	for _, s := range m.Sheets {
		if isEmptySheet(s) {
			issues = append(issues, Issue{Sheet: s.Name, Message: "sheet is empty (no data rows)"})
		}
		checkTarget := func(t StyleTarget, label string) {
			switch t.Kind {
			case TargetRange:
				if iss, bad := checkRange(s, byName, t.Range); bad {
					iss.Sheet = s.Name
					iss.Cell = label
					issues = append(issues, iss)
				}
			case TargetCols:
				if t.Start >= s.Width || t.End >= s.Width {
					issues = append(issues, Issue{Sheet: s.Name, Cell: label,
						Message: "column target " + label + " is outside the sheet (" + strconv.Itoa(s.Width) + " cols)"})
				}
			case TargetRows:
				rows := len(s.Grid)
				if t.Start > rows || t.End > rows {
					issues = append(issues, Issue{Sheet: s.Name, Cell: label,
						Message: "row target " + label + " is outside the sheet (" + strconv.Itoa(rows) + " rows)"})
				}
			}
		}
		for _, r := range s.Styles {
			checkTarget(r.Target, formatStyleTarget(r.Target))
		}
		for _, c := range s.Conditionals {
			checkTarget(c.Target, formatStyleTarget(c.Target))
		}
		for _, v := range s.Validations {
			checkTarget(v.Target, formatStyleTarget(v.Target))
		}
		for _, nr := range s.Names {
			if iss, bad := checkRange(s, byName, nr.Range); bad {
				iss.Sheet = s.Name
				iss.Cell = nr.Name + " = " + formatRange(nr.Range)
				issues = append(issues, iss)
			}
		}
		for _, ch := range s.Charts {
			if ch.HasLabels {
				if iss, bad := checkRange(s, byName, ch.Labels); bad {
					iss.Sheet = s.Name
					iss.Cell = "chart x=" + formatRange(ch.Labels)
					issues = append(issues, iss)
				}
			}
			for _, val := range ch.Values {
				if iss, bad := checkRange(s, byName, val); bad {
					iss.Sheet = s.Name
					iss.Cell = "chart y=" + formatRange(val)
					issues = append(issues, iss)
				}
			}
		}
	}
	return issues
}

func isEmptySheet(s *Sheet) bool {
	// After normalization a sheet always has a header row. It is "empty" if there
	// are no data rows, or it is the degenerate single empty cell.
	if len(s.Grid) <= 1 {
		return true
	}
	return false
}

// checkRange returns an Issue (bad=true) when the range's start corner falls
// outside the target sheet's grid, or the range names a sheet that doesn't exist.
func checkRange(host *Sheet, byName map[string]*Sheet, r Range) (Issue, bool) {
	target := host
	if r.Sheet != "" {
		t, ok := byName[r.Sheet]
		if !ok {
			return Issue{Message: "range " + formatRange(r) + " references unknown sheet '" + r.Sheet + "'"}, true
		}
		target = t
	}
	rows := len(target.Grid)
	if r.Start.Col >= target.Width || r.Start.Row > rows {
		return Issue{Message: "range " + formatRange(r) + " is outside the sheet (" +
			strconv.Itoa(target.Width) + " cols x " + strconv.Itoa(rows) + " rows)"}, true
	}
	return Issue{}, false
}

// LintText parses text and returns Lint(model) plus text-layer checks that the
// model cannot express: malformed defter-style lines (unknown attribute keys,
// bad target syntax, unparseable name/when/validate/chart rules), reported with
// 1-based line numbers.
func LintText(text string) []Issue {
	model := Parse(text)
	issues := Lint(model)
	issues = append(issues, lintStyleText(text)...)
	return issues
}

// lintStyleText walks the raw text, finds every defter-style block, and flags
// lines the lenient parser would silently drop or partially ignore.
func lintStyleText(text string) []Issue {
	var issues []Issue
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	sheet := "Sheet1"
	for i := 0; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if m := headingRe.FindStringSubmatch(trimmed); m != nil {
			if n := strings.TrimSpace(m[1]); n != "" {
				sheet = n
			}
			continue
		}
		fm := fenceRe.FindStringSubmatch(trimmed)
		if fm == nil {
			continue
		}
		marker := fm[1]
		info := strings.TrimSpace(fm[2])
		j := i + 1
		for ; j < len(lines); j++ {
			lt := strings.TrimSpace(lines[j])
			f := fenceRe.FindStringSubmatch(lt)
			if f != nil && strings.HasPrefix(lt, marker[:1]) && strings.TrimSpace(f[2]) == "" {
				break
			}
			if info == "defter-style" {
				issues = append(issues, lintStyleLine(sheet, j+1, lines[j])...)
			}
		}
		i = j
	}
	return issues
}

func lintStyleLine(sheet string, lineNo int, raw string) []Issue {
	line := strings.TrimSpace(raw)
	if line == "" || strings.HasPrefix(line, "#") {
		return nil
	}
	low := strings.ToLower(line)
	mk := func(msg string) []Issue {
		return []Issue{{Sheet: sheet, Line: lineNo, Message: msg}}
	}
	switch {
	case freezePrefixRe.MatchString(line):
		if _, ok := parseFreezeLine(line); !ok {
			return mk("malformed freeze rule (expected `freeze rows=N cols=M`, at least one axis): " + line)
		}
		return nil
	case strings.HasPrefix(low, "name "):
		if _, ok := parseNameLine(line); !ok {
			return mk("malformed name rule: " + line)
		}
		return nil
	case strings.HasPrefix(low, "when "):
		if _, ok := parseCondLine(line); !ok {
			return mk("malformed conditional rule (bad target, operator, value, or attributes): " + line)
		}
		return nil
	case strings.HasPrefix(low, "validate "):
		if _, ok := parseValidateLine(line); !ok {
			return mk("malformed validation rule (expected `validate <range> list=A,B,C`): " + line)
		}
		return nil
	case strings.HasPrefix(low, "chart ") || low == "chart":
		if _, ok := parseChartLine(line); !ok {
			return mk("malformed chart rule (unknown type, missing y=, or bad range): " + line)
		}
		return nil
	}
	// Generic `<target> <attr>...` rule.
	parts := splitWS(line)
	if _, err := parseStyleTarget(parts[0]); err != nil {
		return mk("bad target syntax: '" + parts[0] + "'")
	}
	var issues []Issue
	recognized := 0
	for _, tok := range parts[1:] {
		if tok == "" {
			continue
		}
		eq := strings.IndexByte(tok, '=')
		if eq < 0 {
			if isFlag(tok) {
				recognized++
			} else {
				issues = append(issues, Issue{Sheet: sheet, Line: lineNo, Message: "unknown flag '" + tok + "'"})
			}
			continue
		}
		key := tok[:eq]
		if isKey(key) {
			recognized++
		} else {
			issues = append(issues, Issue{Sheet: sheet, Line: lineNo, Message: "unknown attribute key '" + key + "'"})
		}
	}
	if recognized == 0 {
		issues = append(issues, Issue{Sheet: sheet, Line: lineNo, Message: "style rule has no recognized attributes: " + line})
	}
	return issues
}
