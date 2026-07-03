/** Resolve a chart's label/value ranges into plain arrays using a computed grid. */

import type { ComputedGrid } from './compute.js'
import { cellsInRange } from './coords.js'
import { formatValue } from './format.js'
import type { ChartSpec } from './model.js'
import { type Locale, toNumber } from './values.js'

export interface ChartData {
  labels: string[]
  /** One array of numbers per series. */
  series: number[][]
  /** Series names, inferred from the header cell above each range. */
  seriesNames: string[]
}

export function resolveChartData(
  sheetName: string,
  chart: ChartSpec,
  computed: ComputedGrid,
  locale?: Locale,
): ChartData {
  const series = chart.values.map((range) => {
    const valSheet = range.sheet ?? sheetName
    const out: number[] = []
    for (const { col, row } of cellsInRange(range)) out.push(toNumber(computed.get(valSheet, col, row)) ?? 0)
    return out
  })
  const maxLen = Math.max(0, ...series.map((s) => s.length))
  const labels: string[] = []
  if (chart.labels) {
    const labSheet = chart.labels.sheet ?? sheetName
    for (const { col, row } of cellsInRange(chart.labels)) {
      labels.push(formatValue(computed.get(labSheet, col, row), { locale }))
    }
  }
  while (labels.length < maxLen) labels.push(String(labels.length + 1))
  const seriesNames = chart.values.map((range) => {
    const s = range.sheet ?? sheetName
    const headerRow = range.start.row - 1
    return headerRow >= 1 ? formatValue(computed.get(s, range.start.col, headerRow), { locale }) : ''
  })
  return { labels, series, seriesNames }
}
