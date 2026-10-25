import { useMemo, useState } from 'react'
import MonthNav from './MonthNav'
import ScheduleCalendar from './ScheduleCalendar'
import ShiftPicker from './ShiftPicker'
import DroppedShiftsPanel from './DroppedShiftsPanel'
import DefaultHoursPanel from './DefaultHoursPanel'
import { useScheduleData } from './useScheduleData'
import { assignShift, moveShift, replaceShift, resetShiftTimes, setBaristaEmail, setShiftTimes, unassignShift } from './store'
import { buildBroadcast, gmailComposeUrl } from './broadcast.js'
import { REASON_LABELS, SHIFTS, conflicts, coverageGaps, freeFor, dateKey, dayTypeFor, formatDay, openShifts, pickerLists, shiftsOnDay } from './shifts.js'
import './schedule.css'

// The Gmail account the broadcast opens in, so it goes out from the shop.
const BROADCAST_ACCOUNT = import.meta.env.VITE_BROADCAST_GMAIL_ACCOUNT || 'brbcafeatx@gmail.com'

const addDays = (key, days) => {
  const [year, month, day] = key.split('-').map(Number)
  return dateKey(new Date(year, month - 1, day + days))
}

const copy = async (text, what) => {
  try {
    await navigator.clipboard.writeText(text)
    alert(`${what} copied.`)
  } catch {
    window.prompt(`Copy the ${what.toLowerCase()}:`, text)
  }
}

