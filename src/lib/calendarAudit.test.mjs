// Run with:  node src/lib/calendarAudit.test.mjs
//
// Plain script like statement.test.mjs: exits non-zero on failure. Covers how
// the calendar check tells app writes from outside changes on both calendars.

import {
  auditEventsCalendar, auditScheduleCalendar, parseShiftSummary, recentCalendarChanges, wallClock,
} from './calendarAudit.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

const TZ = 'America/Chicago'
const window = { startDate: '2026-10-01', endDate: '2026-12-31' }
const EVENTS = 'events@gmail.com'
const SCHEDULE = 'shop@gmail.com'

// 7pm-9pm Central on 24 Oct 2026 (CDT, -05:00).
const google = (overrides = {}) => ({
  id: 'g1',
  status: 'confirmed',
  summary: 'Jazz Night',
  start: { dateTime: '2026-10-24T19:00:00-05:00' },
  end: { dateTime: '2026-10-24T21:00:00-05:00' },
  updated: '2026-10-10T10:00:00.000Z',
  creator: { email: SCHEDULE },
  organizer: { email: EVENTS, self: true },
  ...overrides,
})
const appEvent = (overrides = {}) => ({
  id: 'e1',
  title: 'Jazz Night',
  date: '2026-10-24',
  startTime: '19:00',
  endTime: '21:00',
  status: 'booked',
  googleCalendarEventId: 'g1',
  googleCalendarId: EVENTS,
  calendarUpdatedAt: '2026-10-10T10:00:00.000Z',
  ...overrides,
})
const auditEvents = (events, googleEvents, extra = {}) =>
  auditEventsCalendar({
    firestoreEvents: events,
    lookupGoogleEvent: (_cal, id) => googleEvents.find((entry) => entry.id === id) || null,
    eventsCalendarEntries: googleEvents,
    eventsCalendarId: EVENTS,
    legacyCalendarId: SCHEDULE,
    calendarsSeparated: true,
    trustedEditors: [SCHEDULE, EVENTS],
    timeZone: TZ,
    window,
    ...extra,
  }).map((finding) => finding.kind)

console.log('helpers')
eq('wall clock in shop time', wallClock({ dateTime: '2026-10-25T00:00:00Z' }, TZ), { date: '2026-10-24', time: '19:00' })
eq('all-day entry', wallClock({ date: '2026-10-24' }, TZ), { date: '2026-10-24', time: null })
eq('parse opening', parseShiftSummary('[Ana, Opening]'), { name: 'Ana', shiftType: 'opening', label: 'opening' })
eq('parse close', parseShiftSummary('[Bo, close] extra'), { name: 'Bo', shiftType: 'closing', label: 'close' })
eq('not a shift', parseShiftSummary('Dentist'), null)

console.log('events calendar')
eq('in sync', auditEvents([appEvent()], [google()]), [])
eq('moved in Google', auditEvents([appEvent()], [google({ start: { dateTime: '2026-10-24T20:00:00-05:00' }, updated: '2026-10-12T00:00:00Z' })]), ['changed-outside-app'])
eq('edited in app, not pushed', auditEvents([appEvent({ startTime: '18:00' })], [google()]), ['not-pushed'])
eq('details touched in Google', auditEvents([appEvent()], [google({ updated: '2026-10-12T00:00:00Z' })]), ['touched-outside-app'])
eq('deleted in Google', auditEvents([appEvent()], [google({ status: 'cancelled' })]), ['deleted-outside-app'])
eq('approved, never synced', auditEvents([appEvent({ googleCalendarEventId: null })], []), ['missing-from-google'])
eq('pending, never synced is fine', auditEvents([appEvent({ googleCalendarEventId: null, status: 'pending' })], []), [])
eq('rejected but on Google', auditEvents([appEvent({ status: 'rejected' })], [google()]), ['rejected-still-on-google'])
eq('still on old calendar', auditEvents([appEvent({ googleCalendarId: undefined })], [google()]), ['on-schedule-calendar'])
eq('added in Google directly', auditEvents([], [google({ id: 'x' })]), ['added-outside-app'])
eq('unlinked entries ignored before split', auditEvents([], [google({ id: 'x' })], { calendarsSeparated: false }), [])
eq('outside window ignored', auditEvents([appEvent({ date: '2027-03-01', googleCalendarEventId: null })], []), [])

