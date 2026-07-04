/**
 * The `defter-style` presentation layer: parse/serialize of style rules and their A1 targets.
 * One rule per line: `<target>  <attr> <attr> ...`. See docs/FORMAT.md.
 */

import { columnIndex, columnLabel, formatRange, parseRange } from './coords.js'
import type {
  ChartSpec,
  CondOp,
  CondRule,
  NamedRange,
  StyleAttrs,
  StyleRule,
  StyleTarget,
  ValidationRule,
} from './model.js'

const FLAGS = ['bold', 'italic', 'underline', 'strike', 'wrap', 'merge'] as const
const KEYS = [
  'fill',
  'color',
  'align',
  'valign',
  'format',
  'border',
  'font',
  'size',
  'width',
] as const

const NUMERIC_KEYS = new Set(['size', 'width'])

export function parseStyleTarget(text: string): StyleTarget {
  const t = text.trim()
  if (/^[A-Za-z]+:[A-Za-z]+$/.test(t)) {
    const [a, b] = t.split(':')
    return { kind: 'cols', start: columnIndex(a!), end: columnIndex(b!) }
  }
  if (/^\d+:\d+$/.test(t)) {
    const [a, b] = t.split(':')
    return { kind: 'rows', start: Number.parseInt(a!, 10), end: Number.parseInt(b!, 10) }
  }
  return { kind: 'range', range: parseRange(t) }
}

export function formatStyleTarget(target: StyleTarget): string {
  switch (target.kind) {
    case 'cols':
      return `${columnLabel(target.start)}:${columnLabel(target.end)}`
    case 'rows':
      return `${target.start}:${target.end}`
    case 'range':
      return formatRange(target.range)
  }
}

function parseAttrs(tokens: string[]): StyleAttrs {
  const attrs: StyleAttrs = {}
  for (const tok of tokens) {
    if (!tok) continue
    const eq = tok.indexOf('=')
    if (eq < 0) {
      if ((FLAGS as readonly string[]).includes(tok)) {
        ;(attrs as Record<string, unknown>)[tok] = true
      }
      continue
    }
    const key = tok.slice(0, eq)
    const value = tok.slice(eq + 1)
    if (!(KEYS as readonly string[]).includes(key)) continue
    if (NUMERIC_KEYS.has(key)) {
      const n = Number.parseFloat(value)
      if (!Number.isNaN(n)) (attrs as Record<string, unknown>)[key] = n
    } else {
      ;(attrs as Record<string, unknown>)[key] = value
    }
  }
  return attrs
}

/** Deterministic attribute serialization: flags in fixed order, then keyed attrs in fixed order. */
export function formatAttrs(attrs: StyleAttrs): string {
  const out: string[] = []
  for (const flag of FLAGS) {
    if ((attrs as Record<string, unknown>)[flag]) out.push(flag)
  }
  for (const key of KEYS) {
    const v = (attrs as Record<string, unknown>)[key]
    if (v !== undefined && v !== null && v !== '') out.push(`${key}=${v}`)
  }
  return out.join(' ')
}

export interface ParsedStyleBlock {
  rules: StyleRule[]
  charts: ChartSpec[]
  conditionals: CondRule[]
  validations: ValidationRule[]
  names: NamedRange[]
  /** Frozen-pane directive (`freeze rows=N cols=M`), if the block declared one (last wins). */
  freeze?: { rows: number; cols: number }
}

const FREEZE_ROWS_RE = /\brows\s*=\s*(\d+)/i
const FREEZE_COLS_RE = /\bcols\s*=\s*(\d+)/i

/** Parse a `freeze rows=N cols=M` line. Both parts optional; returns null if neither is set (>0). */
function parseFreezeLine(line: string): { rows: number; cols: number } | null {
  const rm = FREEZE_ROWS_RE.exec(line)
  const cm = FREEZE_COLS_RE.exec(line)
  const rows = rm ? Number.parseInt(rm[1]!, 10) : 0
  const cols = cm ? Number.parseInt(cm[1]!, 10) : 0
  if (rows <= 0 && cols <= 0) return null
  return { rows, cols }
}

/** Serialize a freeze directive to its canonical line (omit an axis that is 0). */
export function serializeFreeze(freeze: { rows: number; cols: number }): string {
  let out = 'freeze'
  if (freeze.rows > 0) out += ` rows=${freeze.rows}`
  if (freeze.cols > 0) out += ` cols=${freeze.cols}`
  return out
}

function parseNameLine(line: string): NamedRange | null {
  const m = /^name\s+([A-Za-z_]\w*)\s*=\s*(\S+)/i.exec(line)
  if (!m) return null
  try {
    return { name: m[1]!, range: parseRange(m[2]!) }
  } catch {
    return null
  }
}

function parseValidateLine(line: string): ValidationRule | null {
  // validate <target> list=A,B,C
  const rest = line.slice(9).trim() // drop "validate "
  const m = /^(\S+)\s+list=(.+)$/.exec(rest)
  if (!m) return null
  let target: StyleTarget
  try {
    target = parseStyleTarget(m[1]!)
  } catch {
    return null
  }
  const list = m[2]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? { target, list } : null
}

