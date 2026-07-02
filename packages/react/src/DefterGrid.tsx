import {
  type CellValue,
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
  toNumber,
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
import { renderInline } from './inline.js'
import { styleToCss } from './styleToCss.js'

export interface DefterGridProps {
  /** Canonical Defter text. The grid is a projection of it. */
  text: string
  /** Called with new canonical text when the user edits. Omit for a read-only grid. */
  onChange?: (text: string) => void
  /** Injected formula engine. Without it, formula cells show their source. */
  engine?: FormulaEngine
  /** Built-in theme, or any custom `data-defter-theme` value the host defines in CSS. */
  theme?: 'light' | 'dark' | 'paper' | (string & {})
  sheetIndex?: number
  locale?: Locale
  showFormulas?: boolean
  /** Show the formula/content bar above the grid. */
  formulaBar?: boolean
  /** Show the selection status bar (sum/avg/count) below the grid. */
  statusBar?: boolean
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
interface Rect {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
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
    formulaBar = false,
    statusBar = false,
    extraRows = 6,
    extraCols = 3,
    readOnly = false,
  } = props

  const model = useMemo<Model>(() => parse(text), [text])
  const computed = useMemo<ComputedGrid | null>(() => (engine ? engine.compute(model) : null), [engine, model])
  const sheet = model.sheets[sheetIndex] ?? model.sheets[0]!
  const styles = useMemo(() => resolveStyles(sheet), [sheet])

  const totalRows = sheet.grid.length + extraRows
  const totalCols = sheet.width + extraCols
  const editable = Boolean(onChange) && !readOnly

  const [sel, setSel] = useState<{ anchor: Pos; focus: Pos }>({
    anchor: { col: 0, row: 2 },
    focus: { col: 0, row: 2 },
  })
  const [editing, setEditing] = useState<{ col: number; row: number; value: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const rect: Rect = useMemo(() => {
    const { anchor, focus } = sel
    return {
      minCol: Math.min(anchor.col, focus.col),
      maxCol: Math.max(anchor.col, focus.col),
      minRow: Math.min(anchor.row, focus.row),
      maxRow: Math.max(anchor.row, focus.row),
    }
  }, [sel])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    const up = () => {
      dragging.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const rawAt = useCallback((col: number, row: number) => getCell(sheet, col, row), [sheet])

  const valueAt = useCallback(
    (col: number, row: number): CellValue => {
      const raw = rawAt(col, row)
      if (raw.trim().startsWith('=')) return computed ? computed.get(sheet.name, col, row) : raw
      return parseLiteral(raw, locale)
    },
    [rawAt, computed, sheet.name, locale],
  )

  const commit = useCallback(
    (col: number, row: number, value: string, move?: Pos) => {
      if (onChange) onChange(serialize(setCell(model, sheetIndex, col, row, value)))
      setEditing(null)
      if (move) setSel({ anchor: move, focus: move })
      rootRef.current?.focus()
    },
    [model, onChange, sheetIndex],
  )

  const commitMany = useCallback(
    (writes: { col: number; row: number; value: string }[]) => {
      if (!onChange || writes.length === 0) return
      let m = model
      for (const w of writes) m = setCell(m, sheetIndex, w.col, w.row, w.value)
      onChange(serialize(m))
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

  const clampCol = (c: number) => Math.max(0, Math.min(totalCols - 1, c))
  const clampRow = (r: number) => Math.max(1, Math.min(totalRows, r))

  const moveFocus = useCallback(
    (dcol: number, drow: number, extend: boolean) => {
      setSel((s) => {
        const focus = { col: clampCol(s.focus.col + dcol), row: clampRow(s.focus.row + drow) }
        return { anchor: extend ? s.anchor : focus, focus }
      })
    },
    [totalCols, totalRows],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (editing) return
      const { col, row } = sel.focus
      const shift = e.shiftKey
      switch (e.key) {
        case 'ArrowUp':
          moveFocus(0, -1, shift)
          e.preventDefault()
          break
        case 'ArrowDown':
          moveFocus(0, 1, shift)
          e.preventDefault()
          break
        case 'Enter':
          moveFocus(0, 1, false)
          e.preventDefault()
          break
        case 'ArrowLeft':
          moveFocus(-1, 0, shift)
          e.preventDefault()
          break
        case 'ArrowRight':
        case 'Tab':
          moveFocus(1, 0, false)
          e.preventDefault()
          break
        case 'Backspace':
        case 'Delete': {
          if (editable) {
            const writes = []
            for (let r = rect.minRow; r <= rect.maxRow; r++)
              for (let c = rect.minCol; c <= rect.maxCol; c++)
                if (rawAt(c, r) !== '') writes.push({ col: c, row: r, value: '' })
            commitMany(writes)
          }
          e.preventDefault()
          break
        }
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
    [editing, sel.focus, moveFocus, rect, rawAt, commitMany, editable, beginEdit],
  )

  const onCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing) return
      const lines: string[] = []
      for (let r = rect.minRow; r <= rect.maxRow; r++) {
        const cells: string[] = []
        for (let c = rect.minCol; c <= rect.maxCol; c++) {
          const raw = rawAt(c, r)
          const val = raw.trim().startsWith('=')
            ? formatValue(valueAt(c, r), { locale })
            : raw
          cells.push(val)
        }
        lines.push(cells.join('\t'))
      }
      e.clipboardData.setData('text/plain', lines.join('\n'))
      e.preventDefault()
    },
    [editing, rect, rawAt, valueAt, locale],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing || !editable) return
      const data = e.clipboardData.getData('text/plain')
      if (!data) return
      const rows = data.replace(/\r/g, '').replace(/\n$/, '').split('\n')
      const writes: { col: number; row: number; value: string }[] = []
      rows.forEach((line, dr) => {
        line.split('\t').forEach((cell, dc) => {
          writes.push({ col: rect.minCol + dc, row: rect.minRow + dr, value: cell })
        })
      })
      commitMany(writes)
      e.preventDefault()
    },
    [editing, editable, rect, commitMany],
  )

  const onCellMouseDown = useCallback((col: number, row: number, shift: boolean) => {
    dragging.current = true
    setSel((s) => (shift ? { anchor: s.anchor, focus: { col, row } } : { anchor: { col, row }, focus: { col, row } }))
  }, [])
  const onCellMouseEnter = useCallback((col: number, row: number) => {
    if (dragging.current) setSel((s) => ({ anchor: s.anchor, focus: { col, row } }))
  }, [])

  const stats = useMemo(() => {
    if (rect.minCol === rect.maxCol && rect.minRow === rect.maxRow) return null
    let sum = 0
    let count = 0
    let numCount = 0
    for (let r = rect.minRow; r <= rect.maxRow; r++) {
      for (let c = rect.minCol; c <= rect.maxCol; c++) {
        const raw = rawAt(c, r)
        if (raw.trim() !== '') count++
        const n = toNumber(valueAt(c, r))
        if (n !== null && typeof valueAt(c, r) !== 'string') {
          sum += n
          numCount++
        }
      }
    }
    return { sum, count, numCount, avg: numCount ? sum / numCount : 0 }
  }, [rect, rawAt, valueAt])

  const activeRaw = rawAt(sel.focus.col, sel.focus.row)

  return (
    <div className={`defter-shell${props.className ? ` ${props.className}` : ''}`} style={props.style}>
      {formulaBar && (
        <div className="defter__formulabar" data-defter-theme={theme}>
          <span className="defter__cellref">
            {columnLabel(sel.focus.col)}
            {sel.focus.row}
          </span>
          <input
            className="defter__fx"
            value={editing ? editing.value : activeRaw}
            readOnly={!editable}
            placeholder={editable ? 'Enter a value or =formula' : ''}
            onChange={(e) => setEditing({ col: sel.focus.col, row: sel.focus.row, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit(sel.focus.col, sel.focus.row, editing?.value ?? activeRaw, {
                  col: sel.focus.col,
                  row: sel.focus.row + 1,
                })
                e.preventDefault()
              } else if (e.key === 'Escape') {
                setEditing(null)
              }
            }}
          />
        </div>
      )}

      <div
        ref={rootRef}
        className="defter"
        data-defter-theme={theme}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
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
                  className={`defter__colhead${c >= rect.minCol && c <= rect.maxCol ? ' defter__colhead--active' : ''}`}
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
                    className={`defter__rowhead${row >= rect.minRow && row <= rect.maxRow ? ' defter__rowhead--active' : ''}`}
                  >
                    {row}
                  </th>
                  {Array.from({ length: totalCols }, (_, col) => {
                    if (styles.isCovered(col, row)) return null
                    const span = styles.mergeAnchor(col, row)
                    const isFocus = sel.focus.col === col && sel.focus.row === row
                    const inSel = col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow
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
                        focus={isFocus}
                        inSelection={inSel && !isFocus}
                        colSpan={span?.colspan}
                        rowSpan={span?.rowspan}
                        editing={editing?.col === col && editing?.row === row ? editing.value : null}
                        inputRef={inputRef}
                        onMouseDown={(shift) => onCellMouseDown(col, row, shift)}
                        onMouseEnter={() => onCellMouseEnter(col, row)}
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

      {statusBar && (
        <div className="defter__statusbar" data-defter-theme={theme}>
          {stats ? (
            <>
              {stats.numCount > 0 && (
                <>
                  <span>Sum: {formatValue(stats.sum, { locale })}</span>
                  <span>Avg: {formatValue(stats.avg, { locale })}</span>
                </>
              )}
              <span>Count: {stats.count}</span>
            </>
          ) : (
            <span className="defter__status-hint">
              {columnLabel(sel.focus.col)}
              {sel.focus.row}
            </span>
          )}
        </div>
      )}
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
  focus: boolean
  inSelection: boolean
  colSpan?: number
  rowSpan?: number
  editing: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onMouseDown: (shift: boolean) => void
  onMouseEnter: () => void
  onBeginEdit: () => void
  onEditChange: (v: string) => void
  onCommit: (v: string, dir: 'down' | 'right') => void
  onCancel: () => void
}

function Cell(p: CellProps): React.JSX.Element {
  const attrs = p.styles.attrs(p.col, p.row)
  const raw = getCell(p.sheet, p.col, p.row)
  const isFormula = raw.trim().startsWith('=')

  let display: React.ReactNode = ''
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
    display = attrs.format && numeric ? formatValue(v, { format: attrs.format, locale: p.locale }) : renderInline(raw)
  }

  const cls = [
    'defter__cell',
    numeric && !attrs.align ? 'defter__cell--number' : '',
    attrs.wrap ? 'defter__cell--wrap' : '',
    error ? 'defter__cell--error' : '',
    p.showFormulas && isFormula ? 'defter__cell--formula-src' : '',
    p.inSelection ? 'defter__cell--insel' : '',
    p.focus ? 'defter__cell--focus' : '',
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
      onMouseDown={(e) => p.onMouseDown(e.shiftKey)}
      onMouseEnter={p.onMouseEnter}
      onDoubleClick={p.onBeginEdit}
    >
      {p.editing !== null ? (
        <input
          ref={p.inputRef}
          className="defter__editor"
          value={p.editing}
          onChange={(e) => p.onEditChange(e.target.value)}
          onBlur={() => p.onCommit(p.editing ?? '', 'down')}
          onMouseDown={(e) => e.stopPropagation()}
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
