/*
 * The week's shifts from the master schedule (schedule.brbcoffee-atx.com),
 * shaped for the tip calculator.
 *
 * Shifts live in Firestore, one barista per shift:
 *   scheduleShifts/{date}_{shift}      - { date, shift, baristaId, baristaName }
 *   scheduleSettings/hours             - default hours per day type
 *   scheduleShiftTimes/{date}_{shift}  - one shift's hours on one date (wins)
 *
 * Hours come from ../schedule/shifts.js, the same rules the Schedule tab
 * uses (synced from brb-master-schedule). buildWeek is pure so
 * masterSchedule.test.mjs can run it under plain node.
 */
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { dateKey, parseDateKey, resolveHours, shiftsOnDay, timesFor } from '../schedule/shifts.js'

const atTime = (key, time) => {
  const [hour, minute] = time.split(':').map(Number)
  const date = parseDateKey(key)
  date.setHours(hour, minute, 0, 0)
  return date
}

/**
 * Turns one week of master-schedule docs into what the calculator uses, plus
 * the problems the admin should look at before paying anyone out.
 *
 *   days         - [{ date, shifts: [{ shift, start, end, custom, people }] }] for the
 *                  preview; people = [{ name, start, end }], the scheduled barista
 *                  (none on an empty shift). The admin can add people to a shift
 *                  or change their hours there before calculating - see workedFromDays.
 *   weekSchedule, weekShifts - workedFromDays(days)
 *   issues       - [{ slot, text }] open shifts, unknown or inactive baristas, $0 base
 *                  pay; slot is `${date}_${shift}` (null for base pay)
 */
export const buildWeek = ({ weekStart, assignments, savedHours, overrides, baristas }) => {
  const byId = new Map(baristas.map((barista) => [barista.id, barista]))
  const byShift = new Map(assignments.map((entry) => [`${entry.date}_${entry.shift}`, entry]))
  const days = []
  const issues = []
  const noBasePay = new Set()
  const hours = resolveHours(savedHours)

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart)
    day.setDate(day.getDate() + offset)
    const key = dateKey(day)
    const label = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const dayShifts = []
    // A middle (cover) shift only exists on days someone is on one.
    const assigned = { middle: byShift.has(`${key}_middle`) ? [byShift.get(`${key}_middle`)] : [] }

    for (const shift of shiftsOnDay(key, assigned)) {
      const times = timesFor(key, shift, hours, overrides)
      const entry = byShift.get(`${key}_${shift}`)
      const slot = `${key}_${shift}`
      if (!entry) {
        issues.push({ slot, text: `${label} ${shift}: nobody on this shift` })
        dayShifts.push({ shift, ...times, people: [] })
        continue
      }

      // The staff record's name, so base pay and saved reports line up with it.
      const barista = byId.get(entry.baristaId)
      const name = barista?.name || entry.baristaName
      if (!barista) issues.push({ slot, text: `${label} ${shift}: ${name} isn't in Manage Baristas` })
      else if (barista.active === false) issues.push({ slot, text: `${label} ${shift}: ${name} is marked inactive` })
      else if (!barista.basePay) noBasePay.add(name)

      dayShifts.push({ shift, ...times, people: [{ name, start: times.start, end: times.end }] })
    }

    days.push({ date: key, shifts: dayShifts })
  }

  noBasePay.forEach((name) => issues.push({ slot: null, text: `${name} has $0 base pay` }))
  return { ...workedFromDays(days), days, issues }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Who worked when, from the (possibly adjusted) preview days. Everyone on a
 * shift counts with their own hours, so two people splitting one shift - side
 * by side, or one taking over halfway - each get their part. People with no
 * name or hours that don't make sense are left out (and listed in `problems`).
 *
 *   weekSchedule - { date: [{ barista, start, end }] } that day's shifts
 *   weekShifts   - [{ barista, start, end }] every shift in the week
 *   problems     - [string]
 */
export const workedFromDays = (days) => {
  const weekSchedule = {}
  const weekShifts = []
  const problems = []
  for (const day of days) {
    weekSchedule[day.date] = []
    for (const shift of day.shifts) {
      for (const person of shift.people) {
        if (!person.name) {
          problems.push(`${day.date} ${shift.shift}: pick who worked it, or remove the empty row`)
          continue
        }
        if (!TIME_PATTERN.test(person.start) || !TIME_PATTERN.test(person.end) || person.start >= person.end) {
          problems.push(`${day.date} ${shift.shift}: ${person.name}'s hours need an end after the start`)
          continue
        }
        const worked = { barista: person.name, start: atTime(day.date, person.start), end: atTime(day.date, person.end) }
        weekSchedule[day.date].push(worked)
        weekShifts.push(worked)
      }
    }
  }
  return { weekSchedule, weekShifts, problems }
}

export const fetchMasterWeek = async (db, weekStart, baristas) => {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const inWeek = (name) =>
    query(collection(db, name), where('date', '>=', dateKey(weekStart)), where('date', '<=', dateKey(weekEnd)))

  const [shiftsSnap, timesSnap, hoursSnap] = await Promise.all([
    getDocs(inWeek('scheduleShifts')),
    getDocs(inWeek('scheduleShiftTimes')),
    getDoc(doc(db, 'scheduleSettings', 'hours')),
  ])

  return buildWeek({
    weekStart,
    assignments: shiftsSnap.docs.map((snap) => snap.data()),
    savedHours: hoursSnap.exists() ? hoursSnap.data() : null,
    overrides: Object.fromEntries(timesSnap.docs.map((snap) => [snap.id, snap.data()])),
    baristas,
  })
}
