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
 *   weekSchedule - { date: [{ barista, start, end }] } that day's shifts
 *   weekShifts   - [{ barista, start, end }] every shift in the week, with real hours
 *   days         - [{ date, shifts: [{ shift, name, start, end, custom }] }] for the preview
 *   issues       - [string] open shifts, unknown or inactive baristas, $0 base pay
 */
export const buildWeek = ({ weekStart, assignments, savedHours, overrides, baristas }) => {
  const byId = new Map(baristas.map((barista) => [barista.id, barista]))
  const byShift = new Map(assignments.map((entry) => [`${entry.date}_${entry.shift}`, entry]))
  const weekSchedule = {}
  const weekShifts = []
  const days = []
  const issues = []
  const noBasePay = new Set()
  const hours = resolveHours(savedHours)

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart)
    day.setDate(day.getDate() + offset)
    const key = dateKey(day)
    const label = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    weekSchedule[key] = []
    const dayShifts = []
    // A middle (cover) shift only exists on days someone is on one.
    const assigned = { middle: byShift.has(`${key}_middle`) ? [byShift.get(`${key}_middle`)] : [] }

    for (const shift of shiftsOnDay(key, assigned)) {
      const times = timesFor(key, shift, hours, overrides)
      const entry = byShift.get(`${key}_${shift}`)
      if (!entry) {
        issues.push(`${label} ${shift}: nobody on this shift`)
        dayShifts.push({ shift, name: null, ...times })
        continue
      }

      // The staff record's name, so base pay and saved reports line up with it.
      const barista = byId.get(entry.baristaId)
      const name = barista?.name || entry.baristaName
      if (!barista) issues.push(`${label} ${shift}: ${name} isn't in Manage Baristas`)
      else if (barista.active === false) issues.push(`${label} ${shift}: ${name} is marked inactive`)
      else if (!barista.basePay) noBasePay.add(name)

      const worked = { barista: name, start: atTime(key, times.start), end: atTime(key, times.end) }
      weekSchedule[key].push(worked)
      weekShifts.push(worked)
      dayShifts.push({ shift, name, ...times })
    }

    days.push({ date: key, shifts: dayShifts })
  }

  noBasePay.forEach((name) => issues.push(`${name} has $0 base pay`))
  return { weekSchedule, weekShifts, days, issues }
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
