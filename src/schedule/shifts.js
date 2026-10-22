// Shift rules for the master schedule. Pure - no React, no Firebase - so
// schedule.test.mjs can run it under plain node.
//
// Every day has an opening and a closing shift. Friday, Saturday and Sunday
// also have a shared shift in the middle of the day. Change SHARED_DAYS to
// move shared shifts to other days; times are display labels only.
//
// Any day can also have a middle shift between opening and closing (someone
// covering 12-2 when the opener leaves early). It is optional: it only exists
// on a day once the admin puts someone on it, so it is never "open", never
// auto-filled, and not part of anyone's availability.
//
// Each shift has exactly one barista.

export const SHIFTS = {
  opening: { id: 'opening', label: 'Opening', short: 'Opening' },
  closing: { id: 'closing', label: 'Closing', short: 'Closing' },
  shared: { id: 'shared', label: 'Shared', short: 'Shared' },
  middle: { id: 'middle', label: 'Middle', short: 'Middle' },
}

// The regular shifts - the ones availability is about.
export const SHIFT_ORDER = ['opening', 'shared', 'closing']
// Every shift, in the order a day lists them.
export const DAY_ORDER = ['opening', 'middle', 'shared', 'closing']

// Date.getDay(): 0 = Sunday ... 5 = Friday, 6 = Saturday.
export const SHARED_DAYS = [5, 6, 0]
export const WEEKEND_DAYS = [6, 0]

// ---- hours ----
//
// Times are 'HH:MM', 24-hour. The admin can change the defaults for each day
// type (stored in scheduleSettings/hours) and adjust one shift on one date
// (stored in scheduleShiftTimes/{date}_{shift}); the override wins.

export const DAY_TYPES = {
  weekday: { id: 'weekday', label: 'Mon – Fri' },
  weekend: { id: 'weekend', label: 'Sat – Sun' },
}

export const DEFAULT_HOURS = {
  weekday: {
    opening: { start: '08:00', end: '14:00' },
    closing: { start: '14:00', end: '21:00' },
    shared: { start: '12:00', end: '18:00' },
    middle: { start: '12:00', end: '14:00' },
  },
  weekend: {
    opening: { start: '09:00', end: '14:00' },
    closing: { start: '14:00', end: '21:00' },
    shared: { start: '12:00', end: '18:00' },
    middle: { start: '12:00', end: '14:00' },
  },
}

export const dayTypeFor = (key) => (WEEKEND_DAYS.includes(parseDateKey(key).getDay()) ? 'weekend' : 'weekday')

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const isValidRange = (range) =>
  Boolean(range && TIME_PATTERN.test(range.start) && TIME_PATTERN.test(range.end) && range.start < range.end)

// The saved defaults filled in with DEFAULT_HOURS wherever something is missing or invalid.
export const resolveHours = (saved) =>
  Object.fromEntries(
    Object.entries(DEFAULT_HOURS).map(([dayType, shifts]) => [
      dayType,
      Object.fromEntries(
        Object.entries(shifts).map(([shift, fallback]) => {
          const range = saved?.[dayType]?.[shift]
          return [shift, isValidRange(range) ? { start: range.start, end: range.end } : fallback]
        })
      ),
    ])
  )

/**
 * The hours of one shift on one date: { start, end, custom }.
 * hours     - resolveHours(...) output
 * overrides - { `${date}_${shift}`: { start, end } }
 */
export const timesFor = (key, shift, hours = DEFAULT_HOURS, overrides = {}) => {
  const override = overrides[`${key}_${shift}`]
  if (isValidRange(override)) return { start: override.start, end: override.end, custom: true }
  return { ...hours[dayTypeFor(key)][shift], custom: false }
}

// '14:30' -> '2:30pm', '08:00' -> '8am', '12:00' -> '12pm'
export const formatTime = (time) => {
  const [hour, minute] = time.split(':').map(Number)
  const suffix = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour % 12 || 12
  return minute ? `${hour12}:${String(minute).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`
}

export const formatRange = (range) => `${formatTime(range.start)} – ${formatTime(range.end)}`

