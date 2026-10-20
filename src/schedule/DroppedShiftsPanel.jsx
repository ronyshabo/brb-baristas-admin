import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCoverRequest, gmailComposeUrl } from './broadcast.js'
import { SHIFTS, assignmentId, dateKey, formatDay, formatRange } from './shifts.js'
import { dismissAlert, markAlertEmailed, watchAlerts } from './store'

const timeAgo = (iso) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

// Pops a desktop notification for each alert that arrives while the admin
// page is open. Alerts already there when the page loads are not re-announced.
const useDesktopNotifications = (alerts) => {
  const seen = useRef(null)
  const [permission, setPermission] = useState(() => (canNotify() ? Notification.permission : 'unsupported'))

  useEffect(() => {
    if (!alerts) return
    if (!seen.current) {
      seen.current = new Set(alerts.map((alert) => alert.id))
      return
    }
    for (const alert of alerts) {
      if (seen.current.has(alert.id)) continue
      seen.current.add(alert.id)
      if (alert.status === 'new' && permission === 'granted') {
        new Notification('A shift needs cover', {
          body: `${alert.baristaName} dropped ${formatDay(alert.date)} ${SHIFTS[alert.shift].label}.`,
          tag: alert.id,
        })
      }
    }
  }, [alerts, permission])

  const enable = async () => setPermission(await Notification.requestPermission())
  return { permission, enable }
}

/**
 * Shifts baristas dropped. Each one stays here until someone takes the shift
 * (then it shows who covered it) or the admin dismisses it. "Email" opens a
 * cover request to everyone free that day.
 */
export default function DroppedShiftsPanel({ data, gmailAccount, onFill }) {
  const [alerts, setAlerts] = useState(null)
  useEffect(() => watchAlerts(setAlerts), [])
  const notifications = useDesktopNotifications(alerts)

  const todayKey = dateKey(new Date())

  // Latest alert per shift, still upcoming and not dismissed.
  const active = useMemo(() => {
    const latest = new Map()
    for (const alert of alerts || []) {
      if (alert.status === 'dismissed' || alert.date < todayKey) continue
      const slot = assignmentId(alert.date, alert.shift)
      if (!latest.has(slot) || latest.get(slot).createdAt < alert.createdAt) latest.set(slot, alert)
    }
    return [...latest.values()].sort((left, right) => left.date.localeCompare(right.date))
  }, [alerts, todayKey])

  const uncovered = active.filter((alert) => !data.assignmentsByDate[alert.date]?.[alert.shift]?.length)

  if (!alerts) return null

  return (
    <section className={`sched-panel sched-alerts ${uncovered.length ? 'has-alerts' : ''}`}>
      <div className="sched-alerts-head">
        <h3>
          Dropped shifts{' '}
          <span className={`sched-count ${uncovered.length ? 'is-alert' : ''}`}>{uncovered.length}</span>
        </h3>
        {notifications.permission === 'default' && (
          <button type="button" className="sched-link-btn" onClick={notifications.enable}>
            Turn on desktop alerts
          </button>
        )}
        {notifications.permission === 'granted' && <span className="sched-muted">Desktop alerts on</span>}
      </div>

      {active.length === 0 ? (
        <p className="sched-muted">No barista has dropped a shift.</p>
      ) : (
        <ul className="sched-alert-list">
          {active.map((alert) => {
            const holder = data.assignmentsByDate[alert.date]?.[alert.shift]?.[0]
            const email = buildCoverRequest({
              date: alert.date,
              shift: alert.shift,
              droppedBy: { id: alert.baristaId, name: alert.baristaName },
              baristas: data.baristas,
              availabilityOf: data.availabilityOf,
              assignmentsByDate: data.assignmentsByDate,
              timesFor: data.timesFor,
            })
            return (
              <li key={alert.id} className={`sched-alert ${holder ? 'is-covered' : ''}`}>
                <div className="sched-alert-main">
                  <strong className={`sched-alert-shift sched-bubble-${alert.shift}`}>
                    {formatDay(alert.date)} · {SHIFTS[alert.shift].label} · {formatRange(data.timesFor(alert.date, alert.shift))}
                  </strong>
                  <span>
                    {alert.baristaName} dropped it {timeAgo(alert.createdAt)}.
                    {holder
                      ? <> Covered by <strong>{holder.baristaName}</strong>.</>
                      : alert.status === 'emailed'
                        ? ` Cover request emailed ${timeAgo(alert.emailedAt)} — still empty.`
                        : ' Still empty.'}
                  </span>
                  {!holder && (
                    <span className="sched-muted">
                      Email goes to {email.to.length} free barista{email.to.length === 1 ? '' : 's'}
                      {email.skipped.off.length > 0 && ` · off that day: ${email.skipped.off.join(', ')}`}
                      {email.skipped.working.length > 0 && ` · already working: ${email.skipped.working.join(', ')}`}
                      {email.missingEmail.length > 0 && ` · no email address: ${email.missingEmail.join(', ')}`}
                    </span>
                  )}
                </div>
                <div className="sched-actions">
                  {!holder && (
                    <>
                      <a
                        className={`sched-btn sched-btn-primary ${email.to.length ? '' : 'is-disabled'}`}
                        href={email.to.length ? gmailComposeUrl({ ...email, account: gmailAccount }) : undefined}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => markAlertEmailed(alert)}
                      >
                        {alert.status === 'emailed' ? 'Email again' : `Email ${email.to.length} barista${email.to.length === 1 ? '' : 's'}`}
                      </a>
                      <button type="button" className="sched-btn" onClick={() => onFill(alert.date, alert.shift)}>
                        Assign someone
                      </button>
                    </>
                  )}
                  <button type="button" className="sched-link-btn" onClick={() => dismissAlert(alert)}>
                    {holder ? 'Clear' : 'Dismiss'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
