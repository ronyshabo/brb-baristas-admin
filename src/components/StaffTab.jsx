import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy, where, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/StaffTab.css'

function StaffTab({ user, accessToken }) {
  const [view, setView] = useState('calculator') // calculator, reports, baristas
  const [baristas, setBaristas] = useState([])
  const [selectedWeek, setSelectedWeek] = useState('')
  const [tipInputMethod, setTipInputMethod] = useState('manual') // manual, bulk
  const [bulkTipData, setBulkTipData] = useState('')
  const [dailyTips, setDailyTips] = useState({})
  const [weekSchedule, setWeekSchedule] = useState(null)
  const [loading, setLoading] = useState(false)
  const [calculation, setCalculation] = useState(null)
  const [reports, setReports] = useState([])
  const [newBarista, setNewBarista] = useState({ name: '', basePay: '' })
  const [editingBarista, setEditingBarista] = useState(null)

  const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID

  // Fetch baristas from Firestore on mount
  useEffect(() => {
    fetchBaristas()
    fetchReports()
  }, [])

  const fetchBaristas = async () => {
    try {
      const q = query(collection(db, 'baristas'), orderBy('name'))
      const snapshot = await getDocs(q)
      const baristaList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setBaristas(baristaList)
    } catch (err) {
      console.error('Error fetching baristas:', err)
    }
  }

  const fetchReports = async () => {
    try {
      const q = query(collection(db, 'tipReports'), orderBy('weekStart', 'desc'))
      const snapshot = await getDocs(q)
      const reportList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      setReports(reportList)
    } catch (err) {
      console.error('Error fetching reports:', err)
    }
  }

  const addBarista = async () => {
    if (!newBarista.name || !newBarista.basePay) {
      alert('Please enter barista name and base pay')
      return
    }

    try {
      await addDoc(collection(db, 'baristas'), {
        name: newBarista.name,
        basePay: parseFloat(newBarista.basePay),
        active: true,
        createdAt: new Date(),
        createdBy: user.uid
      })
      setNewBarista({ name: '', basePay: '' })
      fetchBaristas()
      alert('Barista added successfully!')
    } catch (err) {
      console.error('Error adding barista:', err)
      alert('Failed to add barista')
    }
  }

  const updateBaristaBasePay = async (baristaId, newBasePay) => {
    try {
      await updateDoc(doc(db, 'baristas', baristaId), {
        basePay: parseFloat(newBasePay)
      })
      fetchBaristas()
      setEditingBarista(null)
      alert('Base pay updated successfully!')
    } catch (err) {
      console.error('Error updating barista:', err)
      alert('Failed to update base pay')
    }
  }

  const removeBarista = async (baristaId, baristaName) => {
    if (!confirm(`Are you sure you want to remove ${baristaName}? This action cannot be undone.`)) {
      return
    }

    try {
      await deleteDoc(doc(db, 'baristas', baristaId))
      fetchBaristas()
      alert('Barista removed successfully!')
    } catch (err) {
      console.error('Error removing barista:', err)
      alert('Failed to remove barista')
    }
  }

  const fetchWeekSchedule = async () => {
    if (!selectedWeek || !accessToken) {
      alert('Please select a week and ensure you are logged in with Google')
      return
    }

    setLoading(true)
    try {
      const weekStart = new Date(selectedWeek)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events?timeMin=${weekStart.toISOString()}&timeMax=${weekEnd.toISOString()}&singleEvents=true&orderBy=startTime`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const data = await response.json()
      if (!response.ok) throw new Error('Failed to fetch calendar events')

      // Process schedule by day
      const schedule = processSchedule(data.items, weekStart)
      setWeekSchedule(schedule)
      alert('Schedule loaded successfully!')
    } catch (err) {
      console.error('Error fetching schedule:', err)
      alert('Failed to load schedule: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const processSchedule = (events, weekStart) => {
    const schedule = {}
    
    for (let i = 0; i < 7; i++) {
      const currentDay = new Date(weekStart)
      currentDay.setDate(currentDay.getDate() + i)
      const dateKey = currentDay.toISOString().split('T')[0]
      
      schedule[dateKey] = {
        morning: [], // 8am-2pm
        evening: [], // 2pm-9pm
        interShift: [] // 12pm-6pm
      }
    }

    events.forEach(event => {
      if (!event.start?.dateTime || !event.summary) return
      
      // Only process events with format [Name, Shift Type]
      const bracketMatch = event.summary.match(/^\[([^,]+),\s*([^\]]+)\]/)
      if (!bracketMatch) return // Skip non-staff events
      
      const baristaName = bracketMatch[1].trim()
      const startTime = new Date(event.start.dateTime)
      const endTime = new Date(event.end.dateTime)
      const dateKey = startTime.toISOString().split('T')[0]
      
      if (!schedule[dateKey]) return

      const startHour = startTime.getHours()
      const endHour = endTime.getHours()

      // Determine shift type based on start and end times
      // Morning shift: starts at or before 9am and ends around 2pm-3pm
      if (startHour <= 9 && endHour >= 13 && endHour <= 15) {
        schedule[dateKey].morning.push(baristaName)
      }
      // Evening shift: starts around 2pm and ends at or after 8pm
      else if (startHour >= 13 && startHour <= 15 && endHour >= 20) {
        schedule[dateKey].evening.push(baristaName)
      }
      // Inter-shift: starts around noon and ends around 6pm (doesn't span full shifts)
      else if (startHour >= 11 && startHour <= 13 && endHour >= 17 && endHour <= 19) {
        schedule[dateKey].interShift.push(baristaName)
      }
    })

    return schedule
  }

  const parseBulkTips = () => {
    const lines = bulkTipData.trim().split('\n')
    const tips = {}
    
    lines.forEach(line => {
      // Match pattern: date and amount
      const dateMatch = line.match(/(\w+, \w+ \d+, \d{4})/)
      const amountMatch = line.match(/\$(\d+\.\d{2})/)
      
      if (dateMatch && amountMatch) {
        const dateStr = new Date(dateMatch[1]).toISOString().split('T')[0]
        tips[dateStr] = parseFloat(amountMatch[1])
      }
    })
    
    setDailyTips(tips)
    alert(`Parsed ${Object.keys(tips).length} tip entries`)
  }

  const calculateTips = () => {
    if (!weekSchedule || Object.keys(dailyTips).length === 0) {
      alert('Please load schedule and enter tip data first')
      return
    }

    const baristaEarnings = {}

    Object.keys(weekSchedule).forEach(date => {
      const daySchedule = weekSchedule[date]
      const dayTip = dailyTips[date] || 0
      
      // Split tips between morning and evening (50/50 if both shifts worked)
      const morningTip = dayTip / 2
      const eveningTip = dayTip / 2

      // Morning shift (8am-2pm)
      const morningCount = daySchedule.morning.length
      if (morningCount > 0) {
        const morningShare = morningTip / morningCount
        daySchedule.morning.forEach(barista => {
          if (!baristaEarnings[barista]) baristaEarnings[barista] = { tips: 0, hours: 0, shifts: 0, basePay: 0 }
          baristaEarnings[barista].tips += morningShare
          baristaEarnings[barista].hours += 6 // 8am-2pm = 6 hours
          baristaEarnings[barista].shifts += 1
        })
      }

      // Evening shift (2pm-9pm)
      const eveningCount = daySchedule.evening.length
      if (eveningCount > 0) {
        const eveningShare = eveningTip / eveningCount
        daySchedule.evening.forEach(barista => {
          if (!baristaEarnings[barista]) baristaEarnings[barista] = { tips: 0, hours: 0, shifts: 0, basePay: 0 }
          baristaEarnings[barista].tips += eveningShare
          baristaEarnings[barista].hours += 7 // 2pm-9pm = 7 hours
          baristaEarnings[barista].shifts += 1
        })
      }

      // Inter-shift gets a portion based on overlap (12pm-6pm = 4 hours overlap with both)
      daySchedule.interShift.forEach(barista => {
        if (!baristaEarnings[barista]) baristaEarnings[barista] = { tips: 0, hours: 0, shifts: 0, basePay: 0 }
        // Inter-shift overlaps 2 hours with morning, 4 hours with evening
        const interShare = (morningTip * (2/6)) + (eveningTip * (4/7))
        baristaEarnings[barista].tips += interShare / daySchedule.interShift.length
        baristaEarnings[barista].hours += 6 // 12pm-6pm = 6 hours
        baristaEarnings[barista].shifts += 1
      })
    })

    // Add base pay from barista records (flat rate per shift, not hourly)
    baristas.forEach(barista => {
      if (baristaEarnings[barista.name]) {
        baristaEarnings[barista.name].basePay = (barista.basePay || 0) * baristaEarnings[barista.name].shifts
        baristaEarnings[barista.name].total = 
          baristaEarnings[barista.name].tips + baristaEarnings[barista.name].basePay
      }
    })

    setCalculation({
      weekStart: selectedWeek,
      weekEnd: new Date(new Date(selectedWeek).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      earnings: baristaEarnings,
      totalTips: Object.values(dailyTips).reduce((sum, tip) => sum + tip, 0)
    })
  }

  const saveReport = async () => {
    if (!calculation) {
      alert('Calculate tips first')
      return
    }

    try {
      await addDoc(collection(db, 'tipReports'), {
        ...calculation,
        createdAt: new Date(),
        createdBy: user.uid
      })
      alert('Report saved successfully!')
      fetchReports()
    } catch (err) {
      console.error('Error saving report:', err)
      alert('Failed to save report')
    }
  }

  return (
    <div className="staff-tab">
      <div className="staff-header">
        <h2>Staff Management & Tips</h2>
        <div className="view-tabs">
          <button onClick={() => setView('calculator')} className={view === 'calculator' ? 'active' : ''}>
            Tip Calculator
          </button>
          <button onClick={() => setView('baristas')} className={view === 'baristas' ? 'active' : ''}>
            Manage Baristas
          </button>
          <button onClick={() => setView('reports')} className={view === 'reports' ? 'active' : ''}>
            Reports
          </button>
        </div>
      </div>

      {view === 'calculator' && (
        <div className="calculator-section">
          <h3>Weekly Tip Calculator</h3>
          
          <div className="form-group">
            <label>Select Week Start Date (Monday):</label>
            <input 
              type="date" 
              value={selectedWeek} 
              onChange={(e) => setSelectedWeek(e.target.value)}
            />
            <button onClick={fetchWeekSchedule} disabled={loading}>
              {loading ? 'Loading...' : 'Load Schedule from Calendar'}
            </button>
          </div>

          {weekSchedule && (
            <>
              <div className="schedule-preview">
                <h4>Schedule Preview</h4>
                {Object.keys(weekSchedule).map(date => (
                  <div key={date} className="day-schedule">
                    <strong>{new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                    <div>Morning (8am-2pm): {weekSchedule[date].morning.join(', ') || 'None'}</div>
                    <div>Evening (2pm-9pm): {weekSchedule[date].evening.join(', ') || 'None'}</div>
                    <div>Inter-shift (12pm-6pm): {weekSchedule[date].interShift.join(', ') || 'None'}</div>
                  </div>
                ))}
              </div>

              <div className="tip-input-section">
                <h4>Enter Tips</h4>
                <div className="input-method-toggle">
                  <button onClick={() => setTipInputMethod('manual')} className={tipInputMethod === 'manual' ? 'active' : ''}>
                    Manual Entry
                  </button>
                  <button onClick={() => setTipInputMethod('bulk')} className={tipInputMethod === 'bulk' ? 'active' : ''}>
                    Bulk Paste
                  </button>
                </div>

                {tipInputMethod === 'manual' ? (
                  <div className="manual-entry">
                    {Object.keys(weekSchedule).map(date => (
                      <div key={date} className="daily-tip-input">
                        <label>{new Date(date).toLocaleDateString()}:</label>
                        <input 
                          type="number" 
                          step="0.01"
                          placeholder="$0.00"
                          value={dailyTips[date] || ''}
                          onChange={(e) => setDailyTips({...dailyTips, [date]: parseFloat(e.target.value) || 0})}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bulk-entry">
                    <textarea 
                      placeholder="Paste GoDaddy tip report here..."
                      value={bulkTipData}
                      onChange={(e) => setBulkTipData(e.target.value)}
                      rows={10}
                    />
                    <button onClick={parseBulkTips}>Parse Tip Data</button>
                  </div>
                )}
              </div>

              <button onClick={calculateTips} className="calculate-btn">Calculate Tips</button>

              {calculation && (
                <div className="calculation-results">
                  <h4>Calculation Results</h4>
                  <p><strong>Week:</strong> {calculation.weekStart} to {calculation.weekEnd}</p>
                  <p><strong>Total Tips:</strong> ${calculation.totalTips.toFixed(2)}</p>
                  
                  <table className="earnings-table">
                    <thead>
                      <tr>
                        <th>Barista</th>
                        <th>Shifts</th>
                        <th>Hours</th>
                        <th>Base Pay</th>
                        <th>Tips</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(calculation.earnings).map(([name, data]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{data.shifts}</td>
                          <td>{data.hours.toFixed(1)}</td>
                          <td>${data.basePay.toFixed(2)}</td>
                          <td>${data.tips.toFixed(2)}</td>
                          <td><strong>${data.total.toFixed(2)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button onClick={saveReport} className="save-report-btn">Save Report to Firebase</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {view === 'baristas' && (
        <div className="baristas-section">
          <h3>Manage Baristas - {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
          
          <div className="add-barista-form">
            <h4>Add New Barista</h4>
            <div className="form-inputs">
              <input 
                type="text" 
                placeholder="Barista Name"
                value={newBarista.name}
                onChange={(e) => setNewBarista({...newBarista, name: e.target.value})}
              />
              <input 
                type="number" 
                step="0.01"
                placeholder="Base Pay per Shift ($)"
                value={newBarista.basePay}
                onChange={(e) => setNewBarista({...newBarista, basePay: e.target.value})}
              />
              <button onClick={addBarista} className="add-btn">Add Barista</button>
            </div>
          </div>

          <div className="barista-list">
            <h4>Current Baristas ({baristas.length})</h4>
            {baristas.length === 0 ? (
              <p className="empty-state">No baristas yet. Add your first barista above!</p>
            ) : (
              <table className="barista-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Base Pay (per shift)</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {baristas.map(barista => (
                    <tr key={barista.id}>
                      <td><strong>{barista.name}</strong></td>
                      <td>
                        {editingBarista === barista.id ? (
                          <div className="edit-pay">
                            <input 
                              type="number"
                              step="0.01"
                              defaultValue={barista.basePay}
                              id={`edit-${barista.id}`}
                              autoFocus
                            />
                            <button 
                              onClick={() => {
                                const newPay = document.getElementById(`edit-${barista.id}`).value
                                updateBaristaBasePay(barista.id, newPay)
                              }}
                              className="save-btn"
                            >
                              Save
                            </button>
                            <button 
                              onClick={() => setEditingBarista(null)}
                              className="cancel-btn"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span>${barista.basePay?.toFixed(2) || '0.00'}</span>
                        )}
                      </td>
                      <td>
                        <div className="action-buttons">
                          {editingBarista !== barista.id && (
                            <button 
                              onClick={() => setEditingBarista(barista.id)}
                              className="edit-btn"
                            >
                              Edit Pay
                            </button>
                          )}
                          <button 
                            onClick={() => removeBarista(barista.id, barista.name)}
                            className="remove-btn"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {view === 'reports' && (
        <div className="reports-section">
          <h3>Saved Reports</h3>
          {reports.length === 0 ? (
            <p>No reports yet. Calculate and save your first report!</p>
          ) : (
            <div className="reports-list">
              {reports.map(report => (
                <div key={report.id} className="report-card">
                  <h4>Week of {report.weekStart}</h4>
                  <p>Total Tips: ${report.totalTips?.toFixed(2)}</p>
                  <p>Created: {new Date(report.createdAt?.toDate()).toLocaleDateString()}</p>
                  <button>View Details</button>
                  <button>Download PDF</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StaffTab
