// Run with:  node src/lib/masterSchedule.test.mjs
//
// Plain script like statement.test.mjs. Covers turning a week of master
// schedule docs into the tip calculator's shifts: weekday vs weekend hours,
// saved defaults, one-day overrides, staff-record names, and the issue list.

import { buildWeek } from './masterSchedule.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}
const hours = (shift) => (shift.end - shift.start) / (1000 * 60 * 60)

// Sun 18 Oct 2026 - Sat 24 Oct 2026. Fri 23 and Sat 24 have a shared shift.
const weekStart = new Date(2026, 9, 18)
const baristas = [
  { id: 'a', name: 'Ana Lopez', basePay: 20, active: true },
  { id: 'b', name: 'Ben', basePay: 0, active: true },
  { id: 'c', name: 'Cy', basePay: 20, active: false },
]
const shift = (date, shift, baristaId, baristaName) => ({ date, shift, baristaId, baristaName })

// Every shift filled by Ana, except a few cases below.
const assignments = []
for (let day = 18; day <= 24; day += 1) {
  const date = `2026-10-${day}`
  assignments.push(shift(date, 'opening', 'a', 'ana'))
  if (day !== 20) assignments.push(shift(date, 'closing', 'a', 'ana'))
}
assignments.push(shift('2026-10-23', 'shared', 'b', 'Ben'))
assignments.push(shift('2026-10-24', 'shared', 'z', 'Zed'))
// Sunday's shared goes to an inactive barista.
assignments.push(shift('2026-10-18', 'shared', 'c', 'Cy'))
// Thu: the opener leaves at noon and Ben covers 12-2.
assignments.push(shift('2026-10-22', 'middle', 'b', 'Ben'))

console.log('buildWeek')
const week = buildWeek({
  weekStart,
  assignments,
  savedHours: { weekday: { closing: { start: '15:00', end: '21:00' } } },
  overrides: { '2026-10-19_opening': { start: '07:00', end: '13:00' }, '2026-10-22_opening': { start: '08:00', end: '12:00' } },
  baristas,
})

eq('seven days', Object.keys(week.weekSchedule), [
  '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
])
const names = (date) => week.weekSchedule[date].map((s) => s.barista)
eq('uses the staff-record name, not the one saved on the shift', names('2026-10-21'), ['Ana Lopez', 'Ana Lopez'])
eq('Fri: opening, shared, closing', names('2026-10-23'), ['Ana Lopez', 'Ben', 'Ana Lopez'])
eq('unknown barista still keeps the shift name', names('2026-10-24').includes('Zed'), true)
eq('middle shift counted with its real hours', week.weekSchedule['2026-10-22'].map((s) => [s.barista, s.start.getHours(), s.end.getHours()]), [
  ['Ana Lopez', 8, 12], ['Ben', 12, 14], ['Ana Lopez', 15, 21],
])

const ana = week.weekShifts.filter((s) => s.barista === 'Ana Lopez')
eq('Ana works 13 shifts', ana.length, 13)
eq('an empty middle is not an open shift', week.issues.some((issue) => issue.includes('middle')), false)
eq('weekend opening is 9am - 2pm', hours(ana.find((s) => s.start.getDate() === 18 && s.start.getHours() === 9)), 5)
eq('one-day override wins', [ana.find((s) => s.start.getDate() === 19).start.getHours(), ana.find((s) => s.start.getDate() === 19).end.getHours()], [7, 13])
eq('saved weekday closing hours apply', hours(ana.find((s) => s.start.getDate() === 21 && s.start.getHours() === 15)), 6)
eq('weekend closing keeps the default', ana.some((s) => s.start.getDate() === 24 && s.start.getHours() === 14), true)

eq('issues', week.issues, [
  'Sun, Oct 18 shared: Cy is marked inactive',
  'Tue, Oct 20 closing: nobody on this shift',
  "Sat, Oct 24 shared: Zed isn't in Manage Baristas",
  'Ben has $0 base pay',
])
eq('preview marks changed hours', week.days[1].shifts.find((s) => s.shift === 'opening').custom, true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
