/**
 * The formula-engine seam. `@defterjs/core` defines the interface; a concrete engine (the default
 * `@defterjs/formula`, or an IronCalc-wasm adapter) is injected. Values are computed on read and
 * never stored back into the model.
 */

import type { Model } from './model.js'
import type { CellValue } from './values.js'

/** A lazily-computed view over a model's values. Coordinates are A1 (col 0-based, row 1-based). */
export interface ComputedGrid {
  get(sheet: string, col: number, row: number): CellValue
}

export interface FormulaEngine {
  compute(model: Model): ComputedGrid
}
