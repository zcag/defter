/**
 * Value typing: the stored cell text is culture-invariant text; typing happens at read time.
 * A cell is a number, boolean, date, text, or (elsewhere) a formula. Display formatting is a
 * separate concern (see format.ts) driven by the presentation layer's `format=` attribute.
 */

export interface CellError {
  error: string
}
/** A computed/typed cell value. `null` is an empty cell. */
export type CellValue = number | string | boolean | CellError | null

export function isError(v: CellValue): v is CellError {
  return typeof v === 'object' && v !== null && 'error' in v
}

export const ERR = {
  ref: { error: '#REF!' } as CellError,
  div0: { error: '#DIV/0!' } as CellError,
  name: { error: '#NAME?' } as CellError,
  value: { error: '#VALUE!' } as CellError,
  cycle: { error: '#CYCLE!' } as CellError,
  na: { error: '#N/A' } as CellError,
  num: { error: '#NUM!' } as CellError,
}

export interface Locale {
  decimal: string
  group: string
}
export const LOCALE_EN: Locale = { decimal: '.', group: ',' }
export const LOCALE_TR: Locale = { decimal: ',', group: '.' }

/**
 * Type a raw literal cell string (never a formula — the caller strips `=` cells first).
 * Numbers are parsed leniently for the given locale; ISO-ish dates stay text for now.
 */
export function parseLiteral(text: string, locale: Locale = LOCALE_EN): CellValue {
  const t = text.trim()
  if (t === '') return null
  const upper = t.toUpperCase()
  if (upper === 'TRUE') return true
  if (upper === 'FALSE') return false
  const n = parseNumber(t, locale)
  if (n !== null) return n
  return text
}

/** Parse a number in a locale, tolerating grouping separators, a leading sign, `%` and currency. */
export function parseNumber(text: string, locale: Locale = LOCALE_EN): number | null {
  let s = text.trim()
  if (s === '') return null
  let percent = false
  if (s.endsWith('%')) {
    percent = true
    s = s.slice(0, -1).trim()
  }
  // Strip a single leading currency symbol.
  s = s.replace(/^[$€£₺¥]\s?/, '')
  const group = escapeRe(locale.group)
  const dec = escapeRe(locale.decimal)
  if (!new RegExp(`^[-+]?(?:\\d|${group})*(?:${dec}\\d+)?$`).test(s) || !/\d/.test(s)) return null
  const normalized = s.split(locale.group).join('').split(locale.decimal).join('.')
  const n = Number(normalized)
  if (Number.isNaN(n)) return null
  return percent ? n / 100 : n
}

function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Coerce a value to a number for arithmetic; returns null when it can't. */
export function toNumber(v: CellValue): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null) return 0
  if (typeof v === 'string') return parseNumber(v)
  return null
}
