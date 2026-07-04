package defterparse

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// The defter-style presentation layer: parse/serialize of style rules and their
// A1 targets. One rule per line: `<target>  <attr> <attr> ...`. Mirrors
// packages/core/src/style.ts.

var styleFlags = []string{"bold", "italic", "underline", "strike", "wrap", "merge"}
var styleKeys = []string{"fill", "color", "align", "valign", "format", "border", "font", "size", "width"}

func isFlag(tok string) bool {
	for _, f := range styleFlags {
		if f == tok {
			return true
		}
	}
	return false
}

func isKey(tok string) bool {
	for _, k := range styleKeys {
		if k == tok {
			return true
		}
	}
	return false
}

var colsTargetRe = regexp.MustCompile(`^[A-Za-z]+:[A-Za-z]+$`)
var rowsTargetRe = regexp.MustCompile(`^\d+:\d+$`)

func parseStyleTarget(text string) (StyleTarget, error) {
	t := strings.TrimSpace(text)
	if colsTargetRe.MatchString(t) {
		parts := strings.SplitN(t, ":", 2)
		a, err := columnIndex(parts[0])
		if err != nil {
			return StyleTarget{}, err
		}
		b, err := columnIndex(parts[1])
		if err != nil {
			return StyleTarget{}, err
		}
		return StyleTarget{Kind: TargetCols, Start: a, End: b}, nil
	}
	if rowsTargetRe.MatchString(t) {
		parts := strings.SplitN(t, ":", 2)
		a, _ := strconv.Atoi(parts[0])
		b, _ := strconv.Atoi(parts[1])
		return StyleTarget{Kind: TargetRows, Start: a, End: b}, nil
	}
	rng, err := parseRange(t)
	if err != nil {
		return StyleTarget{}, err
	}
	return StyleTarget{Kind: TargetRange, Range: rng}, nil
}

func formatStyleTarget(target StyleTarget) string {
	switch target.Kind {
	case TargetCols:
		a, _ := columnLabel(target.Start)
		b, _ := columnLabel(target.End)
		return a + ":" + b
	case TargetRows:
		return strconv.Itoa(target.Start) + ":" + strconv.Itoa(target.End)
	default:
		return formatRange(target.Range)
	}
}

func setAttr(attrs *StyleAttrs, key, value string) {
	switch key {
	case "fill":
		attrs.Fill = value
	case "color":
		attrs.Color = value
	case "align":
		attrs.Align = value
	case "valign":
		attrs.Valign = value
	case "format":
		attrs.Format = value
	case "border":
		attrs.Border = value
	case "font":
		attrs.Font = value
	case "size":
		if n, ok := jsParseFloat(value); ok {
			attrs.Size = &n
		}
	case "width":
		if n, ok := jsParseFloat(value); ok {
			attrs.Width = &n
		}
	}
}

func setFlag(attrs *StyleAttrs, flag string) {
	switch flag {
	case "bold":
		attrs.Bold = true
	case "italic":
		attrs.Italic = true
	case "underline":
		attrs.Underline = true
	case "strike":
		attrs.Strike = true
	case "wrap":
		attrs.Wrap = true
	case "merge":
		attrs.Merge = true
	}
}

func parseAttrs(tokens []string) StyleAttrs {
	var attrs StyleAttrs
	for _, tok := range tokens {
		if tok == "" {
			continue
		}
		eq := strings.IndexByte(tok, '=')
		if eq < 0 {
			if isFlag(tok) {
				setFlag(&attrs, tok)
			}
			continue
		}
		key := tok[:eq]
		value := tok[eq+1:]
		if !isKey(key) {
			continue
		}
		setAttr(&attrs, key, value)
	}
	return attrs
}