function parseCondLine(line: string): CondRule | null {
  // when <target> <op> <value>  <attr> <attr> ...
  const rest = line.slice(5).trim() // drop "when "
  const opMatch = /(>=|<=|<>|>|<|=)/.exec(rest)
  if (!opMatch) return null
  const targetText = rest.slice(0, opMatch.index).trim()
  const afterOp = rest.slice(opMatch.index + opMatch[0].length).trim()
  // Value may be a quoted (possibly multi-word) string or a bare token; the rest is attributes.
  let value: number | string
  let attrsStr: string
  if (afterOp.startsWith('"')) {
    const end = afterOp.indexOf('"', 1)
    if (end < 0) return null
    value = afterOp.slice(1, end)
    attrsStr = afterOp.slice(end + 1).trim()
  } else {
    const sp = afterOp.search(/\s/)
    const valueTok = sp < 0 ? afterOp : afterOp.slice(0, sp)
    attrsStr = sp < 0 ? '' : afterOp.slice(sp).trim()
    const num = Number(valueTok)
    value = valueTok !== '' && !Number.isNaN(num) ? num : valueTok
  }
  let target: StyleTarget
  try {
    target = parseStyleTarget(targetText)
  } catch {
    return null
  }
  const attrs = parseAttrs(attrsStr.split(/\s+/).filter(Boolean))
  if (Object.keys(attrs).length === 0) return null
  return { target, op: opMatch[0] as CondOp, value, attrs }
}

/** Parse a whole `defter-style` block body (without the fences). Lenient. */
export function parseStyleBlock(body: string): ParsedStyleBlock {
  const rules: StyleRule[] = []
  const charts: ChartSpec[] = []
  const conditionals: CondRule[] = []
  const validations: ValidationRule[] = []
  const names: NamedRange[] = []
  let freeze: { rows: number; cols: number } | undefined
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^freeze\b/i.test(line)) {
      const f = parseFreezeLine(line)
      if (f) freeze = f // last wins
      continue
    }
    if (line.toLowerCase().startsWith('name ')) {
      const nr = parseNameLine(line)
      if (nr) names.push(nr)
      continue
    }
    if (line.toLowerCase().startsWith('when ')) {
      const cond = parseCondLine(line)
      if (cond) conditionals.push(cond)
      continue
    }
    if (line.toLowerCase().startsWith('validate ')) {
      const val = parseValidateLine(line)
      if (val) validations.push(val)
      continue
    }
    if (line.toLowerCase().startsWith('chart ') || line.toLowerCase() === 'chart') {
      const chart = parseChartLine(line)
      if (chart) charts.push(chart)
      continue
    }
    const parts = line.split(/\s+/)
    const targetText = parts[0]!
    let target: StyleTarget
    try {
      target = parseStyleTarget(targetText)
    } catch {
      continue // skip a rule with an unparseable target rather than throwing
    }
    const attrs = parseAttrs(parts.slice(1))
    if (Object.keys(attrs).length > 0) rules.push({ target, attrs })
  }
  return { rules, charts, conditionals, validations, names, freeze }
}

const CHART_ATTR = /(\w+)=(?:"([^"]*)"|(\S+))/g

function parseChartLine(line: string): ChartSpec | null {
  const rest = line.slice(line.toLowerCase().indexOf('chart') + 5)
  const kv: Record<string, string> = {}
  for (const m of rest.matchAll(CHART_ATTR)) kv[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? ''
  const type = (kv.type ?? 'bar') as ChartSpec['type']
  if (!['bar', 'line', 'pie', 'area'].includes(type)) return null
  const yRaw = kv.y ?? kv.values
  if (!yRaw) return null
  try {
    return {
      type,
      title: kv.title || undefined,
      labels: kv.x ? parseRange(kv.x) : undefined,
      values: yRaw.split(',').map((r) => parseRange(r.trim())),
    }
  } catch {
    return null
  }
}

/** Serialize rules, conditionals, and charts to a block body (without fences). */
export function serializeStyleBlock(
  rules: StyleRule[],
  charts: ChartSpec[] = [],
  conditionals: CondRule[] = [],
  validations: ValidationRule[] = [],
  names: NamedRange[] = [],
  freeze?: { rows: number; cols: number },
): string {
  const lines: string[] = []
  if (freeze && (freeze.rows > 0 || freeze.cols > 0)) lines.push(serializeFreeze(freeze))
  for (const r of rules) lines.push(`${formatStyleTarget(r.target)}  ${formatAttrs(r.attrs)}`)
  for (const nr of names) lines.push(`name ${nr.name} = ${formatRange(nr.range)}`)
  for (const cond of conditionals) {
    const v = typeof cond.value === 'number' ? cond.value : `"${cond.value}"`
    lines.push(`when ${formatStyleTarget(cond.target)} ${cond.op} ${v}  ${formatAttrs(cond.attrs)}`)
  }
  for (const val of validations) {
    lines.push(`validate ${formatStyleTarget(val.target)} list=${val.list.join(',')}`)
  }
  for (const ch of charts) lines.push(serializeChart(ch))
  return lines.join('\n')
}

function serializeChart(ch: ChartSpec): string {
  const parts = [`chart type=${ch.type}`]
  if (ch.title) parts.push(`title="${ch.title}"`)
  if (ch.labels) parts.push(`x=${formatRange(ch.labels)}`)
  parts.push(`y=${ch.values.map(formatRange).join(',')}`)
  return parts.join(' ')
}
