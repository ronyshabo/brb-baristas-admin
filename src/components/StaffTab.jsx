import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { signInWithGoogleCalendar, clearGoogleToken } from '../firebase/googleAuth'
import '../styles/StaffTab.css'

// A person paid $600+ in a calendar year needs a 1099-NEC (non-employee comp).
const TAX_1099_THRESHOLD = 600

// Shift windows as scheduled on the calendar, in hours.
const MORNING_HOURS = 6         // 8am - 2pm
const EVENING_HOURS = 7         // 2pm - 9pm
const INTER_SHIFT_HOURS = 6     // 12pm - 6pm
const INTER_MORNING_OVERLAP = 2 // the 12pm - 2pm part of an inter-shift
const INTER_EVENING_OVERLAP = 4 // the 2pm - 6pm part of an inter-shift

function StaffTab({ user, accessToken, setAccessToken }) {
  const [view, setView] = useState('calculator') // calculator, reports, baristas
  const [baristas, setBaristas] = useState([])
  const [selectedWeek, setSelectedWeek] = useState('')
  const [tipInputMethod, setTipInputMethod] = useState('byHour') // byHour, bulk, manual
  const [bulkTipData, setBulkTipData] = useState('')
  const [dailyTips, setDailyTips] = useState({})
  const [weekSchedule, setWeekSchedule] = useState(null)
  const [loading, setLoading] = useState(false)
  const [calculation, setCalculation] = useState(null)
  const [reports, setReports] = useState([])
  const [newBarista, setNewBarista] = useState({ name: '', basePay: '' })
  const [editingBarista, setEditingBarista] = useState(null)
  const [syncingBaristas, setSyncingBaristas] = useState(false)
  const [hasAutoSyncedMonth, setHasAutoSyncedMonth] = useState(false)
  const [squareData, setSquareData] = useState('')
  const [weekShifts, setWeekShifts] = useState([])
  const [reportText, setReportText] = useState('')
  const [copiedReport, setCopiedReport] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()))
  const [taxBasis, setTaxBasis] = useState('weekStart')
  const [taxSummary, setTaxSummary] = useState(null)
  const [taxStatementText, setTaxStatementText] = useState('')

  const calendarId = import.meta.env.VITE_GOOGLE_CALENDAR_ID

  const formatDateKey = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const parseDateInput = (value) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  const getSundayOfWeek = (date) => {
    const sunday = new Date(date)
    sunday.setDate(sunday.getDate() - sunday.getDay())
    sunday.setHours(0, 0, 0, 0)
    return sunday
  }

  // Fetch baristas from Firestore on mount
  useEffect(() => {
    fetchBaristas()
    fetchReports()
  }, [])

  useEffect(() => {
    if (view === 'baristas' && accessToken && baristas.length === 0 && !hasAutoSyncedMonth) {
      setHasAutoSyncedMonth(true)
      syncBaristasFromCurrentMonth(false)
    }
  }, [view, accessToken, baristas.length, hasAutoSyncedMonth])

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

  const syncBaristasFromCurrentMonth = async (showAlert = true) => {
    if (!accessToken) {
      if (showAlert) alert('Please connect Google first to sync baristas from calendar')
      return
    }

    setSyncingBaristas(true)
    try {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events?timeMin=${monthStart.toISOString()}&timeMax=${nextMonthStart.toISOString()}&singleEvents=true&orderBy=startTime`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const data = await response.json()
      if (!response.ok) throw new Error('Failed to fetch calendar events')

      const namesFromCalendar = new Set()
      ;(data.items || []).forEach((event) => {
        if (!event?.summary) return
        const bracketMatch = event.summary.match(/^\[([^,]+),\s*([^\]]+)\]/)
        if (!bracketMatch) return
        const baristaName = bracketMatch[1].trim()
        if (baristaName) namesFromCalendar.add(baristaName)
      })

      const existingNames = new Set(baristas.map((b) => b.name.trim().toLowerCase()))
      const namesToCreate = [...namesFromCalendar].filter(
        (name) => !existingNames.has(name.trim().toLowerCase())
      )

      await Promise.all(
        namesToCreate.map((name) =>
          addDoc(collection(db, 'baristas'), {
            name,
            basePay: 0,
            active: true,
            autoImported: true,
            createdAt: new Date(),
            createdBy: user?.uid || 'system'
          })
        )
      )

      await fetchBaristas()

      if (showAlert) {
        if (namesToCreate.length > 0) {
          alert(`Imported ${namesToCreate.length} baristas from ${now.toLocaleString('en-US', { month: 'long' })} schedule.`)
        } else {
          alert('All current month baristas are already listed.')
        }
      }
    } catch (err) {
      console.error('Error syncing baristas:', err)
      if (showAlert) alert('Failed to sync baristas from calendar')
    } finally {
      setSyncingBaristas(false)
    }
  }

  // Popups are blocked unless this runs from a click, so the tab shows a
  // "Connect Google Calendar" button rather than prompting on its own.
  const connectGoogleCalendar = async () => {
    setConnectingGoogle(true)
    try {
      const { accessToken: freshToken } = await signInWithGoogleCalendar()
      if (!freshToken) throw new Error('Google did not return calendar access')
      setAccessToken(freshToken)
    } catch (err) {
      console.error('Google calendar connect failed:', err)
      alert('Could not connect Google Calendar: ' + err.message)
    } finally {
      setConnectingGoogle(false)
    }
  }

  // A token can expire mid-session; drop it so the connect prompt comes back.
  const handleExpiredToken = () => {
    clearGoogleToken()
    setAccessToken(null)
  }

  const fetchWeekSchedule = async () => {
    if (!selectedWeek || !accessToken) {
      alert('Please select a week and ensure you are logged in with Google')
      return
    }

    setLoading(true)
    try {
      const weekStart = getSundayOfWeek(parseDateInput(selectedWeek))
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events?timeMin=${weekStart.toISOString()}&timeMax=${weekEnd.toISOString()}&singleEvents=true&orderBy=startTime`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const data = await response.json()
      if (response.status === 401 || response.status === 403) {
        handleExpiredToken()
        throw new Error('Google Calendar access expired. Please reconnect above and try again.')
      }
      if (!response.ok) throw new Error('Failed to fetch calendar events')

      // Process schedule by day
      const schedule = processSchedule(data.items, weekStart)
      setWeekSchedule(schedule)
      const shifts = extractShifts(data.items)
      setWeekShifts(shifts)
      setSelectedWeek(formatDateKey(weekStart))
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
      const dateKey = formatDateKey(currentDay)
      
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
      const shiftType = bracketMatch[2].trim().toLowerCase()
      const startTime = new Date(event.start.dateTime)
      const endTime = new Date(event.end.dateTime)
      const dateKey = formatDateKey(startTime)
      
      if (!schedule[dateKey]) return

      const startHour = startTime.getHours()
      const endHour = endTime.getHours()

      // Prioritize explicit shift labels in calendar summaries
      if (shiftType.includes('opening') || shiftType.includes('open')) {
        if (!schedule[dateKey].morning.includes(baristaName)) {
          schedule[dateKey].morning.push(baristaName)
        }
        return
      }

      if (shiftType.includes('closing') || shiftType.includes('close')) {
        if (!schedule[dateKey].evening.includes(baristaName)) {
          schedule[dateKey].evening.push(baristaName)
        }
        return
      }

      if (shiftType.includes('shared') || shiftType.includes('support') || shiftType.includes('inter')) {
        if (!schedule[dateKey].interShift.includes(baristaName)) {
          schedule[dateKey].interShift.push(baristaName)
        }
        return
      }

      // Determine shift type based on start and end times
      // Morning shift: starts at 8am, and fallback to 9am for weekend openings
      if (startHour <= 9 && endHour >= 13 && endHour <= 15) {
        if (!schedule[dateKey].morning.includes(baristaName)) {
          schedule[dateKey].morning.push(baristaName)
        }
      }
      // Evening shift: starts around 2pm and ends at or after 8pm
      else if (startHour >= 13 && startHour <= 15 && endHour >= 20) {
        if (!schedule[dateKey].evening.includes(baristaName)) {
          schedule[dateKey].evening.push(baristaName)
        }
      }
      // Inter-shift: starts around noon and ends around 6pm (doesn't span full shifts)
      else if (startHour >= 11 && startHour <= 13 && endHour >= 17 && endHour <= 19) {
        if (!schedule[dateKey].interShift.includes(baristaName)) {
          schedule[dateKey].interShift.push(baristaName)
        }
      }
    })

    return schedule
  }

  const extractShifts = (events) => {
    const shifts = []
    events.forEach(event => {
      if (!event.start?.dateTime || !event.summary) return
      const bracketMatch = event.summary.match(/^\[([^,]+),\s*([^\]]+)\]/)
      if (!bracketMatch) return
      shifts.push({
        barista: bracketMatch[1].trim(),
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime)
      })
    })
    return shifts
  }

  const parseBulkTips = () => {
    const raw = bulkTipData.trim()
    if (!raw) {
      alert('Please paste tip data first')
      return
    }

    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const tips = {}
    const dayNamePattern = '(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)'
    const fullDateRegex = new RegExp(`^${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}$`)
    const rangeRegex = new RegExp(
      `${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(AM|PM)\\s*-\\s*${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}`,
      'i'
    )
    const amountRegex = /\$([\d,]+(?:\.\d{2})?)/

    let pendingDateText = null

    lines.forEach((line) => {
      const rangeMatch = line.match(rangeRegex)
      if (rangeMatch) {
        // First full date in the range is the business day for tips
        const firstDateMatch = line.match(new RegExp(`${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}`))
        if (firstDateMatch) pendingDateText = firstDateMatch[0]
      } else if (fullDateRegex.test(line)) {
        pendingDateText = line
      }

      const amountMatch = line.match(amountRegex)
      if (amountMatch && pendingDateText) {
        const parsedDate = new Date(pendingDateText)
        if (!Number.isNaN(parsedDate.getTime())) {
          const dateKey = formatDateKey(parsedDate)
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''))
          tips[dateKey] = (tips[dateKey] || 0) + amount
        }
        pendingDateText = null
      }
    })

    // Fallback for single-line formats containing both date and amount
    const combinedRegex = new RegExp(
      `${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}[\\s\\S]{0,140}?\\$([\\d,]+(?:\\.\\d{2})?)`,
      'gi'
    )
    let combinedMatch
    while ((combinedMatch = combinedRegex.exec(raw)) !== null) {
      const dateTextMatch = combinedMatch[0].match(
        new RegExp(`${dayNamePattern},\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}`)
      )
      if (!dateTextMatch) continue

      const amountTextMatch = combinedMatch[0].match(amountRegex)
      if (!amountTextMatch) continue

      const parsedDate = new Date(dateTextMatch[0])
      if (Number.isNaN(parsedDate.getTime())) continue

      const dateKey = formatDateKey(parsedDate)
      const amount = parseFloat(amountTextMatch[1].replace(/,/g, ''))
      if (!Number.isNaN(amount)) {
        tips[dateKey] = amount
      }
    }

    const parsedCount = Object.keys(tips).length
    if (parsedCount === 0) {
      alert('Parsed 0 tip entries. Please paste the full GoDaddy rows including the date range and $ amount.')
      return
    }

    setDailyTips((prev) => ({ ...prev, ...tips }))
    alert(`Parsed ${parsedCount} tip ${parsedCount === 1 ? 'entry' : 'entries'}`)
  }

  const parseSquareAndCalculate = () => {
    const raw = squareData.trim()
    if (!raw) {
      alert('Please paste Square transaction data first')
      return
    }
    if (weekShifts.length === 0) {
      alert('Please load the schedule from calendar first')
      return
    }

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

    // Detect format: tab-separated single-line rows vs multi-line (one cell per line)
    // Check if data rows (not just header) are also tab-separated
    const headerLineIdx = lines.findIndex(l => /\t/.test(l) && /date/i.test(l) && /tip/i.test(l))
    const hasTabData = headerLineIdx >= 0 && lines.slice(headerLineIdx + 1, headerLineIdx + 5).some(l => /\t/.test(l))

    const transactions = []

    if (hasTabData) {
      // Tab-separated format: each row is a single line
      let headerIndex = -1
      let headers = []
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        const cols = lines[i].split('\t').map(c => c.trim().toLowerCase())
        if (cols.includes('date') && cols.includes('tip')) {
          headerIndex = i
          headers = cols
          break
        }
      }
      if (headerIndex === -1) {
        alert('Could not find header row with "Date" and "Tip" columns.')
        return
      }
      const dateIdx = headers.indexOf('date')
      const tipIdx = headers.indexOf('tip')
      const timeIdx = headers.indexOf('time')

      for (let i = headerIndex + 1; i < lines.length; i++) {
        const cols = lines[i].split('\t').map(c => c.trim())
        if (cols.length <= Math.max(dateIdx, tipIdx)) continue
        let dateStr = cols[dateIdx]
        if (!dateStr) continue
        if (timeIdx >= 0 && cols[timeIdx]) dateStr = `${dateStr} ${cols[timeIdx]}`
        const parsedDate = new Date(dateStr)
        if (isNaN(parsedDate.getTime())) continue
        const tipAmount = parseFloat((cols[tipIdx] || '').replace(/[$,]/g, ''))
        if (isNaN(tipAmount) || tipAmount <= 0) continue
        transactions.push({ date: parsedDate, tip: tipAmount })
      }
    } else {
      // Multi-line format: each cell is on its own line when copy-pasted from Square
      // Pattern: date line (M/D/YYYY), time line (H:MM AM/PM), then other fields,
      // then $ amounts at the end (Subtotal, Tip, Surcharge, Debit Cashback, Total)
      const dateRegex = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/
      const timeRegex = /^\d{1,2}:\d{2}\s*(AM|PM)$/i
      const amountRegex = /^\$[\d,]+\.\d{2}$/

      let i = 0
      // Skip header lines (tab-separated or containing column names)
      while (i < lines.length && (/date/i.test(lines[i]) && /tip/i.test(lines[i]))) i++

      while (i < lines.length) {
        // Find a date line
        if (!dateRegex.test(lines[i])) { i++; continue }

        const datePart = lines[i]
        i++

        // Next line should be time
        if (i >= lines.length || !timeRegex.test(lines[i])) continue
        const timePart = lines[i]
        i++

        const parsedDate = new Date(`${datePart} ${timePart}`)
        if (isNaN(parsedDate.getTime())) continue

        // Scan forward to find the $ amount lines
        // Card: Subtotal, Tip, Surcharge, Debit Cashback, Total (5 amounts)
        // Cash: Subtotal, Tip, Surcharge, Total (4 amounts)
        const amounts = []
        while (i < lines.length && !dateRegex.test(lines[i])) {
          // Stop at section headers like "Cash Payments (31)" or "Total"
          if (/^(cash payments|total$)/i.test(lines[i])) break
          if (amountRegex.test(lines[i])) {
            amounts.push(parseFloat(lines[i].replace(/[$,]/g, '')))
          }
          i++
        }

        // Tip is always the 2nd amount regardless of section (4 or 5 amounts)
        if (amounts.length >= 4) {
          const tipAmount = amounts[1] // Tip is the 2nd amount
          if (tipAmount > 0) {
            transactions.push({ date: parsedDate, tip: tipAmount })
          }
        }
      }
    }

    if (transactions.length === 0) {
      alert('No valid transactions with tips found. Make sure the pasted data includes the full Square report with dates, times, and dollar amounts.')
      return
    }

    // Calculate by-hour tips
    const baristaEarnings = {}
    let unmatchedTips = 0
    let unmatchedCount = 0

    transactions.forEach(tx => {
      // Primary match: transaction falls within an exact shift window, so everyone
      // on the floor at that moment splits it evenly.
      const onShiftNow = [...new Set(
        weekShifts
          .filter(shift => tx.date >= shift.start && tx.date <= shift.end)
          .map(shift => shift.barista)
      )]

      const weights = {}
      onShiftNow.forEach(name => { weights[name] = 1 })

      // Fallback for a transaction outside every shift window (e.g. after closing):
      // spread it over that day's crew in proportion to the hours each one worked,
      // so a two-hour inter-shift doesn't take the same cut as a full shift.
      if (onShiftNow.length === 0) {
        const txDateKey = formatDateKey(tx.date)
        weekShifts
          .filter(shift => formatDateKey(shift.start) === txDateKey)
          .forEach(shift => {
            const shiftHours = (shift.end - shift.start) / (1000 * 60 * 60)
            weights[shift.barista] = (weights[shift.barista] || 0) + shiftHours
          })
      }

      const weightTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
      if (weightTotal <= 0) {
        unmatchedTips += tx.tip
        unmatchedCount++
        return
      }

      // Shares are fractions of one transaction, so they always sum back to tx.tip
      Object.entries(weights).forEach(([name, weight]) => {
        if (!baristaEarnings[name]) {
          baristaEarnings[name] = { tips: 0, hours: 0, shifts: 0, basePay: 0, total: 0, transactions: 0 }
        }
        baristaEarnings[name].tips += tx.tip * (weight / weightTotal)
        baristaEarnings[name].transactions++
      })
    })

    // Calculate hours and shifts from calendar data
    Object.keys(baristaEarnings).forEach(name => {
      const shifts = weekShifts.filter(s => s.barista === name)
      // Every scheduled shift earns a base rate, so working a double in one day
      // counts twice - the same rule the daily-totals path applies.
      baristaEarnings[name].shifts = shifts.length
      baristaEarnings[name].hours = shifts.reduce((sum, s) => {
        return sum + (s.end - s.start) / (1000 * 60 * 60)
      }, 0)
      const baristaRecord = baristas.find(b => b.name === name)
      baristaEarnings[name].basePay = (baristaRecord?.basePay || 0) * baristaEarnings[name].shifts
      baristaEarnings[name].total = baristaEarnings[name].tips + baristaEarnings[name].basePay
    })

    const totalTips = transactions.reduce((sum, tx) => sum + tx.tip, 0)
    const tipsDistributed = Object.values(baristaEarnings).reduce((sum, data) => sum + data.tips, 0)

    setCalculation({
      tipsDistributed,
      weekStart: selectedWeek || formatDateKey(transactions[0].date),
      weekEnd: selectedWeek
        ? formatDateKey(new Date(parseDateInput(selectedWeek).getTime() + 6 * 24 * 60 * 60 * 1000))
        : formatDateKey(transactions[transactions.length - 1].date),
      earnings: baristaEarnings,
      totalTips,
      unmatchedTips,
      unmatchedCount,
      matchedTransactions: transactions.length - unmatchedCount,
      totalTransactions: transactions.length,
      isByHour: true
    })

    alert(`Parsed ${transactions.length} transactions with tips. ${unmatchedCount > 0 ? `${unmatchedCount} transactions ($${unmatchedTips.toFixed(2)}) could not be matched to any barista shift.` : 'All matched to shifts.'}`)
  }

  // Splits one day's tips into a morning pool and an evening pool, each divided by
  // the hours a barista actually covered in that window. Weights are normalized
  // inside the pool, so a day's shares always add up to exactly that day's tips:
  // an inter-shift barista dilutes the other shares instead of being paid on top of
  // an already-full split (which is what used to push payouts over 100%).
  const allocateDayTips = (daySchedule, dayTip) => {
    const morningWeights = {}
    const eveningWeights = {}
    const addWeight = (weights, name, hours) => {
      weights[name] = (weights[name] || 0) + hours
    }

    daySchedule.morning.forEach(name => addWeight(morningWeights, name, MORNING_HOURS))
    daySchedule.evening.forEach(name => addWeight(eveningWeights, name, EVENING_HOURS))
    daySchedule.interShift.forEach(name => {
      addWeight(morningWeights, name, INTER_MORNING_OVERLAP)
      addWeight(eveningWeights, name, INTER_EVENING_OVERLAP)
    })

    const sumWeights = (weights) => Object.values(weights).reduce((sum, weight) => sum + weight, 0)
    const morningWeightTotal = sumWeights(morningWeights)
    const eveningWeightTotal = sumWeights(eveningWeights)

    // Half the day's tips per pool, except an unstaffed half hands its share to the
    // other one rather than dropping it.
    let morningPool = dayTip / 2
    let eveningPool = dayTip / 2
    if (morningWeightTotal === 0) {
      eveningPool += morningPool
      morningPool = 0
    }
    if (eveningWeightTotal === 0) {
      morningPool += eveningPool
      eveningPool = 0
    }

    const shares = {}
    Object.entries(morningWeights).forEach(([name, weight]) => {
      shares[name] = (shares[name] || 0) + morningPool * (weight / morningWeightTotal)
    })
    Object.entries(eveningWeights).forEach(([name, weight]) => {
      shares[name] = (shares[name] || 0) + eveningPool * (weight / eveningWeightTotal)
    })

    const allocated = Object.values(shares).reduce((sum, share) => sum + share, 0)
    return { shares, unallocated: dayTip - allocated }
  }

  const calculateTips = () => {
    if (!weekSchedule || Object.keys(dailyTips).length === 0) {
      alert('Please load schedule and enter tip data first')
      return
    }

    const baristaEarnings = {}
    const earningsFor = (name) => {
      if (!baristaEarnings[name]) {
        baristaEarnings[name] = { tips: 0, hours: 0, shifts: 0, basePay: 0, total: 0 }
      }
      return baristaEarnings[name]
    }

    let scheduledTips = 0
    let unallocatedTips = 0
    let unallocatedDays = 0

    Object.keys(weekSchedule).forEach(date => {
      const daySchedule = weekSchedule[date]
      const dayTip = dailyTips[date] || 0
      scheduledTips += dayTip

      const { shares, unallocated } = allocateDayTips(daySchedule, dayTip)
      Object.entries(shares).forEach(([name, share]) => {
        earningsFor(name).tips += share
      })
      if (unallocated > 0.005) {
        unallocatedTips += unallocated
        unallocatedDays += 1
      }

      // Hours and shifts are counted off the schedule, independent of the tip split
      daySchedule.morning.forEach(name => {
        earningsFor(name).hours += MORNING_HOURS
        earningsFor(name).shifts += 1
      })
      daySchedule.evening.forEach(name => {
        earningsFor(name).hours += EVENING_HOURS
        earningsFor(name).shifts += 1
      })
      daySchedule.interShift.forEach(name => {
        earningsFor(name).hours += INTER_SHIFT_HOURS
        earningsFor(name).shifts += 1
      })
    })

    // Tips parsed for a date outside the loaded week can never reach a barista.
    // Count them as undistributed instead of letting them inflate the week total.
    const outsideWeekEntries = Object.entries(dailyTips)
      .filter(([date, tip]) => !weekSchedule[date] && (Number(tip) || 0) > 0)
    const outsideWeekTips = outsideWeekEntries.reduce((sum, [, tip]) => sum + (Number(tip) || 0), 0)

    baristas.forEach(barista => {
      if (baristaEarnings[barista.name]) {
        baristaEarnings[barista.name].basePay = (barista.basePay || 0) * baristaEarnings[barista.name].shifts
      }
    })
    Object.values(baristaEarnings).forEach(data => {
      data.total = data.tips + data.basePay
    })

    const tipsDistributed = Object.values(baristaEarnings).reduce((sum, data) => sum + data.tips, 0)

    setCalculation({
      weekStart: selectedWeek,
      weekEnd: formatDateKey(new Date(parseDateInput(selectedWeek).getTime() + 6 * 24 * 60 * 60 * 1000)),
      earnings: baristaEarnings,
      totalTips: scheduledTips + outsideWeekTips,
      tipsDistributed,
      unmatchedTips: unallocatedTips + outsideWeekTips,
      unmatchedCount: unallocatedDays + outsideWeekEntries.length
    })
  }

  // Mirrors the Calculation Results table above, using WhatsApp *bold* markup
  const formatReportMessage = () => {
    const lines = []
    lines.push('*BRB Tip Report*')
    lines.push(`*Week:* ${calculation.weekStart} to ${calculation.weekEnd}`)
    lines.push(`*Total Tips:* $${calculation.totalTips.toFixed(2)}`)

    if (calculation.isByHour) {
      lines.push(`*Matched Transactions:* ${calculation.matchedTransactions} of ${calculation.totalTransactions}`)
    }
    if (calculation.unmatchedTips > 0.005) {
      const reason = calculation.isByHour ? 'transactions outside any shift' : 'days with tips but nobody scheduled'
      lines.push(`*Undistributed Tips:* $${calculation.unmatchedTips.toFixed(2)} (${calculation.unmatchedCount} ${reason})`)
    }

    Object.entries(calculation.earnings).forEach(([name, data]) => {
      lines.push('')
      lines.push(`*${name}*`)
      lines.push(`Shifts: ${data.shifts}  |  Hours: ${data.hours.toFixed(1)}`)
      lines.push(`Base Pay: $${data.basePay.toFixed(2)}`)
      lines.push(`Tips: $${data.tips.toFixed(2)}${calculation.isByHour ? `  (${data.transactions || 0} txns)` : ''}`)
      lines.push(`Total: *$${(data.total || data.tips).toFixed(2)}*`)
    })

    return lines.join('\n')
  }

  const shareToWhatsApp = async () => {
    if (!calculation) {
      alert('Calculate tips first')
      return
    }

    const message = formatReportMessage()

    // navigator.share opens the native sheet (pick the group directly) on mobile.
    // Requires HTTPS; falls back to the wa.me contact picker elsewhere.
    if (navigator.share) {
      try {
        await navigator.share({ text: message })
        return
      } catch (err) {
        if (err.name === 'AbortError') return // user dismissed the sheet
        console.error('Share failed, falling back to wa.me:', err)
      }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener')
  }

  // Works on devices with no WhatsApp app and no WhatsApp Web session:
  // copy the report, paste it into WhatsApp wherever you actually have it.
  const copyReport = async () => {
    if (!calculation) {
      alert('Calculate tips first')
      return
    }

    const message = formatReportMessage()
    setReportText(message) // always show it, so there is a visible fallback to select manually

    // navigator.clipboard needs HTTPS (or localhost); on plain HTTP this throws
    try {
      await navigator.clipboard.writeText(message)
      setCopiedReport(true)
      setTimeout(() => setCopiedReport(false), 2000)
    } catch (err) {
      console.error('Clipboard write failed, showing text to copy manually:', err)
      setCopiedReport(false)
    }
  }

  const saveReport = async () => {
    if (!calculation) {
      alert('Calculate tips first')
      return
    }

    try {
      // Create document ID based on week start date: "week-2026-02-15"
      const docId = `week-${calculation.weekStart}`
      
      await setDoc(doc(db, 'tipReports', docId), {
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

  const money = (value) => `$${(Number(value) || 0).toFixed(2)}`

  // A saved report is out of balance when the tips paid to baristas don't match what
  // the register recorded. Reports written before the tip split was fixed can be over
  // or under 100%; anything flagged here should be re-pasted and saved again.
  const getReportBalance = (report) => {
    const collected = Number(report.totalTips) || 0
    const distributed = report.tipsDistributed != null
      ? Number(report.tipsDistributed)
      : Object.values(report.earnings || {}).reduce((sum, data) => sum + (Number(data.tips) || 0), 0)
    // Tips nobody could be paid (no one on the clock) are a known, intentional gap,
    // not an allocation error, so they don't count against the balance.
    const expectedGap = Number(report.unmatchedTips) || 0
    const difference = distributed - collected

    return {
      collected,
      distributed,
      difference,
      needsRecalculation: Math.abs(difference + expectedGap) > 0.01
    }
  }

  const flaggedReports = reports.filter(report => getReportBalance(report).needsRecalculation)

  // Reports cover a Sunday-to-Saturday week, so a week can straddle Dec 31.
  // The chosen basis decides which calendar year/quarter that week is taxed in.
  const getPeriodKey = (report, basis) =>
    (basis === 'weekEnd' ? report.weekEnd || report.weekStart : report.weekStart || report.weekEnd) || ''

  const availableTaxYears = [...new Set(
    reports.map(report => getPeriodKey(report, taxBasis).slice(0, 4)).filter(Boolean)
  )].sort().reverse()

  const generateTaxSummary = () => {
    const year = String(taxYear)
    const yearReports = reports
      .filter(report => getPeriodKey(report, taxBasis).slice(0, 4) === year)
      .sort((a, b) => getPeriodKey(a, taxBasis).localeCompare(getPeriodKey(b, taxBasis)))

    if (yearReports.length === 0) {
      setTaxSummary(null)
      setTaxStatementText('')
      alert(`No saved tip reports found for ${year}.`)
      return
    }

    const people = {}
    const detail = []
    let tipsCollected = 0
    let unmatchedTips = 0

    yearReports.forEach(report => {
      const periodKey = getPeriodKey(report, taxBasis)
      const monthIndex = Number(periodKey.slice(5, 7)) - 1
      const quarterIndex = Math.floor(monthIndex / 3)

      tipsCollected += Number(report.totalTips) || 0
      unmatchedTips += Number(report.unmatchedTips) || 0

      Object.entries(report.earnings || {}).forEach(([name, data]) => {
        const tips = Number(data.tips) || 0
        const basePay = Number(data.basePay) || 0
        const total = data.total != null ? Number(data.total) : tips + basePay
        const hours = Number(data.hours) || 0
        const shifts = Number(data.shifts) || 0

        if (!people[name]) {
          people[name] = {
            name,
            shifts: 0,
            hours: 0,
            basePay: 0,
            tips: 0,
            total: 0,
            weeks: 0,
            transactions: 0,
            firstWeek: report.weekStart || periodKey,
            lastWeek: report.weekStart || periodKey,
            quarters: [0, 0, 0, 0],
            quarterBasePay: [0, 0, 0, 0],
            quarterTips: [0, 0, 0, 0],
            months: Array(12).fill(0)
          }
        }

        const person = people[name]
        person.shifts += shifts
        person.hours += hours
        person.basePay += basePay
        person.tips += tips
        person.total += total
        person.weeks += 1
        person.transactions += Number(data.transactions) || 0
        person.quarters[quarterIndex] += total
        person.quarterBasePay[quarterIndex] += basePay
        person.quarterTips[quarterIndex] += tips
        person.months[monthIndex] += total
        if ((report.weekStart || periodKey) < person.firstWeek) person.firstWeek = report.weekStart || periodKey
        if ((report.weekStart || periodKey) > person.lastWeek) person.lastWeek = report.weekStart || periodKey

        detail.push({
          name,
          weekStart: report.weekStart || '',
          weekEnd: report.weekEnd || '',
          month: monthIndex + 1,
          quarter: quarterIndex + 1,
          shifts,
          hours,
          basePay,
          tips,
          total
        })
      })
    })

    const roster = Object.values(people).sort((a, b) => b.total - a.total)
    const totals = roster.reduce((acc, person) => ({
      shifts: acc.shifts + person.shifts,
      hours: acc.hours + person.hours,
      basePay: acc.basePay + person.basePay,
      tips: acc.tips + person.tips,
      total: acc.total + person.total
    }), { shifts: 0, hours: 0, basePay: 0, tips: 0, total: 0 })

    // Weeks with no saved report between the first and last one filed - those are
    // the gaps that make a year-end total understate what was actually paid out.
    const filedWeeks = new Set(yearReports.map(report => report.weekStart).filter(Boolean))
    const missingWeeks = []
    const sortedWeeks = [...filedWeeks].sort()
    if (sortedWeeks.length > 1) {
      const cursor = parseDateInput(sortedWeeks[0])
      const lastWeek = parseDateInput(sortedWeeks[sortedWeeks.length - 1])
      while (cursor < lastWeek) {
        cursor.setDate(cursor.getDate() + 7)
        const key = formatDateKey(cursor)
        if (cursor < lastWeek && !filedWeeks.has(key)) missingWeeks.push(key)
      }
    }

    setTaxStatementText('')
    setTaxSummary({
      year,
      basis: taxBasis,
      roster,
      detail,
      totals,
      weekCount: yearReports.length,
      firstWeek: sortedWeeks[0] || '',
      lastWeek: sortedWeeks[sortedWeeks.length - 1] || '',
      tipsCollected,
      unmatchedTips,
      undistributedTips: tipsCollected - totals.tips,
      missingWeeks,
      flaggedWeeks: yearReports
        .map(report => ({
          weekStart: report.weekStart || getPeriodKey(report, taxBasis),
          ...getReportBalance(report)
        }))
        .filter(entry => entry.needsRecalculation)
    })
  }

  const csvEscape = (value) => {
    const str = String(value ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  const downloadCsv = (filename, rows) => {
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportAnnualCsv = () => {
    if (!taxSummary) return
    const rows = [[
      'Name', 'Year', 'Weeks Paid', 'Shifts', 'Hours', 'Base Pay (no tips)', 'Tips', 'Gross Earnings',
      'Avg $/Hour', 'Tips % of Gross', 'First Week', 'Last Week',
      'Q1 Gross', 'Q2 Gross', 'Q3 Gross', 'Q4 Gross', '1099-NEC Threshold Met'
    ]]

    taxSummary.roster.forEach(person => {
      rows.push([
        person.name,
        taxSummary.year,
        person.weeks,
        person.shifts,
        person.hours.toFixed(2),
        person.basePay.toFixed(2),
        person.tips.toFixed(2),
        person.total.toFixed(2),
        person.hours > 0 ? (person.total / person.hours).toFixed(2) : '',
        person.total > 0 ? ((person.tips / person.total) * 100).toFixed(1) : '0.0',
        person.firstWeek,
        person.lastWeek,
        person.quarters[0].toFixed(2),
        person.quarters[1].toFixed(2),
        person.quarters[2].toFixed(2),
        person.quarters[3].toFixed(2),
        person.total >= TAX_1099_THRESHOLD ? 'YES' : 'no'
      ])
    })

    rows.push([])
    rows.push(['TOTALS', taxSummary.year, taxSummary.weekCount, taxSummary.totals.shifts,
      taxSummary.totals.hours.toFixed(2), taxSummary.totals.basePay.toFixed(2),
      taxSummary.totals.tips.toFixed(2), taxSummary.totals.total.toFixed(2)])
    rows.push(['Tips collected at register', taxSummary.tipsCollected.toFixed(2)])
    rows.push(['Tips distributed to staff', taxSummary.totals.tips.toFixed(2)])
    rows.push(['Tips not distributed', taxSummary.undistributedTips.toFixed(2)])
    rows.push(['Week attributed by', taxSummary.basis === 'weekEnd' ? 'week end date' : 'week start date'])

    if (taxSummary.flaggedWeeks.length > 0) {
      rows.push([])
      rows.push(['WEEKS NEEDING RECALCULATION', 'Tips Collected', 'Tips Paid Out', 'Difference'])
      taxSummary.flaggedWeeks.forEach(week => {
        rows.push([week.weekStart, week.collected.toFixed(2), week.distributed.toFixed(2), week.difference.toFixed(2)])
      })
    }

    if (taxSummary.missingWeeks.length > 0) {
      rows.push([])
      rows.push(['WEEKS WITH NO SAVED REPORT'])
      taxSummary.missingWeeks.forEach(week => rows.push([week]))
    }

    downloadCsv(`brb-tax-summary-${taxSummary.year}.csv`, rows)
  }

  const exportWeeklyDetailCsv = () => {
    if (!taxSummary) return
    const rows = [['Name', 'Week Start', 'Week End', 'Month', 'Quarter', 'Shifts', 'Hours', 'Base Pay', 'Tips', 'Gross']]
    taxSummary.detail
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.weekStart.localeCompare(b.weekStart))
      .forEach(row => {
        rows.push([
          row.name, row.weekStart, row.weekEnd, row.month, `Q${row.quarter}`,
          row.shifts, row.hours.toFixed(2), row.basePay.toFixed(2), row.tips.toFixed(2), row.total.toFixed(2)
        ])
      })
    downloadCsv(`brb-tax-detail-${taxSummary.year}.csv`, rows)
  }

  // Plain-text earnings statement to hand to one barista for their own filing.
  const showEarningsStatement = (person) => {
    const lines = []
    lines.push(`BRB EARNINGS STATEMENT - ${taxSummary.year}`)
    lines.push(`Paid to: ${person.name}`)
    lines.push(`Period: ${person.firstWeek} through ${person.lastWeek}`)
    lines.push('')
    lines.push(`Weeks paid:        ${person.weeks}`)
    lines.push(`Shifts worked:     ${person.shifts}`)
    lines.push(`Hours worked:      ${person.hours.toFixed(1)}`)
    lines.push('')
    lines.push(`Base pay (no tips):${money(person.basePay).padStart(12)}`)
    lines.push(`Tips:              ${money(person.tips).padStart(12)}`)
    lines.push(`GROSS EARNINGS:    ${money(person.total).padStart(12)}`)
    lines.push('')
    lines.push('Quarterly gross:')
    person.quarters.forEach((amount, index) => {
      lines.push(`  Q${index + 1}: ${money(amount)}  (base ${money(person.quarterBasePay[index])} + tips ${money(person.quarterTips[index])})`)
    })
    lines.push('')
    lines.push('Gross amounts, no taxes withheld. Keep for your records.')
    const text = lines.join('\n')
    setTaxStatementText(text)
    navigator.clipboard?.writeText(text).catch(err => {
      console.error('Clipboard write failed, statement shown below instead:', err)
    })
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

      {!accessToken && (
        <div className="google-connect-banner">
          <p>
            Tip reports read the shift schedule from Google Calendar. Your calendar access
            has expired or was never granted on this device.
          </p>
          <button onClick={connectGoogleCalendar} disabled={connectingGoogle}>
            {connectingGoogle ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        </div>
      )}

      {view === 'calculator' && (
        <div className="calculator-section">
          <h3>Weekly Tip Calculator</h3>
          
          <div className="form-group">
            <label>Select Week Start Date (Sunday):</label>
            <input 
              type="date" 
              value={selectedWeek} 
              onChange={(e) => {
                const sunday = getSundayOfWeek(parseDateInput(e.target.value))
                setSelectedWeek(formatDateKey(sunday))
              }}
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
                    <strong>{parseDateInput(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                    <div>Morning (8am-2pm): {weekSchedule[date].morning.join(', ') || 'None'}</div>
                    <div>Evening (2pm-9pm): {weekSchedule[date].evening.join(', ') || 'None'}</div>
                    <div>Inter-shift (12pm-6pm): {weekSchedule[date].interShift.join(', ') || 'None'}</div>
                  </div>
                ))}
              </div>

              <div className="tip-input-section">
                <h4>Enter Tips</h4>
                <div className="input-method-toggle">
                  <button onClick={() => setTipInputMethod('byHour')} className={tipInputMethod === 'byHour' ? 'active' : ''}>
                    Paste Card Report (Recommended)
                  </button>
                  <button onClick={() => setTipInputMethod('bulk')} className={tipInputMethod === 'bulk' ? 'active' : ''}>
                    Paste Daily Totals
                  </button>
                  <button onClick={() => setTipInputMethod('manual')} className={tipInputMethod === 'manual' ? 'active' : ''}>
                    Manual Entry
                  </button>
                </div>

                {tipInputMethod === 'manual' && (
                  <div className="manual-entry">
                    {Object.keys(weekSchedule).map(date => (
                      <div key={date} className="daily-tip-input">
                        <label>{parseDateInput(date).toLocaleDateString()}:</label>
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
                )}

                {tipInputMethod === 'bulk' && (
                  <div className="bulk-entry">
                    <p className="by-hour-description">
                      For a report that only gives one tip total per day. The day is split half to the
                      morning window and half to the evening window, then each half is divided by the
                      hours each barista covered in it. Less precise than the card report above, but the
                      day's shares always add back up to the day's tips.
                    </p>
                    <textarea 
                      placeholder="Paste GoDaddy tip report here..."
                      value={bulkTipData}
                      onChange={(e) => setBulkTipData(e.target.value)}
                      rows={10}
                    />
                    <button onClick={parseBulkTips}>Parse Tip Data</button>
                  </div>
                )}

                {tipInputMethod === 'byHour' && (
                  <div className="bulk-entry">
                    <p className="by-hour-description">
                      Paste the whole card/Square transaction export below — no typing per hour, just
                      copy the report. It needs <strong>Date</strong> and <strong>Tip</strong> columns, plus
                      a <strong>Time</strong> column if you have one. Each transaction is split evenly among
                      whoever was clocked on at that minute, so the payout always adds back up to the
                      exact tips collected. Transactions outside every shift (after close) fall back to
                      that day's crew, weighted by hours worked.
                    </p>
                    <textarea 
                      placeholder="Paste Square transaction report here (with Date and Tip columns)..."
                      value={squareData}
                      onChange={(e) => setSquareData(e.target.value)}
                      rows={10}
                    />
                    <button onClick={parseSquareAndCalculate}>Parse & Calculate Tips</button>
                  </div>
                )}
              </div>

              {tipInputMethod !== 'byHour' && (
                <button onClick={calculateTips} className="calculate-btn">Calculate Tips</button>
              )}

              {calculation && (
                <div className="calculation-results">
                  <h4>Calculation Results</h4>
                  <p><strong>Week:</strong> {calculation.weekStart} to {calculation.weekEnd}</p>
                  <p><strong>Tips Collected:</strong> ${calculation.totalTips.toFixed(2)}</p>
                  <p><strong>Tips Distributed:</strong> ${(calculation.tipsDistributed || 0).toFixed(2)}</p>
                  {calculation.isByHour && (
                    <p><strong>Matched Transactions:</strong> {calculation.matchedTransactions} of {calculation.totalTransactions}</p>
                  )}
                  {calculation.unmatchedTips > 0.005 && (
                    <p className="unmatched-warning">
                      <strong>Undistributed Tips:</strong> ${calculation.unmatchedTips.toFixed(2)}{' '}
                      ({calculation.unmatchedCount}{' '}
                      {calculation.isByHour ? 'transactions outside any shift' : 'days with tips but nobody scheduled'})
                    </p>
                  )}
                  
                  <table className="earnings-table">
                    <thead>
                      <tr>
                        <th>Barista</th>
                        <th>Shifts</th>
                        <th>Hours</th>
                        <th>Base Pay</th>
                        <th>Tips</th>
                        {calculation.isByHour && <th>Txns</th>}
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
                          {calculation.isByHour && <td>{data.transactions || 0}</td>}
                          <td><strong>${(data.total || data.tips).toFixed(2)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button onClick={saveReport} className="save-report-btn">Save Report to Firebase</button>
                  <button onClick={shareToWhatsApp} className="whatsapp-share-btn">Send to WhatsApp</button>
                  <button onClick={copyReport} className="copy-report-btn">
                    {copiedReport ? 'Copied!' : 'Copy Report Text'}
                  </button>

                  {reportText && (
                    <div className="report-text-block">
                      <p>Paste this into the WhatsApp group:</p>
                      <textarea
                        readOnly
                        value={reportText}
                        rows={Math.min(20, reportText.split('\n').length)}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                  )}
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
              <button onClick={() => syncBaristasFromCurrentMonth(true)} className="add-btn" disabled={syncingBaristas}>
                {syncingBaristas ? 'Syncing...' : 'Sync From Current Month Calendar'}
              </button>
            </div>
          </div>

          <div className="barista-list">
            <h4>Current Baristas ({baristas.length})</h4>
            {baristas.length === 0 ? (
              <p className="empty-state">No baristas found yet. Use “Sync From Current Month Calendar” to auto-load scheduled baristas.</p>
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
          <div className="tax-panel">
            <h3>Year-End Tax Summary</h3>
            <p className="tax-panel-description">
              Rolls every saved weekly tip report into per-person totals for the year:
              base pay (what a barista earns before tips), tips paid out, and gross earnings.
            </p>

            <div className="tax-controls">
              <label>
                Tax year
                <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                  {(availableTaxYears.length > 0 ? availableTaxYears : [String(new Date().getFullYear())]).map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              <label>
                Count a week in the year of its
                <select value={taxBasis} onChange={(e) => setTaxBasis(e.target.value)}>
                  <option value="weekStart">start date</option>
                  <option value="weekEnd">end date</option>
                </select>
              </label>
              <button onClick={generateTaxSummary} className="tax-generate-btn">
                Calculate Yearly Totals
              </button>
              {taxSummary && (
                <button
                  onClick={() => { setTaxSummary(null); setTaxStatementText('') }}
                  className="tax-clear-btn"
                >
                  Clear
                </button>
              )}
            </div>

            {taxSummary && (
              <div className="tax-results">
                <div className="tax-stat-grid">
                  <div className="tax-stat">
                    <span>Weeks reported</span>
                    <strong>{taxSummary.weekCount}</strong>
                    <small>{taxSummary.firstWeek} to {taxSummary.lastWeek}</small>
                  </div>
                  <div className="tax-stat">
                    <span>Total base pay</span>
                    <strong>{money(taxSummary.totals.basePay)}</strong>
                    <small>wages before tips</small>
                  </div>
                  <div className="tax-stat">
                    <span>Tips paid out</span>
                    <strong>{money(taxSummary.totals.tips)}</strong>
                    <small>distributed to staff</small>
                  </div>
                  <div className="tax-stat tax-stat-highlight">
                    <span>Total labor cost</span>
                    <strong>{money(taxSummary.totals.total)}</strong>
                    <small>base pay + tips</small>
                  </div>
                  <div className="tax-stat">
                    <span>Tips collected</span>
                    <strong>{money(taxSummary.tipsCollected)}</strong>
                    <small>from the register reports</small>
                  </div>
                  <div className="tax-stat">
                    <span>Total hours</span>
                    <strong>{taxSummary.totals.hours.toFixed(1)}</strong>
                    <small>{taxSummary.totals.shifts} shifts</small>
                  </div>
                </div>

                {Math.abs(taxSummary.undistributedTips) >= 0.01 && (
                  <p className="unmatched-warning">
                    <strong>{money(Math.abs(taxSummary.undistributedTips))}</strong> of collected tips
                    {taxSummary.undistributedTips > 0 ? ' was never distributed' : ' more was paid out than collected'}
                    {taxSummary.unmatchedTips > 0 && ` (${money(taxSummary.unmatchedTips)} flagged as unmatched to any shift)`}.
                    Reconcile this against the register totals before filing.
                  </p>
                )}

                {taxSummary.flaggedWeeks.length > 0 && (
                  <p className="unmatched-warning">
                    <strong>{taxSummary.flaggedWeeks.length} week(s) in {taxSummary.year} need recalculation</strong>{' '}
                    — tips paid out don't match tips collected for: {taxSummary.flaggedWeeks
                      .map(week => `${week.weekStart} (${week.difference > 0 ? '+' : '-'}${money(Math.abs(week.difference))})`)
                      .join(', ')}. The totals below include those figures as saved.
                  </p>
                )}

                {taxSummary.missingWeeks.length > 0 && (
                  <p className="unmatched-warning">
                    <strong>{taxSummary.missingWeeks.length} week(s) have no saved report</strong> between
                    {' '}{taxSummary.firstWeek} and {taxSummary.lastWeek}: {taxSummary.missingWeeks.join(', ')}.
                    Those weeks are missing from every total below.
                  </p>
                )}

                <h4>Per-person earnings — {taxSummary.year}</h4>
                <div className="tax-table-scroll">
                  <table className="earnings-table tax-table">
                    <thead>
                      <tr>
                        <th>Barista</th>
                        <th>Weeks</th>
                        <th>Shifts</th>
                        <th>Hours</th>
                        <th>Base Pay (no tips)</th>
                        <th>Tips</th>
                        <th>Gross (base + tips)</th>
                        <th>Avg $/hr</th>
                        <th>Tips %</th>
                        <th>1099-NEC</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxSummary.roster.map(person => (
                        <tr key={person.name}>
                          <td><strong>{person.name}</strong></td>
                          <td>{person.weeks}</td>
                          <td>{person.shifts}</td>
                          <td>{person.hours.toFixed(1)}</td>
                          <td>{money(person.basePay)}</td>
                          <td>{money(person.tips)}</td>
                          <td><strong>{money(person.total)}</strong></td>
                          <td>{person.hours > 0 ? money(person.total / person.hours) : '—'}</td>
                          <td>{person.total > 0 ? `${((person.tips / person.total) * 100).toFixed(1)}%` : '—'}</td>
                          <td>
                            <span className={person.total >= TAX_1099_THRESHOLD ? 'tax-flag-yes' : 'tax-flag-no'}>
                              {person.total >= TAX_1099_THRESHOLD ? 'Required' : 'Under $600'}
                            </span>
                          </td>
                          <td>
                            <button className="tax-statement-btn" onClick={() => showEarningsStatement(person)}>
                              Statement
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>All staff</strong></td>
                        <td>{taxSummary.weekCount}</td>
                        <td>{taxSummary.totals.shifts}</td>
                        <td>{taxSummary.totals.hours.toFixed(1)}</td>
                        <td>{money(taxSummary.totals.basePay)}</td>
                        <td>{money(taxSummary.totals.tips)}</td>
                        <td><strong>{money(taxSummary.totals.total)}</strong></td>
                        <td>{taxSummary.totals.hours > 0 ? money(taxSummary.totals.total / taxSummary.totals.hours) : '—'}</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <h4>Quarterly gross — for quarterly filings and estimated payments</h4>
                <div className="tax-table-scroll">
                  <table className="earnings-table tax-table">
                    <thead>
                      <tr>
                        <th>Barista</th>
                        <th>Q1 (Jan–Mar)</th>
                        <th>Q2 (Apr–Jun)</th>
                        <th>Q3 (Jul–Sep)</th>
                        <th>Q4 (Oct–Dec)</th>
                        <th>Year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxSummary.roster.map(person => (
                        <tr key={person.name}>
                          <td><strong>{person.name}</strong></td>
                          {person.quarters.map((amount, index) => (
                            <td key={index}>{money(amount)}</td>
                          ))}
                          <td><strong>{money(person.total)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>All staff</strong></td>
                        {[0, 1, 2, 3].map(index => (
                          <td key={index}>
                            {money(taxSummary.roster.reduce((sum, person) => sum + person.quarters[index], 0))}
                          </td>
                        ))}
                        <td><strong>{money(taxSummary.totals.total)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="tax-export-buttons">
                  <button onClick={exportAnnualCsv}>Download Annual Summary (CSV)</button>
                  <button onClick={exportWeeklyDetailCsv}>Download Week-by-Week Detail (CSV)</button>
                </div>

                {taxStatementText && (
                  <div className="report-text-block">
                    <p>Earnings statement (copied to clipboard — paste it to the barista):</p>
                    <textarea
                      readOnly
                      value={taxStatementText}
                      rows={Math.min(24, taxStatementText.split('\n').length)}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                )}

                <p className="tax-disclaimer">
                  All figures are gross amounts with no taxes withheld, taken straight from the saved
                  weekly tip reports. Totals are only as complete as the reports that were saved — check
                  the week coverage above before handing anything to an accountant.
                </p>
              </div>
            )}
          </div>

          <h3>Saved Reports</h3>
          {flaggedReports.length > 0 && (
            <p className="unmatched-warning">
              <strong>{flaggedReports.length} of {reports.length} saved reports don't balance.</strong>{' '}
              The tips paid out don't match the tips collected — these were almost certainly written
              before the tip split was fixed. Re-paste the card report for each flagged week and save to
              correct it; every total on this page uses whatever is stored.
            </p>
          )}
          {reports.length === 0 ? (
            <p>No reports yet. Calculate and save your first report!</p>
          ) : (
            <div className="reports-list">
              {reports.map(report => {
                const balance = getReportBalance(report)
                return (
                  <div
                    key={report.id}
                    className={`report-card${balance.needsRecalculation ? ' report-card-flagged' : ''}`}
                  >
                    <h4>Week of {report.weekStart}</h4>
                    <p>Tips Collected: {money(balance.collected)}</p>
                    <p>Tips Paid Out: {money(balance.distributed)}</p>
                    <p>Created: {new Date(report.createdAt?.toDate()).toLocaleDateString()}</p>
                    {balance.needsRecalculation && (
                      <p className="report-flag">
                        <strong>Needs recalculation</strong> — paid out{' '}
                        {balance.difference > 0 ? 'over' : 'under'} by{' '}
                        {money(Math.abs(balance.difference))}. Re-paste this week's card report on the
                        Tip Calculator and save; it overwrites this document in place.
                      </p>
                    )}
                    <button>View Details</button>
                    <button>Download PDF</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StaffTab
