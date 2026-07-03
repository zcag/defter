/**
 * IronCalc-wasm adapter — an alternative `FormulaEngine` backed by the mature IronCalc Rust engine
 * (300+ functions, real dependency graph). This exists to prove Defter's pluggable-engine seam: the
 * default `@defter/formula` and this share one interface. The wasm module must be initialized once
 * before use — call `initIronCalc(source)` (browser: a wasm URL; Node: pass bytes to `initSync`).
 */

import {
  type CellValue,
  type ComputedGrid,
  ERR,
  type FormulaEngine,
  type Model as DefterModel,
  parseLiteral,
} from '@defter/core'
import initWasm, { Model, initSync } from '@ironcalc/wasm'

const ERROR_STRINGS = new Set([
  '#DIV/0!',
  '#REF!',
  '#VALUE!',
  '#NAME?',
  '#N/A',
  '#NUM!',
  '#NULL!',
  '#ERROR!',
  '#SPILL!',
  '#CALC!',
  '#CIRC!',
])

let ready = false

/** Initialize the wasm module (browser). Pass a URL/Response/module; awaits instantiation. */
export async function initIronCalc(source?: Parameters<typeof initWasm>[0]): Promise<void> {
  await initWasm(source)
  ready = true
}

/** Initialize synchronously from wasm bytes (Node / bundled). */
export function initIronCalcSync(bytes: BufferSource): void {
  initSync({ module: bytes })
  ready = true
}

export function isIronCalcReady(): boolean {
  return ready
}

/** Create a Defter `FormulaEngine` backed by IronCalc. Requires the wasm to be initialized first. */
export function createIronCalcEngine(): FormulaEngine {
  return {
    compute(model: DefterModel): ComputedGrid {
      if (!ready) throw new Error('IronCalc wasm not initialized — call initIronCalc() first')
      const wb = new Model('defter', 'en', 'UTC', 'en')
      const nameToIndex = new Map<string, number>()

      model.sheets.forEach((sheet, si) => {
        if (si > 0) wb.newSheet()
        wb.renameSheet(si, sheet.name)
        nameToIndex.set(sheet.name.toLowerCase(), si)
        for (let r = 0; r < sheet.grid.length; r++) {
          const rowCells = sheet.grid[r]!
          for (let c = 0; c < sheet.width; c++) {
            const raw = rowCells[c] ?? ''
            if (raw !== '') wb.setUserInput(si, r + 1, c + 1, raw) // IronCalc is 1-based on both axes
          }
        }
      })
      wb.evaluate()

      return {
        get(sheetName: string, col: number, row: number): CellValue {
          const si = nameToIndex.get(sheetName.toLowerCase())
          if (si === undefined) return ERR.ref
          const s = wb.getFormattedCellValue(si, row, col + 1)
          if (s === '') return null
          if (ERROR_STRINGS.has(s)) return { error: s }
          return parseLiteral(s)
        },
      }
    },
  }
}
