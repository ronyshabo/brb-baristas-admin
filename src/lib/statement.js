/*
 * Pure earnings-statement maths, kept out of the component so it can be tested.
 *
 * Baristas are 1099 contractors — StaffTab already works to the 1099-NEC
 * threshold — so nothing is withheld. Tax here is a set-aside estimate.
 *
 * A statement is defined by a plain date range. There is deliberately no
 * "which date does this week belong to" setting: a saved report carries a real
 * span (weekStart..weekEnd), so a week is simply in or out depending on whether
 * it OVERLAPS the range. Weeks are counted whole, because the saved earnings are
 * weekly totals with no per-day breakdown to split.
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

const shift = (key, days) => {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toKey(date)
}

/** Weeks here start Sunday, matching getSundayOfWeek in StaffTab. */
export function sundayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

/** A report's inclusive span. weekEnd is saved as weekStart + 6; derive it if absent. */
export function spanOf(report) {
  const start = report.weekStart || report.weekEnd || ''
  if (!start) return null
  const end = report.weekEnd || shift(start, 6)
  return { start, end }
}

/** Quick-fill ranges. `today` is injectable for tests. */
export function rangeFor(preset, today = new Date()) {
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)

  switch (preset) {
    case 'thisWeek':
    case 'lastWeek': {
      const from = sundayOf(base)
      if (preset === 'lastWeek') from.setDate(from.getDate() - 7)
      const to = new Date(from)
      to.setDate(to.getDate() + 6)
      return { from: toKey(from), to: toKey(to) }
    }
    case 'thisMonth':
      return {
        from: toKey(new Date(base.getFullYear(), base.getMonth(), 1)),
        to: toKey(new Date(base.getFullYear(), base.getMonth() + 1, 0)),
      }
    case 'lastMonth':
      return {
        from: toKey(new Date(base.getFullYear(), base.getMonth() - 1, 1)),
        to: toKey(new Date(base.getFullYear(), base.getMonth(), 0)),
      }
    case 'thisYear':
      return { from: `${base.getFullYear()}-01-01`, to: `${base.getFullYear()}-12-31` }
    case 'ever':
    default:
      return { from: '', to: '' }
  }
}

export function rangeLabel({ from, to }) {
  if (!from && !to) return 'All time'
  if (from && !to) return `${from} onwards`
  if (!from && to) return `up to ${to}`
  return `${from} to ${to}`
}

/** Every name that appears in the roster or in any saved report. */
export function namesFrom(baristas = [], reports = []) {
  const set = new Set(baristas.map((b) => b.name).filter(Boolean))
  reports.forEach((r) => Object.keys(r.earnings || {}).forEach((n) => set.add(n)))
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Does a report's week overlap the range? Empty bounds are open-ended. */
export function overlaps(report, { from, to }) {
  const span = spanOf(report)
  if (!span) return false
  if (from && span.end < from) return false
  if (to && span.start > to) return false
  return true
}

export function computeStatement({
  reports = [],
  name,
  range = { from: '', to: '' },
  includeSE = true,
  incomeRate = DEFAULT_INCOME_TAX_RATE,
  year = String(new Date().getFullYear()),
}) {
  if (!name) return null

  const weeks = reports
    .filter((r) => (r.earnings || {})[name] && overlaps(r, range))
    .sort((a, b) => (spanOf(a)?.start || '').localeCompare(spanOf(b)?.start || ''))

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

  // The 1099 threshold is a calendar-year question, so it ignores the range. A
  // week counts toward the year it FINISHED in, so each week lands in exactly
  // one year rather than being counted twice across New Year.
  const ytd = reports
    .filter((r) => {
      const span = spanOf(r)
      return span && span.end.slice(0, 4) === year && (r.earnings || {})[name]
    })
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
