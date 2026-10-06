// Run with:  node src/lib/statement.test.mjs
//
// No test runner is configured here, so this is a plain script that exits
// non-zero on failure. Covers range overlap (including weeks that straddle a
// month or a year), the quick-fill ranges, the tax maths, and the 1099 year.

import {
  rangeFor, rangeLabel, computeStatement, namesFrom, overlaps, spanOf,
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

console.log('\nquick-fill ranges')
eq('thisWeek is Sun-Sat', rangeFor('thisWeek', today), { from: '2026-10-04', to: '2026-10-10' })
eq('lastWeek', rangeFor('lastWeek', today), { from: '2026-09-27', to: '2026-10-03' })
eq('thisMonth', rangeFor('thisMonth', today), { from: '2026-10-01', to: '2026-10-31' })
eq('lastMonth', rangeFor('lastMonth', today), { from: '2026-09-01', to: '2026-09-30' })
eq('Feb ends on the 28th', rangeFor('lastMonth', new Date(2026, 2, 6)).to, '2026-02-28')
eq('thisYear', rangeFor('thisYear', today), { from: '2026-01-01', to: '2026-12-31' })
eq('ever is open-ended', rangeFor('ever', today), { from: '', to: '' })
eq('label for open range', rangeLabel({ from: '', to: '' }), 'All time')
eq('label for half-open', rangeLabel({ from: '2026-01-01', to: '' }), '2026-01-01 onwards')

console.log('\nspans')
eq('weekEnd derived when missing', spanOf({ weekStart: '2026-09-27' }), { start: '2026-09-27', end: '2026-10-03' })
eq('weekEnd used when present', spanOf({ weekStart: '2026-09-27', weekEnd: '2026-10-03' }).end, '2026-10-03')
eq('no dates at all', spanOf({}), null)

console.log('\noverlap — the straddling week is the whole point')
const straddler = { weekStart: '2026-09-27', weekEnd: '2026-10-03' }
eq('in September', overlaps(straddler, { from: '2026-09-01', to: '2026-09-30' }), true)
eq('in October too', overlaps(straddler, { from: '2026-10-01', to: '2026-10-31' }), true)
eq('not in August', overlaps(straddler, { from: '2026-08-01', to: '2026-08-31' }), false)
eq('not in November', overlaps(straddler, { from: '2026-11-01', to: '2026-11-30' }), false)
eq('touching the first day counts', overlaps(straddler, { from: '2026-10-03', to: '2026-10-03' }), true)
eq('touching the last day counts', overlaps(straddler, { from: '2026-09-27', to: '2026-09-27' }), true)
eq('day before does not', overlaps(straddler, { from: '2026-09-26', to: '2026-09-26' }), false)
eq('open range catches everything', overlaps(straddler, { from: '', to: '' }), true)

console.log('\naggregation')
const reports = [
  { id: 'w1', weekStart: '2026-09-27', weekEnd: '2026-10-03', earnings: { Philip: { basePay: 100, tips: 50, hours: 12, shifts: 2 }, Ayah: { basePay: 60, tips: 20, hours: 6, shifts: 1 } } },
  { id: 'w2', weekStart: '2026-10-04', weekEnd: '2026-10-10', earnings: { Philip: { basePay: 200, tips: 80, hours: 24, shifts: 4 } } },
  { id: 'w3', weekStart: '2026-08-02', weekEnd: '2026-08-08', earnings: { Philip: { basePay: 300, tips: 120, hours: 30, shifts: 5 } } },
  { id: 'w4', weekStart: '2025-12-28', weekEnd: '2026-01-03', earnings: { Philip: { basePay: 400, tips: 10, hours: 8, shifts: 1 } } },
]

eq('names union roster + reports', namesFrom([{ name: 'Gregory' }], reports), ['Ayah', 'Gregory', 'Philip'])

const ever = computeStatement({ reports, name: 'Philip', range: rangeFor('ever', today), year: '2026' })
eq('ever picks up all 4 weeks', ever.weeks.length, 4)
near('ever gross', ever.gross, 1260)
eq('weeks come back in date order', ever.weeks.map((w) => w.id), ['w4', 'w3', 'w1', 'w2'])

// This is the bug that started the rework: the last week of September.
const sept = computeStatement({ reports, name: 'Philip', range: rangeFor('lastMonth', today), year: '2026' })
eq('September range includes the straddling week', sept.weeks.map((w) => w.id), ['w1'])
near('September gross', sept.gross, 150)

const oct = computeStatement({ reports, name: 'Philip', range: rangeFor('thisMonth', today), year: '2026' })
eq('October includes both the straddler and the full week', oct.weeks.map((w) => w.id), ['w1', 'w2'])
near('October gross counts whole weeks', oct.gross, 430)

console.log('\ntax')
const t = computeStatement({ reports, name: 'Philip', range: { from: '2026-10-04', to: '2026-10-10' }, year: '2026' })
near('gross 280', t.gross, 280)
near('SE tax = 280 * .9235 * .153', t.seTax, 39.56)
near('income tax at 10%', t.incomeTax, 28)
near('set aside', t.taxSetAside, 67.56)
near('left after set-aside', t.netAfterSetAside, 212.44)
near('all taxes off', computeStatement({ reports, name: 'Philip', range: { from: '', to: '' }, includeSE: false, incomeRate: 0, year: '2026' }).taxSetAside, 0)

console.log('\n1099 year — a week counts in the year it finished')
near('2026 YTD excludes nothing: w4 ended 2026-01-03', ever.ytd, 1260)
eq('over $600', ever.needs1099, true)
const in2025 = computeStatement({ reports, name: 'Philip', range: { from: '', to: '' }, year: '2025' })
near('2025 YTD is zero — w4 finished in 2026', in2025.ytd, 0)
const ayah = computeStatement({ reports, name: 'Ayah', range: { from: '', to: '' }, year: '2026' })
near('Ayah YTD', ayah.ytd, 80)
eq('Ayah under threshold', ayah.needs1099, false)

console.log('\nedge cases')
eq('unknown barista', computeStatement({ reports, name: 'Nobody', range: { from: '', to: '' }, year: '2026' }).weeks.length, 0)
eq('no name selected', computeStatement({ reports, name: '', range: { from: '', to: '' } }), null)
near('missing fields treated as zero', computeStatement({ reports: [{ weekStart: '2026-10-04', earnings: { Philip: {} } }], name: 'Philip', range: { from: '', to: '' }, year: '2026' }).gross, 0)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
