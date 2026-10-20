import { useEffect, useState } from 'react'
import { REASON_LABELS, SHIFTS, formatDay, formatRange, formatTime, isValidRange } from './shifts.js'

/**
 * Opens on a bubble or a name. Each shift has one barista.
 *
 * Barista page (me): "Add me" on an empty shift; on their own shift, move to
 * another empty shift that day or drop it (the admins are alerted).
 * Admin (isAdmin): fill an empty shift from the available list; on a taken
 * shift, move, replace or remove whoever has it.
 *
 * focusId - the person whose name was tapped; their row is highlighted
 * hours   - this shift's hours on this date: { start, end, custom }
 * Admin only, to adjust them: defaultHours, onSaveHours(range), onResetHours(),
 * gapsWith(range) -> stretches of the day nobody would cover with that change
 */

// Admin: change this one shift's hours on this date, e.g. someone leaving early.
function HoursEditor({ hours, defaultHours, onSave, onReset, gapsWith }) {
  const [draft, setDraft] = useState({ start: hours.start, end: hours.end })
  useEffect(() => setDraft({ start: hours.start, end: hours.end }), [hours.start, hours.end])

  const valid = isValidRange(draft)
  const changed = draft.start !== hours.start || draft.end !== hours.end
  const gaps = valid ? gapsWith(draft) : []

  return (
    <section>
      <h4>Hours</h4>
      <form
        className="sched-hours-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid && changed) onSave(draft)
        }}
      >
        <input type="time" step="900" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} aria-label="Start" />
        <span>to</span>
        <input type="time" step="900" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} aria-label="End" />
        <button type="submit" className="sched-btn sched-btn-primary" disabled={!valid || !changed}>Save</button>
        {hours.custom && (
          <button type="button" className="sched-link-btn" onClick={onReset}>
            Reset to {formatRange(defaultHours)}
          </button>
        )}
      </form>
      {!valid && <p className="sched-warning sched-hint">The end has to be after the start.</p>}
      {gaps.length > 0 && (
        <p className="sched-warning sched-hint">
          Nobody would be on {gaps.map((gap) => `${formatTime(gap.start)}–${formatTime(gap.end)}`).join(' and ')} that day.
          Adjust the next shift too, or save anyway.
        </p>
      )}
      <p className="sched-muted sched-hint">
        {hours.custom ? 'Adjusted for this day only.' : `Default for this day: ${formatRange(defaultHours)}.`} Changes apply to this date only.
      </p>
    </section>
  )
}
export default function ShiftPicker({
  date,
  shift,
  lists,
  focusId,
  isAdmin = false,
  me = null,
  onAssign,
  onRemove,
  onMove,
  onReplace,
  hours,
  defaultHours,
  onSaveHours,
  onResetHours,
  gapsWith,
  readOnly = false,
  onClose,
}) {
  const { assigned, available, unavailable, otherShifts, emptyShifts } = lists
  const holder = assigned[0] || null
  const [replacing, setReplacing] = useState(false)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (replacing) setReplacing(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, replacing])

  const isMine = holder && holder.baristaId === me?.id
  const canEditHolder = holder && !readOnly && (isAdmin || isMine)
  const meOff = me ? unavailable.find((barista) => barista.id === me.id) : null
  const meOtherShifts = me ? otherShifts[me.id] || [] : []

  const alsoOn = (baristaId) =>
    otherShifts[baristaId]?.length ? `also ${otherShifts[baristaId].map((other) => SHIFTS[other].label).join(', ')}` : null

  const pick = async (barista, { unavailable: reason = null } = {}) => {
    const why = {
      dayOff: `marked ${formatDay(date)} as a day off`,
      date: `said they can't do this shift on ${formatDay(date)}`,
      weekly: `can't usually do ${SHIFTS[shift].label.toLowerCase()} on ${formatDay(date, { weekday: 'long' })}s`,
    }[reason]
    // Already working another shift that day: usually someone else should
    // cover this one, so the admin confirms a double.
    const doubles = otherShifts[barista.id] || []
    const warnings = [
      reason && `${barista.name} ${why}.`,
      doubles.length > 0 &&
        `${barista.name} is already on the ${doubles.map((other) => SHIFTS[other].label).join(' and ')} shift that day. ` +
          `Most likely someone else should cover ${SHIFTS[shift].label.toLowerCase()}.`,
    ].filter(Boolean)
    if (warnings.length && !window.confirm(`${warnings.join('\n\n')}\n\nPut ${barista.name} on this shift anyway?`)) return
    if (replacing) {
      await onReplace(holder, barista)
      setReplacing(false)
    } else {
      await onAssign(barista)
    }
  }

  // Baristas with no other shift that day first: they're the natural cover.
  const byFreeFirst = (list) =>
    [...list].sort((left, right) => Boolean(otherShifts[left.id]?.length) - Boolean(otherShifts[right.id]?.length))
  const candidates = byFreeFirst(available)
  const candidatesOff = byFreeFirst(unavailable)

  // The admin sees the candidate list on an empty shift, or while replacing.
  const showCandidates = isAdmin && !readOnly && (!holder || replacing)

  return (
    <div className="sched-modal-backdrop" onClick={onClose}>
      <div className="sched-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className={`sched-modal-header sched-header-${shift}`}>
          <div>
            <h3>{SHIFTS[shift].label} shift</h3>
            <p>
              {formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })} · {formatRange(hours)}
              {hours.custom && <span className="sched-custom-tag">adjusted</span>}
            </p>
          </div>
          <button type="button" className="sched-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <section>
          <h4>Barista</h4>
          {!holder ? (
            <p className="sched-empty-note">Nobody yet — this shift is empty.</p>
          ) : (
            <div className={['sched-assigned-row', holder.baristaId === focusId && 'is-focus', replacing && 'is-replacing'].filter(Boolean).join(' ')}>
              <span className="sched-assigned-name">
                {holder.baristaName}
                {isMine && <span className="sched-pick-note"> (you)</span>}
              </span>
              {canEditHolder && (
                <span className="sched-row-actions">
                  {emptyShifts.map((target) => (
                    <button key={target} type="button" className={`sched-mini sched-bubble-${target}`} onClick={() => onMove(holder, target)}>
                      Move to {SHIFTS[target].label}
                    </button>
                  ))}
                  {isAdmin && (
                    <button type="button" className="sched-mini" onClick={() => setReplacing(!replacing)}>
                      {replacing ? 'Cancel' : 'Replace'}
                    </button>
                  )}
                  <button type="button" className="sched-mini is-danger" onClick={() => onRemove(holder)}>
                    {isAdmin ? 'Remove' : "I can't make it"}
                  </button>
                </span>
              )}
            </div>
          )}
          {holder && !isAdmin && isMine && !readOnly && (
            <p className="sched-muted sched-hint">
              Can't make it? Tap "I can't make it" — the shift opens up again and the managers ask the team to cover it.
            </p>
          )}
        </section>

        {isAdmin && onSaveHours && (
          <HoursEditor hours={hours} defaultHours={defaultHours} onSave={onSaveHours} onReset={onResetHours} gapsWith={gapsWith} />
        )}

        {readOnly && <p className="sched-muted">This day has passed.</p>}

        {!readOnly && !isAdmin && me && !holder && (
          <section>
            {meOff ? (
              <p className="sched-muted">
                {meOff.reason === 'weekly'
                  ? `Your usual week says you can't do ${SHIFTS[shift].label.toLowerCase()} on ${formatDay(date, { weekday: 'long' })}s.`
                  : meOff.reason === 'date'
                    ? `You said you can't do the ${SHIFTS[shift].label.toLowerCase()} shift this day.`
                    : 'You marked this day off.'}{' '}
                To take it, change that in My availability first.
              </p>
            ) : (
              <>
                <button type="button" className="sched-btn sched-btn-primary sched-btn-block" onClick={() => onAssign(me)}>
                  Add me to this shift
                </button>
                {meOtherShifts.length > 0 && (
                  <p className="sched-muted sched-hint">
                    You're also on {meOtherShifts.map((other) => SHIFTS[other].label).join(' and ')} that day.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {showCandidates && (
          <>
            <section>
              <h4>
                {replacing ? `Who replaces ${holder.baristaName}?` : 'Choose a barista'}{' '}
                <span className="sched-count">{available.length}</span>
              </h4>
              {available.length === 0 ? (
                <p className="sched-muted">Nobody else is available this day.</p>
              ) : (
                <ul className="sched-pick-list">
                  {candidates.map((barista) => (
                    <li key={barista.id}>
                      <button type="button" className="sched-pick" onClick={() => pick(barista)}>
                        <span>{barista.name}</span>
                        {alsoOn(barista.id) && <span className="sched-pick-note sched-double-note">{alsoOn(barista.id)}</span>}
                        <span className="sched-pick-add">{replacing ? 'Swap in' : 'Assign'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {unavailable.length > 0 && (
              <section>
                <h4>Can't do this shift <span className="sched-count">{unavailable.length}</span></h4>
                <ul className="sched-pick-list">
                  {candidatesOff.map((barista) => (
                    <li key={barista.id}>
                      <button type="button" className="sched-pick is-off" onClick={() => pick(barista, { unavailable: barista.reason })}>
                        <span>{barista.name}</span>
                        <span className="sched-pick-note">{REASON_LABELS[barista.reason]}</span>
                        <span className="sched-pick-add">{replacing ? 'Swap in anyway' : 'Assign anyway'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
