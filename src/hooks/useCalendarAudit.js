import { useCallback, useEffect, useState } from 'react'
import { CalendarAuthError } from '../services/calendars'
import { dismissFinding, getDismissedKeys, runCalendarAudit } from '../services/calendarAudit'

// Runs the calendar check whenever Google gets connected (so every admin login
// with Google runs it), and on demand after a fix.
export const useCalendarAudit = (accessToken, { adminEmail, onAuthExpired } = {}) => {
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(() => getDismissedKeys())

  const run = useCallback(async () => {
    if (!accessToken) return
    setRunning(true)
    setError(null)
    try {
      setResult(await runCalendarAudit(accessToken, { adminEmail }))
    } catch (err) {
      console.error('Calendar check failed:', err)
      if (err instanceof CalendarAuthError) onAuthExpired?.()
      setError(err?.message || 'Calendar check failed')
    } finally {
      setRunning(false)
    }
  }, [accessToken, adminEmail, onAuthExpired])

  useEffect(() => {
    run()
  }, [run])

  const dismiss = useCallback((key) => {
    dismissFinding(key)
    setDismissed(getDismissedKeys())
  }, [])

  const openFindings = (result?.findings || []).filter((finding) => !dismissed.has(finding.key))
  const outsideChanges = (result?.recentChanges || []).filter((change) => !change.byApp)

  return { result, running, error, run, dismiss, openFindings, outsideChanges }
}
