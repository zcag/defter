/** Resolve a chart's label/value ranges into plain arrays using a computed grid. */

import type { ComputedGrid } from './compute.js'
import { cellsInRange } from './coords.js'
import { formatValue } from './format.js'
import type { ChartSpec } from './model.js'
import { type Locale, toNumber } from './values.js'

export interface ChartData {
  labels: string[]
  values: number[]
}

export function resolveChartData(
  sheetName: string,
  chart: ChartSpec,
  computed: ComputedGrid,
  locale?: Locale,
): ChartData {
  const valSheet = chart.values.sheet ?? sheetName
  const values: number[] = []
  for (const { col, row } of cellsInRange(chart.values)) {
    values.push(toNumber(computed.get(valSheet, col, row)) ?? 0)
  }
  const labels: string[] = []
  if (chart.labels) {
    const labSheet = chart.labels.sheet ?? sheetName
    for (const { col, row } of cellsInRange(chart.labels)) {
      labels.push(formatValue(computed.get(labSheet, col, row), { locale }))
    }
  }
  while (labels.length < values.length) labels.push(String(labels.length + 1))
  return { labels, values }
}
