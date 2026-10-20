import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  CALENDAR_TIME_ZONE,
  EVENTS_CALENDAR_ID,
  LEGACY_EVENTS_CALENDAR_ID,
  SCHEDULE_CALENDAR_ID,
  calendarsAreSeparated,
  getCalendarEvent,
  getTrustedEditors,
  isGoneError,
  listCalendarEvents,
} from './calendars'
import {
  auditEventsCalendar,
  auditScheduleCalendar,
  recentCalendarChanges,
  sortFindings,
} from '../lib/calendarAudit'

// How far around today the check looks. Past days catch shifts that were
// quietly edited after the fact, which matters for pay statements.
const DAYS_BACK = 14
const DAYS_AHEAD = 120
const RECENT_CHANGE_DAYS = 7

const DISMISSED_KEY = 'brb_calendar_audit_dismissed'

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// Dismissed findings are per-browser. A dismissed finding reappears if the
// Google entry changes again, because its key includes Google's updated stamp.
export const getDismissedKeys = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

export const dismissFinding = (key) => {
  try {
    const keys = [...getDismissedKeys(), key].slice(-500)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys))
  } catch {
    // Storage unavailable: the finding simply stays visible.
  }
}

export const runCalendarAudit = async (accessToken, { adminEmail } = {}) => {
  if (!accessToken) throw new Error('Connect Google Calendar to run the calendar check.')

  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BACK)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DAYS_AHEAD, 23, 59, 59)
  const window = { startDate: dateKey(start), endDate: dateKey(end) }

  const [eventsSnap, schedulesSnap, baristasSnap] = await Promise.all([
    getDocs(collection(db, 'events')),
    getDocs(
      query(
        collection(db, 'schedules'),
        where('date', '>=', window.startDate),
        where('date', '<=', window.endDate)
      )
    ).catch((err) => {
      console.warn('Calendar check: could not read brb-schedule shifts:', err)
      return null
    }),
    getDocs(collection(db, 'baristas')),
  ])

  const firestoreEvents = eventsSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
  const confirmedShifts = schedulesSnap ? schedulesSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() })) : []
  const baristaNames = baristasSnap.docs.map((entry) => entry.data().name).filter(Boolean)

  // Fetch each distinct calendar once; before the split they are all the same.
  const calendarIds = [...new Set([EVENTS_CALENDAR_ID, SCHEDULE_CALENDAR_ID, LEGACY_EVENTS_CALENDAR_ID].filter(Boolean))]
  const listings = new Map(
    await Promise.all(
      calendarIds.map(async (calendarId) => [
        calendarId,
        await listCalendarEvents(calendarId, accessToken, { timeMin: start, timeMax: end, showDeleted: true }),
      ])
    )
  )

  const googleByKey = new Map()
  for (const [calendarId, items] of listings) {
    for (const item of items) googleByKey.set(`${calendarId}|${item.id}`, item)
  }

  // Linked entries that fell outside the listing (moved to another month, or
  // deleted long ago) are fetched one by one so they are not mistaken for gone.
  const unresolved = firestoreEvents.filter(
    (event) =>
      event.googleCalendarEventId &&
      event.date >= window.startDate &&
      event.date <= window.endDate &&
      !googleByKey.has(`${event.googleCalendarId || LEGACY_EVENTS_CALENDAR_ID}|${event.googleCalendarEventId}`)
  )
  await Promise.all(
    unresolved.map(async (event) => {
      const calendarId = event.googleCalendarId || LEGACY_EVENTS_CALENDAR_ID
      try {
        const item = await getCalendarEvent(calendarId, event.googleCalendarEventId, accessToken)
        googleByKey.set(`${calendarId}|${item.id}`, item)
      } catch (err) {
        if (!isGoneError(err)) throw err
      }
    })
  )

  const trustedEditors = getTrustedEditors(adminEmail ? [adminEmail] : [])
  const linkedIds = new Set(firestoreEvents.map((event) => event.googleCalendarEventId).filter(Boolean))

  const findings = [
    ...auditEventsCalendar({
      firestoreEvents,
      lookupGoogleEvent: (calendarId, eventId) => googleByKey.get(`${calendarId}|${eventId}`) || null,
      eventsCalendarEntries: listings.get(EVENTS_CALENDAR_ID) || [],
      eventsCalendarId: EVENTS_CALENDAR_ID,
      legacyCalendarId: LEGACY_EVENTS_CALENDAR_ID,
      calendarsSeparated: calendarsAreSeparated,
      trustedEditors,
      timeZone: CALENDAR_TIME_ZONE,
      window,
    }),
    ...auditScheduleCalendar({
      scheduleEntries: listings.get(SCHEDULE_CALENDAR_ID) || [],
      skipEventIds: linkedIds,
      scheduleCalendarId: SCHEDULE_CALENDAR_ID,
      confirmedShifts,
      baristaNames,
      trustedEditors,
      timeZone: CALENDAR_TIME_ZONE,
      window,
    }),
  ]

  const appStamps = new Map(
    firestoreEvents
      .filter((event) => event.googleCalendarEventId && event.calendarUpdatedAt)
      .map((event) => [event.googleCalendarEventId, event.calendarUpdatedAt])
  )
  const changeEntries = []
  for (const [calendarId, items] of listings) {
    const calendar = calendarId === SCHEDULE_CALENDAR_ID && calendarsAreSeparated ? 'schedule'
      : calendarId === EVENTS_CALENDAR_ID && calendarsAreSeparated ? 'events'
      : 'shared'
    for (const googleEvent of items) changeEntries.push({ googleEvent, calendar })
  }

  return {
    ranAt: now,
    window,
    calendarsSeparated: calendarsAreSeparated,
    findings: sortFindings(findings),
    recentChanges: recentCalendarChanges({
      entries: changeEntries,
      appStamps,
      now: now.getTime(),
      days: RECENT_CHANGE_DAYS,
    }),
    recentChangeDays: RECENT_CHANGE_DAYS,
    eventsById: new Map(firestoreEvents.map((event) => [event.id, event])),
  }
}
