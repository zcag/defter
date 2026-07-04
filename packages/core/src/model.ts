/**
 * The in-memory model. This is the *ephemeral projection* of the text — parse produces it,
 * serialize turns it back into byte-stable text. Cell text is stored in its **logical** form
 * (real `|` and newline characters, not the `\|` / `\n` escapes used in the serialized form).
 */

import type { Range } from './coords.js'

export interface Model {
  sheets: Sheet[]
}

export interface Sheet {
  name: string
  /**
   * Row-major grid of raw cell text. `grid[0]` is the header (A1 row 1); `grid[r]` is A1
   * row `r + 1`. Formula cells keep their leading `=`. All rows are padded to `width`.
   */
  grid: string[][]
  width: number
  /** Per-column alignment from the GFM delimiter row (native, content-layer). `null` = default. */
  colAlign: (('left' | 'center' | 'right') | null)[]
  styles: StyleRule[]
  /** Charts declared in the `defter-style` block, referencing ranges in this sheet. */
  charts: ChartSpec[]
  /** Conditional formatting rules (`when <range> <op> <value>  <attrs>`). */
  conditionals: CondRule[]
  /** Data-validation dropdowns (`validate <range> list=A,B,C`). */
  validations: ValidationRule[]
  /** Checkbox cells (`checkbox <range>`) — rendered as a toggle over a TRUE/FALSE value. */
  checkboxes: CheckboxRule[]
  /** Named ranges (`name Revenue = D2:D10`) — usable in formulas from any sheet. */
  names: NamedRange[]
  /**
   * Frozen panes: keep the first `rows` rows and/or first `cols` columns pinned while scrolling.
   * `0` on an axis means no freeze there; absent entirely means the sheet declares no freeze.
   * Encoded in the `defter-style` block as `freeze rows=N cols=M`.
   */
  freeze?: { rows: number; cols: number }
  /** Whether the sheet was introduced by an explicit `## Sheet:` heading. */
  headed: boolean
}

export interface NamedRange {
  name: string
  range: Range
}

export interface ValidationRule {
  target: StyleTarget
  list: string[]
}

export interface CheckboxRule {
  target: StyleTarget
}

export type CondOp = '>' | '<' | '>=' | '<=' | '=' | '<>'

export interface CondRule {
  target: StyleTarget
  op: CondOp
  value: number | string
  attrs: StyleAttrs
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'area'
  title?: string
  /** Range of category labels (x axis). */
  labels?: Range
  /** One or more value series (each a range). `y=B2:B5,C2:C5` gives two series. */
  values: Range[]
}

export interface StyleRule {
  target: StyleTarget
  attrs: StyleAttrs
}

export type StyleTarget =
  | { kind: 'range'; range: Range }
  | { kind: 'cols'; start: number; end: number }
  | { kind: 'rows'; start: number; end: number }

export interface StyleAttrs {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  wrap?: boolean
  merge?: boolean
  fill?: string
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  format?: string
  border?: string
  font?: string
  size?: number
  /** Column width in px. Only meaningful on a `cols` target; persists resize in the text layer. */
  width?: number
}

export function emptyModel(): Model {
  return { sheets: [] }
}

export function emptySheet(name: string, headed = true): Sheet {
  return {
    name,
    grid: [[]],
    width: 0,
    colAlign: [],
    styles: [],
    charts: [],
    conditionals: [],
    validations: [],
    checkboxes: [],
    names: [],
    headed,
  }
}

/** Read a cell's logical text by A1 (col 0-based, row 1-based). Empty string if out of range. */
export function getCell(sheet: Sheet, col: number, row: number): string {
  return sheet.grid[row - 1]?.[col] ?? ''
}

/** Deep clone a model. The model is plain JSON-safe data (strings, numbers, booleans, arrays). */
export function cloneModel(model: Model): Model {
  return JSON.parse(JSON.stringify(model)) as Model
}
