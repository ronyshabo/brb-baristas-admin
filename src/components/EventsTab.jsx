import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { v4 as uuidv4 } from 'uuid'
import '../styles/EventsTab.css'

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

function EventsTab({ user, accessToken }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [generatedLink, setGeneratedLink] = useState(null)
  const [formData, setFormData] = useState({
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
  })

  const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID
  const signupBaseUrl =
    import.meta.env.VITE_SIGNUP_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')

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

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    try {
      // Convert 12-hour time to 24-hour format
      const startTime = convertTo24Hour(formData.startHour, formData.startMinute, formData.startPeriod)
      const endTime = convertTo24Hour(formData.endHour, formData.endMinute, formData.endPeriod)
      
      // Create custom document ID: date_startTime
      const customId = `${formData.date}_${startTime.replace(':', '')}`
      const eventData = {
        title: formData.title,
        date: formData.date,
        startTime,
        endTime,
        description: formData.description,
        bandEmail: formData.bandEmail,
        adminId: user.uid,
        createdAt: new Date(),
        googleCalendarEventId: null,
        status: 'pending',
      }
      
      await setDoc(doc(db, 'events', customId), eventData)
      setEvents([...events, { id: customId, ...eventData }])
      setFormData({ title: '', date: '', startHour: '', startMinute: '', startPeriod: 'AM', endHour: '', endMinute: '', endPeriod: 'AM', description: '', bandEmail: '' })
      setShowForm(false)
      // TODO: Sync to Google Calendar
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
        createdAt: editingEvent.createdAt,
      }
      
      await setDoc(doc(db, 'events', editingEvent.id), eventData)
      setEvents(events.map(e => e.id === editingEvent.id ? { id: editingEvent.id, ...eventData } : e))
      setFormData({ title: '', date: '', startHour: '', startMinute: '', startPeriod: 'AM', endHour: '', endMinute: '', endPeriod: 'AM', description: '', bandEmail: '' })
      setShowForm(false)
      setEditingEvent(null)
    } catch (err) {
      console.error('Error updating event:', err)
    }
  }

  const handleDeleteEvent = async (eventId) => {
    if (!confirm('Are you sure you want to delete this event?')) return
    
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
      setEvents(events.filter(e => e.id !== eventId))
    } catch (err) {
      console.error('Error deleting event:', err)
      alert('Failed to delete event')
    }
  }

  const handleCancelEdit = () => {
    setEditingEvent(null)
    setFormData({ title: '', date: '', startHour: '', startMinute: '', startPeriod: 'AM', endHour: '', endMinute: '', endPeriod: 'AM', description: '', bandEmail: '' })
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

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink.link)
    alert('Link copied to clipboard!')
  }

  if (loading) return <div>Loading events...</div>

  return (
    <div className="events-tab">
      <div className="events-header">
        <h2>Events Management</h2>
        <button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : editingEvent ? 'Cancel Edit' : 'Create Event'}
        </button>
      </div>

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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit">{editingEvent ? 'Update Event' : 'Create Event'}</button>
            {editingEvent && <button type="button" onClick={handleCancelEdit}>Cancel</button>}
          </div>
        </form>
      )}

      <div className="events-list">
        {events.length === 0 ? (
          <p>No events yet. Create one to get started.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="event-card">
              <h3>{event.title} {event.status === 'booked' && <span style={{ color: '#27ae60', fontSize: '0.9rem' }}>(Booked)</span>}</h3>
              <p>{event.date} {formatTime12Hour(event.startTime)} - {formatTime12Hour(event.endTime)}</p>
              <p>{event.description}</p>
              <div className="event-actions">
                <button onClick={() => handleEditEvent(event)}>Edit</button>
                <button onClick={() => handleGenerateLink(event.id)}>Generate Link</button>
                <button onClick={() => handleDeleteEvent(event.id)}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default EventsTab
