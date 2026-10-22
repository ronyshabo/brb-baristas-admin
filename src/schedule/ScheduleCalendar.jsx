import { useEffect, useRef } from 'react'
import { SHIFTS, WEEKDAY_HEADERS, coverageGaps, dateKey, formatRange, formatTime, isShiftOpen, monthGrid, parseDateKey, shiftsOnDay } from './shifts.js'

// One shift on one day. The heading opens the shift; each name opens it with
// that person picked, so they can be moved, swapped or removed.
function ShiftBubble({ date, shift, hours, assigned, myId, past, onPick, nobodyFree, colors }) {
  const open = isShiftOpen(assigned)
  const mine = myId && assigned.some((entry) => entry.baristaId === myId)
  const classes = ['sched-bubble', `sched-bubble-${shift}`, open && 'is-open', mine && 'is-mine', past && 'is-past']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} onClick={() => onPick(date, shift)}>
      <button
        type="button"
        className="sched-bubble-head"
        onClick={(event) => { event.stopPropagation(); onPick(date, shift) }}
        aria-label={`${SHIFTS[shift].label} shift, ${formatRange(hours)}${hours.custom ? ' (adjusted)' : ''}${open ? ', needs someone' : ''}`}
      >
        <span className="sched-bubble-label">{SHIFTS[shift].label}</span>
        <span className={`sched-bubble-time ${hours.custom ? 'is-custom' : ''}`} title={hours.custom ? 'Hours adjusted for this day' : undefined}>
          {formatRange(hours)}
        </span>
        {open && <span className="sched-bubble-empty">Empty</span>}
        {open && nobodyFree && <span className="sched-nobody-tag" title="Every barista said they can't do this shift">nobody free</span>}
      </button>
      {assigned.length > 0 && (
        <ul className="sched-bubble-names">
          {assigned.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`sched-name ${entry.baristaId === myId ? 'is-me' : ''} ${colors?.[entry.baristaId] ? 'has-color' : ''}`}
                style={colors?.[entry.baristaId] ? { '--who': colors[entry.baristaId] } : undefined}
                onClick={(event) => { event.stopPropagation(); onPick(date, shift, entry.baristaId) }}
              >
                {entry.baristaName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The month grid. Each day: Opening on top, Closing below, and on shared days
 * (Fri-Sun) a Shared bubble to their right, centred between them. A Middle
 * shift, when someone is on one, sits between Opening and Closing. Weekend
 * columns are wider so full names fit; on phones the grid becomes a list.
 *
 * onPick(date, shift, baristaId?) - baristaId when a name was tapped
 * myId      - highlights this barista's shifts
 * offDates  - Set of dates to mark "off" (the signed-in barista's days off)
 * lockPast  - dims past days (the picker opens read-only)
 * timesFor  - (date, shift) -> { start, end, custom }
 * showGaps  - admin: flag days where adjusted hours leave nobody on
 * freeCount - admin: (date, shift) -> how many baristas can do it; 0 flags an empty shift
 * addMiddle - admin: shows "+ Middle" on days without one (it opens the picker)
 * colors    - { baristaId: hex } the colours baristas picked for their names
 */
export default function ScheduleCalendar({ month, assignmentsByDate, onPick, myId, offDates, lockPast, timesFor, showGaps, freeCount, addMiddle, colors }) {
  const weeks = monthGrid(month.getFullYear(), month.getMonth())
  const todayKey = dateKey(new Date())
  const todayRef = useRef(null)

  // On phones the month is a long list, so open the current month at today
  // instead of the 1st.
  useEffect(() => {
    if (todayRef.current && window.matchMedia('(max-width: 700px)').matches) {
      todayRef.current.scrollIntoView({ block: 'start' })
    }
  }, [month])

  return (
    <div className="sched-calendar sched-calendar-wide">
      <div className="sched-weekdays">
        {WEEKDAY_HEADERS.map((day) => <div key={day}>{day}</div>)}
      </div>
      {weeks.map((week, index) => (
        <div className="sched-week" key={index}>
          {week.map((key, column) => {
            if (!key) return <div key={`empty-${column}`} className="sched-day is-empty" />
            const day = assignmentsByDate[key] || {}
            const shifts = shiftsOnDay(key, day)
            const past = lockPast && key < todayKey
            const gaps = showGaps ? coverageGaps(key, timesFor, shifts) : []
            const classes = [
              'sched-day',
              shifts.includes('shared') && 'has-shared',
              shifts.includes('middle') && 'has-middle',
              key === todayKey && 'is-today',
              past && 'is-past',
              offDates?.has(key) && 'is-off',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <div key={key} className={classes} ref={key === todayKey ? todayRef : undefined}>
                <div className="sched-day-number">
                  <span className="sched-day-weekday">
                    {parseDateKey(key).toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  {Number(key.slice(8))}
                  {offDates?.has(key) && <span className="sched-off-tag">off</span>}
                  {gaps.length > 0 && (
                    <span className="sched-gap-tag" title="Nobody is scheduled in this stretch">
                      nobody {gaps.map((gap) => `${formatTime(gap.start)}–${formatTime(gap.end)}`).join(', ')}
                    </span>
                  )}
                  {addMiddle && !shifts.includes('middle') && key >= todayKey && (
                    <button
                      type="button"
                      className="sched-add-middle"
                      title="Add a middle shift (someone covering between opening and closing)"
                      onClick={() => onPick(key, 'middle')}
                    >
                      + Middle
                    </button>
                  )}
                </div>
                <div className="sched-day-bubbles">
                  {shifts.map((shift) => (
                    <ShiftBubble
                      key={shift}
                      date={key}
                      shift={shift}
                      hours={timesFor(key, shift)}
                      nobodyFree={Boolean(freeCount) && freeCount(key, shift) === 0}
                      assigned={day[shift] || []}
                      myId={myId}
                      past={past}
                      onPick={onPick}
                      colors={colors}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
