// Order-report math: compare what baristas counted/flagged against the
// admin's par levels and turn the shortfall into whole packs, grouped by
// source (HEB, Odeko, Medici, …).
// Pure functions — no React, no data layer — so order.test.mjs can run them.

export const STALE_HOURS = 72

const hoursSince = (iso, now) => (iso ? (now - new Date(iso).getTime()) / 3600000 : Infinity)

// "Out" always means zero, even if an older count said otherwise.
export const effectiveOnHand = (item) => (item.flag === 'out' ? 0 : item.onHand ?? null)

// Classify one item. Returns { status, ... } where status is one of:
//   'order'     — below par; packs/units say how much to buy
//   'on-order'  — already ordered, waiting on delivery
//   'check'     — needs a human: no count, a stale count, or flagged low while at par
//   'ok'        — at or above par
export const computeLine = (item, now = Date.now()) => {
  const onHand = effectiveOnHand(item)
  const par = Number(item.par) || 0
  const packSize = Math.max(1, Number(item.packSize) || 1)
  const ageHours = hoursSince(item.countedAt, now)
  const base = { item, onHand, par, packSize, ageHours }

  if (item.order) return { ...base, status: 'on-order' }

  if (onHand == null) {
    return { ...base, status: 'check', reason: item.flag === 'low' ? 'Flagged low but not counted' : 'Never counted' }
  }

  const shortfall = Math.max(0, par - onHand)
  if (shortfall > 0) {
    const packs = Math.ceil(shortfall / packSize)
    return { ...base, status: 'order', shortfall, packs, units: packs * packSize, stale: ageHours > STALE_HOURS }
  }

  if (item.flag === 'low') return { ...base, status: 'check', reason: 'Flagged low but count is at par — par too low?' }
  if (ageHours > STALE_HOURS) return { ...base, status: 'check', reason: `Count is ${Math.round(ageHours / 24)} days old` }
  return { ...base, status: 'ok' }
}

const byName = (left, right) => left.item.name.localeCompare(right.item.name)

export const NO_SOURCE = 'No source set'

// Lookup used by both the admin report and the barista page.
export const sourceNameOf = (item, sourcesById) => sourcesById.get(item.sourceId)?.name || NO_SOURCE

// Group anything with an `item` (or that is an item) by its source, in
// source-name order with unassigned items last.
export const groupBySource = (entries, sources, getItem = (entry) => entry) => {
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const groups = new Map()
  for (const entry of entries) {
    const source = sourcesById.get(getItem(entry).sourceId) || null
    const key = source?.id ?? ''
    if (!groups.has(key)) groups.set(key, { sourceId: source?.id ?? null, source: source?.name ?? NO_SOURCE, notes: source?.notes ?? '', entries: [] })
    groups.get(key).entries.push(entry)
  }
  return [...groups.values()].sort((left, right) => {
    if (!left.sourceId !== !right.sourceId) return left.sourceId ? -1 : 1
    return left.source.localeCompare(right.source)
  })
}

export const UNCATEGORIZED = 'Uncategorized'

export const sortCategories = (categories) => [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

export const categoryNameOf = (item, categoriesById) => categoriesById.get(item.categoryId)?.name || UNCATEGORIZED

// Group items by category in the admin's chosen order (sortOrder), with
// uncategorized items last.
export const groupByCategory = (items, categories) => {
  const groups = sortCategories(categories).map((category) => ({ categoryId: category.id, category: category.name, entries: [] }))
  const byId = new Map(groups.map((group) => [group.categoryId, group]))
  const loose = { categoryId: null, category: UNCATEGORIZED, entries: [] }
  for (const item of items) (byId.get(item.categoryId) || loose).entries.push(item)
  return [...groups, loose].filter((group) => group.entries.length > 0)
}

export const buildReport = (items, sources = [], now = Date.now()) => {
  const lines = items.filter((item) => item.active !== false).map((item) => computeLine(item, now))
  const toOrder = groupBySource(lines.filter((entry) => entry.status === 'order'), sources, (line) => line.item)

  return {
    toOrder: toOrder.map(({ entries, ...group }) => ({ ...group, lines: entries.sort(byName) })),
    onOrder: lines.filter((entry) => entry.status === 'on-order').sort(byName),
    needsCheck: lines.filter((entry) => entry.status === 'check').sort(byName),
    okCount: lines.filter((entry) => entry.status === 'ok').length,
  }
}

// "box" → "boxes", "5 lb bag" → "5 lb bags"; phrases like "sleeve of 50" are left alone.
export const plural = (count, word) => {
  if (count === 1 || !word || word.includes(' of ')) return word
  return /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`
}

// Shared by the per-source copy, the whole-list copy and the download, so
// every list reads the same. `packsOverride` holds any quantity the admin
// edited in the report; lines edited down to 0 are dropped.
const packsOf = (line, packsOverride) => packsOverride[line.item.id] ?? line.packs

const BOX = '☐'

// "7 gallons", but "4 × 5 lb bag" / "6 × sleeve of 50" for units that start
// with a number or already say what's inside, so they don't read as "4 5 lb bags".
const quantity = (count, unit) => (/^\d|\sof\s/.test(unit || '') ? `${count} × ${unit}` : `${count} ${plural(count, unit)}`)

// Always shows the short amount (par − on hand), then what to buy:
//   "Almond milk — need 10 cartons → buy 2 cases (12)"
//   "Whole milk — need 7 gallons → buy 7 gallons"
export const lineText = (line, packs) => {
  const { packLabel, unit, name } = line.item
  const need = `need ${quantity(line.shortfall, unit)}`
  const units = packs * line.packSize
  const buy = `buy ${packs} ${plural(packs, packLabel || unit)}${line.packSize > 1 ? ` (${units})` : ''}`
  return `${name} — ${need} → ${buy}`
}

const linesToBuy = (lines, packsOverride) =>
  lines.map((line) => [line, packsOf(line, packsOverride)]).filter(([, packs]) => packs > 0)

// Text checklist to paste into a message or save as a file. The person
// shopping swaps ☐ for ✅ as they go and sends it back.
export const shoppingListText = (
  report,
  { packsOverride = {}, requests = [], date = new Date(), title = 'BRB Coffee — Shopping list' } = {},
) => {
  const sections = report.toOrder
    .map((group) => ({ ...group, rows: linesToBuy(group.lines, packsOverride) }))
    .filter((group) => group.rows.length > 0)
  const itemCount = sections.reduce((sum, group) => sum + group.rows.length, 0)
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const fromSources = sections.length > 1 ? ` from ${sections.length} sources` : ''

  const out = [title, `${day} · ${itemCount} ${plural(itemCount, 'item')}${fromSources}`]
  if (sections.length === 0) out.push('', 'Nothing below par — nothing to buy.')
  for (const group of sections) {
    out.push('', `${group.source.toUpperCase()} (${group.rows.length})`)
    if (group.notes) out.push(group.notes)
    for (const [line, packs] of group.rows) out.push(`${BOX} ${lineText(line, packs)}`)
  }
  if (requests.length > 0) {
    out.push('', 'BARISTA REQUESTS (not on the list yet)')
    for (const request of requests) out.push(`${BOX} ${request.text}${request.requestedBy ? ` — ${request.requestedBy}` : ''}`)
  }
  if (itemCount + requests.length > 0) out.push('', `Change ${BOX} to ✅ as you get each one and send the list back.`)
  return `${out.join('\n')}\n`
}

// One source's section on its own — the per-card "Copy list" button.
export const sourceListText = (group, options = {}) =>
  shoppingListText({ toOrder: [group] }, { ...options, title: `BRB Coffee — ${group.source} order` })
