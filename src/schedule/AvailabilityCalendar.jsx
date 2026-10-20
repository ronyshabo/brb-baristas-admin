import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SHIFTS,
  SHIFT_ORDER,
  WEEKDAY_HEADERS,
  dateEntryFor,
  dateKey,
  formatDay,
  isWholeDayOff,
  makeAvailability,
  monthGrid,
  parseDateKey,
  shiftsForDate,
} from './shifts.js'
import { markAvailable, markUnavailable, setDateShifts, setDaysOff } from './store'

// On touch screens a drag would normally scroll the page, so a drag starts
// only after holding a day this long without moving.
const HOLD_MS = 250
const MOVE_TOLERANCE_PX = 8

// Every date from a to b inclusive, in either order, skipping the past.
const datesBetween = (a, b, todayKey) => {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const keys = []
  for (let cursor = parseDateKey(from); dateKey(cursor) <= to; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor)
    if (key >= todayKey) keys.push(key)
  }
  return keys
}

const sameSet = (left, right) => left.length === right.length && left.every((entry) => right.includes(entry))

/**
 * One date: which shifts can you do that day? Starts from what applies now
 * (this date's entry, or the usual week). Saving the same as the usual week
 * just removes the date entry.
 */
function DayChooser({ date, barista, entry, usualOk, currentOk, working, onClose }) {
  const shifts = shiftsForDate(date)
  const [can, setCan] = useState(currentOk)

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirmWorking = (losing) => {
    const clash = working.filter((shift) => losing.includes(shift))
    if (!clash.length) return true
    return window.confirm(
      `You're already on the ${clash.map((shift) => SHIFTS[shift].label).join(' and ')} shift that day. This won't take you off it — let the manager know so it gets covered. Save anyway?`
    )
  }

  const save = async () => {
    const cant = shifts.filter((shift) => !can.includes(shift))
    if (!confirmWorking(cant)) return
    if (sameSet(can, usualOk)) {
      // Same as the usual week: drop the override, if there is one.
      if (entry) await markAvailable(barista, date)
    }
    else if (can.length === 0) await markUnavailable(barista, date)
    else await setDateShifts(barista, date, SHIFT_ORDER.filter((shift) => cant.includes(shift)))
    onClose()
  }

  const allOff = async () => {
    if (!confirmWorking(shifts)) return
    await markUnavailable(barista, date)
    onClose()
  }

  const backToUsual = async () => {
    await markAvailable(barista, date)
    onClose()
  }

  const usualNote = sameSet(usualOk, shifts)
    ? 'Your usual week: free all day.'
    : usualOk.length === 0
      ? "Your usual week: can't work this day."
      : `Your usual week: only ${usualOk.map((shift) => SHIFTS[shift].label).join(' and ')}.`

  return (
    <div className="sched-modal-backdrop" onClick={onClose}>
      <div className="sched-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sched-modal-header sched-header-plain">
          <div>
            <h3>My availability</h3>
            <p>{formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
          <button type="button" className="sched-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <section>
          <h4>I can work</h4>
          <div className="sched-day-choices">
            {shifts.map((shift) => {
              const on = can.includes(shift)
              return (
                <button
                  key={shift}
                  type="button"
                  className={`sched-choice ${on ? `sched-bubble-${shift}` : 'is-no'}`}
                  aria-pressed={on}
                  onClick={() => setCan(on ? can.filter((entry) => entry !== shift) : [...can, shift])}
                >
                  <span>{on ? '✓' : '✗'}</span> {SHIFTS[shift].label}
                </button>
              )
            })}
          </div>
          <p className="sched-muted sched-hint">
            {usualNote} {entry ? 'This day is set differently.' : 'This day follows it.'}
          </p>
        </section>
        <section className="sched-actions">
          <button type="button" className="sched-btn sched-btn-primary" onClick={save}>Save</button>
          <button type="button" className="sched-btn" onClick={allOff}>Off all day</button>
          {entry && (
            <button type="button" className="sched-link-btn" onClick={backToUsual}>Use my usual week</button>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * One barista's dates. Each day shows which shifts they can do (usual week
 * plus any change for that date). Tap a day to choose shifts for that date;
 * press and drag across several (hold first on a phone) to mark them all off.
 * Starting a drag on a day off clears the range back to the usual week.
 */
export default function AvailabilityCalendar({ month, barista, dateEntries, weekly, availabilityOf, assignments }) {
  const weeks = monthGrid(month.getFullYear(), month.getMonth())
  const todayKey = dateKey(new Date())
  const gridRef = useRef(null)
  const dragRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [choosing, setChoosing] = useState(null)

  const usualOf = useMemo(() => makeAvailability([], weekly), [weekly])

  const myShifts = {}
  for (const entry of assignments) {
    if (entry.baristaId === barista.id) (myShifts[entry.date] ||= []).push(entry.shift)
  }
  const isOff = (key) => isWholeDayOff(dateEntries, barista.id, key)

  // Latest values for the window listeners below, which are attached once.
  const latest = useRef({})
  latest.current = { isOff, myShifts, barista, todayKey }

  const commitRange = (keys, markOff) => {
    const { isOff: off, myShifts: shifts, barista: who } = latest.current
    const changes = keys.filter((key) => off(key) !== markOff)
    if (changes.length === 0) return
    if (markOff) {
      const working = changes.filter((key) => shifts[key]?.length)
      if (working.length) {
        const lines = working.map((key) => `• ${formatDay(key)} — ${shifts[key].map((shift) => SHIFTS[shift].label).join(' and ')}`)
        const ok = window.confirm(
          `You're already on the schedule:\n${lines.join('\n')}\n\nMarking these days off won't take you off those shifts — let the manager know so they get covered. Mark them off anyway?`
        )
        if (!ok) return
      }
    }
    setDaysOff(who, changes, markOff)
  }

  const showPreview = (drag) =>
    setPreview({ keys: new Set(datesBetween(drag.anchor, drag.current, latest.current.todayKey)), markOff: drag.markOff })

  const onPointerDown = (event, key) => {
    if (key < todayKey || event.button > 0) return
    const drag = {
      anchor: key,
      current: key,
      markOff: !isOff(key),
      active: event.pointerType === 'mouse',
      x: event.clientX,
      y: event.clientY,
      timer: null,
    }
    if (drag.active) {
      showPreview(drag)
    } else {
      drag.timer = setTimeout(() => {
        drag.active = true
        navigator.vibrate?.(15)
        showPreview(drag)
      }, HOLD_MS)
    }
    dragRef.current = drag
  }

  useEffect(() => {
    const end = () => {
      const drag = dragRef.current
      if (drag) clearTimeout(drag.timer)
      dragRef.current = null
      setPreview(null)
      return drag
    }

    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.active) {
        // Moved before the hold finished: this is a scroll, not a drag.
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > MOVE_TOLERANCE_PX) end()
        return
      }
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-date]')
      const key = cell && gridRef.current?.contains(cell) ? cell.dataset.date : null
      if (key && key !== drag.current) {
        drag.current = key
        showPreview(drag)
      }
    }

    const onUp = () => {
      const drag = end()
      if (!drag) return
      // Released on the day it started: that's a tap, so open the chooser.
      if (drag.anchor === drag.current) setChoosing(drag.anchor)
      else commitRange(datesBetween(drag.anchor, drag.current, latest.current.todayKey), drag.markOff)
    }

    // Once a drag is active, stop the page from scrolling under the finger.
    const onTouchMove = (event) => {
      if (dragRef.current?.active) event.preventDefault()
    }

    const grid = gridRef.current
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', end)
    grid?.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', end)
      grid?.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  const okShifts = (key, of) => shiftsForDate(key).filter((shift) => of(barista.id, key, shift).ok)
  const offThisMonth = weeks.flat().filter((key) => key && isOff(key)).length

  return (
    <div className="sched-availability">
      <p className="sched-muted sched-avail-help">
        {preview ? (
          <strong>
            {preview.markOff ? 'Marking' : 'Clearing'} {preview.keys.size} day{preview.keys.size === 1 ? '' : 's'}
            {preview.markOff ? ' off' : ' back to your usual week'}…
          </strong>
        ) : (
          <>
            Tap a day to choose which shifts you can do that day, or drag across several days to mark them all off
            (on a phone, hold a day first, then drag).
            {offThisMonth > 0 && ` ${offThisMonth} day${offThisMonth === 1 ? '' : 's'} off this month.`}
          </>
        )}
      </p>
      <div
        ref={gridRef}
        className={`sched-calendar sched-calendar-compact sched-avail-grid ${preview ? 'is-dragging' : ''}`}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="sched-weekdays">
          {WEEKDAY_HEADERS.map((day) => <div key={day}>{day}</div>)}
        </div>
        {weeks.map((week, index) => (
          <div className="sched-week" key={index}>
            {week.map((key, column) => {
              if (!key) return <div key={`empty-${column}`} className="sched-day is-empty" />
              const past = key < todayKey
              const off = isOff(key)
              const custom = Boolean(dateEntryFor(dateEntries, barista.id, key))
              const inPreview = preview?.keys.has(key)
              const shifts = shiftsForDate(key)
              const ok = okShifts(key, availabilityOf)
              const partial = !off && ok.length < shifts.length
              const working = myShifts[key]
              return (
                <button
                  key={key}
                  type="button"
                  data-date={key}
                  disabled={past}
                  onPointerDown={(event) => onPointerDown(event, key)}
                  // Pointer handlers do the work; this is for keyboard users only.
                  onClick={(event) => event.detail === 0 && setChoosing(key)}
                  className={[
                    'sched-day',
                    'sched-avail-day',
                    off && 'is-off',
                    partial && 'is-partial',
                    custom && 'is-custom',
                    past && 'is-past',
                    key === todayKey && 'is-today',
                    inPreview && (preview.markOff ? 'is-preview-off' : 'is-preview-on'),
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={`${formatDay(key)}: ${off ? 'day off' : ok.length === shifts.length ? 'free' : `only ${ok.map((shift) => SHIFTS[shift].label).join(', ') || 'none'}`}`}
                >
                  <span className="sched-day-number">{Number(key.slice(8))}</span>
                  <span className="sched-avail-state">
                    {inPreview ? (preview.markOff ? 'Off' : 'Usual') : off ? 'Off' : past ? '' : partial ? 'Some' : 'Free'}
                  </span>
                  {!past && !off && !inPreview && (
                    <span className="sched-avail-dots">
                      {shifts.map((shift) => (
                        <span
                          key={shift}
                          className={`sched-avail-dot ${ok.includes(shift) ? `sched-bubble-${shift}` : 'is-no'}`}
                          title={`${SHIFTS[shift].label}: ${ok.includes(shift) ? 'can' : "can't"}`}
                        >
                          {SHIFTS[shift].label[0]}
                        </span>
                      ))}
                    </span>
                  )}
                  {working && (
                    <span className="sched-avail-working">On: {working.map((shift) => SHIFTS[shift].short).join(' · ')}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="sched-muted sched-avail-legend">
        <span className="sched-avail-dot sched-bubble-opening">O</span> Opening{' '}
        <span className="sched-avail-dot sched-bubble-closing">C</span> Closing{' '}
        <span className="sched-avail-dot sched-bubble-shared">S</span> Shared{' '}
        <span className="sched-avail-dot is-no">X</span> can't · a black corner means that day is set differently from
        your usual week.
      </p>

      {choosing && (
        <DayChooser
          key={choosing}
          date={choosing}
          barista={barista}
          entry={dateEntryFor(dateEntries, barista.id, choosing)}
          usualOk={okShifts(choosing, usualOf)}
          currentOk={okShifts(choosing, availabilityOf)}
          working={myShifts[choosing] || []}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  )
}
