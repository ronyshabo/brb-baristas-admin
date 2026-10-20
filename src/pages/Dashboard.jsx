import { useCallback, useState } from 'react'
import EventsTab from '../components/EventsTab'
import StaffTab from '../components/StaffTab'
import AdminScheduleTab from '../schedule/AdminScheduleTab'
import WebsiteContentTab from '../components/WebsiteContentTab'
import InventoryTab from '../inventory/InventoryTab'
import { clearGoogleToken } from '../firebase/googleAuth'
import { useCalendarAudit } from '../hooks/useCalendarAudit'
import '../styles/Dashboard.css'

function Dashboard({ user, googleAccessToken, setGoogleAccessToken }) {
  const [activeTab, setActiveTab] = useState('events')

  const handleGoogleExpired = useCallback(() => {
    clearGoogleToken()
    setGoogleAccessToken(null)
  }, [setGoogleAccessToken])

  // Runs on every Google connect, so discrepancies show up without opening the tab.
  const calendarAudit = useCalendarAudit(googleAccessToken, {
    adminEmail: user?.email,
    onAuthExpired: handleGoogleExpired,
  })
  const auditCount = calendarAudit.openFindings.length
  const auditHasHigh = calendarAudit.openFindings.some((finding) => finding.severity === 'high')

  const dashboardTabs = [
    { id: 'events', label: 'Events Management' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'staff', label: 'Staff Management' },
    { id: 'websiteContent', label: 'Website Content' },
    { id: 'inventory', label: 'Inventory' },
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
              {tab.id === 'events' && auditCount > 0 && (
                <span
                  className={`tab-badge ${auditHasHigh ? 'tab-badge-alert' : ''}`}
                  title={`${auditCount} calendar discrepanc${auditCount === 1 ? 'y' : 'ies'}`}
                >
                  {auditCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="tab-content">
        {activeTab === 'events' && (
          <EventsTab
            user={user}
            accessToken={googleAccessToken}
            setAccessToken={setGoogleAccessToken}
            audit={calendarAudit}
          />
        )}
        {activeTab === 'schedule' && <AdminScheduleTab />}
        {activeTab === 'staff' && (
          <StaffTab
            user={user}
            accessToken={googleAccessToken}
            setAccessToken={setGoogleAccessToken}
          />
        )}
        {activeTab === 'websiteContent' && <WebsiteContentTab user={user} />}
        {activeTab === 'inventory' && <InventoryTab />}
      </div>
    </div>
  )
}

export default Dashboard
