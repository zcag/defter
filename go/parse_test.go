package defterparse

import "testing"

// Mirrors packages/core/src/roundtrip.test.ts coordinate + escaping assertions.

const workedExample = `## Sheet: Budget

| Item | Qty | Unit | Total |
| --- | --- | --- | --- |
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| **Total** |  |  | =SUM(D2:D3) |

` + "```defter-style\nA1:D1  bold fill=surface-2 align=center\nC2:D4  format=#,##0.00\n```\n"

func TestParseWorkedExampleCoords(t *testing.T) {
	m := Parse(workedExample)
	s := m.Sheets[0]
	if s.Name != "Budget" {
		t.Errorf("name = %q", s.Name)
	}
	if GetCell(s, 0, 1) != "Item" {
		t.Errorf("A1 = %q", GetCell(s, 0, 1))
	}
	if GetCell(s, 0, 2) != "Widget" {
		t.Errorf("A2 = %q", GetCell(s, 0, 2))
	}
	if GetCell(s, 3, 2) != "=B2*C2" {
		t.Errorf("D2 = %q", GetCell(s, 3, 2))
	}
	if GetCell(s, 3, 4) != "=SUM(D2:D3)" {
		t.Errorf("D4 = %q", GetCell(s, 3, 4))
	}
	if len(s.Styles) != 2 {
		t.Errorf("styles = %d", len(s.Styles))
	}
}

func TestBareTableIsSheet1(t *testing.T) {
	m := Parse("| a | b |\n| --- | --- |\n| 1 | 2 |\n")
	if len(m.Sheets) != 1 {
		t.Fatalf("sheets = %d", len(m.Sheets))
	}
	if m.Sheets[0].Name != "Sheet1" {
		t.Errorf("name = %q", m.Sheets[0].Name)
	}
	if m.Sheets[0].Headed {
		t.Error("bare table should not be headed")
	}
	if GetCell(m.Sheets[0], 1, 2) != "2" {
		t.Errorf("B2 = %q", GetCell(m.Sheets[0], 1, 2))
	}
}

func TestEscapedPipesAndAlign(t *testing.T) {
	m := Parse("| a | b |\n| :-- | --: |\n| x \\| y | 2 |\n")
	if GetCell(m.Sheets[0], 0, 2) != "x | y" {
		t.Errorf("A2 = %q", GetCell(m.Sheets[0], 0, 2))
	}
	if m.Sheets[0].ColAlign[0] != AlignLeft || m.Sheets[0].ColAlign[1] != AlignRight {
		t.Errorf("colAlign = %v", m.Sheets[0].ColAlign)
	}
}

func TestMultiSheetNames(t *testing.T) {
	src := "## Sheet: One\n\n| a |\n| --- |\n| 1 |\n\n## Sheet: Two\n\n| b |\n| --- |\n| 2 |\n"
	m := Parse(src)
	if len(m.Sheets) != 2 || m.Sheets[0].Name != "One" || m.Sheets[1].Name != "Two" {
		t.Fatalf("sheets = %v", m.Sheets)
	}
	// Already-canonical multi-sheet text round-trips to identity.
	if got := Serialize(m); got != src {
		t.Errorf("round-trip identity failed:\n%q", got)
	}
}

func TestEscapeRoundTrip(t *testing.T) {
	for _, s := range []string{"plain", "a | b", `back\slash`, "multi\nline", `mix \| and \\`} {
		if got := unescapeCell(escapeCell(s)); got != s {
			t.Errorf("escape round-trip %q -> %q", s, got)
		}
	}
}