console.log('schedule calendar')
const shift = (summary, overrides = {}) => google({
  id: summary + (overrides.id || ''),
  summary,
  start: { dateTime: '2026-10-20T08:00:00-05:00' },
  end: { dateTime: '2026-10-20T14:00:00-05:00' },
  organizer: { email: SCHEDULE, self: true },
  ...overrides,
})
const auditShifts = (entries, extra = {}) =>
  auditScheduleCalendar({
    scheduleEntries: entries,
    scheduleCalendarId: SCHEDULE,
    baristaNames: ['Ana', 'Bo'],
    trustedEditors: [SCHEDULE],
    timeZone: TZ,
    window,
    ...extra,
  }).map((finding) => finding.kind)

eq('good shift', auditShifts([shift('[Ana, Opening]')]), [])
eq('Gmail auto-added', auditShifts([shift('Flight to DEN', { eventType: 'fromGmail' })]), ['automated-entry'])
eq('accepted invitation', auditShifts([shift('Sales call', { organizer: { email: 'vendor@x.com' } })]), ['automated-entry'])
eq('unknown creator', auditShifts([shift('[Ana, Opening]', { creator: { email: 'stranger@x.com' } })]), ['untrusted-creator'])
eq('bad format', auditShifts([shift('Ana opening')]), ['not-a-shift'])
eq('unknown barista', auditShifts([shift('[Zed, Closing]')]), ['unknown-barista'])
eq('duplicate', auditShifts([shift('[Ana, Opening]'), shift('[Ana, Opening]', { id: '2' })]), ['duplicate-shift'])
eq('deleted entries ignored', auditShifts([shift('Ana opening', { status: 'cancelled' })]), [])
eq('band event skipped before split', auditShifts([shift('Jazz Night', { id: 'band' })], { skipEventIds: new Set(['band']) }), [])
eq('compare with brb-schedule', auditShifts([shift('[Ana, Opening]')], {
  confirmedShifts: [
    { id: 's1', date: '2026-10-20', shiftType: 'opening', baristaName: 'Ana', status: 'confirmed' },
    { id: 's2', date: '2026-10-21', shiftType: 'closing', baristaName: 'Bo', status: 'confirmed' },
  ],
}), ['missing-shift-on-google'])
eq('unconfirmed on Google', auditShifts([shift('[Ana, Opening]')], {
  confirmedShifts: [{ id: 's2', date: '2026-10-21', shiftType: 'closing', baristaName: 'Bo' }],
}), ['missing-shift-on-google', 'shift-not-confirmed'])

console.log('recent changes')
const now = Date.parse('2026-10-15T00:00:00Z')
const changes = recentCalendarChanges({
  entries: [
    { calendar: 'events', googleEvent: google({ updated: '2026-10-14T00:00:00Z', created: '2026-10-01T00:00:00Z' }) },
    { calendar: 'schedule', googleEvent: shift('[Bo, Closing]', { updated: '2026-10-13T00:00:00Z', created: '2026-10-13T00:00:02Z' }) },
    { calendar: 'schedule', googleEvent: shift('gone', { status: 'cancelled', updated: '2026-10-12T00:00:00Z' }) },
    { calendar: 'schedule', googleEvent: shift('old', { updated: '2026-09-01T00:00:00Z' }) },
  ],
  appStamps: new Map([['g1', '2026-10-14T00:00:00Z']]),
  now,
})
eq('actions newest first', changes.map((change) => change.action), ['edited', 'created', 'deleted'])
eq('app write recognised', changes.map((change) => change.byApp), [true, false, false])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
