// Schedule domain functions - the only thing the UI calls to read or write.
//
// Collections:
//   baristas                - shared with the staff tab: { name, email, active }
//   scheduleShifts          - { date, shift, baristaId, baristaName, assignedBy, createdAt }
//                             id = `${date}_${shift}`: one barista per shift
//   scheduleUnavailability  - one barista, one date: { baristaId, baristaName, date,
//                             allDay, cant: [shift], createdAt }  id = `${baristaId}_${date}`
//                             (see "availability" in shifts.js)
//   scheduleWeekly          - a barista's usual week: { baristaId, baristaName,
//                             cant: { mon: [shift], ... }, updatedAt }  id = baristaId
//   scheduleSettings/hours  - default hours: { weekday: { opening: { start, end }, ... }, weekend: {...} }
//   scheduleShiftTimes      - one shift's hours on one date: { date, shift, start, end }
//                             id = `${date}_${shift}`
//   scheduleAlerts          - a barista dropped a shift and it is empty again:
//                             { type: 'dropped', date, shift, baristaId, baristaName,
//                               createdAt, status: 'new' | 'emailed' | 'dismissed', emailedAt }

import { AlreadyExistsError, create, now, remove, set, update, watch } from './backend'
import { assignmentId, dateKey, unavailabilityId } from './shifts.js'

// ---- write-error reporting (both pages show a banner) ----

const errorListeners = new Set()

export const watchWriteErrors = (callback) => {
  errorListeners.add(callback)
  return () => errorListeners.delete(callback)
}

const friendly = (error) =>
  error instanceof AlreadyExistsError ? new Error('Someone else just took that shift.') : error

const report = (promise) =>
  promise.catch((error) => {
    console.error('Schedule write failed', error)
    errorListeners.forEach((listener) => listener(friendly(error)))
    return false
  })

// ---- reads ----

export const watchBaristas = (callback, onError) => watch('baristas', callback, onError)
export const watchAssignments = (callback, onError) => watch('scheduleShifts', callback, onError)
export const watchUnavailability = (callback, onError) => watch('scheduleUnavailability', callback, onError)
export const watchWeekly = (callback, onError) => watch('scheduleWeekly', callback, onError)
export const watchAlerts = (callback, onError) => watch('scheduleAlerts', callback, onError)
export const watchSettings = (callback, onError) => watch('scheduleSettings', callback, onError)
export const watchShiftTimes = (callback, onError) => watch('scheduleShiftTimes', callback, onError)
export const watchScheduleUsers = (callback, onError) => watch('scheduleUsers', callback, onError)

// ---- shifts ----

const shiftDoc = (date, shift, barista, by) => ({
  date,
  shift,
  baristaId: barista.id,
  baristaName: barista.name,
  assignedBy: by || null,
  createdAt: now(),
})

// Takes an empty shift. Fails (with a banner) if someone already has it.
// `assignedBy` is who clicked: a barista's name, or 'admin'. Resolves true on success.
export const assignShift = (date, shift, barista, assignedBy) =>
  report(create('scheduleShifts', assignmentId(date, shift), shiftDoc(date, shift, barista, assignedBy)).then(() => true))

// Admin only: takes someone off a shift. No alert - the admin did it.
export const unassignShift = (assignment) => report(remove('scheduleShifts', assignment.id))

// A barista dropping their own shift. The shift goes back to empty and the
// admins get an alert so they can ask the team to cover it.
export const dropShift = async (assignment, barista) => {
  const removed = await report(remove('scheduleShifts', assignment.id).then(() => true))
  if (removed) await raiseDropAlert(assignment, barista)
  return removed
}

const raiseDropAlert = (assignment, barista) => {
  if (assignment.date < dateKey(new Date())) return undefined
  return report(
    set('scheduleAlerts', `${assignmentId(assignment.date, assignment.shift)}_${Date.now()}`, {
      type: 'dropped',
      date: assignment.date,
      shift: assignment.shift,
      baristaId: barista.id,
      baristaName: barista.name,
      createdAt: now(),
      status: 'new',
    })
  )
}

// Same person, another (empty) shift that day. The new shift is taken first,
// so a failure never leaves them on no shift at all. When a barista moves
// themselves, the shift they left is empty, so the admins are told.
export const moveShift = async (assignment, toShift, movedBy, { alertAs } = {}) => {
  const barista = { id: assignment.baristaId, name: assignment.baristaName }
  const taken = await assignShift(assignment.date, toShift, barista, movedBy)
  if (!taken) return false
  await report(remove('scheduleShifts', assignment.id))
  if (alertAs) await raiseDropAlert(assignment, alertAs)
  return true
}

// Admin only: same shift, another person.
export const replaceShift = (assignment, barista) =>
  report(set('scheduleShifts', assignment.id, shiftDoc(assignment.date, assignment.shift, barista, 'admin')))

// ---- hours (admin) ----

export const saveDefaultHours = (hours) => report(set('scheduleSettings', 'hours', { ...hours, updatedAt: now() }))

// Adjusts one shift on one date, whoever is on it.
export const setShiftTimes = (date, shift, range) =>
  report(set('scheduleShiftTimes', assignmentId(date, shift), { date, shift, start: range.start, end: range.end, updatedAt: now() }))

export const resetShiftTimes = (date, shift) => report(remove('scheduleShiftTimes', assignmentId(date, shift)))

// ---- alerts (admin) ----

export const markAlertEmailed = (alert) => report(update('scheduleAlerts', alert.id, { status: 'emailed', emailedAt: now() }))
export const dismissAlert = (alert) => report(update('scheduleAlerts', alert.id, { status: 'dismissed' }))

// ---- availability ----

const dateDoc = (barista, date, fields) => ({
  baristaId: barista.id,
  baristaName: barista.name,
  date,
  ...fields,
  createdAt: now(),
})

// Off the whole day.
export const markUnavailable = (barista, date) =>
  report(set('scheduleUnavailability', unavailabilityId(barista.id, date), dateDoc(barista, date, { allDay: true, cant: [] })))

// That day only: exactly these shifts are out (an empty list means free all
// day, even where the usual week says no).
export const setDateShifts = (barista, date, cant) =>
  report(set('scheduleUnavailability', unavailabilityId(barista.id, date), dateDoc(barista, date, { allDay: false, cant })))

// Back to the usual week for that date.
export const markAvailable = (barista, date) => report(remove('scheduleUnavailability', unavailabilityId(barista.id, date)))

// Several days at once, from a drag on the availability tab: whole days off,
// or back to the usual week.
export const setDaysOff = (barista, dates, off) =>
  Promise.all(dates.map((date) => (off ? markUnavailable(barista, date) : markAvailable(barista, date))))

// The usual week: { mon: ['opening'], ... } - the shifts they normally can't do.
export const saveWeekly = (barista, cant) =>
  report(set('scheduleWeekly', barista.id, { baristaId: barista.id, baristaName: barista.name, cant, updatedAt: now() }))

// Admin only: fills in an address so the broadcast email can reach them.
// A barista's calendar colour (a BARISTA_COLORS id, or null for none), on
// their own login's scheduleUsers doc.
export const setMyColor = (uid, color) => report(update('scheduleUsers', uid, { color: color || null }))

export const setBaristaEmail = (barista, email) => report(update('baristas', barista.id, { email: email.trim() || null }))
