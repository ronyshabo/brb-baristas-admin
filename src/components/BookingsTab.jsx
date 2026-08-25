import { useState, useEffect } from 'react'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase/config'
import { signInWithGoogleCalendar } from '../firebase/googleAuth'
import {
  approveEvent,
  isMissingFromCalendar,
  rejectEvent,
  summarizeApprovals,
  syncEventToCalendar,
} from '../services/eventSync'
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

const formatSubmitted = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null)
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'Unknown'
}

// Requests from the band portal are written straight into the `events` collection
// with status 'pending' - there is no separate `bookings` collection, which is why
// this tab used to be permanently empty.
function BookingsTab({ accessToken, setAccessToken }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [connectingGoogle, setConnectingGoogle] = useState(false)

  const fetchRequests = async () => {
    setLoading(true)
    setError(null)
    try {
      let snapshot
      try {
        snapshot = await getDocs(
          query(collection(db, 'events'), where('status', '==', filter), orderBy('date'))
        )
      } catch (indexError) {
        // orderBy + where needs a composite index; fall back to sorting client-side
        console.warn('Falling back to unordered query:', indexError)
        snapshot = await getDocs(query(collection(db, 'events'), where('status', '==', filter)))
      }

      const list = []
      snapshot.forEach((docSnapshot) => list.push({ id: docSnapshot.id, ...docSnapshot.data() }))
      list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      setRequests(list)
    } catch (err) {
      console.error('Error fetching event requests:', err)
      setError('Could not load event requests. Please refresh and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [filter])

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

  const handleApprove = async (request) => {
    setBusyId(request.id)
    try {
      const { calendarSynced, calendarError } = await approveEvent(request, accessToken)
      // Approved rows leave the pending list; keep them if that filter is showing
      setRequests((previous) =>
        filter === 'pending' ? previous.filter((item) => item.id !== request.id) : previous
      )
      alert(summarizeApprovals([{ calendarSynced, calendarError }]))
    } catch (err) {
      console.error('Error approving event request:', err)
      alert('Failed to approve this request.')
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (request) => {
    if (!window.confirm(`Reject "${request.title}"? The band will no longer see it as pending.`)) {
      return
    }

    setBusyId(request.id)
    try {
      await rejectEvent(request)
      setRequests((previous) =>
        filter === 'pending' ? previous.filter((item) => item.id !== request.id) : previous
      )
    } catch (err) {
      console.error('Error rejecting event request:', err)
      alert('Failed to reject this request.')
    } finally {
      setBusyId(null)
    }
  }

  const handleSyncCalendar = async (request) => {
    if (!accessToken) {
      alert('Connect Google Calendar first.')
      return
    }
    setBusyId(request.id)
    try {
      const updates = await syncEventToCalendar(request, accessToken)
      setRequests((previous) =>
        previous.map((item) => (item.id === request.id ? { ...item, ...updates } : item))
      )
      alert('Added to Google Calendar.')
    } catch (err) {
      console.error('Error syncing to Google Calendar:', err)
      alert(err?.message || 'Failed to add to Google Calendar.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div>Loading event requests...</div>

  const emptyMessage = {
    pending: 'No pending requests. Anything a band submits from the band portal lands here.',
    booked: 'No approved events yet.',
    rejected: 'No rejected requests.',
  }[filter]

  return (
    <div className="bookings-tab">
      <div className="bookings-header">
        <h2>Pending Bookings</h2>
        <div className="filter-buttons">
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            Pending
          </button>
          <button className={filter === 'booked' ? 'active' : ''} onClick={() => setFilter('booked')}>
            Approved
          </button>
          <button className={filter === 'rejected' ? 'active' : ''} onClick={() => setFilter('rejected')}>
            Rejected
          </button>
        </div>
      </div>

      {!accessToken && (
        <div className="google-connect-banner">
          <p>
            Google Calendar is not connected. Approving now publishes to the website but{' '}
            <strong>skips the calendar</strong>.
          </p>
          <button onClick={connectGoogleCalendar} disabled={connectingGoogle}>
            {connectingGoogle ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        </div>
      )}

      {error && <p className="bookings-error">{error}</p>}

      <div className="bookings-list">
        {requests.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : (
          requests.map((request) => (
            <div key={request.id} className="booking-card">
              <div className="booking-info">
                <h3>{request.title || 'Untitled event'}</h3>
                {request.bandName && <p><strong>Band:</strong> {request.bandName}</p>}
                {request.bandEmail && <p><strong>Email:</strong> {request.bandEmail}</p>}
                <p><strong>Date:</strong> {request.date || 'Not set'}</p>
                <p>
                  <strong>Time:</strong>{' '}
                  {request.startTime
                    ? `${formatTime12Hour(request.startTime)} - ${formatTime12Hour(request.endTime)}`
                    : 'Not set'}
                </p>
                {request.venue && <p><strong>Venue:</strong> {request.venue}</p>}
                <p><strong>Details:</strong> {request.description || request.notes || 'None'}</p>
                <p><strong>Submitted:</strong> {formatSubmitted(request.createdAt)}</p>
                <p className="booking-source">
                  {request.bandId ? 'Submitted from the band portal' : 'Created by an admin'}
                </p>
                {isMissingFromCalendar(request) && (
                  <p className="booking-warning">Approved but not on Google Calendar.</p>
                )}
              </div>

              <div className="booking-actions">
                {filter === 'pending' && (
                  <>
                    <button
                      className="approve-btn"
                      onClick={() => handleApprove(request)}
                      disabled={busyId === request.id}
                    >
                      {busyId === request.id ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      className="reject-btn"
                      onClick={() => handleReject(request)}
                      disabled={busyId === request.id}
                    >
                      Reject
                    </button>
                  </>
                )}
                {isMissingFromCalendar(request) && (
                  <button
                    className="approve-btn"
                    onClick={() => handleSyncCalendar(request)}
                    disabled={busyId === request.id || !accessToken}
                  >
                    Add to Calendar
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default BookingsTab
