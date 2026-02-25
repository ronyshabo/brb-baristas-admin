import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/CalendarTab.css'

const formatTime = (date) => {
  if (!date) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const parseEventDate = (eventDate) => {
  if (!eventDate) return null
  return new Date(eventDate)
}

const isSameDay = (dateA, dateB) => {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

function CalendarTab({ accessToken }) {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [events, setEvents] = useState([])
  const [adminEventIds, setAdminEventIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showBaristasSchedule, setShowBaristasSchedule] = useState(true)
  const [showAdminEvents, setShowAdminEvents] = useState(true)

  const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID
  const apiKey = import.meta.env.VITE_GOOGLE_CALENDAR_API_KEY

  useEffect(() => {
    const fetchCalendarEvents = async () => {
      if (!calendarId) {
        setError('Missing Google Calendar configuration. Set VITE_GOOGLE_CALENDAR_ID.')
        setLoading(false)
        return
      }

      if (!accessToken && !apiKey) {
        setError('Google Calendar access not authorized. Please log in with Google.')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        // Fetch admin event IDs first
        const q = query(collection(db, 'events'), where('googleCalendarEventId', '!=', null))
        const snapshot = await getDocs(q)
        const ids = new Set()
        snapshot.forEach(doc => {
          const eventData = doc.data()
          if (eventData.googleCalendarEventId) {
            ids.add(eventData.googleCalendarEventId)
          }
        })
        setAdminEventIds(ids)

        const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
        const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999)

        const apiKeyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calendarId
        )}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime${apiKeyParam}`

        const headers = accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined

        const response = await fetch(url, { headers })
        const data = await response.json()
        if (!response.ok) {
          const apiMessage = data?.error?.message || 'Failed to fetch Google Calendar events'
          throw new Error(apiMessage)
        }
        const calendarEvents = (data.items || []).map((event) => {
          const isAllDay = Boolean(event.start?.date)
          const startDate = parseEventDate(event.start?.dateTime || event.start?.date)
          const endDate = parseEventDate(event.end?.dateTime || event.end?.date)

          return {
            id: event.id,
            title: event.summary || 'Untitled Event',
            start: startDate,
            end: endDate,
            allDay: isAllDay,
            isAdmin: adminEventIds.has(event.id),
          }
        })

        setEvents(calendarEvents)
      } catch (err) {
        console.error('Error fetching Google Calendar events:', err)
        setError(err?.message || 'Unable to load calendar events')
      } finally {
        setLoading(false)
      }
    }

    fetchCalendarEvents()
  }, [calendarId, apiKey, accessToken, currentDate])

  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)
    const daysInMonth = lastDayOfMonth.getDate()
    const startWeekday = firstDayOfMonth.getDay()

    const days = []

    for (let i = 0; i < startWeekday; i += 1) {
      days.push(null)
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push(new Date(year, month, day))
    }

    return days
  }, [currentDate])

  const goToPreviousMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const refreshCalendar = () => {
    setCurrentDate(new Date(currentDate))
  }

  return (
    <div className="calendar-tab">
      <div className="calendar-header">
        <h2>Google Calendar</h2>
        <div className="calendar-controls">
          <button onClick={goToPreviousMonth}>&larr;</button>
          <span className="calendar-month">
            {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={goToNextMonth}>&rarr;</button>
          <button onClick={refreshCalendar} style={{ marginLeft: '1rem', fontWeight: '600' }}>
            &#x21bb; Sync
          </button>
        </div>
      </div>

      <div className="calendar-filters">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={showBaristasSchedule}
            onChange={(e) => setShowBaristasSchedule(e.target.checked)}
          />
          <span className="toggle-label">Show Baristas Schedule</span>
          <span className="toggle-indicator barista"></span>
        </label>
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={showAdminEvents}
            onChange={(e) => setShowAdminEvents(e.target.checked)}
          />
          <span className="toggle-label">Show Events</span>
          <span className="toggle-indicator admin"></span>
        </label>
      </div>

      {loading && <p>Loading calendar...</p>}
      {error && <p className="calendar-error">{error}</p>}

      {!loading && !error && (
        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="calendar-day-header">
              {day}
            </div>
          ))}

          {calendarDays.map((day, index) => (
            <div key={`${day?.toISOString() || 'empty'}-${index}`} className="calendar-day">
              {day && (
                <>
                  <div className="calendar-date">{day.getDate()}</div>
                  <div className="calendar-events">
                    {events
                      .filter((event) => event.start && isSameDay(event.start, day))
                      .filter((event) => {
                        if (event.isAdmin) return showAdminEvents
                        return showBaristasSchedule
                      })
                      .map((event) => (
                        <div
                          key={event.id}
                          className={`calendar-event ${event.isAdmin ? 'calendar-event-admin' : 'calendar-event-existing'}`}
                        >
                          <span className="calendar-event-time">
                            {event.allDay ? 'All day' : formatTime(event.start)}
                          </span>
                          <span className="calendar-event-title">{event.title}</span>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CalendarTab
