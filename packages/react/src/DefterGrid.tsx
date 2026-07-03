import {
  type CellValue,
  type ComputedGrid,
  type FormulaEngine,
  type Locale,
  type Model,
  addSheet,
  clearStylesIn,
  columnLabel,
  deleteCols,
  deleteRows,
  formatValue,
  getCell,
  insertCols,
  insertRows,
  isError,
  parse,
  parseLiteral,
  renameSheet,
  resolveStyles,
  serialize,
  setCell,
  setColumnWidth,
  setStyle,
  toNumber,
} from '@defter/core'
import type { StyleAttrs } from '@defter/core'
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
  /** Show sheet tabs. Defaults to on when the document has more than one sheet. */
  sheetTabs?: boolean
  /** Show the formatting toolbar (bold/align/fill/number-format) above the grid. */
  toolbar?: boolean
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
    sheetTabs,
    toolbar = false,
    extraRows = 6,

    extraCols = 3,
    readOnly = false,
  } = props

  const model = useMemo<Model>(() => parse(text), [text])
  const computed = useMemo<ComputedGrid | null>(() => (engine ? engine.compute(model) : null), [engine, model])
  const [activeSheet, setActiveSheet] = useState(sheetIndex)
  const si = model.sheets[activeSheet] ? activeSheet : 0
  const sheet = model.sheets[si]!
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localW, setLocalW] = useState<Record<number, number>>({})
  const resizeRef = useRef<{ col: number; startX: number; startW: number } | null>(null)
  const DEFAULT_COL_W = 110
  const colWidth = useCallback(
    (c: number) => localW[c] ?? styles.attrs(c, 1).width ?? DEFAULT_COL_W,
    [localW, styles],
  )

  // History: all mutations route through pushEdit so undo/redo works. (Local edits only; a
  // collab host that also wants remote-aware undo would layer Yjs's UndoManager on top.)
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const pushEdit = useCallback(
    (next: string) => {
      if (!onChange || next === text) return
      undoStack.current.push(text)
      if (undoStack.current.length > 300) undoStack.current.shift()
      redoStack.current = []
      onChange(next)
    },
    [text, onChange],
  )
  const undo = useCallback(() => {
    if (!onChange || undoStack.current.length === 0) return
    const prev = undoStack.current.pop()!
    redoStack.current.push(text)
    onChange(prev)
  }, [text, onChange])
  const redo = useCallback(() => {
    if (!onChange || redoStack.current.length === 0) return
    const nxt = redoStack.current.pop()!
    undoStack.current.push(text)
    onChange(nxt)
  }, [text, onChange])

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

  // Column resize (drag the header's right edge); commit persists into the style layer.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const w = Math.max(48, r.startW + (e.clientX - r.startX))
      setLocalW((prev) => ({ ...prev, [r.col]: w }))
    }
    const up = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const w = Math.max(48, Math.round(r.startW + (e.clientX - r.startX)))
      resizeRef.current = null
      pushEdit(serialize(setColumnWidth(model, si, r.col, w)))
      setLocalW((prev) => {
        const n = { ...prev }
        delete n[r.col]
        return n
      })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [model, pushEdit, si])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const applyModel = useCallback(
    (m: Model) => {
      pushEdit(serialize(m))
      setMenu(null)
    },
    [pushEdit],
  )

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
      pushEdit(serialize(setCell(model, si, col, row, value)))
      setEditing(null)
      if (move) setSel({ anchor: move, focus: move })
      rootRef.current?.focus()
    },
    [model, pushEdit, si],
  )

  const commitMany = useCallback(
    (writes: { col: number; row: number; value: string }[]) => {
      if (writes.length === 0) return
      let m = model
      for (const w of writes) m = setCell(m, si, w.col, w.row, w.value)
      pushEdit(serialize(m))
    },
    [model, pushEdit, si],
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) redo()
        else undo()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        redo()
        e.preventDefault()
        return
      }
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
    [editing, sel.focus, moveFocus, rect, rawAt, commitMany, editable, beginEdit, undo, redo],
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

  const startResize = useCallback(
    (col: number, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { col, startX: e.clientX, startW: colWidth(col) }
    },
    [colWidth],
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editable) return
      const el = (e.target as HTMLElement).closest('[data-col],[data-row]') as HTMLElement | null
      if (!el) return
      e.preventDefault()
      const c = el.dataset.col !== undefined ? Number(el.dataset.col) : undefined
      const r = el.dataset.row !== undefined ? Number(el.dataset.row) : undefined
      if (c !== undefined && r !== undefined) {
        const inside = c >= rect.minCol && c <= rect.maxCol && r >= rect.minRow && r <= rect.maxRow
        if (!inside) setSel({ anchor: { col: c, row: r }, focus: { col: c, row: r } })
      } else if (c !== undefined) {
        setSel({ anchor: { col: c, row: 1 }, focus: { col: c, row: totalRows } })
      } else if (r !== undefined) {
        setSel({ anchor: { col: 0, row: r }, focus: { col: totalCols - 1, row: r } })
      }
      setMenu({ x: e.clientX, y: e.clientY })
    },
    [editable, rect, totalRows, totalCols],
  )

  const clearSelection = useCallback(() => {
    const writes = []
    for (let r = rect.minRow; r <= rect.maxRow; r++)
      for (let c = rect.minCol; c <= rect.maxCol; c++)
        if (rawAt(c, r) !== '') writes.push({ col: c, row: r, value: '' })
    commitMany(writes)
    setMenu(null)
  }, [rect, rawAt, commitMany])

  const applyStyle = useCallback(
    (attrs: StyleAttrs) => {
      const range = {
        start: { col: rect.minCol, row: rect.minRow, colAbs: false, rowAbs: false },
        end: { col: rect.maxCol, row: rect.maxRow, colAbs: false, rowAbs: false },
        sheet: undefined,
      }
      pushEdit(serialize(setStyle(model, si, { kind: 'range', range }, attrs)))
    },
    [model, pushEdit, si, rect],
  )
  const clearFormatting = useCallback(() => {
    pushEdit(serialize(clearStylesIn(model, si, rect.minCol, rect.minRow, rect.maxCol, rect.maxRow)))
  }, [model, pushEdit, si, rect])

  const activeAttrs = styles.attrs(sel.focus.col, sel.focus.row)
  const activeRaw = rawAt(sel.focus.col, sel.focus.row)

  return (
    <div className={`defter-shell${props.className ? ` ${props.className}` : ''}`} style={props.style}>
      {toolbar && editable && (
        <div className="defter__toolbar" data-defter-theme={theme}>
          <button
            className={`defter__tb${activeAttrs.bold ? ' defter__tb--on' : ''}`}
            title="Bold"
            onClick={() => applyStyle({ bold: !activeAttrs.bold })}
          >
            <b>B</b>
          </button>
          <button
            className={`defter__tb${activeAttrs.italic ? ' defter__tb--on' : ''}`}
            title="Italic"
            onClick={() => applyStyle({ italic: !activeAttrs.italic })}
          >
            <i>I</i>
          </button>
          <span className="defter__tb-sep" />
          {(['left', 'center', 'right'] as const).map((al) => (
            <button
              key={al}
              className={`defter__tb${activeAttrs.align === al ? ' defter__tb--on' : ''}`}
              title={`Align ${al}`}
              onClick={() => applyStyle({ align: al })}
            >
              {al === 'left' ? '⯇' : al === 'center' ? '≡' : '⯈'}
            </button>
          ))}
          <span className="defter__tb-sep" />
          {(
            [
              ['', 'none'],
              ['surface-2', 'gray'],
              ['accent-soft', 'blue'],
              ['success-soft', 'green'],
              ['warning-soft', 'amber'],
              ['danger-soft', 'red'],
            ] as const
          ).map(([token, label]) => (
            <button
              key={label}
              className="defter__swatch"
              title={`Fill ${label}`}
              style={{ background: token ? `var(--defter-token-${token})` : 'transparent' }}
              onClick={() => applyStyle({ fill: token || undefined })}
            >
              {token ? '' : '⊘'}
            </button>
          ))}
          <span className="defter__tb-sep" />
          <select
            className="defter__tb-select"
            value={activeAttrs.format ?? ''}
            title="Number format"
            onChange={(e) => applyStyle({ format: e.target.value || undefined })}
          >
            <option value="">General</option>
            <option value="#,##0">1,234</option>
            <option value="#,##0.00">1,234.00</option>
            <option value="$#,##0.00">$1,234.00</option>
            <option value="0%">0%</option>
            <option value="0.00%">0.00%</option>
          </select>
          <span className="defter__tb-sep" />
          <button className="defter__tb" title="Clear formatting" onClick={clearFormatting}>
            ⌫ clear
          </button>
        </div>
      )}
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
        onContextMenu={onContextMenu}
      >
        <table className="defter__grid">
          <colgroup>
            <col style={{ width: 'var(--defter-head-width)' }} />
            {Array.from({ length: totalCols }, (_, c) => (
              <col key={c} style={{ width: `${colWidth(c)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="defter__corner" />
              {Array.from({ length: totalCols }, (_, c) => (
                <th
                  key={c}
                  data-col={c}
                  className={`defter__colhead${c >= rect.minCol && c <= rect.maxCol ? ' defter__colhead--active' : ''}`}
                >
                  {columnLabel(c)}
                  {editable && (
                    <span
                      className="defter__resizer"
                      onMouseDown={(e) => startResize(c, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
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
                    data-row={row}
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

      {menu && (
        <div className="defter__menu" style={{ left: menu.x, top: menu.y }} data-defter-theme={theme}>
          <button onClick={() => applyModel(insertRows(model, si, Math.max(2, rect.minRow), 1))}>
            Insert row above
          </button>
          <button onClick={() => applyModel(insertRows(model, si, rect.maxRow + 1, 1))}>
            Insert row below
          </button>
          <button onClick={() => applyModel(deleteRows(model, si, rect.minRow, rect.maxRow - rect.minRow + 1))}>
            Delete {rect.maxRow > rect.minRow ? `rows ${rect.minRow}–${rect.maxRow}` : `row ${rect.minRow}`}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={() => applyModel(insertCols(model, si, rect.minCol, 1))}>
            Insert column left
          </button>
          <button onClick={() => applyModel(insertCols(model, si, rect.maxCol + 1, 1))}>
            Insert column right
          </button>
          <button onClick={() => applyModel(deleteCols(model, si, rect.minCol, rect.maxCol - rect.minCol + 1))}>
            Delete {rect.maxCol > rect.minCol ? `columns ${columnLabel(rect.minCol)}–${columnLabel(rect.maxCol)}` : `column ${columnLabel(rect.minCol)}`}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={clearSelection}>Clear contents</button>
        </div>
      )}

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

      {(sheetTabs ?? model.sheets.length > 1) && (
        <div className="defter__tabs" data-defter-theme={theme}>
          {model.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              className={`defter__tab${i === si ? ' defter__tab--on' : ''}`}
              onClick={() => setActiveSheet(i)}
              onDoubleClick={() => {
                if (!editable) return
                const name = window.prompt('Rename sheet', s.name)
                if (name) pushEdit(serialize(renameSheet(model, i, name)))
              }}
            >
              {s.name}
            </button>
          ))}
          {editable && (
            <button
              className="defter__tab-add"
              title="Add sheet"
              onClick={() => {
                const len = model.sheets.length
                pushEdit(serialize(addSheet(model)))
                setActiveSheet(len)
              }}
            >
              +
            </button>
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
      data-col={p.col}
      data-row={p.row}
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
