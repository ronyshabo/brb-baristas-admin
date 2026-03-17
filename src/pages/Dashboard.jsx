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
          className={`tab ${activeTab === 'posts' ? 'active' : ''}`}
          onClick={() => setActiveTab('posts')}
        >
          Website Posts
        </button>
        <button
          className={`tab ${activeTab === 'places' ? 'active' : ''}`}
          onClick={() => setActiveTab('places')}
        >
          Favorite Places
        </button>
        <button
          className={`tab ${activeTab === 'community' ? 'active' : ''}`}
          onClick={() => setActiveTab('community')}
        >
          Community Board
        </button>
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
