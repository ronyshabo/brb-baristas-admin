import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  CALENDAR_TIME_ZONE,
  EVENTS_CALENDAR_ID,
  EVENTS_CALENDAR_SYNC_ENABLED,
  LEGACY_EVENTS_CALENDAR_ID,
  calendarRequest,
  isGoneError,
} from './calendars'

// An approved event has to land in two places: the public website (which reads
// status + showOnWebsite out of Firestore) and the shop's Google Calendar. Both
// writes live here so the events tab and the pending-requests tab can't drift.

// The events calendar, not the barista schedule calendar - see ./calendars.js.
export const calendarId = EVENTS_CALENDAR_ID
export const calendarTimeZone = CALENDAR_TIME_ZONE
export { EVENTS_CALENDAR_SYNC_ENABLED }

// Last line of defence: callers check the switch first, so this only fires if
// something new forgets to.
const assertSyncEnabled = () => {
  if (!EVENTS_CALENDAR_SYNC_ENABLED) {
    throw new Error('Google Calendar sync for events is turned off.')
  }
}

// This app writes 'booked' on approval; the band portal in brb-events writes and
// reads 'approved'. The website accepts either, so treat both as approved here
// rather than letting an event's origin decide whether it looks approved.
export const APPROVED_STATUS = 'booked'
export const APPROVED_STATUSES = ['booked', 'approved']

export const isApprovedEvent = (event) =>
  APPROVED_STATUSES.includes(String(event?.status || '').toLowerCase())

export const buildCalendarDescription = (event) =>
  [
    event.description ? `Description: ${event.description}` : null,
    event.bandName ? `Band: ${event.bandName}` : null,
    event.bandEmail ? `Email: ${event.bandEmail}` : null,
    event.venue ? `Venue: ${event.venue}` : null,
    event.notes ? `Notes: ${event.notes}` : null,
    event.bandId ? 'Requested by band, approved by admin' : 'Booked directly by admin',
  ]
    .filter(Boolean)
    .join('\n')

// Marks the entry as written by this app, and ties it to its Firestore doc, so
// the calendar check can tell app entries from ones added in Google directly.
export const BRB_CALENDAR_SOURCE = 'brb-admin'

const buildCalendarResource = (event) => ({
  summary: event.title,
  description: buildCalendarDescription(event),
  start: { dateTime: `${event.date}T${event.startTime}:00`, timeZone: calendarTimeZone },
  end: { dateTime: `${event.date}T${event.endTime}:00`, timeZone: calendarTimeZone },
  extendedProperties: {
    private: {
      brbSource: BRB_CALENDAR_SOURCE,
      ...(event.id ? { brbEventId: event.id } : {}),
    },
  },
})

const assertCanWrite = (event, accessToken) => {
  assertSyncEnabled()
  if (!calendarId) {
    throw new Error('Missing Google Calendar configuration. Set VITE_GOOGLE_EVENTS_CALENDAR_ID.')
  }
  if (!accessToken) {
    throw new Error('Google Calendar is not connected. Reconnect and try again.')
  }
  if (!event.date || !event.startTime || !event.endTime) {
    throw new Error('Event is missing a date, start time, or end time.')
  }
}

// The calendar an event's Google entry lives on. Docs written before the split
// have no googleCalendarId and are on the old shared calendar.
export const calendarIdForEvent = (event) => event.googleCalendarId || LEGACY_EVENTS_CALENDAR_ID

// The Firestore fields recording where an event sits on Google and when the app
// last wrote it. calendarUpdatedAt is Google's own `updated` stamp: if Google
// later reports a different one, someone changed the entry outside this app.
const syncFields = (googleEvent, calendarIdUsed) => ({
  googleCalendarEventId: googleEvent.id,
  googleCalendarId: calendarIdUsed,
  calendarUpdatedAt: googleEvent.updated || null,
  calendarSyncStatus: 'synced',
  calendarSyncError: null,
  calendarSyncedAt: new Date(),
})

// Creates the Google entry and returns the sync fields to store on the doc.
export const createCalendarEventRecord = async (event, accessToken) => {
  assertCanWrite(event, accessToken)
  const created = await calendarRequest(calendarId, '/events', accessToken, {
    method: 'POST',
    body: buildCalendarResource(event),
  })
  return syncFields(created, calendarId)
}

export const createCalendarEvent = async (event, accessToken) =>
  (await createCalendarEventRecord(event, accessToken)).googleCalendarEventId

