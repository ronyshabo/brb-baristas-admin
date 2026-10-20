import { SHIFTS, SHIFT_ORDER, WEEKDAY_NAMES, WEEK_ROWS, dateKey, formatDay, shiftsForWeekday, weekdayKeyFor } from './shifts.js'
import { saveWeekly } from './store'

/**
 * A barista's usual week: tap a cell to say "I can't usually do this shift on
 * this day" (e.g. classes every Monday morning). Applies to every week until
 * they change it; a specific date on the calendar below overrides it.
 */
export default function WeeklyAvailability({ barista, weekly, assignments = [] }) {
  const cant = weekly.find((entry) => (entry.baristaId || entry.id) === barista.id)?.cant || {}
  const blocked = WEEK_ROWS.reduce((total, day) => total + (cant[day]?.length || 0), 0)

  const toggle = (day, shift) => {
    const current = cant[day] || []
    if (!current.includes(shift)) {
      // Blocking a shift they're already booked on: say which dates.
      const todayKey = dateKey(new Date())
      const booked = assignments
        .filter((entry) => entry.baristaId === barista.id && entry.shift === shift && entry.date >= todayKey && weekdayKeyFor(entry.date) === day)
        .sort((left, right) => left.date.localeCompare(right.date))
      if (booked.length) {
        const ok = window.confirm(
          `You're already on the ${SHIFTS[shift].label.toLowerCase()} shift on ${booked.map((entry) => formatDay(entry.date)).join(', ')}. This won't take you off those — let the manager know so they get covered. Block ${WEEKDAY_NAMES[day]} ${SHIFTS[shift].label.toLowerCase()} anyway?`
        )
        if (!ok) return
      }
    }
    const next = current.includes(shift) ? current.filter((entry) => entry !== shift) : [...current, shift]
    saveWeekly(barista, { ...cant, [day]: SHIFT_ORDER.filter((entry) => next.includes(entry)) })
  }

  return (
    <div className="sched-weekly">
      <p className="sched-muted">
        Tap the shifts you <strong>can't usually</strong> work. This repeats every week. Use the calendar below for one-off
        changes.
        {blocked > 0 && ` ${blocked} shift${blocked === 1 ? '' : 's'} blocked each week.`}
      </p>
      <table className="sched-weekly-table">
        <thead>
          <tr>
            <th />
            {SHIFT_ORDER.map((shift) => <th key={shift}>{SHIFTS[shift].label}</th>)}
          </tr>
        </thead>
        <tbody>
          {WEEK_ROWS.map((day) => {
            const shifts = shiftsForWeekday(day)
            return (
              <tr key={day}>
                <th scope="row">
                  <span className="sched-wide-label">{WEEKDAY_NAMES[day]}</span>
                  <span className="sched-short-label">{WEEKDAY_NAMES[day].slice(0, 3)}</span>
                </th>
                {SHIFT_ORDER.map((shift) => {
                  if (!shifts.includes(shift)) return <td key={shift} className="is-na" aria-label="No shift">—</td>
                  const no = cant[day]?.includes(shift)
                  return (
                    <td key={shift}>
                      <button
                        type="button"
                        className={`sched-weekly-cell ${no ? 'is-no' : `sched-bubble-${shift}`}`}
                        aria-pressed={no}
                        aria-label={`${WEEKDAY_NAMES[day]} ${SHIFTS[shift].label}: ${no ? "can't" : 'can'}`}
                        onClick={() => toggle(day, shift)}
                      >
                        {no ? "✗ Can't" : '✓ Can'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
