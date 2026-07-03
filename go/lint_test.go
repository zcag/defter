package defterparse

import (
	"strings"
	"testing"
)

func hasMsg(issues []Issue, substr string) bool {
	for _, is := range issues {
		if strings.Contains(is.Message, substr) {
			return true
		}
	}
	return false
}

func TestLintCleanSheet(t *testing.T) {
	text := `## Sheet: S

| a | b |
| --- | ---: |
| 1 | 2 |

` + "```defter-style\nA1:B1  bold\n```\n"
	if issues := Lint(Parse(text)); len(issues) != 0 {
		t.Errorf("clean sheet should have no issues, got %+v", issues)
	}
}

func TestLintDuplicateSheetNames(t *testing.T) {
	text := "## Sheet: Data\n\n| a |\n| --- |\n| 1 |\n\n## Sheet: Data\n\n| b |\n| --- |\n| 2 |\n"
	if !hasMsg(Lint(Parse(text)), "duplicate sheet name") {
		t.Error("expected duplicate sheet name issue")
	}
}

func TestLintEmptySheet(t *testing.T) {
	text := "## Sheet: Empty\n\n| header |\n| --- |\n"
	if !hasMsg(Lint(Parse(text)), "empty") {
		t.Error("expected empty sheet issue")
	}
}

func TestLintOutOfBoundsRange(t *testing.T) {
	// Chart references column Z, far outside a 2-column sheet.
	text := "## Sheet: S\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n" +
		"```defter-style\nchart type=bar x=A2:A2 y=Z2:Z2\n```\n"
	if !hasMsg(Lint(Parse(text)), "outside the sheet") {
		t.Errorf("expected out-of-bounds chart range issue, got %+v", Lint(Parse(text)))
	}
}

func TestLintUnknownSheetRef(t *testing.T) {
	text := "## Sheet: S\n\n| a |\n| --- |\n| 1 |\n\n```defter-style\nname R = Ghost!A1:A2\n```\n"
	if !hasMsg(Lint(Parse(text)), "unknown sheet") {
		t.Errorf("expected unknown-sheet issue, got %+v", Lint(Parse(text)))
	}
}

func TestLintTextMalformedStyleLines(t *testing.T) {
	text := "## Sheet: S\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n" +
		"```defter-style\n" +
		"A1:B1  bold bogus=1\n" + // unknown attribute key
		"@@@   bold\n" + // bad target syntax
		"when B2 !! 0  bold\n" + // malformed conditional (no valid op)
		"validate B2\n" + // malformed validation (no list=)
		"chart type=donut y=A1\n" + // malformed chart (unknown type)
		"A1  frobnicate\n" + // unknown flag, no recognized attrs
		"```\n"
	issues := LintText(text)
	for _, want := range []string{
		"unknown attribute key 'bogus'",
		"bad target syntax",
		"malformed conditional",
		"malformed validation",
		"malformed chart",
		"unknown flag 'frobnicate'",
	} {
		if !hasMsg(issues, want) {
			t.Errorf("LintText missing %q; got %+v", want, issues)
		}
	}
}

func TestLintTextCleanHasNoStyleIssues(t *testing.T) {
	// Every sample fixture's canonical form must lint clean at the text layer.
	for id, text := range readFixtures(t) {
		if id == "duplicate-sheet-names" || id == "empty" || id == "whitespace-only" {
			continue // these intentionally trip model-level checks
		}
		norm := Normalize(text)
		for _, is := range lintStyleText(norm) {
			t.Errorf("%s: canonical form has style-line issue: %+v", id, is)
		}
	}
}