/**
 * Stretches of a day nobody's shift covers, between the first shift's start
 * and the last one's end - e.g. opening cut to 1pm while closing starts at 2pm.
 * `shifts` defaults to the day's regular shifts; pass shiftsOnDay(...) to count
 * a middle shift. Returns [{ start, end }].
 */
export const coverageGaps = (key, timesForShift, shifts = shiftsForDate(key)) => {
  const ranges = shifts
    .map((shift) => timesForShift(key, shift))
    .sort((left, right) => left.start.localeCompare(right.start))
  const gaps = []
  let coveredUntil = ranges[0]?.end
  for (const range of ranges.slice(1)) {
    if (range.start > coveredUntil) gaps.push({ start: coveredUntil, end: range.start })
    if (range.end > coveredUntil) coveredUntil = range.end
  }
  return gaps
}

// 'YYYY-MM-DD' in local time. Never toISOString(), which shifts to UTC and can
// land on the previous day in the evening.
export const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const parseDateKey = (key) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const monthKey = (date) => dateKey(date).slice(0, 7)

// The regular shifts on a date. A middle shift is never "due", so it isn't here.
export const shiftsForDate = (key) => {
  const weekday = parseDateKey(key).getDay()
  return SHARED_DAYS.includes(weekday) ? ['opening', 'closing', 'shared'] : ['opening', 'closing']
}

// What a day actually shows, in DAY_ORDER: its regular shifts plus a middle
// shift when someone is on it. `day` is assignmentsByDate[key].
export const shiftsOnDay = (key, day) =>
  DAY_ORDER.filter((shift) => shiftsForDate(key).includes(shift) || (shift === 'middle' && day?.middle?.length))