function BroadcastPanel({ data, month }) {
  const todayKey = dateKey(new Date())
  const monthStart = dateKey(month)
  const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0))

  const presets = {
    month: { label: 'Month shown above', start: monthStart < todayKey && monthEnd >= todayKey ? todayKey : monthStart, end: monthEnd },
    week: { label: 'Next 7 days', start: todayKey, end: addDays(todayKey, 6) },
    twoWeeks: { label: 'Next 14 days', start: todayKey, end: addDays(todayKey, 13) },
  }
  const [preset, setPreset] = useState('month')
  const [custom, setCustom] = useState({ start: todayKey, end: addDays(todayKey, 6) })
  const range = preset === 'custom' ? custom : presets[preset]

  const email = useMemo(
    () => (range.start && range.end && range.start <= range.end
      ? buildBroadcast({ assignments: data.assignments, baristas: data.baristas, startKey: range.start, endKey: range.end, timesFor: data.timesFor })
      : null),
    [data.assignments, data.baristas, data.timesFor, range.start, range.end]
  )

  // Edits stick until "Reset"; otherwise the draft follows the schedule live.
  const [editedBody, setEditedBody] = useState(null)
  const body = editedBody ?? email?.body ?? ''

  const [emailDrafts, setEmailDrafts] = useState({})
  const missing = email ? data.baristas.filter((barista) => email.missingEmail.includes(barista.name)) : []

  return (
    <section className="sched-panel">
      <h3>Broadcast the schedule</h3>
      <p className="sched-muted">
        One email to everyone working in the dates below, with their own shifts at the top and the full schedule underneath.
        Addresses go in BCC.
      </p>

      <div className="sched-range">
        {Object.entries(presets).map(([id, item]) => (
          <label key={id}>
            <input type="radio" name="range" checked={preset === id} onChange={() => { setPreset(id); setEditedBody(null) }} />
            {item.label}
          </label>
        ))}
        <label>
          <input type="radio" name="range" checked={preset === 'custom'} onChange={() => { setPreset('custom'); setEditedBody(null) }} />
          Custom
        </label>
        {preset === 'custom' && (
          <span className="sched-range-custom">
            <input type="date" value={custom.start} onChange={(event) => { setCustom({ ...custom, start: event.target.value }); setEditedBody(null) }} />
            to
            <input type="date" value={custom.end} onChange={(event) => { setCustom({ ...custom, end: event.target.value }); setEditedBody(null) }} />
          </span>
        )}
      </div>

      {!email ? (
        <p className="sched-warning">Pick a start date on or before the end date.</p>
      ) : (
        <>
          <p>
            <strong>{email.shiftCount}</strong> shift{email.shiftCount === 1 ? '' : 's'} ·{' '}
            <strong>{email.to.length}</strong> recipient{email.to.length === 1 ? '' : 's'}
            {email.openCount > 0 && <> · <span className="sched-open-text">{email.openCount} still open</span></>}
          </p>

          {missing.length > 0 && (
            <div className="sched-warning">
              <p>No email address for {missing.map((barista) => barista.name).join(', ')}, so they won't get it:</p>
              {missing.map((barista) => (
                <form
                  key={barista.id}
                  className="sched-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (emailDrafts[barista.id]) setBaristaEmail(barista, emailDrafts[barista.id])
                  }}
                >
                  <span>{barista.name}</span>
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={emailDrafts[barista.id] || ''}
                    onChange={(event) => setEmailDrafts({ ...emailDrafts, [barista.id]: event.target.value })}
                  />
                  <button type="submit" className="sched-btn">Save</button>
                </form>
              ))}
            </div>
          )}

          <label className="sched-field">
            Subject
            <input value={email.subject} readOnly />
          </label>
          <label className="sched-field">
            Message {editedBody !== null && (
              <button type="button" className="sched-link-btn" onClick={() => setEditedBody(null)}>Reset to the current schedule</button>
            )}
            <textarea rows={14} value={body} onChange={(event) => setEditedBody(event.target.value)} />
          </label>

          <div className="sched-actions">
            <a
              className={`sched-btn sched-btn-primary ${email.to.length ? '' : 'is-disabled'}`}
              href={email.to.length ? gmailComposeUrl({ to: email.to, subject: email.subject, body, account: BROADCAST_ACCOUNT }) : undefined}
              target="_blank"
              rel="noreferrer"
            >
              Open in Gmail
            </a>
            <button type="button" className="sched-btn" onClick={() => copy(body, 'Message')}>Copy message</button>
            <button type="button" className="sched-btn" onClick={() => copy(email.to.join(', '), 'Addresses')} disabled={!email.to.length}>
              Copy addresses
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default function AdminScheduleTab() {
  const data = useScheduleData()
  const [month, setMonth] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [picking, setPicking] = useState(null)

  const todayKey = dateKey(new Date())
  const monthStart = dateKey(month)
  const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0))

  const open = useMemo(
    () => (monthEnd < todayKey ? [] : openShifts({
      startKey: monthStart > todayKey ? monthStart : todayKey,
      endKey: monthEnd,
      assignmentsByDate: data.assignmentsByDate,
    })),
    [data.assignmentsByDate, monthStart, monthEnd, todayKey]
  )
  const clashes = useMemo(
    () => conflicts({ assignments: data.assignments, availabilityOf: data.availabilityOf })
      .filter((entry) => entry.date >= todayKey)
      .sort((left, right) => left.date.localeCompare(right.date)),
    [data.assignments, data.availabilityOf, todayKey]
  )

  if (data.loading) return <div className="sched-root"><p className="sched-muted">Loading schedule…</p></div>

  return (
    <div className="sched-root sched-admin">
      {data.error && (
        <p className="sched-error">
          {data.error} <button type="button" className="sched-link-btn" onClick={data.clearError}>Dismiss</button>
        </p>
      )}

      <DroppedShiftsPanel
        data={data}
        gmailAccount={BROADCAST_ACCOUNT}
        onFill={(date, shift) => setPicking({ date, shift })}
      />

      <MonthNav month={month} onChange={setMonth} />
      <Legend />
      <ScheduleCalendar
        month={month}
        assignmentsByDate={data.assignmentsByDate}
        timesFor={data.timesFor}
        showGaps
        addMiddle
        colors={data.colors}
        freeCount={(date, shift) => freeFor({ baristas: data.baristas, date, shift, availabilityOf: data.availabilityOf }).length}
        onPick={(date, shift, focusId) => setPicking({ date, shift, focusId })}
      />

      <div className="sched-panels">
        <section className="sched-panel">
          <h3>Open shifts <span className="sched-count">{open.length}</span></h3>
          {open.length === 0 ? (
            <p className="sched-muted">Every shift from today to the end of this month is covered.</p>
          ) : (
            <ul className="sched-open-list">
              {open.map((entry) => (
                <li key={`${entry.date}_${entry.shift}`}>
                  <button type="button" className={`sched-open-chip sched-bubble-${entry.shift}`} onClick={() => setPicking(entry)}>
                    {formatDay(entry.date)} · {SHIFTS[entry.shift].label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sched-panel">
          <h3>Scheduled when they can't <span className="sched-count">{clashes.length}</span></h3>
          {clashes.length === 0 ? (
            <p className="sched-muted">Nobody is on a shift they said they can't do.</p>
          ) : (
            <ul className="sched-clash-list">
              {clashes.map((entry) => (
                <li key={entry.id}>
                  <span>
                    <strong>{entry.baristaName}</strong> · {formatDay(entry.date)} · {SHIFTS[entry.shift].label}{' '}
                    <span className="sched-reason">{REASON_LABELS[entry.reason]}</span>
                  </span>
                  <span>
                    <button type="button" className="sched-link-btn" onClick={() => setPicking({ ...entry, focusId: entry.baristaId })}>Find cover</button>
                    <button type="button" className="sched-link-btn" onClick={() => unassignShift(entry)}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <DefaultHoursPanel hours={data.hours} />

      <BroadcastPanel data={data} month={month} />

      {picking && (
        <ShiftPicker
          date={picking.date}
          shift={picking.shift}
          lists={pickerLists({ ...data, date: picking.date, shift: picking.shift })}
          focusId={picking.focusId}
          isAdmin
          onAssign={async (barista) => {
            if (await assignShift(picking.date, picking.shift, barista, 'admin')) setPicking(null)
          }}
          onRemove={unassignShift}
          onMove={(entry, toShift) => moveShift(entry, toShift, 'admin')}
          onReplace={replaceShift}
          hours={data.timesFor(picking.date, picking.shift)}
          defaultHours={data.hours[dayTypeFor(picking.date)][picking.shift]}
          onSaveHours={(range) => setShiftTimes(picking.date, picking.shift, range)}
          onResetHours={() => resetShiftTimes(picking.date, picking.shift)}
          gapsWith={(range) =>
            coverageGaps(
              picking.date,
              (date, shift) => (shift === picking.shift ? range : data.timesFor(date, shift)),
              // The shift being edited counts even before anyone is on it (a new middle shift).
              [...new Set([...shiftsOnDay(picking.date, data.assignmentsByDate[picking.date]), picking.shift])]
            )
          }
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

export function Legend() {
  return (
    <div className="sched-legend">
      {Object.values(SHIFTS).map((shift) => (
        <span key={shift.id} className={`sched-legend-item sched-bubble-${shift.id}`}>{shift.label}</span>
      ))}
      <span className="sched-legend-item is-open">Empty — needs someone</span>
      <span className="sched-legend-item is-custom-key">
        <span className="sched-bubble-time is-custom">2pm – 6pm</span> hours changed for that day
      </span>
    </div>
  )
}
