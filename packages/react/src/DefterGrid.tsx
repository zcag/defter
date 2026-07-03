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
  fillDown,
  fillRight,
  formatColor,
  formatValue,
  getCell,
  insertCols,
  insertRows,
  isError,
  parse,
  parseLiteral,
  renameSheet,
  resolveConditionalAttrs,
  resolveStyles,
  resolveValidation,
  serialize,
  setCell,
  setColumnWidth,
  setStyle,
  sortRows,
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
import { resolveColor, styleToCss } from './styleToCss.js'

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
  /** Keep the header row (A1 row 1) pinned while scrolling. */
  freezeHeader?: boolean
  /** Keep the first column (A) pinned while scrolling horizontally. */
  freezeCol?: boolean
  /** Render only the visible rows (windowing) for large sheets. Assumes a fixed row height. */
  virtualize?: boolean
  /** Fixed row height in px used by virtualization; must match `--defter-row-height` (default 26). */
  rowHeight?: number
  /** Function names for formula autocomplete (e.g. `FUNCTION_NAMES` from `@defter/formula`). */
  functions?: string[]
  extraRows?: number
  extraCols?: number
  readOnly?: boolean
  className?: string
  style?: CSSProperties
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Increase/decrease the decimal places of a number format, preserving prefix/suffix (currency, %),
 * grouping, and every `;` section — only the digit-skeleton's fractional part changes.
 */
function adjustDecimals(format: string | undefined, delta: number): string {
  const base = format || '#,##0'
  return base.replace(/[#0][#0,]*(?:\.[0#]+)?/g, (skel) => {
    const dot = skel.indexOf('.')
    const intPart = dot >= 0 ? skel.slice(0, dot) : skel
    const cur = dot >= 0 ? (skel.slice(dot + 1).match(/0/g) || []).length : 0
    const dec = Math.max(0, Math.min(9, cur + delta))
    return dec > 0 ? `${intPart}.${'0'.repeat(dec)}` : intPart
  })
}

