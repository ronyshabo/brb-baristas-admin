// The shop runs two Google Calendars:
//   - the schedule calendar: barista shifts, written by hand as "[Name, Shift]"
//   - the events calendar: band events, written only by this app
// They used to be one calendar, and that is still what you get when only
// VITE_GOOGLE_CALENDAR_ID is set. Splitting them keeps Gmail's auto-added
// reservations and stray invites out of the shift schedule, and lets the
// calendar check treat anything on the events calendar that the app did not
// write as an outside change.

const legacyCalendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID || ''

export const SCHEDULE_CALENDAR_ID = import.meta.env.VITE_GOOGLE_SCHEDULE_CALENDAR_ID || legacyCalendarId
export const EVENTS_CALENDAR_ID = import.meta.env.VITE_GOOGLE_EVENTS_CALENDAR_ID || legacyCalendarId

// Off: band events live only in Firestore. The app never writes, edits, or
// deletes anything on the events calendar, and the calendar check skips it.
// Set to true only if this app should write to the events calendar again.
export const EVENTS_CALENDAR_SYNC_ENABLED = false

// Where an event lives if its Firestore doc predates googleCalendarId.
export const LEGACY_EVENTS_CALENDAR_ID = legacyCalendarId || SCHEDULE_CALENDAR_ID

export const CALENDAR_TIME_ZONE = import.meta.env.VITE_GOOGLE_CALENDAR_TIME_ZONE || 'America/Chicago'

export const calendarsAreSeparated = Boolean(
  EVENTS_CALENDAR_ID && SCHEDULE_CALENDAR_ID && EVENTS_CALENDAR_ID !== SCHEDULE_CALENDAR_ID
)

// Google accounts allowed to create entries. Anything created by another
// account is flagged by the calendar check. The calendar IDs themselves count,
// since a primary calendar's ID is its owner's address.
export const getTrustedEditors = (extraEmails = []) =>
  [
    ...(import.meta.env.VITE_GOOGLE_CALENDAR_TRUSTED_EDITORS || '').split(','),
    SCHEDULE_CALENDAR_ID,
    EVENTS_CALENDAR_ID,
    ...extraEmails,
  ]
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => email.includes('@'))

export class CalendarAuthError extends Error {}

export class CalendarRequestError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export const isGoneError = (err) => err instanceof CalendarRequestError && (err.status === 404 || err.status === 410)

// One Calendar API call. `path` is relative to the calendar, e.g. '/events'.
// Without a token it falls back to the public API key (read-only).
export const calendarRequest = async (calendarId, path, accessToken, { method = 'GET', params = {}, body } = {}) => {
  if (!calendarId) {
    throw new Error('Missing Google Calendar configuration. Set the calendar IDs in .env.local.')
  }

  const search = new URLSearchParams(params)
  const apiKey = import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY
  if (!accessToken && apiKey) search.set('key', apiKey)
  const query = search.toString()

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}${query ? `?${query}` : ''}`,
    {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  )

  if (response.status === 204) return null
  const data = await response.json().catch(() => null)

  if (response.status === 401) {
    throw new CalendarAuthError('Google Calendar access expired. Reconnect Google and try again.')
  }
  if (!response.ok) {
    throw new CalendarRequestError(
      data?.error?.message || `Google Calendar request failed (${response.status})`,
      response.status
    )
  }
  return data
}

// Every event in a time range, following nextPageToken. showDeleted brings back
// cancelled entries too, which is how the check sees deletions.
export const listCalendarEvents = async (calendarId, accessToken, { timeMin, timeMax, showDeleted = false } = {}) => {
  const items = []
  let pageToken = ''
  do {
    const data = await calendarRequest(calendarId, '/events', accessToken, {
      params: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        showDeleted: String(showDeleted),
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {}),
      },
    })
    items.push(...(data?.items || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return items
}

export const getCalendarEvent = (calendarId, eventId, accessToken) =>
  calendarRequest(calendarId, `/events/${encodeURIComponent(eventId)}`, accessToken)
