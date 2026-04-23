import { useState } from 'react'
import EventsTab from '../components/EventsTab'
import StaffTab from '../components/StaffTab'
import BookingsTab from '../components/BookingsTab'
import CalendarTab from '../components/CalendarTab'
import WebsiteContentTab from '../components/WebsiteContentTab'
import CreateSubscriptionTab from '../components/CreateSubscriptionTab'
import SubscriptionLookupAndManageTab from '../components/SubscriptionLookupAndManageTab'
import '../styles/Dashboard.css'

function Dashboard({ user, googleAccessToken }) {
  const [activeTab, setActiveTab] = useState('events')

  const dashboardTabs = [
    { id: 'events', label: 'Events Management' },
    { id: 'bookings', label: 'Pending Bookings' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'staff', label: 'Staff Management' },
    { id: 'websiteContent', label: 'Website Content' },
    { id: 'subscriptions', label: 'Subscriptions' },
  ]

  return (
    <div className="dashboard">
      <div className="tabs">
        <div className="tabs-row">
          {dashboardTabs.map((tab) => (
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
      <div className="tab-content">
        {activeTab === 'events' && <EventsTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'bookings' && <BookingsTab accessToken={googleAccessToken} />}
        {activeTab === 'calendar' && <CalendarTab accessToken={googleAccessToken} />}
        {activeTab === 'staff' && <StaffTab user={user} accessToken={googleAccessToken} />}
        {activeTab === 'websiteContent' && <WebsiteContentTab user={user} />}
        {activeTab === 'subscriptions' && (
          <div>
            <CreateSubscriptionTab />
            <hr style={{ margin: '32px 0' }} />
            <SubscriptionLookupAndManageTab />
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
