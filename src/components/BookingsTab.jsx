import { useState, useEffect } from 'react'
import { collection, getDocs, query, where, updateDoc, doc, deleteDoc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/BookingsTab.css'

// Helper function to display time in 12-hour format
const formatTime12Hour = (time24) => {
  if (!time24) return ''
  const [hours, minutes] = time24.split(':')
  const hour = parseInt(hours)
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${hour12}:${minutes} ${period}`
}

function BookingsTab({ accessToken }) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [error, setError] = useState(null)

  const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID
  const timeZone = import.meta.env.VITE_GOOGLE_CALENDAR_TIME_ZONE || 'America/Chicago'

  // Fetch bookings from Firestore on component mount
  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const q = query(collection(db, 'bookings'), where('status', '==', filter))
        const querySnapshot = await getDocs(q)
        const bookingsList = []
        querySnapshot.forEach((doc) => {
          bookingsList.push({ id: doc.id, ...doc.data() })
        })
        setBookings(bookingsList)
      } catch (err) {
        console.error('Error fetching bookings:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchBookings()
  }, [filter])

  const createGoogleCalendarEvent = async (booking) => {
    if (!calendarId) {
      throw new Error('Missing Google Calendar configuration. Set VITE_GOOGLE_CALENDAR_ID.')
    }

    if (!accessToken) {
      throw new Error('Google Calendar access not authorized. Please log in with Google.')
    }

    const startDateTime = `${booking.eventDate}T${booking.eventStartTime}:00`
    const endDateTime = `${booking.eventDate}T${booking.eventEndTime}:00`

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: booking.eventTitle,
          description: [
            booking.notes ? `Notes: ${booking.notes}` : null,
            `Band: ${booking.bandName}`,
            `Email: ${booking.bandEmail}`,
          ]
            .filter(Boolean)
            .join('\n'),
          start: {
            dateTime: startDateTime,
            timeZone,
          },
          end: {
            dateTime: endDateTime,
            timeZone,
          },
        }),
      }
    )

    const data = await response.json()
    if (!response.ok) {
      const apiMessage = data?.error?.message || 'Failed to create Google Calendar event'
      throw new Error(apiMessage)
    }

    return data.id
  }

  const handleApproveBooking = async (bookingId) => {
    if (!accessToken) {
      setError('Please log in with Google (Calendar) to approve bookings.')
      alert('Please log in with Google (Calendar) to approve bookings.')
      return
    }

    try {
      const booking = bookings.find(b => b.id === bookingId)
      if (!booking) return

      // Update booking status
      await updateDoc(doc(db, 'bookings', bookingId), {
        status: 'approved',
        approvedAt: new Date(),
      })

      const eventRef = doc(db, 'events', booking.eventId)
      const eventSnapshot = await getDoc(eventRef)
      const existingCalendarEventId = eventSnapshot.data()?.googleCalendarEventId || null

      // Update event status to 'booked'
      await updateDoc(eventRef, {
        status: 'booked',
        bookedBandId: booking.bandId,
        bookedAt: new Date(),
      })

      if (!existingCalendarEventId) {
        try {
          const googleCalendarEventId = await createGoogleCalendarEvent(booking)
          await updateDoc(eventRef, { googleCalendarEventId })
        } catch (err) {
          console.error('Error creating Google Calendar event:', err)
          alert(err?.message || 'Failed to add event to Google Calendar')
        }
      }

      // Delete other pending bookings for the same event
      const otherBookingsQuery = query(
        collection(db, 'bookings'),
        where('eventId', '==', booking.eventId),
        where('status', '==', 'pending')
      )
      const otherBookingsSnapshot = await getDocs(otherBookingsQuery)
      const deletePromises = otherBookingsSnapshot.docs
        .filter(doc => doc.id !== bookingId)
        .map(doc => deleteDoc(doc.ref))
      await Promise.all(deletePromises)

      // Refresh bookings list
      setBookings(bookings.filter(b => b.id === bookingId || b.eventId !== booking.eventId)
        .map(b => b.id === bookingId ? { ...b, status: 'approved', approvedAt: new Date() } : b))
      
      alert('Booking approved! Event marked as booked and other pending bookings removed.')
    } catch (err) {
      console.error('Error approving booking:', err)
      alert('Failed to approve booking')
    }
  }

  const handleRejectBooking = async (bookingId) => {
    try {
      await deleteDoc(doc(db, 'bookings', bookingId))
      setBookings(bookings.filter(b => b.id !== bookingId))
      alert('Booking rejected!')
    } catch (err) {
      console.error('Error rejecting booking:', err)
      alert('Failed to reject booking')
    }
  }

  if (loading) return <div>Loading bookings...</div>

  return (
    <div className="bookings-tab">
      <div className="bookings-header">
        <h2>Pending Bookings</h2>
        <div className="filter-buttons">
          <button
            className={filter === 'pending' ? 'active' : ''}
            onClick={() => setFilter('pending')}
          >
            Pending
          </button>
          <button
            className={filter === 'approved' ? 'active' : ''}
            onClick={() => setFilter('approved')}
          >
            Approved
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#e74c3c', fontWeight: '600', marginBottom: '1rem' }}>{error}</p>}

      <div className="bookings-list">
        {bookings.length === 0 ? (
          <p>No {filter} bookings at this time.</p>
        ) : (
          bookings.map((booking) => (
            <div key={booking.id} className="booking-card">
              <div className="booking-info">
                <h3>{booking.bandName}</h3>
                <p><strong>Email:</strong> {booking.bandEmail}</p>
                <p><strong>Event:</strong> {booking.eventTitle}</p>
                <p><strong>Date:</strong> {booking.eventDate}</p>
                <p><strong>Time:</strong> {formatTime12Hour(booking.eventStartTime)} - {formatTime12Hour(booking.eventEndTime)}</p>
                <p><strong>Notes:</strong> {booking.notes || 'None'}</p>
                <p><strong>Submitted:</strong> {new Date(booking.createdAt?.toDate?.() || booking.createdAt).toLocaleDateString()}</p>
              </div>
              {filter === 'pending' && (
                <div className="booking-actions">
                  <button 
                    className="approve-btn"
                    onClick={() => handleApproveBooking(booking.id)}
                    disabled={!accessToken}
                    title={!accessToken ? 'Log in with Google (Calendar) to approve' : ''}
                  >
                    Approve
                  </button>
                  <button 
                    className="reject-btn"
                    onClick={() => handleRejectBooking(booking.id)}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default BookingsTab
