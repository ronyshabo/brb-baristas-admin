import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { v4 as uuidv4 } from 'uuid'
import { signInWithGoogleCalendar } from '../firebase/googleAuth'
import {
  approveEvent,
  calendarId,
  isApprovedEvent,
  createCalendarEvent,
  isHiddenFromWebsite,
  isMissingFromCalendar,
  publishEventToWebsite,
  summarizeApprovals,
  syncEventToCalendar,
} from '../services/eventSync'
import '../styles/EventsTab.css'

const getInitialFormData = () => ({
  title: '',
  date: '',
  startHour: '',
  startMinute: '',
  startPeriod: 'AM',
  endHour: '',
  endMinute: '',
  endPeriod: 'AM',
  description: '',
  bandEmail: '',
  isRecurring: false,
  recurrenceMode: 'weeks',
  recurrenceWeeks: '1',
  recurrenceEndDate: '',
  showOnWebsite: true,
})

// Helper function to convert 24-hour time to 12-hour format
const convertTo12Hour = (time24) => {
  if (!time24) return { hour: '', minute: '', period: 'AM' }
  const [hours, minutes] = time24.split(':')
  const hour = parseInt(hours)
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return { hour: hour12.toString(), minute: minutes, period }
}

// Helper function to convert 12-hour time to 24-hour format
const convertTo24Hour = (hour, minute, period) => {
  let hour24 = parseInt(hour)
  if (period === 'PM' && hour24 !== 12) hour24 += 12
  if (period === 'AM' && hour24 === 12) hour24 = 0
  return `${hour24.toString().padStart(2, '0')}:${minute}`
}

// Helper function to display time in 12-hour format
const formatTime12Hour = (time24) => {
  if (!time24) return ''
  const { hour, minute, period } = convertTo12Hour(time24)
  return `${hour}:${minute} ${period}`
}