// formatAttrs deterministically serializes attributes: flags in fixed order,
// then keyed attrs in fixed order.
func formatAttrs(attrs StyleAttrs) string {
	var out []string
	if attrs.Bold {
		out = append(out, "bold")
	}
	if attrs.Italic {
		out = append(out, "italic")
	}
	if attrs.Underline {
		out = append(out, "underline")
	}
	if attrs.Strike {
		out = append(out, "strike")
	}
	if attrs.Wrap {
		out = append(out, "wrap")
	}
	if attrs.Merge {
		out = append(out, "merge")
	}
	if attrs.Fill != "" {
		out = append(out, "fill="+attrs.Fill)
	}
	if attrs.Color != "" {
		out = append(out, "color="+attrs.Color)
	}
	if attrs.Align != "" {
		out = append(out, "align="+attrs.Align)
	}
	if attrs.Valign != "" {
		out = append(out, "valign="+attrs.Valign)
	}
	if attrs.Format != "" {
		out = append(out, "format="+attrs.Format)
	}
	if attrs.Border != "" {
		out = append(out, "border="+attrs.Border)
	}
	if attrs.Font != "" {
		out = append(out, "font="+attrs.Font)
	}
	if attrs.Size != nil {
		out = append(out, "size="+jsNum(*attrs.Size))
	}
	if attrs.Width != nil {
		out = append(out, "width="+jsNum(*attrs.Width))
	}
	return strings.Join(out, " ")
}

// parsedStyleBlock holds everything parsed out of a defter-style block body.
type parsedStyleBlock struct {
	Rules        []StyleRule
	Charts       []ChartSpec
	Conditionals []CondRule
	Validations  []ValidationRule
	Checkboxes   []CheckboxRule
	Dates        []DateRule
	Names        []NamedRange
	Freeze       FreezeSpec // {0,0} when the block declares no freeze
	HasFreeze    bool       // true if a valid freeze line was seen (last wins)
}

var freezePrefixRe = regexp.MustCompile(`(?i)^freeze\b`)
var freezeRowsRe = regexp.MustCompile(`(?i)\brows\s*=\s*(\d+)`)
var freezeColsRe = regexp.MustCompile(`(?i)\bcols\s*=\s*(\d+)`)

// parseFreezeLine parses `freeze rows=N cols=M`. Both parts optional; ok=false
// when neither resolves to a positive count.
func parseFreezeLine(line string) (FreezeSpec, bool) {
	var f FreezeSpec
	if m := freezeRowsRe.FindStringSubmatch(line); m != nil {
		f.Rows, _ = strconv.Atoi(m[1])
	}
	if m := freezeColsRe.FindStringSubmatch(line); m != nil {
		f.Cols, _ = strconv.Atoi(m[1])
	}
	if f.Rows <= 0 && f.Cols <= 0 {
		return FreezeSpec{}, false
	}
	return f, true
}

// serializeFreeze renders a freeze directive to its canonical line (omit an axis that is 0).
func serializeFreeze(f FreezeSpec) string {
	out := "freeze"
	if f.Rows > 0 {
		out += " rows=" + strconv.Itoa(f.Rows)
	}
	if f.Cols > 0 {
		out += " cols=" + strconv.Itoa(f.Cols)
	}
	return out
}

var nameLineRe = regexp.MustCompile(`(?i)^name\s+([A-Za-z_]\w*)\s*=\s*(\S+)`)
var validateLineRe = regexp.MustCompile(`^(\S+)\s+list=(.+)$`)
var condOpRe = regexp.MustCompile(`(>=|<=|<>|>|<|=)`)
var wsRe = regexp.MustCompile(`\s+`)

func parseNameLine(line string) (NamedRange, bool) {
	m := nameLineRe.FindStringSubmatch(line)
	if m == nil {
		return NamedRange{}, false
	}
	rng, err := parseRange(m[2])
	if err != nil {
		return NamedRange{}, false
	}
	return NamedRange{Name: m[1], Range: rng}, true
}

func parseValidateLine(line string) (ValidationRule, bool) {
	rest := strings.TrimSpace(line[9:]) // drop "validate "
	m := validateLineRe.FindStringSubmatch(rest)
	if m == nil {
		return ValidationRule{}, false
	}
	target, err := parseStyleTarget(m[1])
	if err != nil {
		return ValidationRule{}, false
	}
	var list []string
	for _, s := range strings.Split(m[2], ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			list = append(list, s)
		}
	}
	if len(list) == 0 {
		return ValidationRule{}, false
	}
	return ValidationRule{Target: target, List: list}, true
}

