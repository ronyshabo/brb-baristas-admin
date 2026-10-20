// Month heading with previous / next / today. `month` is a Date on the 1st.
export default function MonthNav({ month, onChange }) {
  const shift = (delta) => onChange(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  const today = new Date()
  const isCurrent = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()

  return (
    <div className="sched-month-nav">
      <button type="button" className="sched-nav-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
      <h2>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
      <button type="button" className="sched-nav-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
      {!isCurrent && (
        <button type="button" className="sched-link-btn" onClick={() => onChange(new Date(today.getFullYear(), today.getMonth(), 1))}>
          Today
        </button>
      )}
    </div>
  )
}
