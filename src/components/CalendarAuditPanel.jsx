import { useState } from 'react'
import {
  moveEventToEventsCalendar,
  pushEventToCalendar,
  removeEventFromCalendar,
} from '../services/eventSync'
import '../styles/CalendarAuditPanel.css'

const FIX_LABELS = {
  push: 'Restore app version on Google',
  move: 'Move to events calendar',
  remove: 'Remove from Google',
}

const CALENDAR_LABELS = { events: 'Events', schedule: 'Schedule', shared: 'Shared' }

const formatWhen = (ms) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function CalendarAuditPanel({ audit, accessToken }) {
  const { result, running, error, run, dismiss, openFindings, outsideChanges } = audit
  const [busyKey, setBusyKey] = useState('')
  const [showAllChanges, setShowAllChanges] = useState(false)

  const applyFix = async (finding) => {
    const event = result?.eventsById.get(finding.event?.id) || finding.event
    if (!event) return
    setBusyKey(finding.key)
    try {
      if (finding.fix === 'push') await pushEventToCalendar(event, accessToken)
      if (finding.fix === 'move') await moveEventToEventsCalendar(event, accessToken)
      if (finding.fix === 'remove') await removeEventFromCalendar(event, accessToken)
      await run()
    } catch (err) {
      console.error('Calendar fix failed:', err)
      alert(err?.message || 'Could not apply the fix.')
    } finally {
      setBusyKey('')
    }
  }

  const movable = openFindings.filter((finding) => finding.fix === 'move')
  const moveAll = async () => {
    if (!confirm(`Move ${movable.length} event(s) from the schedule calendar to the events calendar?`)) return
    setBusyKey('move-all')
    const failures = []
    for (const finding of movable) {
      try {
        await moveEventToEventsCalendar(result.eventsById.get(finding.event.id), accessToken)
      } catch (err) {
        failures.push(`${finding.title}: ${err?.message}`)
      }
    }
    setBusyKey('')
    await run()
    if (failures.length) alert(`${failures.length} could not be moved:\n${failures.join('\n')}`)
  }

  // Collapsed by default so it doesn't push the events list down; the summary
  // line still shows how many discrepancies are open.
  const summary = (
    <summary className="audit-summary">
      <span>Calendar check</span>
      {openFindings.length > 0 && <span className="audit-count">{openFindings.length}</span>}
    </summary>
  )

  if (!accessToken) {
    return (
      <details className="audit-panel">
        {summary}
        <p className="audit-muted">Connect Google Calendar to check both calendars for changes made outside the app.</p>
      </details>
    )
  }

  const visibleChanges = showAllChanges ? result?.recentChanges || [] : outsideChanges

  return (
    <details className="audit-panel">
      {summary}
      <div className="audit-header">
        <span className="audit-muted">Compares Google Calendar with the app and lists changes made outside it.</span>
        <button onClick={run} disabled={running}>{running ? 'Checking...' : 'Run check'}</button>
      </div>

      {result && !result.calendarsSeparated && (
        <p className="audit-warning">
          Events and the barista schedule still share one calendar. Set VITE_GOOGLE_EVENTS_CALENDAR_ID
          to the new events calendar so outside additions can be detected.
        </p>
      )}
      {error && <p className="audit-error">{error}</p>}

      {result && (
        <>
          <p className="audit-muted">
            Checked {result.window.startDate} to {result.window.endDate} at {formatWhen(result.ranAt)}.
          </p>

          {openFindings.length === 0 ? (
            <p className="audit-ok">No discrepancies. Google Calendar matches the app.</p>
          ) : (
            <>
              {movable.length > 1 && (
                <button className="audit-bulk" onClick={moveAll} disabled={Boolean(busyKey)}>
                  {busyKey === 'move-all' ? 'Moving...' : `Move all ${movable.length} to the events calendar`}
                </button>
              )}
              <ul className="audit-list">
                {openFindings.map((finding) => (
                  <li key={finding.key} className={`audit-item audit-${finding.severity}`}>
                    <div className="audit-item-main">
                      <span className="audit-tag">{CALENDAR_LABELS[finding.calendar]}</span>
                      <strong>{finding.title}</strong>
                      {finding.date && <span className="audit-muted"> · {finding.date}</span>}
                      <p>{finding.detail}</p>
                    </div>
                    <div className="audit-actions">
                      {finding.fix && (
                        <button onClick={() => applyFix(finding)} disabled={Boolean(busyKey)}>
                          {busyKey === finding.key ? 'Working...' : FIX_LABELS[finding.fix]}
                        </button>
                      )}
                      {finding.googleEvent?.htmlLink && (
                        <a href={finding.googleEvent.htmlLink} target="_blank" rel="noreferrer">Open in Google</a>
                      )}
                      <button className="audit-dismiss" onClick={() => dismiss(finding.key)}>Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="audit-changes">
            <div className="audit-header">
              <h4>
                Changes in the last {result.recentChangeDays} days
                {showAllChanges ? '' : ' not made by the app'}
              </h4>
              <label className="audit-muted">
                <input type="checkbox" checked={showAllChanges} onChange={(e) => setShowAllChanges(e.target.checked)} />{' '}
                include app changes
              </label>
            </div>
            {visibleChanges.length === 0 ? (
              <p className="audit-muted">None.</p>
            ) : (
              <table className="audit-table">
                <tbody>
                  {visibleChanges.map((change) => (
                    <tr key={change.key} className={change.automated ? 'audit-row-flag' : ''}>
                      <td>{formatWhen(change.at)}</td>
                      <td>{CALENDAR_LABELS[change.calendar]}</td>
                      <td>{change.action}</td>
                      <td>{change.link ? <a href={change.link} target="_blank" rel="noreferrer">{change.title}</a> : change.title}</td>
                      <td>{change.automated ? 'Gmail (automatic)' : change.byApp ? 'this app' : change.creator ? `created by ${change.creator}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </details>
  )
}

export default CalendarAuditPanel