func parseCondLine(line string) (CondRule, bool) {
	rest := strings.TrimSpace(line[5:]) // drop "when "
	loc := condOpRe.FindStringIndex(rest)
	if loc == nil {
		return CondRule{}, false
	}
	op := rest[loc[0]:loc[1]]
	targetText := strings.TrimSpace(rest[:loc[0]])
	afterOp := strings.TrimSpace(rest[loc[1]:])

	var value CondValue
	var attrsStr string
	if strings.HasPrefix(afterOp, `"`) {
		end := strings.IndexByte(afterOp[1:], '"')
		if end < 0 {
			return CondRule{}, false
		}
		end++ // adjust for the offset slice
		value = CondValue{IsNum: false, Str: afterOp[1:end]}
		attrsStr = strings.TrimSpace(afterOp[end+1:])
	} else {
		sp := indexOfWhitespace(afterOp)
		var valueTok string
		if sp < 0 {
			valueTok = afterOp
			attrsStr = ""
		} else {
			valueTok = afterOp[:sp]
			attrsStr = strings.TrimSpace(afterOp[sp:])
		}
		if n, ok := jsNumberStrict(valueTok); ok && valueTok != "" {
			value = CondValue{IsNum: true, Num: n}
		} else {
			value = CondValue{IsNum: false, Str: valueTok}
		}
	}

	target, err := parseStyleTarget(targetText)
	if err != nil {
		return CondRule{}, false
	}
	attrs := parseAttrs(splitWS(attrsStr))
	if attrs.count() == 0 {
		return CondRule{}, false
	}
	return CondRule{Target: target, Op: op, Value: value, Attrs: attrs}, true
}

// parseStyleBlock parses a whole defter-style block body (without the fences).
// Lenient: unparseable lines are skipped.
func parseStyleBlock(body string) parsedStyleBlock {
	var out parsedStyleBlock
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		low := strings.ToLower(line)
		switch {
		case freezePrefixRe.MatchString(line):
			if f, ok := parseFreezeLine(line); ok {
				out.Freeze = f // last wins
				out.HasFreeze = true
			}
			continue
		case strings.HasPrefix(low, "name "):
			if nr, ok := parseNameLine(line); ok {
				out.Names = append(out.Names, nr)
			}
			continue
		case strings.HasPrefix(low, "when "):
			if c, ok := parseCondLine(line); ok {
				out.Conditionals = append(out.Conditionals, c)
			}
			continue
		case strings.HasPrefix(low, "validate "):
			if v, ok := parseValidateLine(line); ok {
				out.Validations = append(out.Validations, v)
			}
			continue
		case strings.HasPrefix(low, "checkbox "):
			if t, err := parseStyleTarget(strings.TrimSpace(line[len("checkbox "):])); err == nil {
				out.Checkboxes = append(out.Checkboxes, CheckboxRule{Target: t})
			}
			continue
		case strings.HasPrefix(low, "date "):
			if t, err := parseStyleTarget(strings.TrimSpace(line[len("date "):])); err == nil {
				out.Dates = append(out.Dates, DateRule{Target: t})
			}
			continue
		case strings.HasPrefix(low, "chart ") || low == "chart":
			if ch, ok := parseChartLine(line); ok {
				out.Charts = append(out.Charts, ch)
			}
			continue
		}
		parts := splitWS(line)
		target, err := parseStyleTarget(parts[0])
		if err != nil {
			continue // skip a rule with an unparseable target rather than failing
		}
		attrs := parseAttrs(parts[1:])
		if attrs.count() > 0 {
			out.Rules = append(out.Rules, StyleRule{Target: target, Attrs: attrs})
		}
	}
	return out
}

var chartAttrRe = regexp.MustCompile(`(\w+)=(?:"([^"]*)"|(\S+))`)

