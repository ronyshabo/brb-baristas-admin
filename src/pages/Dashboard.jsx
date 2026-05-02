import { useState } from 'react'
import EventsTab from '../components/EventsTab'
import StaffTab from '../components/StaffTab'
import BookingsTab from '../components/BookingsTab'
import CalendarTab from '../components/CalendarTab'
import PressTab from '../components/PressTab'
import '../styles/Dashboard.css'

function Dashboard({ user, googleAccessToken }) {
  const [activeTab, setActiveTab] = useState('events')

  return (
    <div className="dashboard">
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          Events Management
        </button>
        <button
          className={`tab ${activeTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setActiveTab('bookings')}
        >
          Pending Bookings
        </button>
        <button
          className={`tab ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setActiveTab('calendar')}
        >
          Calendar
        </button>
        <button
          className={`tab ${activeTab === 'staff' ? 'active' : ''}`}
          onClick={() => setActiveTab('staff')}
        >
          Staff Management
        </button>
        <button
          className={`tab ${activeTab === 'press' ? 'active' : ''}`}
          onClick={() => setActiveTab('press')}
        >
          Press &amp; Media
        </button>
      </div>
      <div className="tab-content">
        {activeTab === 'events' && <EventsTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'bookings' && <BookingsTab accessToken={googleAccessToken} />}
        {activeTab === 'calendar' && <CalendarTab accessToken={googleAccessToken} />}
        {activeTab === 'staff' && <StaffTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'press' && <PressTab />}
      </div>
    </div>
  )
}

export default Dashboard
