// Run with:  node src/lib/statement.test.mjs
//
// No test runner is configured in this project, so this is a plain script that
// exits non-zero on failure. Covers the window arithmetic (month ends, Sunday
// week starts), the weekStart/weekEnd attribution of weeks that straddle a
// month, the tax maths, and the calendar-year 1099 threshold.
import {
  windowFor, computeStatement, namesFrom,
} from './statement.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}
const near = (label, got, want) => eq(label, Math.round(got * 100) / 100, want)

// Tue 6 Oct 2026. The Sunday of that week is 4 Oct.
const today = new Date(2026, 9, 6)

console.log('\nwindows')
eq('thisWeek starts Sunday', windowFor('thisWeek', {}, today).from, '2026-10-04')
eq('thisWeek ends Saturday', windowFor('thisWeek', {}, today).to, '2026-10-10')
eq('lastWeek', [windowFor('lastWeek', {}, today).from, windowFor('lastWeek', {}, today).to], ['2026-09-27', '2026-10-03'])
eq('thisMonth', [windowFor('thisMonth', {}, today).from, windowFor('thisMonth', {}, today).to], ['2026-10-01', '2026-10-31'])
eq('lastMonth spans Sep 30', [windowFor('lastMonth', {}, today).from, windowFor('lastMonth', {}, today).to], ['2026-09-01', '2026-09-30'])
eq('ever is unbounded', windowFor('ever', {}, today).from, '0000-01-01')
eq('custom passes through', windowFor('custom', { from: '2026-01-01', to: '2026-03-31' }, today).to, '2026-03-31')

// Feb lastMonth from 6 Mar 2026 — month-end arithmetic, not 30 days
eq('Feb 2026 ends on the 28th', windowFor('lastMonth', {}, new Date(2026, 2, 6)).to, '2026-02-28')

console.log('\nreports fixture')
const reports = [
  { id: 'w1', weekStart: '2026-09-27', weekEnd: '2026-10-03', earnings: { Rony: { basePay: 100, tips: 50, hours: 12, shifts: 2 }, Ayah: { basePay: 60, tips: 20, hours: 6, shifts: 1 } } },
  { id: 'w2', weekStart: '2026-10-04', weekEnd: '2026-10-10', earnings: { Rony: { basePay: 200, tips: 80, hours: 24, shifts: 4 } } },
  { id: 'w3', weekStart: '2026-08-02', weekEnd: '2026-08-08', earnings: { Rony: { basePay: 300, tips: 120, hours: 30, shifts: 5 } } },
  { id: 'w4', weekStart: '2025-12-28', weekEnd: '2026-01-03', earnings: { Rony: { basePay: 400, tips: 10, hours: 8, shifts: 1 } } },
]

eq('names union roster + reports', namesFrom([{ name: 'Gregory' }], reports), ['Ayah', 'Gregory', 'Rony'])

console.log('\naggregation')
const ever = computeStatement({ reports, name: 'Rony', window: windowFor('ever', {}, today), year: '2026' })
eq('ever picks up all 4 weeks', ever.weeks.length, 4)
near('ever base pay', ever.totals.basePay, 1000)
near('ever tips', ever.totals.tips, 260)
near('ever gross', ever.gross, 1260)

const thisMonth = computeStatement({ reports, name: 'Rony', window: windowFor('thisMonth', {}, today), year: '2026' })
eq('October by weekStart = 1 week', thisMonth.weeks.length, 1)
near('October gross', thisMonth.gross, 280)

const thisMonthByEnd = computeStatement({ reports, name: 'Rony', window: windowFor('thisMonth', {}, today), basis: 'weekEnd', year: '2026' })
eq('October by weekEnd pulls in the straddling week', thisMonthByEnd.weeks.length, 2)
near('October gross by weekEnd', thisMonthByEnd.gross, 430)

console.log('\ntax')
const t = computeStatement({ reports, name: 'Rony', window: windowFor('custom', { from: '2026-10-04', to: '2026-10-10' }, today), year: '2026' })
near('gross 280', t.gross, 280)
near('SE tax = 280 * .9235 * .153', t.seTax, 39.56)
near('income tax at 10%', t.incomeTax, 28)
near('set aside', t.taxSetAside, 67.56)
near('left after set-aside', t.netAfterSetAside, 212.44)

const noSE = computeStatement({ reports, name: 'Rony', window: windowFor('custom', { from: '2026-10-04', to: '2026-10-10' }, today), includeSE: false, incomeRate: 0, year: '2026' })
near('all taxes off', noSE.taxSetAside, 0)

console.log('\n1099 threshold (calendar year, ignores the window)')
eq('Rony 2026 is over $600', ever.needs1099, true)
near('Rony YTD 2026 excludes the 2025-dated week', ever.ytd, 850)
const ayah = computeStatement({ reports, name: 'Ayah', window: windowFor('ever', {}, today), year: '2026' })
near('Ayah YTD', ayah.ytd, 80)
eq('Ayah under threshold', ayah.needs1099, false)

console.log('\nedge cases')
eq('unknown barista', computeStatement({ reports, name: 'Nobody', window: windowFor('ever', {}, today), year: '2026' }).weeks.length, 0)
eq('no name selected', computeStatement({ reports, name: '', window: windowFor('ever', {}, today) }), null)
const missing = computeStatement({ reports: [{ weekStart: '2026-10-04', earnings: { Rony: {} } }], name: 'Rony', window: windowFor('ever', {}, today), year: '2026' })
near('missing fields treated as zero', missing.gross, 0)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
