# Authoring Defter sheets — the agent contract

This is the complete contract for an LLM (or any program) to **generate** a Defter spreadsheet
from scratch and **edit** an existing one. It is intentionally small. If you can write a markdown
table, you can write Defter.

## 1. A sheet is a markdown document

```markdown
## Sheet: <name>

| Header A | Header B | Header C |
| --- | --- | --- |
| value | value | =FORMULA |
| ... | ... | ... |

```defter-style
<style rules — optional; see §5>
```
```

- Start each sheet with `## Sheet: <name>`. A single-sheet document may omit the heading (a bare
  table is a valid sheet named `Sheet1`).
- The first table row is the **header** (A1 row 1). The `|---|` delimiter row is required and does
  **not** count as a row. The first data row is **row 2**.
- Keep it compact: one row per line, one space around each cell. Don't hand-align columns with
  extra spaces — Defter stores compact and aligns at render time.

## 2. Coordinates

- Columns are letters `A, B, C … Z, AA, AB…`. Rows are 1-based; **row 1 is the header**, data
  starts at **row 2**.
- Reference a cell `B2`, a range `B2:D5`, another sheet `Sales!B2`, or an absolute `$B$2`.

## 3. Values

Write plain values: `42`, `3.14`, `2026-07-03`, `TRUE`, `hello`. Numbers are typed automatically.
Cells may contain inline markdown (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`).
Escape a literal pipe inside a cell as `\|`.

## 4. Formulas

A cell starting with `=` is a formula. Computed values are derived at read time and never stored —
you always write the formula, never the number.

Operators: `+ - * / ^`, `&` (concat), comparisons `= <> < > <= >=`, `%` (postfix), unary `-`.

Functions (case-insensitive):

```
SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT MEDIAN LARGE SMALL RANK
SUMIF COUNTIF AVERAGEIF SUMIFS COUNTIFS
IF IFS IFERROR SWITCH AND OR NOT
VLOOKUP HLOOKUP XLOOKUP INDEX MATCH
ISNUMBER ISTEXT ISLOGICAL ISBLANK ISERROR ISNA N VALUE
ROUND ROUNDUP ROUNDDOWN ABS SQRT INT TRUNC POWER MOD
CONCAT CONCATENATE LEN UPPER LOWER PROPER TRIM LEFT RIGHT MID FIND SUBSTITUTE REPT TEXT
DATE YEAR MONTH DAY WEEKDAY DATEDIF
```

`SUMIF`/`COUNTIF` criteria support `>`/`<`/`>=`/`<=`/`<>` and `*`/`?` wildcards.

Dates are ISO strings (`2026-07-03`). `DATEDIF(start, end, "D"|"M"|"Y")` gives the
difference; `DATE(y, m, d)` builds one (overflow normalizes).

Examples: `=B2*C2`, `=SUM(D2:D9)`, `=IF(D2>=0,"under","over")`, `=SUM(Sales!D2:D4)`,
`=ROUND(B2/C2, 2)`.

## 5. Make it look good — the `defter-style` block

Append a fenced ` ```defter-style ` block per sheet. One rule per line: a target, then attributes.

```
A1:D1   bold fill=surface-3 align=center     # header band
D2:D9   format=$#,##0.00                       # currency column
A9:D9   bold border=top fill=accent-soft       # total row
B2:B9   align=right
```

- **Targets:** a cell `A1`, a range `A1:D9`, a whole column `C:C`, or whole rows `2:9`.
- **Flags:** `bold italic underline strike wrap merge`.
- **Key=value:** `fill=<token>` `color=<token>` `align=left|center|right` `valign=top|middle|bottom`
  `format=<number-format>` `border=all|top|right|bottom|left` `width=<px>` `size=<px>`.
- **Number formats:** `#,##0` (grouped), `0.00` (decimals), `0%` (percent), `$#,##0.00` (currency).
- **Prefer theme tokens** for colors so the host theme restyles cleanly:
  `surface-1 surface-2 surface-3 accent accent-soft success success-soft warning warning-soft
  danger danger-soft muted`. A raw `#hex` also works but won't follow the theme.
- **Merged cells:** `merge` on a range keeps the range rectangular in the text (covered cells stay
  empty) and displays merged: `A1:D1 merge bold align=center`.
- **Named ranges:** `name Revenue = D2:D10` defines a name usable in formulas from any sheet —
  `=SUM(Revenue)`. The definition follows the data on insert/delete.
- **Data validation:** `validate <range> list=Todo,Doing,Done` turns those cells into dropdowns
  restricted to the listed options.
- **Conditional formatting:** `when <range> <op> <value>  <attrs>` applies the attributes to
  each cell in the range whose computed value satisfies the condition — e.g.
  `when D2:D9 < 0  color=danger bold` or `when B2:B9 >= 100  fill=success-soft`
  (ops: `> < >= <= = <>`; value is a number or `"text"`). They follow the data.
- **Charts** are declared in the same block, one per line, referencing ranges:
  `chart type=bar title="Revenue" x=A2:A4 y=D2:D4` (types: `bar`, `line`, `area`, `pie`; `x` is
  the label range, `y` the values). They follow the data — insert/delete a row and the chart's
  ranges shift automatically.

### A good-looking template (copy this shape)

```markdown
## Sheet: Invoice

| Item | Qty | Unit | Total |
| --- | ---: | ---: | ---: |
| Design audit | 12 | 140 | =B2*C2 |
| Build | 34 | 120 | =B3*C3 |
| Subtotal |  |  | =SUM(D2:D3) |
| Tax (20%) |  |  | =D4*0.2 |
| **Total due** |  |  | =D4+D5 |

```defter-style
A1:D1   bold fill=surface-3 align=center
D2:D6   format=$#,##0.00
A4:A6   bold
A6:D6   bold border=top fill=accent-soft
```
```

## 6. Editing an existing sheet (do NOT rewrite the whole body)

When a sheet is live and collaborative, replacing the entire document clobbers concurrent edits.
Use the **structured operations** the host exposes (these map to `@defterjs/core`):

- `setCell(sheet, col, row, text)` — set one cell (text or `=formula`).
- `insertRows / deleteRows / insertCols / deleteCols` — structural edits; Defter rewrites all
  affected references (formulas *and* style targets) automatically.
- `setStyle(target, attrs)` / `setColumnWidth(col, px)` — presentation.
- `addSheet / renameSheet / deleteSheet`.

Generating a brand-new sheet from scratch? Then just emit the full markdown document from §1.
Editing an existing one? Prefer the ops above.

## 7. Reading a sheet (search / RAG / “what does it say”)

Ask the host for the **projection**, not the raw body: it materializes computed values and strips
styling, giving clean text (`projectText`) or one self-describing line per row (`projectProse`).
The raw body has formulas, not answers; the projection has the numbers.