func parseChartLine(line string) (ChartSpec, bool) {
	low := strings.ToLower(line)
	idx := strings.Index(low, "chart")
	rest := line[idx+5:]
	kv := map[string]string{}
	for _, m := range chartAttrRe.FindAllStringSubmatch(rest, -1) {
		val := m[2]
		if val == "" {
			val = m[3]
		}
		kv[strings.ToLower(m[1])] = val
	}
	typ := kv["type"]
	if typ == "" {
		typ = "bar"
	}
	if typ != "bar" && typ != "line" && typ != "pie" && typ != "area" {
		return ChartSpec{}, false
	}
	yRaw := kv["y"]
	if yRaw == "" {
		yRaw = kv["values"]
	}
	if yRaw == "" {
		return ChartSpec{}, false
	}
	spec := ChartSpec{Type: typ}
	if t := kv["title"]; t != "" {
		spec.Title = t
		spec.HasTitle = true
	}
	if x := kv["x"]; x != "" {
		rng, err := parseRange(x)
		if err != nil {
			return ChartSpec{}, false
		}
		spec.Labels = rng
		spec.HasLabels = true
	}
	for _, r := range strings.Split(yRaw, ",") {
		rng, err := parseRange(strings.TrimSpace(r))
		if err != nil {
			return ChartSpec{}, false
		}
		spec.Values = append(spec.Values, rng)
	}
	return spec, true
}

// serializeStyleBlock renders rules, names, conditionals, validations, and
// charts to a block body (without fences), in that fixed order.
func serializeStyleBlock(rules []StyleRule, charts []ChartSpec, conds []CondRule, vals []ValidationRule, checkboxes []CheckboxRule, dates []DateRule, names []NamedRange, freeze FreezeSpec) string {
	var lines []string
	if freeze.isSet() {
		lines = append(lines, serializeFreeze(freeze))
	}
	for _, r := range rules {
		lines = append(lines, formatStyleTarget(r.Target)+"  "+formatAttrs(r.Attrs))
	}
	for _, nr := range names {
		lines = append(lines, "name "+nr.Name+" = "+formatRange(nr.Range))
	}
	for _, c := range conds {
		var v string
		if c.Value.IsNum {
			v = jsNum(c.Value.Num)
		} else {
			v = `"` + c.Value.Str + `"`
		}
		lines = append(lines, "when "+formatStyleTarget(c.Target)+" "+c.Op+" "+v+"  "+formatAttrs(c.Attrs))
	}
	for _, val := range vals {
		lines = append(lines, "validate "+formatStyleTarget(val.Target)+" list="+strings.Join(val.List, ","))
	}
	for _, cb := range checkboxes {
		lines = append(lines, "checkbox "+formatStyleTarget(cb.Target))
	}
	for _, d := range dates {
		lines = append(lines, "date "+formatStyleTarget(d.Target))
	}
	for _, ch := range charts {
		lines = append(lines, serializeChart(ch))
	}
	return strings.Join(lines, "\n")
}

func serializeChart(ch ChartSpec) string {
	parts := []string{"chart type=" + ch.Type}
	if ch.HasTitle && ch.Title != "" {
		parts = append(parts, `title="`+ch.Title+`"`)
	}
	if ch.HasLabels {
		parts = append(parts, "x="+formatRange(ch.Labels))
	}
	var ys []string
	for _, r := range ch.Values {
		ys = append(ys, formatRange(r))
	}
	parts = append(parts, "y="+strings.Join(ys, ","))
	return strings.Join(parts, " ")
}

// --- numeric helpers matching JS coercion semantics -------------------------

var floatPrefixRe = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?`)

// jsParseFloat mimics JavaScript's Number.parseFloat: it parses the leading
// numeric prefix of a (possibly-trailing-garbage) string.
func jsParseFloat(s string) (float64, bool) {
	t := strings.TrimLeft(s, " \t\n\r\f\v")
	m := floatPrefixRe.FindString(t)
	if m == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(m, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// jsNumberStrict mimics JavaScript's Number(x): the whole (trimmed) string must
// be a valid number. Returns ok=false for NaN-producing input.
func jsNumberStrict(s string) (float64, bool) {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0, true // Number("") === 0
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// jsNum stringifies a float the way JavaScript's Number.prototype.toString does
// for the value range Defter uses (sizes, widths, small comparison values):
// integers print without a decimal point, others use the shortest round-trip.
func jsNum(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

func indexOfWhitespace(s string) int {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			return i
		}
	}
	return -1
}

// splitWS splits on runs of whitespace, dropping empty fields (like
// `s.split(/\s+/).filter(Boolean)` after a trim).
func splitWS(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return wsRe.Split(s, -1)
}