function EventsTab({ user, accessToken, setAccessToken }) {
  // Helper: Find conflicting event IDs (same date and time)
  const getConflictingEventIds = () => {
    const conflicts = new Set();
    const seen = {};
    events.forEach(event => {
      if (!event.date || !event.startTime || !event.endTime) return;
      const key = `${event.date}_${event.startTime}_${event.endTime}`;
      if (seen[key]) {
        conflicts.add(event.id);
        conflicts.add(seen[key]);
      } else {
        seen[key] = event.id;
      }
    });
    return conflicts;
  };

  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [generatedLink, setGeneratedLink] = useState(null)
  const [selectedEventIds, setSelectedEventIds] = useState([])
  const [showHiddenEvents, setShowHiddenEvents] = useState(false)
  const [formData, setFormData] = useState(getInitialFormData())
  const [selectedEventDetails, setSelectedEventDetails] = useState(null)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [syncingCalendar, setSyncingCalendar] = useState(false)
  const [publishingWebsite, setPublishingWebsite] = useState(false)

  const signupBaseUrl =
    import.meta.env.VITE_SIGNUP_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')

  const connectGoogleCalendar = async () => {
    setConnectingGoogle(true)
    try {
      const { accessToken: token } = await signInWithGoogleCalendar()
      if (token) {
        setAccessToken?.(token)
      } else {
        alert('Google did not return calendar access. Please try again.')
      }
    } catch (err) {
      console.error('Error connecting Google Calendar:', err)
      alert('Failed to connect Google Calendar: ' + (err?.message || 'unknown error'))
    } finally {
      setConnectingGoogle(false)
    }
  }

  // TODO: Fetch events from Firestore on component mount
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'events'))
        const eventsList = []
        querySnapshot.forEach((doc) => {
          eventsList.push({ id: doc.id, ...doc.data() })
        })
        setEvents(eventsList)
      } catch (err) {
        console.error('Error fetching events:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchEvents()
  }, [])

  useEffect(() => {
    setSelectedEventIds((previousSelected) =>
      previousSelected.filter((id) =>
        getVisibleEventEntries().some((entry) => entry.entryId === id)
      )
    )
  }, [events, showHiddenEvents])

  const getEventDateTime = (event) => new Date(`${event.date}T${event.startTime || '00:00'}:00`).getTime()

  const getVisibleEventEntries = () => {
    const filteredEvents = events.filter((event) => (showHiddenEvents ? true : !event.hidden))
    const groupedEvents = new Map()

    filteredEvents.forEach((event) => {
      const groupKey = event.isRecurring && event.recurrenceGroupId ? `recurring-${event.recurrenceGroupId}` : `single-${event.id}`

      if (!groupedEvents.has(groupKey)) {
        groupedEvents.set(groupKey, [])
      }

      groupedEvents.get(groupKey).push(event)
    })

    return [...groupedEvents.entries()]
      .map(([entryId, grouped]) => {
        const sortedGrouped = [...grouped].sort((a, b) => getEventDateTime(a) - getEventDateTime(b))
        const representative = sortedGrouped[0]
        const firstOccurrence = sortedGrouped[0]
        const lastOccurrence = sortedGrouped[sortedGrouped.length - 1]
        const allBooked = sortedGrouped.every(isApprovedEvent)
        const someBooked = sortedGrouped.some(isApprovedEvent)

        return {
          entryId,
          representative,
          events: sortedGrouped,
          eventIds: sortedGrouped.map((event) => event.id),
          isSeries: sortedGrouped.length > 1,
          firstOccurrence,
          lastOccurrence,
          status: allBooked ? 'booked' : someBooked ? 'partial' : sortedGrouped.every((event) => event.status === 'rejected') ? 'rejected' : 'pending',
          missingFromCalendar: sortedGrouped.some(isMissingFromCalendar),
          publishedToWebsite: sortedGrouped.some((event) => isApprovedEvent(event) && event.showOnWebsite !== false),
          sortTs: getEventDateTime(lastOccurrence),
        }
      })
      .sort((a, b) => b.sortTs - a.sortTs)
  }

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    try {
      // Convert 12-hour time to 24-hour format
      const startTime = convertTo24Hour(formData.startHour, formData.startMinute, formData.startPeriod)
      const endTime = convertTo24Hour(formData.endHour, formData.endMinute, formData.endPeriod)

      const baseDate = new Date(`${formData.date}T00:00:00`)
      const eventDates = []

      if (!formData.isRecurring) {
        eventDates.push(formData.date)
      } else if (formData.recurrenceMode === 'weeks') {
        const weeks = Math.max(1, parseInt(formData.recurrenceWeeks || '1', 10))
        for (let i = 0; i < weeks; i++) {
          const nextDate = new Date(baseDate)
          nextDate.setDate(baseDate.getDate() + i * 7)
          eventDates.push(nextDate.toISOString().split('T')[0])
        }
      } else {
        if (!formData.recurrenceEndDate) {
          alert('Please select an end date for day-based recurring events')
          return
        }

        const endDate = new Date(`${formData.recurrenceEndDate}T00:00:00`)
        if (endDate < baseDate) {
          alert('Recurring end date must be after the event start date')
          return
        }

        let cursor = new Date(baseDate)
        while (cursor <= endDate) {
          eventDates.push(cursor.toISOString().split('T')[0])
          cursor.setDate(cursor.getDate() + 7)
        }
      }

      const recurrenceGroupId = formData.isRecurring ? uuidv4() : null
      const createdEvents = []
      let calendarSyncedCount = 0
      let calendarFailedCount = 0

      await Promise.all(
        eventDates.map(async (dateValue) => {
          const customId = `${dateValue}_${startTime.replace(':', '')}`
          let googleCalendarEventId = null

          if (accessToken) {
            try {
              googleCalendarEventId = await createCalendarEvent(
                {
                  title: formData.title,
                  date: dateValue,
                  startTime,
                  endTime,
                  description: formData.description,
                  bandEmail: formData.bandEmail,
                },
                accessToken
              )
              calendarSyncedCount += 1
            } catch (calendarError) {
              calendarFailedCount += 1
              console.error('Error creating Google Calendar event on create:', calendarError)
            }
          }

          const eventData = {
            title: formData.title,
            date: dateValue,
            startTime,
            endTime,
            description: formData.description,
            bandEmail: formData.bandEmail,
            adminId: user.uid,
            createdAt: new Date(),
            googleCalendarEventId,
            status: 'pending',
            showOnWebsite: formData.showOnWebsite,
            isRecurring: formData.isRecurring,
            recurrenceMode: formData.isRecurring ? formData.recurrenceMode : null,
            recurrenceGroupId,
          }

          await setDoc(doc(db, 'events', customId), eventData)
          createdEvents.push({ id: customId, ...eventData })
        })
      )

      setEvents([...events, ...createdEvents])
      setFormData(getInitialFormData())
      setShowForm(false)

      if (!accessToken) {
        alert('Event created. Log in with Google to auto-add future events to Calendar.')
      } else if (calendarFailedCount > 0) {
        alert(`Created ${createdEvents.length} event(s). Synced ${calendarSyncedCount} to Google Calendar, ${calendarFailedCount} failed.`)
      }
    } catch (err) {
      console.error('Error creating event:', err)
    }
  }

  const handleEditEvent = (event) => {
    const startTime12 = convertTo12Hour(event.startTime)
    const endTime12 = convertTo12Hour(event.endTime)
    
    setEditingEvent(event)
    setFormData({
      title: event.title,
      date: event.date,
      startHour: startTime12.hour,
      startMinute: startTime12.minute,
      startPeriod: startTime12.period,
      endHour: endTime12.hour,
      endMinute: endTime12.minute,
      endPeriod: endTime12.period,
      description: event.description,
      bandEmail: event.bandEmail,
      isRecurring: false,
      recurrenceMode: 'weeks',
      recurrenceWeeks: '1',
      recurrenceEndDate: '',
      showOnWebsite: Boolean(event.showOnWebsite),
    })
    setShowForm(true)
  }

  const handleUpdateEvent = async (e) => {
    e.preventDefault()
    try {
      const startTime = convertTo24Hour(formData.startHour, formData.startMinute, formData.startPeriod)
      const endTime = convertTo24Hour(formData.endHour, formData.endMinute, formData.endPeriod)
      
      const eventData = {
        title: formData.title,
        date: formData.date,
        startTime,
        endTime,
        description: formData.description,
        bandEmail: formData.bandEmail,
        adminId: user.uid,
        updatedAt: new Date(),
        googleCalendarEventId: editingEvent.googleCalendarEventId,
        status: editingEvent.status,
        showOnWebsite: formData.showOnWebsite,
        createdAt: editingEvent.createdAt,
      }
      
      await setDoc(doc(db, 'events', editingEvent.id), eventData)
      setEvents(events.map(e => e.id === editingEvent.id ? { id: editingEvent.id, ...eventData } : e))
      setFormData(getInitialFormData())
      setShowForm(false)
      setEditingEvent(null)
    } catch (err) {
      console.error('Error updating event:', err)
    }
  }

  const handleDeleteEvent = async (eventId, options = { confirmDelete: true }) => {
    const { confirmDelete = true } = options
    if (confirmDelete && !confirm('Are you sure you want to delete this event?')) return
    
    try {
      const event = events.find(e => e.id === eventId)
      
      // Delete from Google Calendar if it exists
      if (event?.googleCalendarEventId && accessToken && calendarId) {
        try {
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.googleCalendarEventId}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          )
          
          if (!response.ok) {
            console.error('Failed to delete from Google Calendar')
          }
        } catch (err) {
          console.error('Error deleting from Google Calendar:', err)
        }
      }
      
      // Delete from Firestore
      await deleteDoc(doc(db, 'events', eventId))
      setEvents((previousEvents) => previousEvents.filter((entry) => entry.id !== eventId))
    } catch (err) {
      console.error('Error deleting event:', err)
      alert('Failed to delete event')
    }
  }

  const handleDeleteEventEntry = async (entry) => {
    const confirmMessage = entry.isSeries
      ? `Are you sure you want to delete this recurring series (${entry.events.length} events)?`
      : 'Are you sure you want to delete this event?'

    if (!confirm(confirmMessage)) return

    try {
      for (const eventId of entry.eventIds) {
        await handleDeleteEvent(eventId, { confirmDelete: false })
      }
      setSelectedEventIds((previousSelected) => previousSelected.filter((id) => id !== entry.entryId))
    } catch (err) {
      console.error('Error deleting event entry:', err)
      alert('Failed to delete event(s)')
    }
  }

  const handleCancelEdit = () => {
    setEditingEvent(null)
    setFormData(getInitialFormData())
    setShowForm(false)
  }

  const handleGenerateLink = async (eventId) => {
    try {
      const token = uuidv4()
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes from now

      // Get the event details to retrieve bandEmail
      const event = events.find(e => e.id === eventId)
      const bandEmail = event?.bandEmail || ''
      
      // Create custom document ID: sanitized_bandEmail_timestamp
      const timestamp = Date.now()
      const sanitizedEmail = bandEmail.replace(/[@.]/g, '_')
      const customInvId = `${sanitizedEmail}_${timestamp}`
      
      const invitationData = {
        token,
        eventId,
        bandEmail,
        createdAt: new Date(),
        expiresAt,
        claimed: false,
      }
      
      await setDoc(doc(db, 'invitations', customInvId), invitationData)

      const link = `${signupBaseUrl}/signup?token=${token}`
      setGeneratedLink({ link, token })
    } catch (err) {
      console.error('Error generating link:', err)
      alert('Failed to generate link')
    }
  }

  // Returns a result object instead of a bare boolean so batch callers can report
  // which approvals reached Google Calendar and which only reached the website.
  const handleAdminApproveEvent = async (eventId, options = { silent: false }) => {
    const { silent = false } = options

    try {
      const event = events.find((entry) => entry.id === eventId)
      if (!event) return null

      if (isApprovedEvent(event)) {
        if (!silent) alert('This event is already booked.')
        return null
      }

      const { updates, calendarSynced, calendarError } = await approveEvent(event, accessToken, {
        bookedDirectlyByAdmin: true,
      })

      setEvents((previousEvents) =>
        previousEvents.map((entry) => (entry.id === eventId ? { ...entry, ...updates } : entry))
      )
      setSelectedEventIds((previousSelected) => previousSelected.filter((id) => id !== eventId))

      if (!silent) {
        alert(summarizeApprovals([{ calendarSynced, calendarError }]))
      }
      return { eventId, calendarSynced, calendarError }
    } catch (err) {
      console.error('Error approving event directly:', err)
      if (!silent) alert('Failed to approve event')
      return null
    }
  }

  // Publishes approved events the website is still hiding. Approving sets
  // showOnWebsite now, but anything approved before that keeps its old value.
  const handlePublishHiddenEvents = async () => {
    const hidden = events.filter(isHiddenFromWebsite)
    if (hidden.length === 0) {
      alert('Every approved event is already visible on the website.')
      return
    }
    if (!confirm(`Publish ${hidden.length} approved event(s) to the website?`)) return

    setPublishingWebsite(true)
    const published = []
    const failures = []

    for (const event of hidden) {
      try {
        const updates = await publishEventToWebsite(event)
        published.push({ id: event.id, updates })
      } catch (err) {
        console.error(`Failed to publish event ${event.id}:`, err)
        failures.push(err?.message || 'unknown error')
      }
    }

    if (published.length > 0) {
      const updatesById = new Map(published.map((entry) => [entry.id, entry.updates]))
      setEvents((previousEvents) =>
        previousEvents.map((entry) =>
          updatesById.has(entry.id) ? { ...entry, ...updatesById.get(entry.id) } : entry
        )
      )
    }

    setPublishingWebsite(false)
    alert(
      failures.length === 0
        ? `Published ${published.length} event${published.length === 1 ? '' : 's'} to the website.`
        : `Published ${published.length}. ${failures.length} failed: ${failures[0]}`
    )
  }

  // Pushes already-approved events that never reached the calendar. Before this,
  // approving without a live Google token dropped the calendar write silently and
  // there was no way to notice, let alone retry.
  const handleSyncMissingCalendarEvents = async () => {
    const missing = events.filter(isMissingFromCalendar)
    if (missing.length === 0) {
      alert('Every approved event is already on Google Calendar.')
      return
    }
    if (!accessToken) {
      alert('Connect Google Calendar first, then run the sync again.')
      return
    }

    setSyncingCalendar(true)
    const synced = []
    const failures = []

    for (const event of missing) {
      try {
        const updates = await syncEventToCalendar(event, accessToken)
        synced.push({ id: event.id, updates })
      } catch (err) {
        console.error(`Failed to sync event ${event.id} to Google Calendar:`, err)
        failures.push({ event, message: err?.message || 'unknown error' })
      }
    }

    if (synced.length > 0) {
      const updatesById = new Map(synced.map((entry) => [entry.id, entry.updates]))
      setEvents((previousEvents) =>
        previousEvents.map((entry) =>
          updatesById.has(entry.id) ? { ...entry, ...updatesById.get(entry.id) } : entry
        )
      )
    }

    setSyncingCalendar(false)
    alert(
      failures.length === 0
        ? `Added ${synced.length} event${synced.length === 1 ? '' : 's'} to Google Calendar.`
        : `Added ${synced.length} to Google Calendar. ${failures.length} still failed: ${failures[0].message}`
    )
  }

  const handleToggleSelectEvent = (eventId) => {
    setSelectedEventIds((previousSelected) =>
      previousSelected.includes(eventId)
        ? previousSelected.filter((id) => id !== eventId)
        : [...previousSelected, eventId]
    )
  }

  const handleToggleSelectAllPending = () => {
    const visibleEventIds = getVisibleEventEntries().map((entry) => entry.entryId)
    const allVisibleSelected =
      visibleEventIds.length > 0 && visibleEventIds.every((id) => selectedEventIds.includes(id))

    if (allVisibleSelected) {
      setSelectedEventIds([])
      return
    }

    setSelectedEventIds(visibleEventIds)
  }

  const handleApproveSelectedEvents = async () => {
    if (selectedEventIds.length === 0) {
      alert('Select at least one pending event to approve.')
      return
    }

    const results = []

    const selectedEntries = getVisibleEventEntries().filter((entry) => selectedEventIds.includes(entry.entryId))

    for (const entry of selectedEntries) {
      const pendingEventIds = entry.events.filter((event) => !isApprovedEvent(event)).map((event) => event.id)
      if (pendingEventIds.length === 0) {
        continue
      }

      for (const eventId of pendingEventIds) {
        try {
          const result = await handleAdminApproveEvent(eventId, { silent: true })
          if (result) {
            results.push(result)
          }
        } catch (error) {
          console.error(`Failed to approve event ${eventId}:`, error)
        }
      }
    }

    alert(results.length === 0 ? 'No pending events were approved.' : summarizeApprovals(results))
  }

  const handleHideSelectedEvents = async () => {
    if (selectedEventIds.length === 0) {
      alert('Select at least one event to hide.')
      return
    }

    try {
      const selectedEntries = getVisibleEventEntries().filter((entry) => selectedEventIds.includes(entry.entryId))
      const eventIdsToHide = selectedEntries.flatMap((entry) => entry.eventIds)

      await Promise.all(
        eventIdsToHide.map((eventId) =>
          updateDoc(doc(db, 'events', eventId), {
            hidden: true,
            hiddenAt: new Date(),
            hiddenBy: user.uid,
          })
        )
      )

      setEvents((previousEvents) =>
        previousEvents.map((event) =>
          eventIdsToHide.includes(event.id)
            ? { ...event, hidden: true, hiddenAt: new Date(), hiddenBy: user.uid }
            : event
        )
      )
      setSelectedEventIds([])
      alert('Selected events have been hidden.')
    } catch (err) {
      console.error('Error hiding selected events:', err)
      alert('Failed to hide selected events')
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink.link)
    alert('Link copied to clipboard!')
  }

  if (loading) return <div>Loading events...</div>

  const visibleEventEntries = getVisibleEventEntries();
  const conflictingIds = getConflictingEventIds();
  const eventsMissingFromCalendar = events.filter(isMissingFromCalendar);
  const eventsHiddenFromWebsite = events.filter(isHiddenFromWebsite);

  return (
    <div className="events-tab">
      <div className="events-header">
        <h2>Events Management</h2>
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : editingEvent ? 'Cancel Edit' : 'Create Event'}
        </button>
      </div>

      {!accessToken && (
        <div className="google-connect-banner">
          <p>
            Google Calendar is not connected, so approving an event will publish it to the
            website but <strong>not</strong> add it to the calendar. Connect to keep both in sync.
          </p>
          <button onClick={connectGoogleCalendar} disabled={connectingGoogle}>
            {connectingGoogle ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        </div>
      )}

      {eventsHiddenFromWebsite.length > 0 && (
        <div className="calendar-sync-banner">
          <p>
            <strong>
              {eventsHiddenFromWebsite.length} approved event
              {eventsHiddenFromWebsite.length === 1 ? ' is' : 's are'} hidden from the website.
            </strong>{' '}
            They were approved before approval started publishing automatically.
          </p>
          <button onClick={handlePublishHiddenEvents} disabled={publishingWebsite}>
            {publishingWebsite ? 'Publishing...' : `Publish ${eventsHiddenFromWebsite.length} to the website`}
          </button>
        </div>
      )}

      {eventsMissingFromCalendar.length > 0 && (
        <div className="calendar-sync-banner">
          <p>
            <strong>
              {eventsMissingFromCalendar.length} approved event
              {eventsMissingFromCalendar.length === 1 ? ' is' : 's are'} not on Google Calendar.
            </strong>{' '}
            They are live on the website but missing from the calendar — most likely approved while
            Google was disconnected.
          </p>
          <button onClick={handleSyncMissingCalendarEvents} disabled={syncingCalendar || !accessToken}>
            {syncingCalendar ? 'Syncing...' : `Add ${eventsMissingFromCalendar.length} to Google Calendar`}
          </button>
        </div>
      )}

      {generatedLink && (
        <div className="link-modal">
          <div className="link-content">
            <h3>Invitation Link Generated!</h3>
            <p>Copy and send this link to the band:</p>
            <div className="link-box">
              <code>{generatedLink.link}</code>
            </div>
            <button onClick={copyToClipboard}>Copy Link</button>
            <button onClick={() => setGeneratedLink(null)}>Close</button>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEventDetails && (
        <div className="link-modal" onClick={() => setSelectedEventDetails(null)}>
          <div className="link-content" onClick={e => e.stopPropagation()}>
            <h3>Event Details</h3>
            <p><strong>Title:</strong> {selectedEventDetails.title}</p>
            <p><strong>Date:</strong> {selectedEventDetails.date}</p>
            <p><strong>Time:</strong> {formatTime12Hour(selectedEventDetails.startTime)} - {formatTime12Hour(selectedEventDetails.endTime)}</p>
            <p><strong>Description:</strong> {selectedEventDetails.description || 'N/A'}</p>
            <p><strong>Band Email:</strong> {selectedEventDetails.bandEmail || 'N/A'}</p>
            <button onClick={() => setSelectedEventDetails(null)}>Close</button>
          </div>
        </div>
      )}

      {showForm && (
        <form className="event-form" onSubmit={editingEvent ? handleUpdateEvent : handleCreateEvent}>
<input
            type="text"
            placeholder="Event Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label>Start Time:</label>
            <select
              value={formData.startHour}
              onChange={(e) => setFormData({ ...formData, startHour: e.target.value })}
              required
            >
              <option value="">Hour</option>
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <span>:</span>
            <select
              value={formData.startMinute}
              onChange={(e) => setFormData({ ...formData, startMinute: e.target.value })}
              required
            >
              <option value="">Min</option>
              <option value="00">00</option>
              <option value="15">15</option>
              <option value="30">30</option>
              <option value="45">45</option>
            </select>
            <select
              value={formData.startPeriod}
              onChange={(e) => setFormData({ ...formData, startPeriod: e.target.value })}
              required
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label>End Time:</label>
            <select
              value={formData.endHour}
              onChange={(e) => setFormData({ ...formData, endHour: e.target.value })}
              required
            >
              <option value="">Hour</option>
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <span>:</span>
            <select
              value={formData.endMinute}
              onChange={(e) => setFormData({ ...formData, endMinute: e.target.value })}
              required
            >
              <option value="">Min</option>
              <option value="00">00</option>
              <option value="15">15</option>
              <option value="30">30</option>
              <option value="45">45</option>
            </select>
            <select
              value={formData.endPeriod}
              onChange={(e) => setFormData({ ...formData, endPeriod: e.target.value })}
              required
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <input
            type="email"
            placeholder="Band Email"
            value={formData.bandEmail}
            onChange={(e) => setFormData({ ...formData, bandEmail: e.target.value })}
            required
          />

          <label className="recurrence-check">
            <input
              type="checkbox"
              checked={formData.showOnWebsite}
              onChange={(e) => setFormData({ ...formData, showOnWebsite: e.target.checked })}
            />
            Show this event on website upcoming shows
          </label>

          {!editingEvent && (
            <div className="recurrence-box">
              <label className="recurrence-check">
                <input
                  type="checkbox"
                  checked={formData.isRecurring}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isRecurring: e.target.checked,
                      recurrenceWeeks: formData.recurrenceWeeks || '1',
                    })
                  }
                />
                Recurring Event
              </label>

              {formData.isRecurring && (
                <div className="recurrence-controls">
                  <div className="recurrence-row">
                    <label>Repeat based on:</label>
                    <select
                      value={formData.recurrenceMode}
                      onChange={(e) => setFormData({ ...formData, recurrenceMode: e.target.value })}
                    >
                      <option value="weeks">Number of Weeks</option>
                      <option value="day">Day (same weekday) until date</option>
                    </select>
                  </div>

                  {formData.recurrenceMode === 'weeks' ? (
                    <div className="recurrence-row">
                      <label>Number of weeks:</label>
                      <input
                        type="number"
                        min="1"
                        max="52"
                        value={formData.recurrenceWeeks}
                        onChange={(e) => setFormData({ ...formData, recurrenceWeeks: e.target.value })}
                        required={formData.isRecurring && formData.recurrenceMode === 'weeks'}
                      />
                    </div>
                  ) : (
                    <div className="recurrence-row">
                      <label>End date:</label>
                      <input
                        type="date"
                        value={formData.recurrenceEndDate}
                        onChange={(e) => setFormData({ ...formData, recurrenceEndDate: e.target.value })}
                        min={formData.date || undefined}
                        required={formData.isRecurring && formData.recurrenceMode === 'day'}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit">{editingEvent ? 'Update Event' : 'Create Event'}</button>
            {editingEvent && <button type="button" onClick={handleCancelEdit}>Cancel</button>}
          </div>
        </form>
      )}

      <div className="events-list">
        {events.length > 0 && (
          <div className="bulk-actions-bar">
            <label className="event-select-checkbox">
              <input
                type="checkbox"
                checked={
                  visibleEventEntries.length > 0 &&
                  visibleEventEntries.every((entry) => selectedEventIds.includes(entry.entryId))
                }
                onChange={handleToggleSelectAllPending}
              />
              Select all
            </label>
            <span className="bulk-selection-count">
              {selectedEventIds.length} selected
            </span>
            <button onClick={handleApproveSelectedEvents} disabled={selectedEventIds.length === 0}>
              Approve Selected
            </button>
            <button onClick={handleHideSelectedEvents} disabled={selectedEventIds.length === 0}>
              Hide Selected
            </button>
            <label className="event-select-checkbox">
              <input
                type="checkbox"
                checked={showHiddenEvents}
                onChange={(e) => setShowHiddenEvents(e.target.checked)}
              />
              Show hidden events
            </label>
          </div>
        )}

        {visibleEventEntries.length === 0 ? (
          <p>{showHiddenEvents ? 'No events to show.' : 'No visible events. Create one to get started.'}</p>
        ) : (
          visibleEventEntries.map((entry) => {
            const isConflict = conflictingIds.has(entry.representative.id);
            return (
              <div key={entry.entryId} className="event-card" onClick={() => setSelectedEventDetails(entry.representative)} style={{ cursor: 'pointer' }}>
                <div className="event-card-head">
                  <label className="event-select-checkbox" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedEventIds.includes(entry.entryId)}
                      onChange={() => handleToggleSelectEvent(entry.entryId)}
                    />
                    Select
                  </label>
                  <h3>
                    {entry.representative.title}{' '}
                    {isConflict && (
                      <span title="Conflicting event" style={{ color: 'red', fontSize: '1.2em', marginRight: 8, verticalAlign: 'middle' }}>
                        &#9888;
                      </span>
                    )}
                    {entry.status === 'booked' && <span style={{ color: '#27ae60', fontSize: '0.9rem' }}>(Approved)</span>}
                    {entry.status === 'rejected' && <span style={{ color: '#e74c3c', fontSize: '0.9rem' }}>(Rejected)</span>}
                    {entry.status === 'partial' && <span style={{ color: '#f39c12', fontSize: '0.9rem' }}>(Partially Booked)</span>}
                    {entry.isSeries && <span style={{ color: '#667eea', fontSize: '0.9rem' }}>({entry.events.length} in series)</span>}
                  </h3>
                </div>
                <p>
                  {entry.isSeries
                    ? `${entry.firstOccurrence.date} → ${entry.lastOccurrence.date}`
                    : `${entry.representative.date} ${formatTime12Hour(entry.representative.startTime)} - ${formatTime12Hour(entry.representative.endTime)}`}
                </p>
                <p>{entry.representative.description}</p>
                {entry.status === 'booked' && (
                  <div className="event-destinations">
                    <span className={entry.publishedToWebsite ? 'destination-ok' : 'destination-missing'}>
                      {entry.publishedToWebsite ? 'On website' : 'Hidden from website'}
                    </span>
                    <span className={entry.missingFromCalendar ? 'destination-missing' : 'destination-ok'}>
                      {entry.missingFromCalendar ? 'Not on Google Calendar' : 'On Google Calendar'}
                    </span>
                  </div>
                )}
                <div className="event-actions" onClick={e => e.stopPropagation()}>
                  {entry.missingFromCalendar && (
                    <button
                      onClick={async () => {
                        if (!accessToken) {
                          alert('Connect Google Calendar first.')
                          return
                        }
                        const failures = []
                        for (const event of entry.events.filter(isMissingFromCalendar)) {
                          try {
                            const updates = await syncEventToCalendar(event, accessToken)
                            setEvents((previousEvents) =>
                              previousEvents.map((item) => (item.id === event.id ? { ...item, ...updates } : item))
                            )
                          } catch (err) {
                            console.error(`Failed to sync event ${event.id}:`, err)
                            failures.push(err?.message || 'unknown error')
                          }
                        }
                        alert(failures.length === 0 ? 'Added to Google Calendar.' : `Failed: ${failures[0]}`)
                      }}
                    >
                      Add to Calendar
                    </button>
                  )}
                  <button onClick={() => handleEditEvent(entry.representative)}>Edit</button>
                  <button
                    onClick={async () => {
                      const results = []
                      for (const eventId of entry.eventIds) {
                        const result = await handleAdminApproveEvent(eventId, { silent: true })
                        if (result) results.push(result)
                      }
                      alert(results.length === 0 ? 'Nothing to approve.' : summarizeApprovals(results))
                    }}
                    disabled={entry.status === 'booked'}
                  >
                    {entry.status === 'booked' ? 'Approved' : entry.isSeries ? 'Approve Series' : 'Admin Approve'}
                  </button>
                  <button onClick={() => handleGenerateLink(entry.representative.id)}>Generate Link</button>
                  <button onClick={() => handleDeleteEventEntry(entry)}>
                    {entry.isSeries ? 'Delete Series' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  )
}

export default EventsTab
