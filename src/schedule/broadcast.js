// The schedule email the admin sends to everyone working in a date range.
// Pure, like shifts.js. Nothing is sent from here: the admin tab opens it in
// Gmail (from the BRB account) or copies it, the same way the ACL invites go
// out, so Firebase's email cap never gets in the way.

import { SHIFTS, SHIFT_ORDER, formatDay, formatRange, groupAssignments, openShifts, parseDateKey, shiftsForDate, dateKey, timesFor as defaultTimesFor } from './shifts.js'

export const SCHEDULE_URL = 'https://schedule.brbcoffee-atx.com'

// `timesFor(date, shift)` gives each shift's actual hours (the admin can adjust them).
export const buildBroadcast = ({ assignments, baristas, startKey, endKey, timesFor = defaultTimesFor }) => {
  const inRange = assignments.filter((entry) => entry.date >= startKey && entry.date <= endKey)
  const byDate = groupAssignments(inRange)
  const baristasById = new Map(baristas.map((barista) => [barista.id, barista]))

  const workingIds = [...new Set(inRange.map((entry) => entry.baristaId))]
  const working = workingIds
    .map((id) => baristasById.get(id) || { id, name: inRange.find((entry) => entry.baristaId === id).baristaName })
    .sort((left, right) => left.name.localeCompare(right.name))

  const to = working.map((barista) => barista.email).filter(Boolean)
  const missingEmail = working.filter((barista) => !barista.email).map((barista) => barista.name)

  const range = `${formatDay(startKey, { month: 'short', day: 'numeric' })} – ${formatDay(endKey, { month: 'short', day: 'numeric' })}`
  const subject = `BRB schedule: ${range}`

  const dayLines = []
  for (let cursor = parseDateKey(startKey); dateKey(cursor) <= endKey; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor)
    const parts = SHIFT_ORDER.filter((shift) => shiftsForDate(key).includes(shift)).map((shift) => {
      const names = (byDate[key]?.[shift] || []).map((entry) => entry.baristaName)
      const hours = timesFor(key, shift)
      return `${SHIFTS[shift].label}${hours.custom ? ` (${formatRange(hours)})` : ''}: ${names.length ? names.join(', ') : 'OPEN'}`
    })
    dayLines.push(`${formatDay(key)} — ${parts.join(' · ')}`)
  }

  const personLines = working.map((barista) => {
    const shifts = inRange
      .filter((entry) => entry.baristaId === barista.id)
      .sort((left, right) => left.date.localeCompare(right.date) || SHIFT_ORDER.indexOf(left.shift) - SHIFT_ORDER.indexOf(right.shift))
      .map((entry) => `  • ${formatDay(entry.date)} — ${SHIFTS[entry.shift].label} (${formatRange(timesFor(entry.date, entry.shift))})`)
    return `${barista.name} (${shifts.length})\n${shifts.join('\n')}`
  })

  const open = openShifts({ startKey, endKey, assignmentsByDate: byDate })
  const openLines = open.map((entry) => `  • ${formatDay(entry.date)} — ${SHIFTS[entry.shift].label} (${formatRange(timesFor(entry.date, entry.shift))})`)

  const body = [
    'Hi team,',
    '',
    `Here is the schedule for ${range}.`,
    '',
    'YOUR SHIFTS',
    '',
    personLines.join('\n\n') || '(no shifts assigned)',
    '',
    'FULL SCHEDULE',
    '',
    dayLines.join('\n'),
    ...(openLines.length
      ? ['', `STILL OPEN — reply if you can pick one up (${openLines.length})`, '', openLines.join('\n')]
      : []),
    '',
    `Something wrong or can't make a shift? Reply to this email, and keep your days off up to date at ${SCHEDULE_URL}.`,
    '',
    'Thanks!',
    'BRB Coffee',
  ].join('\n')

  return { to, missingEmail, subject, body, openCount: open.length, shiftCount: inRange.length }
}

// Gmail's compose window, addressed by BCC so baristas don't see each other's
// addresses. `account` picks which signed-in Gmail it opens in.
export const gmailComposeUrl = ({ to, subject, body, account }) => {
  const params = new URLSearchParams({ view: 'cm', fs: '1', bcc: to.join(','), su: subject, body })
  if (account) params.set('authuser', account)
  return `https://mail.google.com/mail/?${params}`
}

/**
 * "This shift needs someone" - sent when a barista drops a shift. Goes to
 * every active barista with an email who can do that shift, except whoever
 * dropped it and anyone already working another shift that day (they can't
 * do two at once, but are listed so the admin can see who was left out).
 */
export const buildCoverRequest = ({ date, shift, droppedBy, baristas, availabilityOf, assignmentsByDate, timesFor = defaultTimesFor }) => {
  const busy = new Set(Object.values(assignmentsByDate[date] || {}).flat().map((entry) => entry.baristaId))

  const candidates = baristas
    .filter((barista) => barista.active !== false && barista.id !== droppedBy?.id)
    .sort((left, right) => left.name.localeCompare(right.name))
  const off = new Set(candidates.filter((barista) => !availabilityOf(barista.id, date, shift).ok).map((barista) => barista.id))
  const free = candidates.filter((barista) => !off.has(barista.id) && !busy.has(barista.id))

  const when = `${formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${SHIFTS[shift].label} (${formatRange(timesFor(date, shift))})`
  const body = [
    'Hi team,',
    '',
    `We need someone for ${when}.`,
    ...(droppedBy?.name ? ['', `${droppedBy.name} can no longer make it.`] : []),
    '',
    `Can you pick it up? Open ${SCHEDULE_URL}, tap that shift and choose "Add me" — whoever adds themselves first gets it.`,
    '',
    'Thanks!',
    'BRB Coffee',
  ].join('\n')

  return {
    to: free.map((barista) => barista.email).filter(Boolean),
    missingEmail: free.filter((barista) => !barista.email).map((barista) => barista.name),
    skipped: {
      off: candidates.filter((barista) => off.has(barista.id)).map((barista) => barista.name),
      working: candidates.filter((barista) => busy.has(barista.id) && !off.has(barista.id)).map((barista) => barista.name),
    },
    subject: `Shift needs cover: ${formatDay(date)} ${SHIFTS[shift].label}`,
    body,
  }
}