// Weeks for a month view, Monday first so Fri-Sat-Sun sit together on the
// right. Days outside the month are null.
export const monthGrid = (year, month) => {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leading = (first.getDay() + 6) % 7
  const cells = Array(leading).fill(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(dateKey(new Date(year, month, day)))
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return weeks
}

export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const formatDay = (key, options = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  parseDateKey(key).toLocaleDateString('en-US', options)

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '?'

export const initials = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

// One barista per shift, so the shift itself is the doc id: a second person
// cannot be written onto a taken shift.
export const assignmentId = (date, shift) => `${date}_${shift}`
export const unavailabilityId = (baristaId, date) => `${baristaId}_${date}`

// { 'YYYY-MM-DD': { opening: [assignment], closing: [...], shared: [...] } }
export const groupAssignments = (assignments) => {
  const byDate = {}
  for (const assignment of assignments) {
    const day = (byDate[assignment.date] ||= {})
    ;(day[assignment.shift] ||= []).push(assignment)
  }
  for (const day of Object.values(byDate)) {
    for (const list of Object.values(day)) list.sort((left, right) => left.baristaName.localeCompare(right.baristaName))
  }
  return byDate
}

// ---- availability ----
//
// Two layers, per barista:
//   usual week - scheduleWeekly/{baristaId}: { cant: { mon: ['opening'], ... } }
//                the shifts they normally can't do on each weekday
//   dates      - scheduleUnavailability/{baristaId}_{date}:
//                { allDay: true }                 off that whole day
//                { allDay: false, cant: [...] }   that day only these shifts are out
//                                                 (an empty list = free all day, even
//                                                 if the usual week says otherwise)
//                Older entries without allDay count as a whole day off.

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const WEEK_ROWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const WEEKDAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

export const weekdayKeyFor = (key) => WEEKDAY_KEYS[parseDateKey(key).getDay()]

// Shifts a weekday has: shared only on SHARED_DAYS.
export const shiftsForWeekday = (weekdayKey) =>
  SHARED_DAYS.includes(WEEKDAY_KEYS.indexOf(weekdayKey)) ? ['opening', 'closing', 'shared'] : ['opening', 'closing']

const isAllDay = (entry) => entry.allDay !== false

/**
 * Builds availabilityOf(baristaId, date, shift) ->
 *   { ok: true }
 *   { ok: false, reason: 'dayOff' | 'date' | 'weekly' }
 * from the date entries and the usual weeks.
 */
export const makeAvailability = (dateEntries = [], weekly = []) => {
  const byDate = new Map(dateEntries.map((entry) => [unavailabilityId(entry.baristaId, entry.date), entry]))
  const byBarista = new Map(weekly.map((entry) => [entry.baristaId || entry.id, entry]))
  return (baristaId, date, shift) => {
    const entry = byDate.get(unavailabilityId(baristaId, date))
    if (entry) {
      if (isAllDay(entry)) return { ok: false, reason: 'dayOff' }
      return entry.cant?.includes(shift) ? { ok: false, reason: 'date' } : { ok: true }
    }
    const usual = byBarista.get(baristaId)?.cant?.[weekdayKeyFor(date)] || []
    return usual.includes(shift) ? { ok: false, reason: 'weekly' } : { ok: true }
  }
}

// The date entry itself, for the availability tab: null (follows the usual week),
// { allDay: true }, or { allDay: false, cant }.
export const dateEntryFor = (dateEntries, baristaId, date) =>
  dateEntries.find((entry) => entry.baristaId === baristaId && entry.date === date) || null

export const isWholeDayOff = (dateEntries, baristaId, date) => {
  const entry = dateEntryFor(dateEntries, baristaId, date)
  return Boolean(entry && isAllDay(entry))
}

export const REASON_LABELS = {
  dayOff: 'day off',
  date: "can't that day",
  weekly: 'usual week',
}

export const isShiftOpen = (assigned = []) => assigned.length === 0

/**
 * Who the picker shows for one shift on one day:
 *   assigned    - on this shift (one person at most)
 *   available   - active, free for this shift, not on it
 *   unavailable - can't do this shift; each carries `reason` (see REASON_LABELS)
 *   otherShifts - { baristaId: [shift] } anyone working another shift that day
 *   emptyShifts - the day's other shifts nobody has, i.e. where someone can move
 */
export const pickerLists = ({ baristas, date, shift, assignmentsByDate, availabilityOf }) => {
  const day = assignmentsByDate[date] || {}
  const assigned = day[shift] || []
  const assignedIds = new Set(assigned.map((entry) => entry.baristaId))

  const otherShifts = {}
  for (const [otherShift, list] of Object.entries(day)) {
    if (otherShift === shift) continue
    for (const entry of list) (otherShifts[entry.baristaId] ||= []).push(otherShift)
  }

  const candidates = baristas
    .filter((barista) => barista.active !== false && !assignedIds.has(barista.id))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((barista) => ({ ...barista, availability: availabilityOf(barista.id, date, shift) }))

  return {
    assigned,
    available: candidates.filter((barista) => barista.availability.ok),
    unavailable: candidates
      .filter((barista) => !barista.availability.ok)
      .map((barista) => ({ ...barista, reason: barista.availability.reason })),
    otherShifts,
    emptyShifts: shiftsForDate(date).filter((other) => other !== shift && !day[other]?.length),
  }
}

// Active baristas free for this shift, whoever is on it now.
export const freeFor = ({ baristas, date, shift, availabilityOf }) =>
  baristas.filter((barista) => barista.active !== false && availabilityOf(barista.id, date, shift).ok)

// Every shift in [startKey, endKey] that nobody has.
export const openShifts = ({ startKey, endKey, assignmentsByDate }) => {
  const result = []
  for (let cursor = parseDateKey(startKey); dateKey(cursor) <= endKey; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor)
    for (const shift of shiftsForDate(key)) {
      if (isShiftOpen(assignmentsByDate[key]?.[shift])) result.push({ date: key, shift })
    }
  }
  return result
}

// Shifts someone is on but has since said they can't do. Each carries `reason`.
export const conflicts = ({ assignments, availabilityOf }) =>
  assignments
    .map((entry) => ({ ...entry, availability: availabilityOf(entry.baristaId, entry.date, entry.shift) }))
    .filter((entry) => !entry.availability.ok)
    .map((entry) => ({ ...entry, reason: entry.availability.reason }))

// ---- auto-fill ----

/**
 * Proposes a barista for every empty shift in [startKey, endKey], using only
 * who is free for it. Shifts someone already has are never touched.
 *
 * Shifts go day by day, opening and closing before shared, so if anyone is
 * left without a shift it is the optional shared one. Each shift goes to an
 * active barista who is free for it and not already working that day; among
 * those, whoever has the fewest shifts in the range so far (existing ones
 * count), then the fewest of this shift type, then by name.
 *
 * Returns { proposals: [{ date, shift, baristaId, baristaName }],
 *           unfilled: [{ date, shift }],
 *           counts: { baristaId: shifts in the range after filling } }
 */
export const autoFill = ({ baristas, startKey, endKey, assignmentsByDate, availabilityOf }) => {
  const active = baristas
    .filter((barista) => barista.active !== false)
    .sort((left, right) => left.name.localeCompare(right.name))
  const total = {}
  const byShift = {}
  const working = {} // date -> Set of baristaIds on any shift that day
  const count = (date, shift, baristaId) => {
    total[baristaId] = (total[baristaId] || 0) + 1
    byShift[`${baristaId}_${shift}`] = (byShift[`${baristaId}_${shift}`] || 0) + 1
    ;(working[date] ||= new Set()).add(baristaId)
  }

  for (const [date, day] of Object.entries(assignmentsByDate)) {
    if (date < startKey || date > endKey) continue
    for (const [shift, list] of Object.entries(day)) list.forEach((entry) => count(date, shift, entry.baristaId))
  }

  const proposals = []
  const unfilled = []
  for (const { date, shift } of openShifts({ startKey, endKey, assignmentsByDate })) {
    const pick = active
      .filter((barista) => !working[date]?.has(barista.id) && availabilityOf(barista.id, date, shift).ok)
      .sort((left, right) =>
        (total[left.id] || 0) - (total[right.id] || 0)
        || (byShift[`${left.id}_${shift}`] || 0) - (byShift[`${right.id}_${shift}`] || 0))[0]
    if (!pick) {
      unfilled.push({ date, shift })
      continue
    }
    proposals.push({ date, shift, baristaId: pick.id, baristaName: pick.name })
    count(date, shift, pick.id)
  }

  return { proposals, unfilled, counts: total }
}

// ---- barista colours ----
//
// Each barista can pick a colour for their name on the calendar. It is saved
// on their own scheduleUsers/{uid} doc (which they may edit and every signed-in
// user may read) as `color: <id>`. All of these keep white text readable.

export const BARISTA_COLORS = [
  { id: 'red', label: 'Red', hex: '#c0392b' },
  { id: 'orange', label: 'Orange', hex: '#b9520b' },
  { id: 'gold', label: 'Gold', hex: '#8a6d00' },
  { id: 'green', label: 'Green', hex: '#2e7d32' },
  { id: 'teal', label: 'Teal', hex: '#00796b' },
  { id: 'sky', label: 'Sky', hex: '#0277bd' },
  { id: 'blue', label: 'Blue', hex: '#1f4fbf' },
  { id: 'indigo', label: 'Indigo', hex: '#4a3aa8' },
  { id: 'purple', label: 'Purple', hex: '#7b1fa2' },
  { id: 'pink', label: 'Pink', hex: '#c2185b' },
  { id: 'brown', label: 'Brown', hex: '#6d4c41' },
  { id: 'slate', label: 'Slate', hex: '#455a64' },
]

/**
 * { baristaId: hex } from the scheduleUsers docs. Only the login currently
 * linked to a barista (baristas/{id}.uid) counts, and unknown colour ids are
 * ignored.
 */
export const baristaColors = (scheduleUsers, baristas) => {
  const hexById = new Map(BARISTA_COLORS.map((color) => [color.id, color.hex]))
  const colorByUid = new Map(scheduleUsers.map((entry) => [entry.uid || entry.id, entry.color]))
  const result = {}
  for (const barista of baristas) {
    const hex = barista.uid && hexById.get(colorByUid.get(barista.uid))
    if (hex) result[barista.id] = hex
  }
  return result
}
