import { createEngine } from '@defter/formula'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { DefterGrid } from './DefterGrid.js'

const engine = createEngine()

/** Controlled wrapper so stories are live-editable. */
function Grid(props: Omit<React.ComponentProps<typeof DefterGrid>, 'text' | 'onChange'> & { initial: string }) {
  const { initial, ...rest } = props
  const [text, setText] = useState(initial)
  return (
    <div style={{ height: 420 }}>
      <DefterGrid text={text} onChange={setText} engine={engine} {...rest} />
    </div>
  )
}

const meta: Meta<typeof Grid> = {
  title: 'DefterGrid',
  component: Grid,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Grid>

const INVOICE = `## Sheet: Invoice

| Item | Qty | Unit | Total |
| --- | ---: | ---: | ---: |
| Design | 12 | 140 | =B2*C2 |
| Build | 34 | 120 | =B3*C3 |
| Subtotal |  |  | =SUM(D2:D3) |
| **Total** |  |  | =D4*1.2 |

\`\`\`defter-style
A1:D1  bold fill=surface-3 align=center
D2:D5  format=$#,##0.00
A4:D5  bold border=top
\`\`\`
`

export const Playground: Story = {
  args: { initial: INVOICE, toolbar: true, formulaBar: true, statusBar: true, sheetTabs: true },
}

export const Empty: Story = {
  args: { initial: '| A | B | C |\n|---|---|---|\n|  |  |  |\n' },
}

export const FormulasAndStyling: Story = {
  args: { initial: INVOICE, formulaBar: true },
}

export const Errors: Story = {
  args: {
    initial:
      '| Case | Result |\n| --- | --- |\n| div/0 | =1/0 |\n| value | ="x"*2 |\n| name | =NOPE() |\n| cycle | =B5 |\n',
  },
}

export const Large: Story = {
  args: {
    initial: (() => {
      const cols = 12
      const header = `| ${Array.from({ length: cols }, (_, c) => `C${c + 1}`).join(' | ')} |`
      const delim = `| ${Array(cols).fill('---').join(' | ')} |`
      const rows = Array.from({ length: 40 }, (_, r) =>
        `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `r${r + 1}` : String((r + 1) * (c + 1)))).join(' | ')} |`,
      )
      return [header, delim, ...rows].join('\n')
    })(),
    statusBar: true,
  },
}

export const ReadOnly: Story = {
  args: { initial: INVOICE, readOnly: true },
  render: (args) => (
    <div style={{ height: 420 }}>
      <DefterGrid text={args.initial} engine={engine} readOnly theme="light" />
    </div>
  ),
}

export const DarkTheme: Story = {
  args: { initial: INVOICE, theme: 'dark', toolbar: true, formulaBar: true, statusBar: true },
}

export const PaperTheme: Story = {
  args: { initial: INVOICE, theme: 'paper', toolbar: true, formulaBar: true, statusBar: true },
}
