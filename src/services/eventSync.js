import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

// An approved event has to land in two places: the public website (which reads
// status + showOnWebsite out of Firestore) and the shop's Google Calendar. Both
// writes live here so the events tab and the pending-requests tab can't drift.

export const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID
export const calendarTimeZone = import.meta.env.VITE_GOOGLE_CALENDAR_TIME_ZONE || 'America/Chicago'

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

export const createCalendarEvent = async (event, accessToken) => {
  if (!calendarId) {
    throw new Error('Missing Google Calendar configuration. Set VITE_GOOGLE_CALENDAR_ID.')
  }
  if (!accessToken) {
    throw new Error('Google Calendar is not connected. Reconnect and try again.')
  }
  if (!event.date || !event.startTime || !event.endTime) {
    throw new Error('Event is missing a date, start time, or end time.')
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.title,
        description: buildCalendarDescription(event),
        start: { dateTime: `${event.date}T${event.startTime}:00`, timeZone: calendarTimeZone },
        end: { dateTime: `${event.date}T${event.endTime}:00`, timeZone: calendarTimeZone },
      }),
    }
  )

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Failed to create Google Calendar event')
  }

  return data.id
}

// An approved event that never reached the calendar. These used to be invisible:
// approving without a Google token skipped the calendar write without saying so.
export const isMissingFromCalendar = (event) =>
  isApprovedEvent(event) && !event.googleCalendarEventId

export const isPublishedToWebsite = (event) =>
  isApprovedEvent(event) && event.showOnWebsite !== false

// Approves one event and reports honestly on both destinations. Never throws for a
// calendar problem - the approval itself still stands, and the failure is recorded
// on the document so the UI can offer a retry.
export const approveEvent = async (event, accessToken, extraFields = {}) => {
  let googleCalendarEventId = event.googleCalendarEventId || null
  let calendarError = null

  if (!googleCalendarEventId) {
    try {
      googleCalendarEventId = await createCalendarEvent(event, accessToken)
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
    calendarSyncStatus: googleCalendarEventId ? 'synced' : 'failed',
    calendarSyncError: calendarError,
    calendarSyncedAt: googleCalendarEventId ? new Date() : null,
    ...extraFields,
  }

  await updateDoc(doc(db, 'events', event.id), updates)

  return { updates, calendarSynced: Boolean(googleCalendarEventId), calendarError }
}

// Retry for an event that is already approved but never made it to the calendar.
export const syncEventToCalendar = async (event, accessToken) => {
  const googleCalendarEventId = await createCalendarEvent(event, accessToken)
  const updates = {
    googleCalendarEventId,
    calendarSyncStatus: 'synced',
    calendarSyncError: null,
    calendarSyncedAt: new Date(),
  }
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

export const rejectEvent = async (event, extraFields = {}) => {
  const updates = { status: 'rejected', rejectedAt: new Date(), showOnWebsite: false, ...extraFields }
  await updateDoc(doc(db, 'events', event.id), updates)
  return updates
}

// One line summarizing what actually happened, for the alert after a batch.
export const summarizeApprovals = (results) => {
  const approved = results.length
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
