// The comparison behind the calendar check. Pure functions only - no Firebase,
// no fetch - so it runs under plain node: node src/lib/calendarAudit.test.mjs
//
// A finding is something on Google that does not match what the admin or the
// baristas entered through the apps:
//   { key, calendar, kind, severity, title, detail, date, fix, event, googleEvent }
// `key` changes whenever Google's copy changes, so a finding the admin has
// dismissed comes back if the entry is touched again.

const APPROVED_STATUSES = ['booked', 'approved']
const lower = (value) => String(value || '').trim().toLowerCase()

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

// "[Ana, Opening]" -> { name: 'Ana', shiftType: 'opening' }. Same labels the
// staff tab accepts; shiftType is null when the label is not one of them.
export const parseShiftSummary = (summary) => {
  const match = String(summary || '').match(/^\[([^,]+),\s*([^\]]+)\]/)
  if (!match || !match[1].trim()) return null
  const label = lower(match[2])
  let shiftType = null
  if (label.includes('open')) shiftType = 'opening'
  else if (label.includes('clos')) shiftType = 'closing'
  else if (label.includes('shared') || label.includes('support') || label.includes('inter')) shiftType = 'shared'
  return { name: match[1].trim(), shiftType, label }
}

// A Google start/end as the shop's wall clock: { date: 'YYYY-MM-DD', time: 'HH:mm' }.
// Comparing wall clocks avoids offsets entirely, since the app stores local times.
export const wallClock = (googleTime, timeZone) => {
  if (!googleTime) return null
  if (googleTime.date) return { date: googleTime.date, time: null }
  const instant = new Date(googleTime.dateTime)
  if (Number.isNaN(instant.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

const toMillis = (value) => {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value.toMillis === 'function') return value.toMillis()
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

const inWindow = (date, window) => Boolean(date) && date >= window.startDate && date <= window.endDate

const describeOrigin = (googleEvent) => {
  if (googleEvent.eventType === 'fromGmail') return 'added automatically by Gmail from an email'
  const creator = googleEvent.creator?.email
  return creator ? `created by ${creator}` : 'creator unknown'
}

// Gmail reservations and auto-accepted invitations land on a calendar without
// anyone adding them on purpose.
export const isAutomatedEntry = (googleEvent, calendarId) => {
  if (googleEvent.eventType === 'fromGmail') return true
  const organizer = googleEvent.organizer
  if (!organizer?.email || organizer.self) return false
  return lower(organizer.email) !== lower(calendarId)
}

const isTrustedCreator = (googleEvent, trustedEditors) => {
  if (!trustedEditors?.length) return true
  const creator = lower(googleEvent.creator?.email)
  return !creator || trustedEditors.includes(creator)
}

const diffEventContent = (event, googleEvent, timeZone) => {
  const start = wallClock(googleEvent.start, timeZone)
  const end = wallClock(googleEvent.end, timeZone)
  const differences = []
  if ((googleEvent.summary || '') !== (event.title || '')) {
    differences.push(`title: app "${event.title || ''}", Google "${googleEvent.summary || ''}"`)
  }
  if (start?.date !== event.date) {
    differences.push(`date: app ${event.date}, Google ${start?.date || 'none'}`)
  }
  if (start?.time !== event.startTime || end?.time !== event.endTime) {
    differences.push(
      `time: app ${event.startTime}–${event.endTime}, Google ${start?.time || 'all day'}–${end?.time || ''}`
    )
  }
  return differences
}

const finding = (fields) => ({
  ...fields,
  key: [fields.kind, fields.event?.id || '', fields.googleEvent?.id || '', fields.googleEvent?.updated || ''].join('|'),
})

/**
 * Band events: the Firestore `events` collection is the source of truth, and
 * every entry on the events calendar should be one the app wrote.
 *
 * firestoreEvents  - docs from `events`, each with its id
 * lookupGoogleEvent(calendarId, eventId) - Google's copy (cancelled ones included) or null
 * eventsCalendarEntries - everything on the events calendar in the window, deletions included
 */
export const auditEventsCalendar = ({
  firestoreEvents,
  lookupGoogleEvent,
  eventsCalendarEntries,
  eventsCalendarId,
  legacyCalendarId,
  calendarsSeparated,
  trustedEditors,
  timeZone,
  window,
}) => {
  const findings = []
  const linkedIds = new Set()

  for (const event of firestoreEvents) {
    if (event.googleCalendarEventId) linkedIds.add(event.googleCalendarEventId)
    if (!inWindow(event.date, window)) continue

    const status = lower(event.status)
    const approved = APPROVED_STATUSES.includes(status)
    const base = { calendar: 'events', event, title: event.title || 'Untitled event', date: event.date }

    if (!event.googleCalendarEventId) {
      if (approved) {
        findings.push(finding({
          ...base,
          kind: 'missing-from-google',
          severity: 'high',
          detail: 'Approved in the app but not on Google Calendar, so it does not show on phones.',
          fix: 'push',
        }))
      }
      continue
    }

    const calendarId = event.googleCalendarId || legacyCalendarId
    const googleEvent = lookupGoogleEvent(calendarId, event.googleCalendarEventId)

    if (!googleEvent || googleEvent.status === 'cancelled') {
      if (approved) {
        findings.push(finding({
          ...base,
          googleEvent,
          kind: 'deleted-outside-app',
          severity: 'high',
          detail: 'Deleted from Google Calendar outside the app. It is still booked here and on the website.',
          fix: 'push',
        }))
      }
      continue
    }

    if (status === 'rejected' || status === 'cancelled') {
      findings.push(finding({
        ...base,
        googleEvent,
        kind: 'rejected-still-on-google',
        severity: 'medium',
        detail: `Marked ${status} in the app but still on Google Calendar, so phones show it as happening.`,
        fix: 'remove',
      }))
      continue
    }

    const differences = diffEventContent(event, googleEvent, timeZone)
    const googleTouched = event.calendarUpdatedAt ? googleEvent.updated !== event.calendarUpdatedAt : null
    const appEditedAfterSync =
      toMillis(event.updatedAt) && toMillis(event.calendarSyncedAt)
        ? toMillis(event.updatedAt) > toMillis(event.calendarSyncedAt) + 1000
        : null

    if (differences.length > 0) {
      if (googleTouched === true) {
        findings.push(finding({
          ...base,
          googleEvent,
          kind: 'changed-outside-app',
          severity: 'high',
          detail: `Changed directly in Google Calendar, not by the app. ${differences.join('; ')}.`,
          fix: 'push',
        }))
      } else if (googleTouched === false || appEditedAfterSync) {
        findings.push(finding({
          ...base,
          googleEvent,
          kind: 'not-pushed',
          severity: 'medium',
          detail: `Edited in the app but Google Calendar still has the old version. ${differences.join('; ')}.`,
          fix: 'push',
        }))
      } else {
        findings.push(finding({
          ...base,
          googleEvent,
          kind: 'mismatch',
          severity: 'medium',
          detail: `The app and Google Calendar disagree. ${differences.join('; ')}.`,
          fix: 'push',
        }))
      }
    } else if (googleTouched === true) {
      findings.push(finding({
        ...base,
        googleEvent,
        kind: 'touched-outside-app',
        severity: 'low',
        detail: 'Date, time and title still match, but the entry was edited in Google Calendar (description, guests or reminders).',
        fix: null,
      }))
    }

    if (calendarsSeparated && calendarId !== eventsCalendarId) {
      findings.push(finding({
        ...base,
        googleEvent,
        kind: 'on-schedule-calendar',
        severity: 'medium',
        detail: 'Still on the barista schedule calendar from before the split. Move it to the events calendar.',
        fix: 'move',
      }))
    }
  }

  // With one shared calendar every shift would show up here, so this only runs
  // once events have a calendar of their own.
  if (calendarsSeparated) {
    for (const googleEvent of eventsCalendarEntries) {
      if (googleEvent.status === 'cancelled' || linkedIds.has(googleEvent.id)) continue
      const automated = isAutomatedEntry(googleEvent, eventsCalendarId)
      const trusted = isTrustedCreator(googleEvent, trustedEditors)
      const start = wallClock(googleEvent.start, timeZone)
      findings.push(finding({
        calendar: 'events',
        googleEvent,
        title: googleEvent.summary || 'Untitled entry',
        date: start?.date || null,
        kind: 'added-outside-app',
        severity: automated || !trusted ? 'high' : 'medium',
        detail: `On the events calendar but not in the app (${describeOrigin(googleEvent)}). The website and band portal do not know about it.`,
        fix: null,
      }))
    }
  }

  return findings
}

/**
 * Barista shifts on the schedule calendar. Entries are added by hand, so the
 * check looks for ones nobody on the trusted list added, ones the staff tab
 * cannot read, and disagreement with shifts confirmed in brb-schedule.
 *
 * scheduleEntries - everything on the schedule calendar in the window, deletions included
 * skipEventIds    - Google IDs that belong to band events (only matters before the split)
 * confirmedShifts - `schedules` docs: { date, shiftType, baristaName, status }
 * baristaNames    - names from the `baristas` collection
 */
export const auditScheduleCalendar = ({
  scheduleEntries,
  skipEventIds = new Set(),
  scheduleCalendarId,
  confirmedShifts = [],
  baristaNames = [],
  trustedEditors,
  timeZone,
  window,
}) => {
  const findings = []
  const knownNames = new Set(baristaNames.map(lower))
  const onGoogle = new Map()

  for (const googleEvent of scheduleEntries) {
    if (googleEvent.status === 'cancelled' || skipEventIds.has(googleEvent.id)) continue
    const start = wallClock(googleEvent.start, timeZone)
    if (!inWindow(start?.date, window)) continue

    const base = {
      calendar: 'schedule',
      googleEvent,
      title: googleEvent.summary || 'Untitled entry',
      date: start.date,
      fix: null,
    }

    if (isAutomatedEntry(googleEvent, scheduleCalendarId)) {
      findings.push(finding({
        ...base,
        kind: 'automated-entry',
        severity: 'high',
        detail: `Not added by the admin or a barista: ${describeOrigin(googleEvent)}${
          googleEvent.organizer?.email ? `, organizer ${googleEvent.organizer.email}` : ''
        }.`,
      }))
      continue
    }

    if (!isTrustedCreator(googleEvent, trustedEditors)) {
      findings.push(finding({
        ...base,
        kind: 'untrusted-creator',
        severity: 'high',
        detail: `Created by ${googleEvent.creator.email}, which is not on the trusted editors list.`,
      }))
    }

    const shift = parseShiftSummary(googleEvent.summary)
    if (!shift) {
      findings.push(finding({
        ...base,
        kind: 'not-a-shift',
        severity: 'medium',
        detail: 'Does not follow the "[Name, Shift]" format, so the staff tab and pay statements ignore it.',
      }))
      continue
    }
    if (!shift.shiftType) {
      findings.push(finding({
        ...base,
        kind: 'unknown-shift-type',
        severity: 'medium',
        detail: `"${shift.label}" is not Opening, Closing or Shared, so the shift type is guessed from the hours.`,
      }))
    }
    if (knownNames.size > 0 && !knownNames.has(lower(shift.name))) {
      findings.push(finding({
        ...base,
        kind: 'unknown-barista',
        severity: 'medium',
        detail: `"${shift.name}" is not a barista in Staff Management. Check the spelling.`,
      }))
    }

    const slot = `${lower(shift.name)}|${start.date}|${shift.shiftType || shift.label}`
    if (onGoogle.has(slot)) {
      findings.push(finding({
        ...base,
        kind: 'duplicate-shift',
        severity: 'medium',
        detail: `${shift.name} has this shift twice on ${start.date}.`,
      }))
    } else {
      onGoogle.set(slot, { googleEvent, shift, date: start.date })
    }
  }

  // Only compare against brb-schedule when baristas actually use it for the
  // window; otherwise every shift on Google would look unconfirmed.
  const confirmed = confirmedShifts.filter(
    (entry) => lower(entry.status || 'confirmed') === 'confirmed' && inWindow(entry.date, window)
  )
  if (confirmed.length > 0) {
    const confirmedSlots = new Set()
    for (const entry of confirmed) {
      const slot = `${lower(entry.baristaName)}|${entry.date}|${entry.shiftType}`
      confirmedSlots.add(slot)
      if (!onGoogle.has(slot)) {
        findings.push(finding({
          calendar: 'schedule',
          event: { id: entry.id },
          title: `[${entry.baristaName}, ${entry.shiftType}]`,
          date: entry.date,
          kind: 'missing-shift-on-google',
          severity: 'medium',
          detail: `${entry.baristaName} confirmed this ${entry.shiftType} shift in the schedule app, but it is not on Google Calendar.`,
          fix: null,
        }))
      }
    }
    for (const [slot, { googleEvent, shift, date }] of onGoogle) {
      if (confirmedSlots.has(slot)) continue
      findings.push(finding({
        calendar: 'schedule',
        googleEvent,
        title: googleEvent.summary,
        date,
        kind: 'shift-not-confirmed',
        severity: 'low',
        detail: `On Google Calendar, but ${shift.name} has not confirmed this shift in the schedule app.`,
        fix: null,
      }))
    }
  }

  return findings
}

/**
 * Every create, edit and delete Google recorded in the last `days` days, newest
 * first. `byApp` is true when the change is the app's own write (Google's
 * `updated` stamp matches what the app saved), so the rest are the changes to
 * look at.
 */
export const recentCalendarChanges = ({ entries, appStamps = new Map(), now, days = 7 }) => {
  const since = now - days * 24 * 60 * 60 * 1000
  return entries
    .filter((entry) => toMillis(entry.googleEvent.updated) >= since)
    .map(({ googleEvent, calendar }) => {
      const updated = toMillis(googleEvent.updated)
      const created = toMillis(googleEvent.created)
      let action = 'edited'
      if (googleEvent.status === 'cancelled') action = 'deleted'
      else if (created && Math.abs(updated - created) < 5000) action = 'created'
      return {
        key: `${googleEvent.id}|${googleEvent.updated}`,
        calendar,
        action,
        at: updated,
        title: googleEvent.summary || '(no title)',
        creator: googleEvent.creator?.email || null,
        automated: googleEvent.eventType === 'fromGmail',
        byApp: appStamps.get(googleEvent.id) === googleEvent.updated,
        link: googleEvent.htmlLink || null,
      }
    })
    .sort((left, right) => right.at - left.at)
}

export const sortFindings = (findings) =>
  [...findings].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      String(left.date || '').localeCompare(String(right.date || ''))
  )