function Icon({ name }: { name: string }): React.JSX.Element {
  const c = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'align-left':
      return (
        <svg {...c}>
          <path d="M4 6h16M4 12h10M4 18h13" />
        </svg>
      )
    case 'align-center':
      return (
        <svg {...c}>
          <path d="M4 6h16M7 12h10M6 18h12" />
        </svg>
      )
    case 'align-right':
      return (
        <svg {...c}>
          <path d="M4 6h16M10 12h10M7 18h13" />
        </svg>
      )
    case 'fill':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M6 4l9 9-6 6a2 2 0 01-3 0l-3-3a2 2 0 010-3z" />
          <path d="M6 4l-1-1" />
          <path d="M19 15s2 2.5 2 4a2 2 0 11-4 0c0-1.5 2-4 2-4z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'text-color':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M6 16L10 6l4 10M7.5 12.5h5" />
        </svg>
      )
    case 'borders':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="3" width="18" height="18" rx="1.5" />
          <path d="M3 12h18M12 3v18" opacity="0.55" />
        </svg>
      )
    case 'wrap':
      return (
        <svg {...c}>
          <path d="M4 6h16M4 12h12a3 3 0 010 6h-4m0 0l2-2m-2 2l2 2M4 18h4" />
        </svg>
      )
    case 'merge':
      return (
        <svg {...c} strokeWidth={1.6}>
          <rect x="3" y="6" width="18" height="12" rx="1" />
          <path d="M12 6v12M8 12h8m0 0l-2-2m2 2l-2 2M8 12l2-2m-2 2l2 2" opacity="0.7" />
        </svg>
      )
    case 'undo':
      return (
        <svg {...c}>
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 016 6v1" />
        </svg>
      )
    case 'redo':
      return (
        <svg {...c}>
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 00-6 6v1" />
        </svg>
      )
    case 'painter':
      return (
        <svg {...c} strokeWidth={1.7}>
          <rect x="4" y="3" width="14" height="6" rx="1" />
          <path d="M18 6h2v4h-8v3" />
          <rect x="10" y="13" width="4" height="7" rx="1" />
        </svg>
      )
    case 'clear':
      return (
        <svg {...c} strokeWidth={1.7}>
          <path d="M8 5h9l-1 9H9z" />
          <path d="M6 19h12" />
          <path d="M11 8l3 3m0-3l-3 3" opacity="0.6" />
        </svg>
      )
    case 'sigma':
      return (
        <svg {...c} strokeWidth={1.9}>
          <path d="M17 5H7l6 7-6 7h10" />
        </svg>
      )
    default:
      return <svg {...c} />
  }
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
    freezeHeader = false,
    freezeCol = false,
    virtualize = false,
    rowHeight = 26,
    functions,
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
  const OVERSCAN = 8

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

  const [vp, setVp] = useState({ top: 0, height: 0 })
  useEffect(() => {
    if (virtualize && rootRef.current) setVp((v) => ({ ...v, height: rootRef.current!.clientHeight }))
  }, [virtualize])

  // Visible row window (1-based, inclusive). Without virtualize this is the full range → no spacers.
  let winStart = 1
  let winEnd = totalRows
  if (virtualize && vp.height > 0) {
    const visible = Math.ceil(vp.height / rowHeight)
    winStart = Math.max(1, Math.floor(vp.top / rowHeight) + 1 - OVERSCAN)
    winEnd = Math.min(totalRows, winStart + visible + OVERSCAN * 2)
  }
  // Under virtualization, force-render the frozen header row (row 1) even when scrolled past it.
  const forceHeader = virtualize && freezeHeader && winStart > 1
  const padTop = (winStart - 1 - (forceHeader ? 1 : 0)) * rowHeight
  const padBottom = (totalRows - winEnd) * rowHeight

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

  const fillDragging = useRef(false)
  const fillTargetRef = useRef<Pos | null>(null)
  useEffect(() => {
    const up = () => {
      if (fillDragging.current) {
        fillDragging.current = false
        const t = fillTargetRef.current
        fillTargetRef.current = null
        if (t && t.row > rect.maxRow) {
          pushEdit(serialize(fillDown(model, si, rect.minCol, rect.maxCol, rect.minRow, t.row)))
        } else if (t && t.col > rect.maxCol) {
          pushEdit(serialize(fillRight(model, si, rect.minCol, t.col, rect.minRow, rect.maxRow)))
        }
      }
      dragging.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [rect, model, si, pushEdit])

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

  const autoSum = useCallback(() => {
    const { col, row } = sel.focus
    const end = row - 1
    if (end < 2) return
    let start = end
    while (start > 2 && typeof parseLiteral(getCell(sheet, col, start - 1), locale) === 'number') start--
    const c = columnLabel(col)
    pushEdit(serialize(setCell(model, si, col, row, `=SUM(${c}${start}:${c}${end})`)))
    setSel({ anchor: { col, row }, focus: { col, row } })
  }, [sel.focus, sheet, locale, model, si, pushEdit])

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

  // Ctrl+Arrow: jump to the edge of the current data block (Sheets behaviour).
  const jump = useCallback(
    (dc: number, dr: number, extend: boolean) => {
      const dataRows = sheet.grid.length
      const dataCols = sheet.width
      const isEmpty = (c: number, r: number) => getCell(sheet, c, r).trim() === ''
      const inB = (c: number, r: number) => c >= 0 && c < dataCols && r >= 1 && r <= dataRows
      let { col: c, row: r } = sel.focus
      if (inB(c, r)) {
        if (!isEmpty(c, r) && inB(c + dc, r + dr) && !isEmpty(c + dc, r + dr)) {
          while (inB(c + dc, r + dr) && !isEmpty(c + dc, r + dr)) {
            c += dc
            r += dr
          }
        } else {
          c += dc
          r += dr
          while (inB(c, r) && isEmpty(c, r)) {
            c += dc
            r += dr
          }
          if (!inB(c, r)) {
            c -= dc
            r -= dr
          }
        }
      } else {
        c += dc
        r += dr
      }
      const p = { col: clampCol(c), row: clampRow(r) }
      setSel((s) => ({ anchor: extend ? s.anchor : p, focus: p }))
    },
    [sheet, sel.focus, totalCols, totalRows],
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        setFinder({ query: '', replace: '', replaceMode: false })
        setMatchIdx(0)
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H') && editable) {
        setFinder({ query: '', replace: '', replaceMode: true })
        setMatchIdx(0)
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && editable) {
        const k = e.key.toLowerCase()
        if (k === 'b') {
          applyStyle({ bold: !styles.attrs(sel.focus.col, sel.focus.row).bold })
          e.preventDefault()
          return
        }
        if (k === 'i') {
          applyStyle({ italic: !styles.attrs(sel.focus.col, sel.focus.row).italic })
          e.preventDefault()
          return
        }
        if (k === 'd') {
          pushEdit(serialize(fillDown(model, si, rect.minCol, rect.maxCol, rect.minRow, rect.maxRow)))
          e.preventDefault()
          return
        }
        if (k === 'r') {
          pushEdit(serialize(fillRight(model, si, rect.minCol, rect.maxCol, rect.minRow, rect.maxRow)))
          e.preventDefault()
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        setSel({ anchor: { col: 0, row: 1 }, focus: { col: totalCols - 1, row: totalRows } })
        e.preventDefault()
        return
      }
      const { col, row } = sel.focus
      const shift = e.shiftKey
      const mod = e.ctrlKey || e.metaKey
      const lastCol = Math.max(0, sheet.width - 1)
      const lastRow = Math.max(1, sheet.grid.length)
      switch (e.key) {
        case 'ArrowUp':
          mod ? jump(0, -1, shift) : moveFocus(0, -1, shift)
          e.preventDefault()
          break
        case 'ArrowDown':
          mod ? jump(0, 1, shift) : moveFocus(0, 1, shift)
          e.preventDefault()
          break
        case 'Enter':
          moveFocus(0, 1, false)
          e.preventDefault()
          break
        case 'ArrowLeft':
          mod ? jump(-1, 0, shift) : moveFocus(-1, 0, shift)
          e.preventDefault()
          break
        case 'ArrowRight':
          mod ? jump(1, 0, shift) : moveFocus(1, 0, shift)
          e.preventDefault()
          break
        case 'Tab':
          moveFocus(1, 0, false)
          e.preventDefault()
          break
        case 'Home': {
          const p = mod ? { col: 0, row: 1 } : { col: 0, row }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'End': {
          const p = mod ? { col: lastCol, row: lastRow } : { col: lastCol, row }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'PageDown': {
          const p = { col, row: clampRow(row + 20) }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
        case 'PageUp': {
          const p = { col, row: clampRow(row - 20) }
          setSel((s) => ({ anchor: shift ? s.anchor : p, focus: p }))
          e.preventDefault()
          break
        }
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
    [
      editing,
      sel.focus,
      moveFocus,
      rect,
      rawAt,
      commitMany,
      editable,
      beginEdit,
      undo,
      redo,
      applyStyle,
      styles,
      model,
      pushEdit,
      si,
      totalCols,
      totalRows,
      jump,
      sheet,
    ],
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

  const painterRef = useRef<StyleAttrs | null>(null)
  const [painterOn, setPainterOn] = useState(false)
  const onCellMouseDown = useCallback(
    (col: number, row: number, shift: boolean) => {
      rootRef.current?.focus() // capture the keyboard for THIS grid (critical with >1 grid on a page)
      if (painterRef.current) {
        const attrs = painterRef.current
        painterRef.current = null
        setPainterOn(false)
        setSel({ anchor: { col, row }, focus: { col, row } })
        const range = {
          start: { col, row, colAbs: false, rowAbs: false },
          end: { col, row, colAbs: false, rowAbs: false },
          sheet: undefined,
        }
        pushEdit(serialize(setStyle(model, si, { kind: 'range', range }, attrs)))
        return
      }
      dragging.current = true
      setSel((s) => (shift ? { anchor: s.anchor, focus: { col, row } } : { anchor: { col, row }, focus: { col, row } }))
    },
    [model, si, pushEdit],
  )
  const onCellMouseEnter = useCallback((col: number, row: number) => {
    if (dragging.current) setSel((s) => ({ anchor: s.anchor, focus: { col, row } }))
  }, [])

  // Fill-handle drag tracks the target via a document mousemove (robust across real drags).
  const onFillStart = useCallback(() => {
    fillDragging.current = true
    fillTargetRef.current = null
    const move = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-col][data-row]') as HTMLElement | null
      if (el?.dataset.col !== undefined && el.dataset.row !== undefined) {
        fillTargetRef.current = { col: Number(el.dataset.col), row: Number(el.dataset.row) }
        return
      }
      // Over a virtualization spacer (no data cell): derive the row from geometry.
      const root = rootRef.current
      if (root) {
        const box = root.getBoundingClientRect()
        const row = Math.max(1, Math.floor((ev.clientY - box.top + root.scrollTop) / rowHeight))
        fillTargetRef.current = { col: fillTargetRef.current?.col ?? sel.focus.col, row }
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener(
      'mouseup',
      function done() {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', done)
      },
      { once: true },
    )
  }, [sel.focus.col, rowHeight])

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

  // Find & replace (Ctrl+F / Ctrl+H).
  const [finder, setFinder] = useState<{ query: string; replace: string; replaceMode: boolean } | null>(null)
  const [matchIdx, setMatchIdx] = useState(0)
  const matches = useMemo<Pos[]>(() => {
    if (!finder?.query) return []
    const q = finder.query.toLowerCase()
    const out: Pos[] = []
    for (let r = 0; r < sheet.grid.length; r++) {
      for (let c = 0; c < sheet.width; c++) {
        if ((sheet.grid[r]![c] ?? '').toLowerCase().includes(q)) out.push({ col: c, row: r + 1 })
      }
    }
    return out
  }, [finder?.query, sheet])
  const curMatch = matches.length ? ((matchIdx % matches.length) + matches.length) % matches.length : 0
  useEffect(() => {
    if (finder && matches.length) {
      const m = matches[curMatch]!
      setSel({ anchor: m, focus: m })
      const el = rootRef.current
      if (el) {
        if (virtualize) el.scrollTop = Math.max(0, (m.row - 1) * rowHeight - el.clientHeight / 2)
        else el.querySelector(`[data-col="${m.col}"][data-row="${m.row}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
  }, [curMatch, matches, finder, virtualize, rowHeight])

  const doReplace = useCallback(() => {
    if (!finder || !editable || !matches.length) return
    const m = matches[curMatch]!
    const raw = getCell(sheet, m.col, m.row)
    const next = raw.replace(new RegExp(escapeRegExp(finder.query), 'i'), finder.replace)
    pushEdit(serialize(setCell(model, si, m.col, m.row, next)))
  }, [finder, editable, matches, curMatch, sheet, model, si, pushEdit])
  const doReplaceAll = useCallback(() => {
    if (!finder || !editable) return
    const re = new RegExp(escapeRegExp(finder.query), 'gi')
    commitMany(matches.map((m) => ({ col: m.col, row: m.row, value: getCell(sheet, m.col, m.row).replace(re, finder.replace) })))
  }, [finder, editable, matches, sheet, commitMany])

  const activeAttrs = styles.attrs(sel.focus.col, sel.focus.row)
  const activeRaw = rawAt(sel.focus.col, sel.focus.row)

  const [popover, setPopover] = useState<'fill' | 'text' | null>(null)
  useEffect(() => {
    if (!popover) return
    const close = () => setPopover(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [popover])

  const renderRow = (row: number) => (
    <tr key={row} role="row" aria-rowindex={row}>
      <th
        data-row={row}
        role="rowheader"
        className={`defter__rowhead${row >= rect.minRow && row <= rect.maxRow ? ' defter__rowhead--active' : ''}${freezeHeader && row === 1 ? ' defter__rowhead--frozen' : ''}`}
      >
        {row}
      </th>
      {Array.from({ length: totalCols }, (_, col) => {
        if (styles.isCovered(col, row)) return null
        const span = styles.mergeAnchor(col, row)
        const isFocus = sel.focus.col === col && sel.focus.row === row
        const inSel = col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow
        const selBorder = inSel
          ? [
              row === rect.minRow && 'inset 0 2px 0 0 var(--defter-selection-border)',
              row === rect.maxRow && 'inset 0 -2px 0 0 var(--defter-selection-border)',
              col === rect.minCol && 'inset 2px 0 0 0 var(--defter-selection-border)',
              col === rect.maxCol && 'inset -2px 0 0 0 var(--defter-selection-border)',
            ]
              .filter(Boolean)
              .join(', ')
          : ''
        return (
          <Cell
            key={col}
            col={col}
            row={row}
            selBorder={selBorder}
            sheet={sheet}
            styles={styles}
            computed={computed}
            sheetName={sheet.name}
            locale={locale}
            showFormulas={showFormulas}
            colAlign={sheet.colAlign[col] ?? null}
            focus={isFocus}
            inSelection={inSel && !isFocus}
            frozen={freezeHeader && row === 1}
            frozenCol={freezeCol && col === 0}
            fillHandle={isFocus && editable}
            onFillStart={onFillStart}
            colSpan={span?.colspan}
            rowSpan={span?.rowspan}
            editing={editing?.col === col && editing?.row === row ? editing.value : null}
            inputRef={inputRef}
            functions={functions}
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

  return (
    <div className={`defter-shell${props.className ? ` ${props.className}` : ''}`} style={props.style}>
      {toolbar && editable && (
        <div className="defter__toolbar" data-defter-theme={theme}>
          <button className="defter__tb" title="Undo (Ctrl+Z)" onClick={undo}>
            <Icon name="undo" />
          </button>
          <button className="defter__tb" title="Redo (Ctrl+Y)" onClick={redo}>
            <Icon name="redo" />
          </button>
          <button
            className={`defter__tb${painterOn ? ' defter__tb--on' : ''}`}
            title="Paint format — then click a target cell"
            onClick={() => {
              painterRef.current = { ...activeAttrs }
              setPainterOn(true)
            }}
          >
            <Icon name="painter" />
          </button>
          <span className="defter__tb-sep" />

          <button className="defter__tb defter__tb--wide" title="Currency" onClick={() => applyStyle({ format: '$#,##0.00' })}>
            $
          </button>
          <button className="defter__tb defter__tb--wide" title="Percent" onClick={() => applyStyle({ format: '0%' })}>
            %
          </button>
          <button className="defter__tb defter__tb--wide" title="Fewer decimals" onClick={() => applyStyle({ format: adjustDecimals(activeAttrs.format, -1) })}>
            .0
          </button>
          <button className="defter__tb defter__tb--wide" title="More decimals" onClick={() => applyStyle({ format: adjustDecimals(activeAttrs.format, 1) })}>
            .00
          </button>
          <select className="defter__tb-select" value={activeAttrs.format ?? ''} title="Number format" onChange={(e) => applyStyle({ format: e.target.value || undefined })}>
            <option value="">123</option>
            <option value="#,##0">1,234</option>
            <option value="#,##0.00">1,234.00</option>
            <option value="$#,##0.00">$1,234.00</option>
            <option value="0%">0%</option>
            <option value="0.00%">0.00%</option>
          </select>
          <span className="defter__tb-sep" />

          <button className={`defter__tb defter__tb--strong${activeAttrs.bold ? ' defter__tb--on' : ''}`} title="Bold (Ctrl+B)" onClick={() => applyStyle({ bold: !activeAttrs.bold })}>
            <b>B</b>
          </button>
          <button className={`defter__tb defter__tb--strong${activeAttrs.italic ? ' defter__tb--on' : ''}`} title="Italic (Ctrl+I)" onClick={() => applyStyle({ italic: !activeAttrs.italic })}>
            <i>I</i>
          </button>
          <button className={`defter__tb defter__tb--strong${activeAttrs.strike ? ' defter__tb--on' : ''}`} title="Strikethrough" onClick={() => applyStyle({ strike: !activeAttrs.strike })}>
            <s>S</s>
          </button>

          <div className="defter__tb-pop">
            <button className="defter__tb defter__tb--color" title="Text color" onClick={(e) => { e.stopPropagation(); setPopover(popover === 'text' ? null : 'text') }}>
              <Icon name="text-color" />
              <span className="defter__tb-bar" style={{ background: activeAttrs.color ? `var(--defter-token-${activeAttrs.color})` : 'var(--defter-fg)' }} />
            </button>
            {popover === 'text' && (
              <div className="defter__popover" onClick={(e) => e.stopPropagation()}>
                {(['', 'accent', 'success', 'warning', 'danger', 'muted'] as const).map((t) => (
                  <button key={`fg${t}`} className="defter__pop-swatch" title={t || 'default'} style={{ background: t ? `var(--defter-token-${t})` : 'var(--defter-fg)' }} onClick={() => { applyStyle({ color: t || undefined }); setPopover(null) }} />
                ))}
              </div>
            )}
          </div>
          <div className="defter__tb-pop">
            <button className="defter__tb defter__tb--color" title="Fill color" onClick={(e) => { e.stopPropagation(); setPopover(popover === 'fill' ? null : 'fill') }}>
              <Icon name="fill" />
              <span className="defter__tb-bar" style={{ background: activeAttrs.fill ? `var(--defter-token-${activeAttrs.fill})` : 'transparent', outline: activeAttrs.fill ? 'none' : '1px solid var(--defter-grid-line-strong)' }} />
            </button>
            {popover === 'fill' && (
              <div className="defter__popover" onClick={(e) => e.stopPropagation()}>
                <button className="defter__pop-swatch defter__pop-swatch--none" title="none" onClick={() => { applyStyle({ fill: undefined }); setPopover(null) }} />
                {(['surface-2', 'surface-3', 'accent-soft', 'success-soft', 'warning-soft', 'danger-soft'] as const).map((t) => (
                  <button key={`bg${t}`} className="defter__pop-swatch" title={t} style={{ background: `var(--defter-token-${t})` }} onClick={() => { applyStyle({ fill: t }); setPopover(null) }} />
                ))}
              </div>
            )}
          </div>
          <span className="defter__tb-sep" />

          <button className="defter__tb" title="Borders" onClick={() => applyStyle({ border: 'all' })}>
            <Icon name="borders" />
          </button>
          <button className={`defter__tb${activeAttrs.merge ? ' defter__tb--on' : ''}`} title="Merge cells" onClick={() => applyStyle({ merge: !activeAttrs.merge })}>
            <Icon name="merge" />
          </button>
          <span className="defter__tb-sep" />

          {(['left', 'center', 'right'] as const).map((al) => (
            <button key={al} className={`defter__tb${activeAttrs.align === al ? ' defter__tb--on' : ''}`} title={`Align ${al}`} onClick={() => applyStyle({ align: al })}>
              <Icon name={`align-${al}`} />
            </button>
          ))}
          <button className={`defter__tb${activeAttrs.wrap ? ' defter__tb--on' : ''}`} title="Wrap text" onClick={() => applyStyle({ wrap: !activeAttrs.wrap })}>
            <Icon name="wrap" />
          </button>
          <span className="defter__tb-sep" />

          <button className="defter__tb" title="Sum the column above" onClick={autoSum}>
            <Icon name="sigma" />
          </button>
          <button className="defter__tb" title="Clear formatting" onClick={clearFormatting}>
            <Icon name="clear" />
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
        role="application"
        aria-label={`Defter sheet: ${sheet.name}`}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        onScroll={
          virtualize
            ? (e) => setVp({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })
            : undefined
        }
      >
        <table className="defter__grid" role="grid" aria-readonly={!editable || undefined}>
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
                  role="columnheader"
                  aria-colindex={c + 2}
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
            {forceHeader && renderRow(1)}
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={totalCols + 1} style={{ height: padTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {Array.from({ length: winEnd - winStart + 1 }, (_, k) => renderRow(winStart + k))}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={totalCols + 1} style={{ height: padBottom, padding: 0, border: 0 }} />
              </tr>
            )}
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
          <button onClick={() => applyModel(sortRows(model, si, rect.minCol, true, 2, sheet.grid.length))}>
            Sort ↑ by column {columnLabel(rect.minCol)}
          </button>
          <button onClick={() => applyModel(sortRows(model, si, rect.minCol, false, 2, sheet.grid.length))}>
            Sort ↓ by column {columnLabel(rect.minCol)}
          </button>
          <div className="defter__menu-sep" />
          <button onClick={clearSelection}>Clear contents</button>
        </div>
      )}

      {finder && (
        <div className="defter__finder" data-defter-theme={theme}>
          <input
            className="defter__finder-input"
            autoFocus
            placeholder="Find"
            value={finder.query}
            onChange={(e) => {
              setFinder((f) => (f ? { ...f, query: e.target.value } : f))
              setMatchIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setMatchIdx((i) => i + (e.shiftKey ? -1 : 1))
              else if (e.key === 'Escape') {
                setFinder(null)
                rootRef.current?.focus()
              }
              e.stopPropagation()
            }}
          />
          <span className="defter__finder-count">
            {matches.length ? `${curMatch + 1} / ${matches.length}` : '0'}
          </span>
          <button className="defter__finder-btn" title="Previous" onClick={() => setMatchIdx((i) => i - 1)}>
            ↑
          </button>
          <button className="defter__finder-btn" title="Next" onClick={() => setMatchIdx((i) => i + 1)}>
            ↓
          </button>
          {finder.replaceMode && editable && (
            <>
              <input
                className="defter__finder-input"
                placeholder="Replace"
                value={finder.replace}
                onChange={(e) => setFinder((f) => (f ? { ...f, replace: e.target.value } : f))}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button className="defter__finder-btn" onClick={doReplace}>
                Replace
              </button>
              <button className="defter__finder-btn" onClick={doReplaceAll}>
                All
              </button>
            </>
          )}
          <button
            className="defter__finder-btn"
            title="Close"
            onClick={() => {
              setFinder(null)
              rootRef.current?.focus()
            }}
          >
            ✕
          </button>
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
  selBorder?: string
  frozen?: boolean
  frozenCol?: boolean
  fillHandle?: boolean
  onFillStart?: () => void
  colSpan?: number
  rowSpan?: number
  editing: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  functions?: string[]
  onMouseDown: (shift: boolean) => void
  onMouseEnter: () => void
  onBeginEdit: () => void
  onEditChange: (v: string) => void
  onCommit: (v: string, dir: 'down' | 'right') => void
  onCancel: () => void
}

function CellEditor(p: {
  value: string
  functions?: string[]
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (v: string) => void
  onCommit: (dir: 'down' | 'right') => void
  onCancel: () => void
}): React.JSX.Element {
  const [caret, setCaret] = useState(p.value.length)
  const [dismissed, setDismissed] = useState(false)
  const [sugIdx, setSugIdx] = useState(0)

  const suggestions = useMemo(() => {
    if (!p.functions || dismissed || !p.value.startsWith('=')) return []
    const m = /(?:^|[^A-Za-z0-9_])([A-Za-z]{1,})$/.exec(p.value.slice(0, caret))
    if (!m) return []
    const partial = m[1]!.toUpperCase()
    return p.functions.filter((f) => f.startsWith(partial) && f !== partial).slice(0, 8)
  }, [p.value, caret, p.functions, dismissed])

  const accept = (name: string) => {
    const before = p.value.slice(0, caret)
    const after = p.value.slice(caret)
    const m = /([A-Za-z]+)$/.exec(before)
    const stem = m ? before.slice(0, before.length - m[1]!.length) : before
    const pos = stem.length + name.length + 1
    p.onChange(`${stem}${name}(${after}`)
    setCaret(pos)
    setSugIdx(0)
    requestAnimationFrame(() => {
      const el = p.inputRef.current
      if (el) el.selectionStart = el.selectionEnd = pos
    })
  }

  const active = suggestions.length ? sugIdx % suggestions.length : 0
  return (
    <>
      <input
        ref={p.inputRef}
        className="defter__editor"
        value={p.value}
        autoFocus
        onChange={(e) => {
          p.onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
        }}
        onKeyUp={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onClick={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onBlur={() => p.onCommit('down')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === 'ArrowDown') {
              setSugIdx((i) => (i + 1) % suggestions.length)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'ArrowUp') {
              setSugIdx((i) => (i - 1 + suggestions.length) % suggestions.length)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              accept(suggestions[active]!)
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (e.key === 'Escape') {
              setDismissed(true)
              e.preventDefault()
              e.stopPropagation()
              return
            }
          }
          if (e.key === 'Enter') {
            p.onCommit('down')
            e.preventDefault()
          } else if (e.key === 'Tab') {
            p.onCommit('right')
            e.preventDefault()
          } else if (e.key === 'Escape') {
            p.onCancel()
            e.preventDefault()
          }
          e.stopPropagation()
        }}
      />
      {suggestions.length > 0 && (
        <ul className="defter__autocomplete">
          {suggestions.map((f, i) => (
            <li
              key={f}
              className={i === active ? 'defter__ac--on' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(f)
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Cell(p: CellProps): React.JSX.Element {
  const staticAttrs = p.styles.attrs(p.col, p.row)
  const attrs =
    p.computed && p.sheet.conditionals.length > 0
      ? { ...staticAttrs, ...resolveConditionalAttrs(p.sheet, p.computed, p.col, p.row) }
      : staticAttrs
  const raw = getCell(p.sheet, p.col, p.row)
  const isFormula = raw.trim().startsWith('=')

  let display: React.ReactNode = ''
  let numeric = false
  let error = false
  let numVal: number | null = null
  if (p.showFormulas && isFormula) {
    display = raw
  } else if (isFormula) {
    const v = p.computed ? p.computed.get(p.sheetName, p.col, p.row) : null
    display = p.computed ? formatValue(v, { format: attrs.format, locale: p.locale }) : raw
    numeric = typeof v === 'number'
    numVal = typeof v === 'number' ? v : null
    error = isError(v)
  } else {
    const v = parseLiteral(raw, p.locale)
    numeric = typeof v === 'number'
    numVal = typeof v === 'number' ? v : null
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
    p.frozen ? 'defter__cell--frozen' : '',
    p.frozenCol ? 'defter__cell--frozen-col' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const css = styleToCss(attrs)
  if (!attrs.align && p.colAlign) css.textAlign = p.colAlign
  if (p.selBorder) css.boxShadow = p.selBorder
  if (numVal !== null && attrs.format && !attrs.color) {
    const fc = formatColor(numVal, attrs.format)
    if (fc) css.color = resolveColor(fc)
  }
  const validation = resolveValidation(p.sheet, p.col, p.row)

  return (
    <td
      className={`${cls}${validation ? ' defter__cell--select' : ''}${p.editing !== null ? ' defter__cell--editing' : ''}`}
      style={css}
      data-col={p.col}
      data-row={p.row}
      role="gridcell"
      aria-colindex={p.col + 2}
      aria-selected={p.inSelection || p.focus || undefined}
      colSpan={p.colSpan}
      rowSpan={p.rowSpan}
      onMouseDown={(e) => p.onMouseDown(e.shiftKey)}
      onMouseEnter={p.onMouseEnter}
      onDoubleClick={p.onBeginEdit}
    >
      {p.editing !== null && validation ? (
        <select
          className="defter__editor defter__select-editor"
          value={validation.includes(p.editing) ? p.editing : ''}
          autoFocus
          onChange={(e) => p.onCommit(e.target.value, 'down')}
          onBlur={() => p.onCancel()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') p.onCancel()
            e.stopPropagation()
          }}
        >
          <option value="" />
          {validation.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : p.editing !== null ? (
        <CellEditor
          value={p.editing}
          functions={p.functions}
          inputRef={p.inputRef}
          onChange={p.onEditChange}
          onCommit={(dir) => p.onCommit(p.editing ?? '', dir)}
          onCancel={p.onCancel}
        />
      ) : (
        <>
          {display}
          {validation && <span className="defter__caret" aria-hidden="true">▾</span>}
          {p.fillHandle && (
            <span
              className="defter__fill-handle"
              onMouseDown={(e) => {
                e.stopPropagation()
                p.onFillStart?.()
              }}
            />
          )}
        </>
      )}
    </td>
  )
}
