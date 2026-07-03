export interface Sample {
  id: string
  label: string
  text: string
}

const invoice = `## Sheet: Invoice

| Item | Qty | Unit | Total |
| --- | ---: | ---: | ---: |
| Design system audit | 12 | 140 | =B2*C2 |
| Component build | 34 | 120 | =B3*C3 |
| Motion & polish | 8 | 160 | =B4*C4 |
| Subtotal |  |  | =SUM(D2:D4) |
| Tax (20%) |  |  | =D5*0.2 |
| **Total due** |  |  | =D5+D6 |

\`\`\`defter-style
A1:D1  bold fill=surface-3 align=center
D2:D7  format=$#,##0.00
A5:A7  bold
D5:D7  bold border=top
A7:D7  fill=accent-soft
\`\`\`
`

const budget = `## Sheet: Q3 Budget

| Team | Planned | Actual | Variance | Status |
| --- | ---: | ---: | ---: | :-: |
| Engineering | 42000 | 39120 | =B2-C2 | =IF(D2>=0,"under","over") |
| Design | 18000 | 19850 | =B3-C3 | =IF(D3>=0,"under","over") |
| Marketing | 27000 | 24300 | =B4-C4 | =IF(D4>=0,"under","over") |
| Ops | 15500 | 15500 | =B5-C5 | =IF(D5>=0,"under","over") |
| **All teams** | =SUM(B2:B5) | =SUM(C2:C5) | =B6-C6 | =IF(D6>=0,"under","over") |

\`\`\`defter-style
A1:E1  bold fill=surface-3
B2:D6  format=#,##0
A6:E6  bold border=top
when D2:D6 >= 0  color=success
when D2:D6 < 0  color=danger bold
chart type=bar title="Actual spend by team" x=A2:A5 y=C2:C5
chart type=pie title="Budget share" x=A2:A5 y=B2:B5
\`\`\`
`

const planner = `## Sheet: Roadmap

| Feature | Effort | Impact | Score | Priority |
| --- | ---: | ---: | ---: | :-: |
| Minimal-splice CRDT | 8 | 10 | =C2/B2 | =IF(D2>=1,"P0","P1") |
| Charts in style layer | 5 | 7 | =C3/B3 | =IF(D3>=1,"P0","P1") |
| xlsx import | 3 | 6 | =C4/B4 | =IF(D4>=1,"P0","P1") |
| Multi-cursor awareness | 6 | 5 | =C5/B5 | =IF(D5>=1,"P0","P1") |

\`\`\`defter-style
A1:E1  bold fill=accent-soft align=center
D2:D5  format=0.00
E2:E5  bold
\`\`\`
`

const multi = `## Sheet: Sales

| Month | Units | Price | Revenue |
| --- | ---: | ---: | ---: |
| Jan | 120 | 29 | =B2*C2 |
| Feb | 145 | 29 | =B3*C3 |
| Mar | 190 | 32 | =B4*C4 |

\`\`\`defter-style
A1:D1  bold fill=surface-3
D2:D4  format=$#,##0
\`\`\`

## Sheet: Summary

| Metric | Value |
| --- | ---: |
| Total units | =SUM(Sales!B2:B4) |
| Total revenue | =SUM(Sales!D2:D4) |
| Avg price | =Summary!B3/Summary!B2 |
| Best month | =Sales!A4 |

\`\`\`defter-style
A1:B1  bold fill=accent-soft
B2  format=#,##0
B3:B4  format=$#,##0.00
\`\`\`
`

export const SAMPLES: Sample[] = [
  { id: 'invoice', label: 'Invoice', text: invoice },
  { id: 'budget', label: 'Budget', text: budget },
  { id: 'planner', label: 'Roadmap', text: planner },
  { id: 'multi', label: 'Multi-sheet', text: multi },
]
