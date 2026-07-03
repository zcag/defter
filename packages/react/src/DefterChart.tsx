import type { ChartSpec } from '@defter/core'
import type { CSSProperties } from 'react'

export interface DefterChartProps {
  type: ChartSpec['type']
  title?: string
  labels: string[]
  values: number[]
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

/** A small, dependency-free, CSS-variable-themed SVG chart (bar / line / area / pie). */
export function DefterChart(props: DefterChartProps): React.JSX.Element {
  const { type, title, labels, values, width = 420, height = 260, theme } = props
  const pad = { top: title ? 34 : 16, right: 16, bottom: 34, left: 40 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const y = (v: number) => pad.top + h - ((v - min) / span) * h
  const n = values.length

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
            {values.map((v, i) => {
              const cx = pad.left + (w / n) * (i + 0.5)
              return (
                <text key={i} x={cx} y={height - 12} className="defter-chart__label" textAnchor="middle">
                  {labels[i] ?? ''}
                </text>
              )
            })}
          </>
        )}

        {type === 'bar' &&
          values.map((v, i) => {
            const bw = (w / n) * 0.62
            const cx = pad.left + (w / n) * (i + 0.5)
            const top = y(Math.max(0, v))
            const bot = y(Math.min(0, v))
            return (
              <rect
                key={i}
                x={cx - bw / 2}
                y={top}
                width={bw}
                height={Math.max(1, bot - top)}
                rx={3}
                fill={PALETTE[0]}
              />
            )
          })}

        {(type === 'line' || type === 'area') && (
          <>
            {type === 'area' && (
              <path
                d={`M ${pad.left + w / n / 2} ${y(0)} ${values
                  .map((v, i) => `L ${pad.left + (w / n) * (i + 0.5)} ${y(v)}`)
                  .join(' ')} L ${pad.left + (w / n) * (n - 0.5)} ${y(0)} Z`}
                fill={PALETTE[0]}
                opacity={0.16}
              />
            )}
            <polyline
              points={values.map((v, i) => `${pad.left + (w / n) * (i + 0.5)},${y(v)}`).join(' ')}
              fill="none"
              stroke={PALETTE[0]}
              strokeWidth={2}
            />
            {values.map((v, i) => (
              <circle key={i} cx={pad.left + (w / n) * (i + 0.5)} cy={y(v)} r={3} fill={PALETTE[0]} />
            ))}
          </>
        )}

        {type === 'pie' && <Pie values={values} labels={labels} cx={width / 2} cy={pad.top + h / 2} r={Math.min(w, h) / 2} />}
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
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={PALETTE[i % PALETTE.length]}
          >
            <title>{`${labels[i] ?? i}: ${v}`}</title>
          </path>
        )
      })}
    </>
  )
}
