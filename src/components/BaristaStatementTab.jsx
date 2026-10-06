import { useState, useMemo } from 'react'
import {
  windowFor, computeStatement, namesFrom, periodKey,
  DEFAULT_INCOME_TAX_RATE,
} from '../lib/statement'
import '../styles/BaristaStatement.css'

/*
 * Per-barista earnings statement over a chosen window.
 *
 * Reads the saved weekly tipReports rather than recomputing from the calendar:
 * those reports are what was actually paid out, so a statement always matches
 * the money that changed hands even if the schedule was edited afterwards.
 *
 * All the arithmetic lives in ../lib/statement.js so it can be tested.
 */

const money = (v) => `$${(Number(v) || 0).toFixed(2)}`

function BaristaStatementTab({ baristas, reports }) {
  const [name, setName] = useState('')
  const [preset, setPreset] = useState('thisMonth')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [basis, setBasis] = useState('weekStart')
  const [incomeRate, setIncomeRate] = useState(DEFAULT_INCOME_TAX_RATE)
  const [includeSE, setIncludeSE] = useState(true)
  const [copied, setCopied] = useState(false)

  // Anyone in the roster OR in any saved report, so people who have left still
  // have a statement you can produce.
  const names = useMemo(() => namesFrom(baristas, reports), [baristas, reports])

  const win = useMemo(() => windowFor(preset, custom), [preset, custom.from, custom.to])
  const keyOf = (r) => periodKey(r, basis)

  const statement = useMemo(
    () => computeStatement({ reports, name, window: win, basis, includeSE, incomeRate }),
    [reports, name, win, basis, includeSE, incomeRate]
  )

  const statementText = () => {
    if (!statement) return ''
    const L = []
    L.push('*BRB Earnings Statement*')
    L.push(`*${name}*`)
    L.push(`*Period:* ${win.label}`)
    L.push('')
    L.push(`Shifts: ${statement.totals.shifts}  |  Hours: ${statement.totals.hours.toFixed(1)}`)
    L.push(`Base pay: ${money(statement.totals.basePay)}`)
    L.push(`Tips: ${money(statement.totals.tips)}`)
    L.push(`*Gross earnings: ${money(statement.gross)}*`)
    L.push('')
    L.push('*Estimated tax to set aside*')
    if (includeSE) L.push(`Self-employment (15.3% of 92.35%): ${money(statement.seTax)}`)
    if (Number(incomeRate) > 0) L.push(`Federal income (${incomeRate}%): ${money(statement.incomeTax)}`)
    L.push(`Texas state income tax: $0.00 (none)`)
    L.push(`*Set aside: ${money(statement.taxSetAside)}*`)
    L.push(`Left after setting that aside: ${money(statement.netAfterSetAside)}`)
    L.push('')
    L.push(`You are paid as a 1099 contractor — nothing is withheld for you.`)
    L.push(`${statement.year} earnings to date: ${money(statement.ytd)}${statement.needs1099 ? ' (over $600, you will get a 1099-NEC)' : ' (under $600 so far)'}`)
    L.push('')
    L.push('_Estimate only, to help you set money aside. Your actual tax depends on your other income, filing status and deductions._')
    return L.join('\n')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statementText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('Clipboard blocked — select the text below and copy it manually.')
    }
  }

  const share = async () => {
    const text = statementText()
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch (err) {
        if (err.name === 'AbortError') return
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  const downloadCsv = () => {
    if (!statement) return
    const rows = [['Week', 'Shifts', 'Hours', 'Base pay', 'Tips', 'Total']]
    statement.weeks.forEach((r) => {
      const e = r.earnings[name]
      rows.push([
        keyOf(r), e.shifts || 0, (Number(e.hours) || 0).toFixed(2),
        (Number(e.basePay) || 0).toFixed(2), (Number(e.tips) || 0).toFixed(2),
        ((Number(e.basePay) || 0) + (Number(e.tips) || 0)).toFixed(2),
      ])
    })
    rows.push(['TOTAL', statement.totals.shifts, statement.totals.hours.toFixed(2),
      statement.totals.basePay.toFixed(2), statement.totals.tips.toFixed(2), statement.gross.toFixed(2)])
    rows.push([])
    rows.push(['Estimated self-employment tax', statement.seTax.toFixed(2)])
    rows.push([`Estimated federal income tax (${incomeRate}%)`, statement.incomeTax.toFixed(2)])
    rows.push(['Total to set aside', statement.taxSetAside.toFixed(2)])
    rows.push(['Left after set-aside', statement.netAfterSetAside.toFixed(2)])

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `brb-${name.toLowerCase().replace(/\s+/g, '-')}-${win.from}-to-${win.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="statement-section">
      <div className="statement-controls">
        <div className="form-group">
          <label>Barista</label>
          <select value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Select a barista…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Period</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="ever">Ever (all time)</option>
            <option value="thisMonth">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="thisWeek">This week</option>
            <option value="lastWeek">Last week</option>
            <option value="custom">Custom range…</option>
          </select>
        </div>

        {preset === 'custom' && (
          <>
            <div className="form-group">
              <label>From</label>
              <input type="date" value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </div>
            <div className="form-group">
              <label>To</label>
              <input type="date" value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          </>
        )}

        <div className="form-group">
          <label>Attribute week by</label>
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="weekStart">Week start date</option>
            <option value="weekEnd">Week end date</option>
          </select>
        </div>
      </div>

      <div className="tax-controls">
        <label className="check">
          <input type="checkbox" checked={includeSE}
            onChange={(e) => setIncludeSE(e.target.checked)} />
          Include self-employment tax (15.3% on 92.35% of earnings)
        </label>
        <label className="rate">
          Federal income tax estimate
          <input type="number" min="0" max="50" step="1" value={incomeRate}
            onChange={(e) => setIncomeRate(e.target.value)} />
          %
        </label>
      </div>

      {!name && <p className="empty-state">Pick a barista to build their statement.</p>}

      {name && statement && statement.weeks.length === 0 && (
        <p className="empty-state">
          No saved tip reports for <b>{name}</b> in {win.label.toLowerCase()}.
        </p>
      )}

      {name && statement && statement.weeks.length > 0 && (
        <>
          <div className="statement-card">
            <h3>{name}</h3>
            <p className="period">{win.label} · {statement.weeks.length} week{statement.weeks.length === 1 ? '' : 's'}</p>

            <table className="statement-table">
              <tbody>
                <tr><th>Shifts</th><td>{statement.totals.shifts}</td></tr>
                <tr><th>Hours</th><td>{statement.totals.hours.toFixed(1)}</td></tr>
                <tr><th>Base pay (income without tips)</th><td>{money(statement.totals.basePay)}</td></tr>
                <tr><th>Tips</th><td>{money(statement.totals.tips)}</td></tr>
                <tr className="total"><th>Gross earnings</th><td>{money(statement.gross)}</td></tr>
              </tbody>
            </table>

            <h4>Estimated tax to set aside</h4>
            <table className="statement-table">
              <tbody>
                {includeSE && (
                  <tr><th>Self-employment (15.3% × 92.35%)</th><td>{money(statement.seTax)}</td></tr>
                )}
                {Number(incomeRate) > 0 && (
                  <tr><th>Federal income ({incomeRate}%)</th><td>{money(statement.incomeTax)}</td></tr>
                )}
                <tr><th>Texas state income tax</th><td>$0.00</td></tr>
                <tr className="total"><th>Set aside</th><td>{money(statement.taxSetAside)}</td></tr>
                <tr><th>Left after set-aside</th><td>{money(statement.netAfterSetAside)}</td></tr>
              </tbody>
            </table>

            <p className={`ten99 ${statement.needs1099 ? 'over' : ''}`}>
              {statement.year} to date: <b>{money(statement.ytd)}</b>{' '}
              {statement.needs1099
                ? '— over $600, so a 1099-NEC is due for this person.'
                : '— under the $600 1099-NEC threshold so far.'}
            </p>

            <p className="disclaimer">
              An estimate to help them set money aside, not tax advice. Actual liability
              depends on their other income, filing status and deductions.
            </p>
          </div>

          <details className="week-breakdown">
            <summary>Week by week ({statement.weeks.length})</summary>
            <table className="statement-table breakdown">
              <thead>
                <tr><th>Week</th><th>Shifts</th><th>Hours</th><th>Base</th><th>Tips</th><th>Total</th></tr>
              </thead>
              <tbody>
                {statement.weeks.map((r) => {
                  const e = r.earnings[name]
                  return (
                    <tr key={r.id || keyOf(r)}>
                      <td>{keyOf(r)}</td>
                      <td>{e.shifts || 0}</td>
                      <td>{(Number(e.hours) || 0).toFixed(1)}</td>
                      <td>{money(e.basePay)}</td>
                      <td>{money(e.tips)}</td>
                      <td>{money((Number(e.basePay) || 0) + (Number(e.tips) || 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>

          <div className="action-buttons">
            <button onClick={copy} className="copy-report-btn">
              {copied ? 'Copied' : 'Copy statement'}
            </button>
            <button onClick={share}>Send</button>
            <button onClick={downloadCsv}>Download CSV</button>
          </div>

          <pre className="report-text-block">{statementText()}</pre>
        </>
      )}
    </div>
  )
}

export default BaristaStatementTab
