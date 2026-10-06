/*
 * Pure earnings-statement maths, kept out of the component so it can be tested.
 *
 * Baristas are 1099 contractors — StaffTab already works to the 1099-NEC
 * threshold — so nothing is withheld. Tax here is a set-aside estimate.
 */

// Self-employment tax: 15.3% (12.4% Social Security + 2.9% Medicare) charged on
// 92.35% of net earnings. A contractor owes both halves.
export const SE_RATE = 0.153
export const SE_TAXABLE_PORTION = 0.9235

// Federal income tax cannot be derived from this data — it depends on their other
// income, filing status and deductions. A starting point the admin can change.
export const DEFAULT_INCOME_TAX_RATE = 10

// Texas has no state income tax, so there is no state line to estimate.
export const TAX_1099_THRESHOLD = 600

const pad = (n) => String(n).padStart(2, '0')
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Weeks here start Sunday, matching getSundayOfWeek in StaffTab. */
export function sundayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

/** Inclusive [from, to] date-key window for a preset. `today` is injectable for tests. */
export function windowFor(preset, custom = {}, today = new Date()) {
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)
  const monthLabel = (d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  switch (preset) {
    case 'thisWeek':
    case 'lastWeek': {
      const from = sundayOf(base)
      if (preset === 'lastWeek') from.setDate(from.getDate() - 7)
      const to = new Date(from)
      to.setDate(to.getDate() + 6)
      return { from: toKey(from), to: toKey(to), label: `Week of ${toKey(from)}` }
    }
    case 'thisMonth': {
      const from = new Date(base.getFullYear(), base.getMonth(), 1)
      const to = new Date(base.getFullYear(), base.getMonth() + 1, 0)
      return { from: toKey(from), to: toKey(to), label: monthLabel(from) }
    }
    case 'lastMonth': {
      const from = new Date(base.getFullYear(), base.getMonth() - 1, 1)
      const to = new Date(base.getFullYear(), base.getMonth(), 0)
      return { from: toKey(from), to: toKey(to), label: monthLabel(from) }
    }
    case 'custom':
      return {
        from: custom.from || '0000-01-01',
        to: custom.to || '9999-12-31',
        label: custom.from && custom.to ? `${custom.from} to ${custom.to}` : 'Custom range',
      }
    case 'ever':
    default:
      return { from: '0000-01-01', to: '9999-12-31', label: 'All time' }
  }
}

/** Which date a weekly report is filed under. */
export const periodKey = (report, basis = 'weekStart') =>
  (basis === 'weekEnd' ? report.weekEnd || report.weekStart : report.weekStart || report.weekEnd) || ''

/** Every name that appears in the roster or in any saved report. */
export function namesFrom(baristas = [], reports = []) {
  const set = new Set(baristas.map((b) => b.name).filter(Boolean))
  reports.forEach((r) => Object.keys(r.earnings || {}).forEach((n) => set.add(n)))
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function computeStatement({
  reports = [],
  name,
  window: win,
  basis = 'weekStart',
  includeSE = true,
  incomeRate = DEFAULT_INCOME_TAX_RATE,
  year = String(new Date().getFullYear()),
}) {
  if (!name) return null

  const weeks = reports
    .filter((r) => {
      const key = periodKey(r, basis)
      return key && key >= win.from && key <= win.to && (r.earnings || {})[name]
    })
    .sort((a, b) => periodKey(a, basis).localeCompare(periodKey(b, basis)))

  const totals = weeks.reduce(
    (acc, r) => {
      const e = r.earnings[name]
      acc.basePay += Number(e.basePay) || 0
      acc.tips += Number(e.tips) || 0
      acc.hours += Number(e.hours) || 0
      acc.shifts += Number(e.shifts) || 0
      return acc
    },
    { basePay: 0, tips: 0, hours: 0, shifts: 0 }
  )

  const gross = totals.basePay + totals.tips
  const seTax = includeSE ? gross * SE_TAXABLE_PORTION * SE_RATE : 0
  const incomeTax = gross * ((Number(incomeRate) || 0) / 100)
  const taxSetAside = seTax + incomeTax

  // The 1099 threshold is a calendar-year question, so it ignores the window.
  const ytd = reports
    .filter((r) => periodKey(r, basis).slice(0, 4) === year && (r.earnings || {})[name])
    .reduce((sum, r) => {
      const e = r.earnings[name]
      return sum + (Number(e.basePay) || 0) + (Number(e.tips) || 0)
    }, 0)

  return {
    weeks, totals, gross, seTax, incomeTax, taxSetAside,
    netAfterSetAside: gross - taxSetAside,
    ytd, year, needs1099: ytd >= TAX_1099_THRESHOLD,
  }
}
