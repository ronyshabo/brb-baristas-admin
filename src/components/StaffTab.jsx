import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore'
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
  const [syncingBaristas, setSyncingBaristas] = useState(false)
  const [hasAutoSyncedMonth, setHasAutoSyncedMonth] = useState(false)
  const [squareData, setSquareData] = useState('')
  const [weekShifts, setWeekShifts] = useState([])
  const [reportText, setReportText] = useState('')
  const [copiedReport, setCopiedReport] = useState(false)

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
      // Primary match: transaction falls within an exact shift window
      let workingBaristas = [...new Set(
        weekShifts
          .filter(shift => tx.date >= shift.start && tx.date <= shift.end)
          .map(shift => shift.barista)
      )]

      // Fallback: if no exact shift match (e.g. transaction after closing time),
      // assign to whoever worked on that calendar date so post-closing tips aren't lost
      if (workingBaristas.length === 0) {
        const txDateKey = formatDateKey(tx.date)
        workingBaristas = [...new Set(
          weekShifts
            .filter(shift => formatDateKey(shift.start) === txDateKey)
            .map(shift => shift.barista)
        )]
      }

      if (workingBaristas.length === 0) {
        unmatchedTips += tx.tip
        unmatchedCount++
        return
      }

      const share = tx.tip / workingBaristas.length
      workingBaristas.forEach(name => {
        if (!baristaEarnings[name]) {
          baristaEarnings[name] = { tips: 0, hours: 0, shifts: 0, basePay: 0, total: 0, transactions: 0 }
        }
        baristaEarnings[name].tips += share
        baristaEarnings[name].transactions++
      })
    })

    // Calculate hours and shifts from calendar data
    Object.keys(baristaEarnings).forEach(name => {
      const shifts = weekShifts.filter(s => s.barista === name)
      const uniqueDays = new Set(shifts.map(s => formatDateKey(s.start)))
      baristaEarnings[name].shifts = uniqueDays.size
      baristaEarnings[name].hours = shifts.reduce((sum, s) => {
        return sum + (s.end - s.start) / (1000 * 60 * 60)
      }, 0)
      const baristaRecord = baristas.find(b => b.name === name)
      baristaEarnings[name].basePay = (baristaRecord?.basePay || 0) * baristaEarnings[name].shifts
      baristaEarnings[name].total = baristaEarnings[name].tips + baristaEarnings[name].basePay
    })

    const totalTips = transactions.reduce((sum, tx) => sum + tx.tip, 0)

    setCalculation({
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
      weekEnd: formatDateKey(new Date(parseDateInput(selectedWeek).getTime() + 6 * 24 * 60 * 60 * 1000)),
      earnings: baristaEarnings,
      totalTips: Object.values(dailyTips).reduce((sum, tip) => sum + tip, 0)
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
      if (calculation.unmatchedTips > 0) {
        lines.push(`*Unmatched Tips:* $${calculation.unmatchedTips.toFixed(2)} (${calculation.unmatchedCount} transactions outside any shift)`)
      }
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
                  <button onClick={() => setTipInputMethod('manual')} className={tipInputMethod === 'manual' ? 'active' : ''}>
                    Manual Entry
                  </button>
                  <button onClick={() => setTipInputMethod('bulk')} className={tipInputMethod === 'bulk' ? 'active' : ''}>
                    Bulk Paste
                  </button>
                  <button onClick={() => setTipInputMethod('byHour')} className={tipInputMethod === 'byHour' ? 'active' : ''}>
                    By-Hour Tip Out
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
                    <p className="by-hour-description">Paste your Square transaction report below. The data should include <strong>Date</strong> and <strong>Tip</strong> columns (tab or comma separated). Tips will be split equally among baristas working at the time of each transaction.</p>
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
                  <p><strong>Total Tips:</strong> ${calculation.totalTips.toFixed(2)}</p>
                  {calculation.isByHour && (
                    <>
                      <p><strong>Matched Transactions:</strong> {calculation.matchedTransactions} of {calculation.totalTransactions}</p>
                      {calculation.unmatchedTips > 0 && (
                        <p className="unmatched-warning"><strong>Unmatched Tips:</strong> ${calculation.unmatchedTips.toFixed(2)} ({calculation.unmatchedCount} transactions outside any shift)</p>
                      )}
                    </>
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
