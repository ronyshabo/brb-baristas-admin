import { useEffect, useState } from 'react'
import { DAY_ORDER, DAY_TYPES, DEFAULT_HOURS, SHIFTS, SHIFT_ORDER, formatRange, formatTime, isValidRange } from './shifts.js'
import { saveDefaultHours } from './store'

// Shared runs Fri-Sun and Friday uses weekday hours, so the weekday row's
// Shared column is labelled "Fridays". Middle is only used on days the admin
// adds one, so gaps are checked over the regular shifts alone.
const gapsIn = (dayHours) => {
  const ranges = SHIFT_ORDER.map((shift) => dayHours[shift]).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start))
  const gaps = []
  let until = ranges[0]?.end
  for (const range of ranges.slice(1)) {
    if (range.start > until) gaps.push(`${formatTime(until)}–${formatTime(range.start)}`)
    if (range.end > until) until = range.end
  }
  return gaps
}

/**
 * Default hours for every shift, Mon-Fri and Sat-Sun. One shift on one date
 * can still be adjusted from its pop-up; those adjustments are kept when the
 * defaults change.
 */
export default function DefaultHoursPanel({ hours }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(hours)
  useEffect(() => setDraft(hours), [hours])

  const setTime = (dayType, shift, edge, value) =>
    setDraft({ ...draft, [dayType]: { ...draft[dayType], [shift]: { ...draft[dayType][shift], [edge]: value } } })

  const invalid = Object.values(draft).some((day) => Object.values(day).some((range) => !isValidRange(range)))
  const changed = JSON.stringify(draft) !== JSON.stringify(hours)

  return (
    <section className="sched-panel">
      <div className="sched-alerts-head">
        <h3>Shift hours</h3>
        <button type="button" className="sched-link-btn" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Change default hours'}
        </button>
      </div>

      {!open ? (
        <div className="sched-hours-summary">
          {Object.values(DAY_TYPES).map((dayType) => (
            <p key={dayType.id}>
              <strong>{dayType.label}:</strong>{' '}
              {DAY_ORDER.map((shift) => (
                <span key={shift} className={`sched-hours-chip sched-bubble-${shift}`}>
                  {SHIFTS[shift].label}{dayType.id === 'weekday' && shift === 'shared' ? ' (Fri)' : ''} {formatRange(hours[dayType.id][shift])}
                </span>
              ))}
            </p>
          ))}
          <p className="sched-muted">To change one shift on one day (someone leaving early), open that shift on the calendar.</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!invalid && changed) saveDefaultHours(draft)
          }}
        >
          <table className="sched-hours-table">
            <thead>
              <tr>
                <th />
                {DAY_ORDER.map((shift) => <th key={shift}>{SHIFTS[shift].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.values(DAY_TYPES).map((dayType) => (
                <tr key={dayType.id}>
                  <th scope="row">
                    {dayType.label}
                    {gapsIn(draft[dayType.id]).length > 0 && (
                      <span className="sched-gap-tag">nobody {gapsIn(draft[dayType.id]).join(', ')}</span>
                    )}
                  </th>
                  {DAY_ORDER.map((shift) => {
                    const range = draft[dayType.id][shift]
                    return (
                      <td key={shift} className={isValidRange(range) ? '' : 'is-invalid'}>
                        <input type="time" step="900" value={range.start} onChange={(event) => setTime(dayType.id, shift, 'start', event.target.value)} aria-label={`${dayType.label} ${SHIFTS[shift].label} start`} />
                        <span>–</span>
                        <input type="time" step="900" value={range.end} onChange={(event) => setTime(dayType.id, shift, 'end', event.target.value)} aria-label={`${dayType.label} ${SHIFTS[shift].label} end`} />
                        {dayType.id === 'weekday' && shift === 'shared' && <small className="sched-muted">Fridays</small>}
                        {shift === 'middle' && <small className="sched-muted">when added</small>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {invalid && <p className="sched-warning">Every shift's end has to be after its start.</p>}
          <div className="sched-actions">
            <button type="submit" className="sched-btn sched-btn-primary" disabled={invalid || !changed}>Save default hours</button>
            <button type="button" className="sched-btn" onClick={() => setDraft(hours)} disabled={!changed}>Undo changes</button>
            <button type="button" className="sched-link-btn" onClick={() => setDraft(DEFAULT_HOURS)}>Back to shop hours</button>
          </div>
        </form>
      )}
    </section>
  )
}
