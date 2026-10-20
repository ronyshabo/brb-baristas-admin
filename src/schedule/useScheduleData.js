import { useCallback, useEffect, useMemo, useState } from 'react'
import { watchAssignments, watchBaristas, watchSettings, watchShiftTimes, watchUnavailability, watchWeekly, watchWriteErrors } from './store'
import { groupAssignments, makeAvailability, resolveHours, timesFor } from './shifts.js'

// Live baristas, shifts and availability, plus the lookups every view needs.
export const useScheduleData = () => {
  const [baristas, setBaristas] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [unavailability, setUnavailability] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [settings, setSettings] = useState(null)
  const [shiftTimes, setShiftTimes] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onError = (err) => setError(err?.message || 'Could not load the schedule')
    const stops = [
      watchBaristas((list) => setBaristas(list.filter((barista) => barista.name)), onError),
      watchAssignments(setAssignments, onError),
      watchUnavailability(setUnavailability, onError),
      watchWeekly(setWeekly, onError),
      watchSettings(setSettings, onError),
      watchShiftTimes(setShiftTimes, onError),
      watchWriteErrors((err) => setError(`Could not save: ${err?.message || 'unknown error'}`)),
    ]
    return () => stops.forEach((stop) => stop())
  }, [])

  const assignmentsByDate = useMemo(() => groupAssignments(assignments || []), [assignments])
  // (baristaId, date, shift) -> { ok } or { ok: false, reason }
  const availabilityOf = useMemo(() => makeAvailability(unavailability || [], weekly || []), [unavailability, weekly])
  const hours = useMemo(() => resolveHours(settings?.find((entry) => entry.id === 'hours')), [settings])
  const overrides = useMemo(
    () => Object.fromEntries((shiftTimes || []).map((entry) => [`${entry.date}_${entry.shift}`, entry])),
    [shiftTimes]
  )
  // (date, shift) -> { start, end, custom }
  const shiftHours = useCallback((date, shift) => timesFor(date, shift, hours, overrides), [hours, overrides])

  return {
    loading: !baristas || !assignments || !unavailability || !weekly || !settings || !shiftTimes,
    error,
    clearError: () => setError(null),
    baristas: baristas || [],
    assignments: assignments || [],
    unavailability: unavailability || [],
    weekly: weekly || [],
    assignmentsByDate,
    availabilityOf,
    hours,
    timesFor: shiftHours,
  }
}
