import { useState } from 'react'
import EventsTab from '../components/EventsTab'
import StaffTab from '../components/StaffTab'
import BookingsTab from '../components/BookingsTab'
import CalendarTab from '../components/CalendarTab'
import PostsTab from '../components/PostsTab'
import FavoritePlacesTab from '../components/FavoritePlacesTab'
import CommunityBoardTab from '../components/CommunityBoardTab'
import '../styles/Dashboard.css'

function Dashboard({ user, googleAccessToken }) {
  const [activeTab, setActiveTab] = useState('events')

  const operationsTabs = [
    { id: 'events', label: 'Events Management' },
    { id: 'bookings', label: 'Pending Bookings' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'staff', label: 'Staff Management' },
  ]

  const websiteTabs = [
    { id: 'posts', label: 'Website Posts' },
    { id: 'places', label: 'Favorite Places' },
    { id: 'community', label: 'Community Board' },
  ]

  return (
    <div className="dashboard">
      <div className="tabs">
        <div className="tabs-group">
          <p className="tabs-group-label">Operations</p>
          <div className="tabs-row">
            {operationsTabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tabs-group">
          <p className="tabs-group-label">Website Content</p>
          <div className="tabs-row">
            {websiteTabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="tab-content">
        {activeTab === 'events' && <EventsTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'bookings' && <BookingsTab accessToken={googleAccessToken} />}
        {activeTab === 'calendar' && <CalendarTab accessToken={googleAccessToken} />}
        {activeTab === 'staff' && <StaffTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'posts' && <PostsTab user={user} />}
        {activeTab === 'places' && <FavoritePlacesTab />}
        {activeTab === 'community' && <CommunityBoardTab />}
      </div>
    </div>
  )
}

export default Dashboard
