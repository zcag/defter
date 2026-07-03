/**
 * Display formatting. A compact subset of Excel number-format codes, applied at render time to a
 * computed value. Supports: percent (`%`), thousands grouping (`#,##0`), fixed decimals (`0.00`),
 * a leading/trailing currency or literal, and plain passthrough. Locale controls separators.
 */

import { type CellValue, type Locale, LOCALE_EN, isError } from './values.js'

export interface FormatOptions {
  format?: string
  locale?: Locale
}

/** Format a computed value for display. Errors and text pass through; numbers use `format`. */
export function formatValue(value: CellValue, opts: FormatOptions = {}): string {
  if (value === null) return ''
  if (isError(value)) return value.error
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return value
  return formatNumber(value, opts.format, opts.locale ?? LOCALE_EN)
}

export function formatNumber(n: number, format: string | undefined, locale: Locale): string {
  if (!Number.isFinite(n)) return String(n)
  if (!format) return defaultNumber(n, locale)

  // Excel format sections: positive;negative;zero. A negative section carries its own sign
  // notation (e.g. parentheses). `[Red]`/`[Color]` tokens are stripped (color is the renderer's job).
  const sections = format.split(';')
  const usesNegSection = n < 0 && sections[1] !== undefined
  let fmt = usesNegSection
    ? sections[1]!
    : n === 0 && sections[2] !== undefined
      ? sections[2]!
      : sections[0]!
  fmt = fmt.replace(/\[[^\]]*\]/g, '')

  const percent = fmt.includes('%')
  let x = percent ? n * 100 : n

  const m = /([^#0.,]*)([#0.,]+)([^#0.,]*)/.exec(fmt.replace('%', ''))
  const prefix = m?.[1] ?? ''
  const skeleton = m?.[2] ?? '0'
  const suffix = (m?.[3] ?? '') + (percent ? '%' : '')

  const grouped = skeleton.includes(',')
  const dot = skeleton.indexOf('.')
  const decimals = dot >= 0 ? skeleton.length - dot - 1 : 0

  const neg = x < 0 && !usesNegSection
  x = Math.abs(x)
  let body = decimals > 0 ? x.toFixed(decimals) : Math.round(x).toString()
  if (grouped) body = groupThousands(body, locale)
  else body = body.split('.').join(locale.decimal)

  return `${neg ? '-' : ''}${prefix}${body}${suffix}`
}

function defaultNumber(n: number, locale: Locale): string {
  const s = Number.isInteger(n) ? n.toString() : n.toString()
  return s.split('.').join(locale.decimal)
}

function groupThousands(numText: string, locale: Locale): string {
  const [intPart, fracPart] = numText.split('.')
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, locale.group)
  return fracPart !== undefined ? `${grouped}${locale.decimal}${fracPart}` : grouped
}
