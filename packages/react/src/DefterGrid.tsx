import {
  type ComputedGrid,
  type FormulaEngine,
  type Locale,
  type Model,
  columnLabel,
  formatValue,
  getCell,
  isError,
  parse,
  parseLiteral,
  resolveStyles,
  serialize,
  setCell,
} from '@defter/core'
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { styleToCss } from './styleToCss.js'

export interface DefterGridProps {
  /** Canonical Defter text. The grid is a projection of it. */
  text: string
  /** Called with new canonical text when the user edits a cell. Omit for a read-only grid. */
  onChange?: (text: string) => void
  /** Injected formula engine. Without it, formula cells show their source. */
  engine?: FormulaEngine
  /** Built-in theme, or any custom `data-defter-theme` value the host defines in CSS. */
  theme?: 'light' | 'dark' | 'paper' | (string & {})
  sheetIndex?: number
  locale?: Locale
  /** Show formula sources instead of computed values. */
  showFormulas?: boolean
  /** Blank rows/columns rendered past the content extent, for a spreadsheet feel. */
  extraRows?: number
  extraCols?: number
  readOnly?: boolean
  className?: string
  style?: CSSProperties
}

interface Pos {
  col: number
  row: number
}

export function DefterGrid(props: DefterGridProps): React.JSX.Element {
  const {
    text,
    onChange,
    engine,
    theme = 'light',
    sheetIndex = 0,
    locale,
    showFormulas = false,
    extraRows = 6,
    extraCols = 3,
    readOnly = false,
  } = props

  const model = useMemo<Model>(() => parse(text), [text])
  const computed = useMemo<ComputedGrid | null>(() => (engine ? engine.compute(model) : null), [engine, model])
  const sheet = model.sheets[sheetIndex] ?? model.sheets[0]!
  const styles = useMemo(() => resolveStyles(sheet), [sheet])

  const contentRows = sheet.grid.length
  const totalRows = contentRows + extraRows
  const totalCols = sheet.width + extraCols
  const editable = Boolean(onChange) && !readOnly

  const [active, setActive] = useState<Pos>({ col: 0, row: 2 })
  const [editing, setEditing] = useState<{ col: number; row: number; value: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const rawAt = useCallback((col: number, row: number) => getCell(sheet, col, row), [sheet])

  const commit = useCallback(
    (col: number, row: number, value: string, move?: Pos) => {
      if (onChange) onChange(serialize(setCell(model, sheetIndex, col, row, value)))
      setEditing(null)
      if (move) setActive(move)
      rootRef.current?.focus()
    },
    [model, onChange, sheetIndex],
  )

  const beginEdit = useCallback(
    (col: number, row: number, initial?: string) => {
      if (!editable) return
      setEditing({ col, row, value: initial ?? rawAt(col, row) })
    },
    [editable, rawAt],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (editing) return
      const { col, row } = active
      const clampCol = (c: number) => Math.max(0, Math.min(totalCols - 1, c))
      const clampRow = (r: number) => Math.max(1, Math.min(totalRows, r))
      switch (e.key) {
        case 'ArrowUp':
          setActive({ col, row: clampRow(row - 1) })
          e.preventDefault()
          break
        case 'ArrowDown':
        case 'Enter':
          setActive({ col, row: clampRow(row + 1) })
          e.preventDefault()
          break
        case 'ArrowLeft':
          setActive({ col: clampCol(col - 1), row })
          e.preventDefault()
          break
        case 'ArrowRight':
        case 'Tab':
          setActive({ col: clampCol(col + 1), row })
          e.preventDefault()
          break
        case 'Backspace':
        case 'Delete':
          if (editable) commit(col, row, '')
          e.preventDefault()
          break
        case 'F2':
          beginEdit(col, row)
          e.preventDefault()
          break
        default:
          if (editable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            beginEdit(col, row, e.key)
            e.preventDefault()
          }
      }
    },
    [active, editing, totalCols, totalRows, editable, commit, beginEdit],
  )

  return (
    <div
      ref={rootRef}
      className={`defter${props.className ? ` ${props.className}` : ''}`}
      data-defter-theme={theme}
      style={props.style}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <table className="defter__grid">
        <colgroup>
          <col style={{ width: 'var(--defter-head-width)' }} />
          {Array.from({ length: totalCols }, (_, c) => (
            <col key={c} style={{ width: 'var(--defter-col-width)' }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="defter__corner" />
            {Array.from({ length: totalCols }, (_, c) => (
              <th
                key={c}
                className={`defter__colhead${active.col === c ? ' defter__colhead--active' : ''}`}
              >
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: totalRows }, (_, ri) => {
            const row = ri + 1
            return (
              <tr key={row}>
                <th
                  className={`defter__rowhead${active.row === row ? ' defter__rowhead--active' : ''}`}
                >
                  {row}
                </th>
                {Array.from({ length: totalCols }, (_, col) => {
                  if (styles.isCovered(col, row)) return null
                  const span = styles.mergeAnchor(col, row)
                  return (
                    <Cell
                      key={col}
                      col={col}
                      row={row}
                      sheet={sheet}
                      styles={styles}
                      computed={computed}
                      sheetName={sheet.name}
                      locale={locale}
                      showFormulas={showFormulas}
                      colAlign={sheet.colAlign[col] ?? null}
                      active={active.col === col && active.row === row}
                      colSpan={span?.colspan}
                      rowSpan={span?.rowspan}
                      editing={editing?.col === col && editing?.row === row ? editing.value : null}
                      inputRef={inputRef}
                      onSelect={() => setActive({ col, row })}
                      onBeginEdit={() => beginEdit(col, row)}
                      onEditChange={(v) => setEditing({ col, row, value: v })}
                      onCommit={(v, dir) =>
                        commit(col, row, v, dir === 'down' ? { col, row: row + 1 } : { col: col + 1, row })
                      }
                      onCancel={() => setEditing(null)}
                    />
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface CellProps {
  col: number
  row: number
  sheet: Model['sheets'][number]
  styles: ReturnType<typeof resolveStyles>
  computed: ComputedGrid | null
  sheetName: string
  locale?: Locale
  showFormulas: boolean
  colAlign: 'left' | 'center' | 'right' | null
  active: boolean
  colSpan?: number
  rowSpan?: number
  editing: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: () => void
  onBeginEdit: () => void
  onEditChange: (v: string) => void
  onCommit: (v: string, dir: 'down' | 'right') => void
  onCancel: () => void
}

function Cell(p: CellProps): React.JSX.Element {
  const attrs = p.styles.attrs(p.col, p.row)
  const raw = getCell(p.sheet, p.col, p.row)
  const isFormula = raw.trim().startsWith('=')

  let display = ''
  let numeric = false
  let error = false
  if (p.showFormulas && isFormula) {
    display = raw
  } else if (isFormula) {
    const v = p.computed ? p.computed.get(p.sheetName, p.col, p.row) : null
    display = p.computed ? formatValue(v, { format: attrs.format, locale: p.locale }) : raw
    numeric = typeof v === 'number'
    error = isError(v)
  } else {
    const v = parseLiteral(raw, p.locale)
    numeric = typeof v === 'number'
    display = attrs.format && numeric ? formatValue(v, { format: attrs.format, locale: p.locale }) : raw
  }

  const cls = [
    'defter__cell',
    numeric && !attrs.align ? 'defter__cell--number' : '',
    attrs.wrap ? 'defter__cell--wrap' : '',
    error ? 'defter__cell--error' : '',
    p.showFormulas && isFormula ? 'defter__cell--formula-src' : '',
    p.active ? 'defter__cell--selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const css = styleToCss(attrs)
  if (!attrs.align && p.colAlign) css.textAlign = p.colAlign

  return (
    <td
      className={cls}
      style={css}
      colSpan={p.colSpan}
      rowSpan={p.rowSpan}
      onMouseDown={p.onSelect}
      onDoubleClick={p.onBeginEdit}
    >
      {p.editing !== null ? (
        <input
          ref={p.inputRef}
          className="defter__editor"
          value={p.editing}
          onChange={(e) => p.onEditChange(e.target.value)}
          onBlur={() => p.onCommit(p.editing ?? '', 'down')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              p.onCommit(p.editing ?? '', 'down')
              e.preventDefault()
            } else if (e.key === 'Tab') {
              p.onCommit(p.editing ?? '', 'right')
              e.preventDefault()
            } else if (e.key === 'Escape') {
              p.onCancel()
              e.preventDefault()
            }
            e.stopPropagation()
          }}
        />
      ) : (
        display
      )}
    </td>
  )
}