// Makes Google match the app's copy of an event: patches the existing entry, or
// recreates it if it was deleted in Google. Saves the sync fields to Firestore.
export const pushEventToCalendar = async (event, accessToken) => {
  assertCanWrite(event, accessToken)
  let updates = null

  if (event.googleCalendarEventId) {
    const targetCalendarId = calendarIdForEvent(event)
    try {
      const patched = await calendarRequest(
        targetCalendarId,
        `/events/${encodeURIComponent(event.googleCalendarEventId)}`,
        accessToken,
        { method: 'PATCH', body: { ...buildCalendarResource(event), status: 'confirmed' } }
      )
      updates = syncFields(patched, targetCalendarId)
    } catch (err) {
      if (!isGoneError(err)) throw err
    }
  }

  if (!updates) updates = await createCalendarEventRecord(event, accessToken)

  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// Removes an event's Google entry. An entry that is already gone counts as done.
export const deleteCalendarEvent = async (event, accessToken) => {
  if (!EVENTS_CALENDAR_SYNC_ENABLED || !event.googleCalendarEventId) return
  if (!accessToken) {
    throw new Error('Google Calendar is not connected, so the calendar entry cannot be removed.')
  }
  try {
    await calendarRequest(
      calendarIdForEvent(event),
      `/events/${encodeURIComponent(event.googleCalendarEventId)}`,
      accessToken,
      { method: 'DELETE' }
    )
  } catch (err) {
    if (!isGoneError(err)) throw err
  }
}

// Takes an event off Google but keeps the doc, e.g. a rejected booking that
// was still showing on everyone's phone.
export const removeEventFromCalendar = async (event, accessToken) => {
  assertSyncEnabled()
  await deleteCalendarEvent(event, accessToken)
  const updates = {
    googleCalendarEventId: null,
    googleCalendarId: null,
    calendarUpdatedAt: null,
    calendarSyncStatus: 'removed',
    calendarSyncedAt: new Date(),
  }
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// One-time migration: moves an entry from the old shared calendar onto the
// events calendar. Google keeps the same event ID, so phones see a move rather
// than a delete and a new entry.
export const moveEventToEventsCalendar = async (event, accessToken) => {
  assertSyncEnabled()
  const sourceCalendarId = calendarIdForEvent(event)
  if (!event.googleCalendarEventId || sourceCalendarId === calendarId) return null
  if (!accessToken) throw new Error('Google Calendar is not connected. Reconnect and try again.')

  const moved = await calendarRequest(
    sourceCalendarId,
    `/events/${encodeURIComponent(event.googleCalendarEventId)}/move`,
    accessToken,
    { method: 'POST', params: { destination: calendarId } }
  )
  const updates = syncFields(moved, calendarId)
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// An approved event that never reached the calendar. These used to be invisible:
// approving without a Google token skipped the calendar write without saying so.
export const isMissingFromCalendar = (event) =>
  EVENTS_CALENDAR_SYNC_ENABLED && isApprovedEvent(event) && !event.googleCalendarEventId

export const isPublishedToWebsite = (event) =>
  isApprovedEvent(event) && event.showOnWebsite !== false

// Approves one event and reports honestly on both destinations. Never throws for a
// calendar problem - the approval itself still stands, and the failure is recorded
// on the document so the UI can offer a retry.
export const approveEvent = async (event, accessToken, extraFields = {}) => {
  let googleCalendarEventId = event.googleCalendarEventId || null
  let calendarRecord = {}
  let calendarError = null

  if (EVENTS_CALENDAR_SYNC_ENABLED && !googleCalendarEventId) {
    try {
      calendarRecord = await createCalendarEventRecord(event, accessToken)
      googleCalendarEventId = calendarRecord.googleCalendarEventId
    } catch (err) {
      calendarError = err?.message || 'Failed to add the event to Google Calendar'
      console.error(`Calendar sync failed for event ${event.id}:`, err)
    }
  }

  const updates = {
    status: APPROVED_STATUS,
    bookedAt: new Date(),
    // The website hides an event whose showOnWebsite is false, and the create form
    // defaults it to false - so approving has to publish explicitly, or the event is
    // approved straight into invisibility.
    showOnWebsite: true,
    googleCalendarEventId,
    calendarSyncStatus: !EVENTS_CALENDAR_SYNC_ENABLED ? 'off' : googleCalendarEventId ? 'synced' : 'failed',
    calendarSyncError: calendarError,
    calendarSyncedAt: googleCalendarEventId ? new Date() : null,
    ...calendarRecord,
    ...extraFields,
  }

  await updateDoc(doc(db, 'events', event.id), updates)

  return { updates, calendarSynced: Boolean(googleCalendarEventId), calendarError }
}

// Retry for an event that is already approved but never made it to the calendar.
export const syncEventToCalendar = async (event, accessToken) => {
  const updates = await createCalendarEventRecord(event, accessToken)
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// An approved event the website is still hiding, because showOnWebsite was left
// false when it was approved. Approval now forces it true, but older events keep
// whatever they were saved with.
export const isHiddenFromWebsite = (event) =>
  isApprovedEvent(event) && event.showOnWebsite === false

export const publishEventToWebsite = async (event) => {
  const updates = { showOnWebsite: true, publishedToWebsiteAt: new Date() }
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// A rejected event must not stay on the calendar, or it keeps showing on
// phones as if it were booked. Without a token the calendar entry is left for
// the calendar check to flag.
export const rejectEvent = async (event, extraFields = {}, accessToken = null) => {
  const updates = { status: 'rejected', rejectedAt: new Date(), showOnWebsite: false, ...extraFields }
  if (EVENTS_CALENDAR_SYNC_ENABLED && event.googleCalendarEventId && accessToken) {
    await deleteCalendarEvent(event, accessToken)
    Object.assign(updates, {
      googleCalendarEventId: null,
      googleCalendarId: null,
      calendarUpdatedAt: null,
      calendarSyncStatus: 'removed',
    })
  }
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// One line summarizing what actually happened, for the alert after a batch.
export const summarizeApprovals = (results) => {
  const approved = results.length
  if (!EVENTS_CALENDAR_SYNC_ENABLED) {
    return `Approved ${approved} event${approved === 1 ? '' : 's'} — published to the website.`
  }
  const failures = results.filter((result) => !result.calendarSynced)
  if (failures.length === 0) {
    return `Approved ${approved} event${approved === 1 ? '' : 's'} — published to the website and added to Google Calendar.`
  }
  const reason = failures[0].calendarError || 'unknown error'
  return [
    `Approved ${approved} event${approved === 1 ? '' : 's'} and published to the website,`,
    `but ${failures.length} did not reach Google Calendar (${reason}).`,
    'They are flagged in the list with a "Not on Google Calendar" badge — reconnect Google and use Sync to retry.',
  ].join(' ')
}
