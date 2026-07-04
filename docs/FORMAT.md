# The Defter text format

Defter's source of truth is **plain UTF-8 text**, line-oriented, designed so ordinary
text machinery — git, a text CRDT (Yjs `Y.Text`), file-sync, full-text search — operates
on it directly. This document is the normative spec. Everything else in `@defterjs/core`
implements it.

## Design invariants (why the format looks the way it does)

1. **One row = one line.** A row is exactly one `\n`-terminated line. Inserting/deleting a
   row is a whole-line insert/delete, which a line/char CRDT merges cleanly and which never
   touches neighbouring rows.
2. **Compact, never padded.** Cells are *not* aligned with padding spaces. Alignment is a
   render-time concern only. Padding would make one cell's width change rewrite every other
   row of the column — the opposite of a minimal splice, and a conflict magnet under a CRDT.
   (This is the one place we deliberately diverge from org-mode / GitHub's pretty tables.)
3. **Content and presentation are separate layers.** The markdown table carries *content*
   (labels, values, formulas). Everything text can't express — fills, number formats, merges,
   borders, conditional formatting, charts, frozen panes — lives in a separate `defter-style`
   block, keyed by A1 range. Absent that block you still have a valid plain markdown table.
4. **The document degrades gracefully.** An unaware markdown pipeline (GitHub, a wiki, WebDAV
   sync, a zip export) renders the content tables as tables and shows the style block as an
   inert fenced code block. Nothing is lost on round-trip.

## Document structure

A Defter document is a markdown document containing one or more **sheets**. Each sheet is:

- an `## Sheet: <name>` heading (H2), then
- a compact GFM table (the content grid), then
- an optional fenced ` ```defter-style ` block (the presentation layer for that sheet).

```markdown
## Sheet: Budget

| Item | Qty | Unit | Total |
|---|---|---|---|
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| **Total** |  |  | =SUM(D2:D3) |

```defter-style
A1:D1  bold fill=surface-2 align=center
C2:D4  format=#,##0.00
D5  bold
```

## Sheet: Q2
...
```

A single-sheet document may omit the `## Sheet:` heading entirely — a bare markdown table is
a valid one-sheet Defter document named `Sheet1`. This is the zero-lock-in degenerate case.

## Coordinates (A1 ↔ table position)

Load-bearing convention, defined once:

- **Columns** are letters: `A`, `B`, … `Z`, `AA`, `AB`, … (base-26 bijective).
- **Rows** are 1-based. **Row 1 is the header row** (the first `|…|` line).
- **The delimiter row (`|---|---|`) does NOT consume a row number.** It sits between row 1 and
  row 2 in the text but is invisible to the coordinate space.
- The first data row is **row 2**. So in the example, `Widget` is `A2`, its total formula is
  `D2`, and `=SUM(D2:D3)` sums the two data rows.

Mapping text line → row number, for a sheet whose table starts at line `L0`:

| line     | meaning        | row number |
|----------|----------------|------------|
| `L0`     | header         | 1          |
| `L0 + 1` | delimiter      | — (none)   |
| `L0 + 2` | first data row | 2          |
| `L0 + k` | data row       | `k`        |

A **reference** is `A1` (relative), `$A$1` / `A$1` / `$A1` (absolute parts), or
`Sheet2!A1` (cross-sheet). A **range** is `A1:B4`. These appear in formulas and as the keys
of `defter-style` rules; reference-rewriting on structural edits updates all of them.

## Cell content

A cell is the text between two pipes on a row line, trimmed of surrounding spaces.

- A cell whose trimmed text starts with `=` is a **formula**. Its computed value is derived at
  read time and **never stored**. The text keeps the formula.
- Any other cell is a **literal**: a number, date, boolean, or text (typed at read time; see
  `docs/VALUES.md`). Inline markdown (`**bold**`, `` `code` ``, links) is allowed and rendered.
- **Escaping.** A literal `|` inside a cell is written `\|`. A literal backslash is `\\`.
  Newlines are not permitted inside a cell in the canonical form; a multi-line value is encoded
  as `\n` (backslash-n) and rendered as a line break. This keeps *one row = one line* absolute.

## The `defter-style` block

A fenced block with info-string `defter-style`, one rule per line:

```
<target>  <attr> <attr> ...
```

- `<target>` is a cell `A1`, a range `A1:B4`, a whole column `C:C`, or a whole row `4:4`.
- Attributes are space-separated `key=value` or bare flags. Bare flags: `bold`, `italic`,
  `underline`, `strike`, `wrap`, `merge`. Key/value: `fill=<token|#hex>`, `color=<token|#hex>`,
  `align=left|center|right`, `valign=top|middle|bottom`, `format=<number-format>`,
  `border=<spec>`, `font=<token>`, `size=<n>`, `width=<px>` (on a `cols` target).
- Later rules override earlier ones for overlapping targets (last-wins per attribute).
- `fill`/`color` values are preferentially **theme tokens** (e.g. `surface-2`, `accent`) so a
  host theme can restyle without touching the document; raw `#hex` is allowed as an escape hatch.

The block also carries two data-driven constructs, keyed by A1 range like everything else:

- **Conditional formatting** — `when <range> <op> <value>  <attrs>` applies the attributes to
  each cell whose *computed* value satisfies the condition (ops `> < >= <= = <>`; value a number
  or `"text"`). Example: `when D2:D9 < 0  color=danger bold`.
- **Charts** — `chart type=bar|line|area|pie title="…" x=<labels-range> y=<values-range>`. One per
  line. The chart follows the data referenced by its ranges.
- **Data validation** — `validate <range> list=A,B,C` makes those cells dropdowns restricted to
  the listed options.
- **Checkbox cells** — `checkbox <range>` renders those cells as a toggle over a `TRUE`/`FALSE` value.
- **Date cells** — `date <range>` renders a calendar picker over an ISO `YYYY-MM-DD` value.
- **Named ranges** — `name <Name> = <range>` defines a name usable in formulas from any sheet
  (`=SUM(Revenue)`).
- **Frozen panes** — `freeze rows=N cols=M` pins the first `N` rows and/or first `M` columns as
  sticky panes while scrolling. Both parts are optional (`freeze rows=1`, `freeze cols=1`, and
  `freeze rows=1 cols=1` are all valid) and at most one `freeze` line is meaningful per sheet (last
  wins). Unlike the constructs above it is **not** keyed by A1 — it is sheet-level metadata (counts
  from the top-left), so it is not reference-rewritten on insert/delete. Because it travels in the
  document text, a frozen sheet stays frozen across export, sync, and collaboration rather than being
  a runtime-only view setting. `@defterjs/core` exposes `setFreeze(text, { rows?, cols? }, sheetIndex?)`
  to add/update/remove it as a minimal text edit (both axes 0/omitted removes the line).

Because the first four are keyed by A1, they are subject to the same reference rewriting as formulas
(insert/delete a row or column and their targets shift; a fully-deleted range drops the rule). `freeze`
is the exception noted above — it carries plain counts, not references.

## Round-trip guarantee

`parse` is **lenient** (tolerates ragged rows, loose whitespace, missing delimiter, agent
sloppiness) and normalizes. `serialize` is **byte-stable** (a given model always produces
identical bytes). The invariant tested is **idempotence**, not identity:

```
serialize(parse(t)) === serialize(parse(serialize(parse(t))))
```

i.e. one normalization pass reaches a fixed point. Round-tripping already-normalized text is
the identity.
