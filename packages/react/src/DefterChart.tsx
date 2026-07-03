import type { ChartSpec } from '@defter/core'
import type { CSSProperties } from 'react'

export interface DefterChartProps {
  type: ChartSpec['type']
  title?: string
  labels: string[]
  /** One array of numbers per series. */
  series: number[][]
  /** Optional series names for the legend. */
  seriesNames?: string[]
  width?: number
  height?: number
  theme?: string
  className?: string
  style?: CSSProperties
}

const PALETTE = [
  'var(--defter-token-accent)',
  'var(--defter-token-success)',
  'var(--defter-token-warning)',
  'var(--defter-token-danger)',
  'var(--defter-token-muted)',
  'var(--defter-token-accent-soft)',
]

/** A small, dependency-free, CSS-variable-themed SVG chart (bar / line / area / pie, multi-series). */
export function DefterChart(props: DefterChartProps): React.JSX.Element {
  const { type, title, labels, series, width = 420, height = 260, theme } = props
  const multi = series.length > 1
  const pad = { top: title ? 34 : 16, right: 16, bottom: multi ? 44 : 34, left: 40 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom
  const all = series.flat()
  const max = Math.max(0, ...all)
  const min = Math.min(0, ...all)
  const span = max - min || 1
  const y = (v: number) => pad.top + h - ((v - min) / span) * h
  const n = Math.max(1, ...series.map((s) => s.length))

  return (
    <div className={`defter-chart${props.className ? ` ${props.className}` : ''}`} data-defter-theme={theme} style={props.style}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title ?? 'chart'}>
        {title && (
          <text x={pad.left} y={20} className="defter-chart__title">
            {title}
          </text>
        )}
        {type !== 'pie' && (
          <>
            <line x1={pad.left} y1={y(0)} x2={pad.left + w} y2={y(0)} className="defter-chart__axis" />
            {labels.slice(0, n).map((label, i) => (
              <text key={i} x={pad.left + (w / n) * (i + 0.5)} y={height - (multi ? 26 : 12)} className="defter-chart__label" textAnchor="middle">
                {label}
              </text>
            ))}
          </>
        )}

        {type === 'bar' &&
          series.map((s, si) =>
            s.map((v, i) => {
              const groupW = (w / n) * 0.72
              const barW = groupW / series.length
              const gx = pad.left + (w / n) * (i + 0.5) - groupW / 2 + si * barW
              const top = y(Math.max(0, v))
              const bot = y(Math.min(0, v))
              return <rect key={`${si}-${i}`} x={gx} y={top} width={Math.max(1, barW - 1)} height={Math.max(1, bot - top)} rx={2} fill={PALETTE[si % PALETTE.length]} />
            }),
          )}

        {(type === 'line' || type === 'area') &&
          series.map((s, si) => (
            <g key={si}>
              {type === 'area' && (
                <path
                  d={`M ${pad.left + w / n / 2} ${y(0)} ${s.map((v, i) => `L ${pad.left + (w / n) * (i + 0.5)} ${y(v)}`).join(' ')} L ${pad.left + (w / n) * (s.length - 0.5)} ${y(0)} Z`}
                  fill={PALETTE[si % PALETTE.length]}
                  opacity={0.16}
                />
              )}
              <polyline points={s.map((v, i) => `${pad.left + (w / n) * (i + 0.5)},${y(v)}`).join(' ')} fill="none" stroke={PALETTE[si % PALETTE.length]} strokeWidth={2} />
              {s.map((v, i) => (
                <circle key={i} cx={pad.left + (w / n) * (i + 0.5)} cy={y(v)} r={3} fill={PALETTE[si % PALETTE.length]} />
              ))}
            </g>
          ))}

        {type === 'pie' && <Pie values={series[0] ?? []} labels={labels} cx={width / 2} cy={pad.top + h / 2} r={Math.min(w, h) / 2} />}

        {multi && type !== 'pie' && (
          <g>
            {series.map((_, si) => (
              <g key={si} transform={`translate(${pad.left + si * 90}, ${height - 10})`}>
                <rect width={10} height={10} y={-9} rx={2} fill={PALETTE[si % PALETTE.length]} />
                <text x={14} className="defter-chart__label">
                  {props.seriesNames?.[si] || `Series ${si + 1}`}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  )
}

function Pie({ values, labels, cx, cy, r }: { values: number[]; labels: string[]; cx: number; cy: number; r: number }) {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
  let angle = -Math.PI / 2
  return (
    <>
      {values.map((v, i) => {
        const frac = Math.max(0, v) / total
        const start = angle
        const end = angle + frac * Math.PI * 2
        angle = end
        const large = frac > 0.5 ? 1 : 0
        const x1 = cx + r * Math.cos(start)
        const y1 = cy + r * Math.sin(start)
        const x2 = cx + r * Math.cos(end)
        const y2 = cy + r * Math.sin(end)
        return (
          <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={PALETTE[i % PALETTE.length]}>
            <title>{`${labels[i] ?? i}: ${v}`}</title>
          </path>
        )
      })}
    </>
  )
}
