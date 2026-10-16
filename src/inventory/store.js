// Inventory domain functions — the only thing the UI calls to read or write.
//
// They never read state themselves: callers pass in the item/list they're
// acting on (which they already have from a watch*). That keeps every write a
// single, predictable Firestore operation the security rules can check.
//
// Collections: inventorySources, inventoryCategories, inventoryItems,
// inventoryRequests. Field shapes are documented in the README.

import { add, batch, now, remove, update, watch } from './backend'

// ---- write-error reporting (barista page shows a banner) ----

const errorListeners = new Set()

export const watchWriteErrors = (callback) => {
  errorListeners.add(callback)
  return () => errorListeners.delete(callback)
}

// Failed writes are reported (console + listeners) and resolve to undefined,
// so click handlers don't each need a try/catch.
const report = (promise) =>
  promise.catch((error) => {
    console.error('Inventory write failed', error)
    errorListeners.forEach((listener) => listener(error))
    return undefined
  })

// ---- reads ----

export const watchSources = (callback, onError) => watch('inventorySources', callback, onError)
export const watchCategories = (callback, onError) => watch('inventoryCategories', callback, onError)
export const watchItems = (callback, onError) => watch('inventoryItems', callback, onError)
export const watchRequests = (callback, onError) => watch('inventoryRequests', callback, onError)

// ---- barista (no login) — the rules only allow these exact fields ----

const cleanName = (name) => (name || '').trim().slice(0, 40) || null

// A count above zero clears an "out" flag; a count of zero sets it, so the
// two never contradict each other.
export const saveCount = (item, onHand, countedBy) => {
  let flag = item.flag ?? null
  if (onHand === 0) flag = 'out'
  else if (flag === 'out') flag = null
  return report(update('inventoryItems', item.id, { onHand, flag, countedAt: now(), countedBy: cleanName(countedBy) }))
}

// Toggle Low / Out. Marking out also zeroes the count.
export const setFlag = (item, flag, countedBy) => {
  const by = cleanName(countedBy)
  const patch = { flag, flaggedAt: now(), flaggedBy: by }
  if (flag === 'out') Object.assign(patch, { onHand: 0, countedAt: now(), countedBy: by })
  return report(update('inventoryItems', item.id, patch))
}

export const addRequest = (text, requestedBy) =>
  report(add('inventoryRequests', { text: text.trim().slice(0, 300), requestedBy: cleanName(requestedBy), createdAt: now(), status: 'open' }))

// ---- admin: sources ----

export const addSource = (data) => report(add('inventorySources', { notes: '', ...data }))
export const updateSource = (sourceId, patch) => report(update('inventorySources', sourceId, patch))

// Deleting a source never deletes items — they become "No source set".
export const deleteSource = (sourceId, items) =>
  report(
    batch([
      { type: 'delete', collection: 'inventorySources', id: sourceId },
      ...items
        .filter((item) => item.sourceId === sourceId)
        .map((item) => ({ type: 'update', collection: 'inventoryItems', id: item.id, data: { sourceId: null } })),
    ]),
  )

// ---- admin: categories (sortOrder = the order baristas count in) ----

export const addCategory = (name, categories) =>
  report(add('inventoryCategories', { name, sortOrder: Math.max(0, ...categories.map((category) => category.sortOrder ?? 0)) + 1 }))

export const updateCategory = (categoryId, patch) => report(update('inventoryCategories', categoryId, patch))

// `categories` must already be sorted. Swaps with the neighbour above (-1) or below (+1).
export const moveCategory = (categories, categoryId, direction) => {
  const index = categories.findIndex((category) => category.id === categoryId)
  const current = categories[index]
  const neighbour = categories[index + direction]
  if (!current || !neighbour) return Promise.resolve()
  // Equal sortOrders (e.g. two added at once) would make a swap a no-op, so
  // fall back to list positions.
  const [mine, theirs] = current.sortOrder === neighbour.sortOrder
    ? [index + direction + 1, index + 1]
    : [neighbour.sortOrder, current.sortOrder]
  return report(
    batch([
      { type: 'update', collection: 'inventoryCategories', id: current.id, data: { sortOrder: mine } },
      { type: 'update', collection: 'inventoryCategories', id: neighbour.id, data: { sortOrder: theirs } },
    ]),
  )
}

// Deleting a category never deletes items — they become "Uncategorized".
export const deleteCategory = (categoryId, items) =>
  report(
    batch([
      { type: 'delete', collection: 'inventoryCategories', id: categoryId },
      ...items
        .filter((item) => item.categoryId === categoryId)
        .map((item) => ({ type: 'update', collection: 'inventoryItems', id: item.id, data: { categoryId: null } })),
    ]),
  )

// ---- admin: catalog ----

export const addItem = (data) =>
  report(
    add('inventoryItems', {
      onHand: null,
      flag: null,
      order: null,
      active: true,
      sourceId: null,
      categoryId: null,
      countedAt: null,
      countedBy: null,
      ...data,
    }),
  )
export const updateItem = (itemId, patch) => report(update('inventoryItems', itemId, patch))
export const deleteItem = (itemId) => report(remove('inventoryItems', itemId))

// First-run helper: an empty catalog gets the usual sources and categories.
export const STARTER_SOURCES = [
  ['HEB', 'Grocery run.'],
  ['Odeko', ''],
  ['Medici', 'Coffee beans.'],
  ['Other', 'Amazon, restaurant supply, one-offs.'],
]
export const STARTER_CATEGORIES = ['Coffee', 'Milk', 'Syrups & Tea', 'Cups & Paper', 'Cleaning']

export const addStarterCatalog = () =>
  report(
    batch([
      ...STARTER_SOURCES.map(([name, notes]) => ({ type: 'set', collection: 'inventorySources', data: { name, notes } })),
      ...STARTER_CATEGORIES.map((name, index) => ({ type: 'set', collection: 'inventoryCategories', data: { name, sortOrder: index + 1 } })),
    ]),
  )

// ---- admin: ordering ----

export const markOrdered = (itemId, packs, units) =>
  report(update('inventoryItems', itemId, { order: { packs, units, orderedAt: now() } }))

export const cancelOrder = (itemId) => report(update('inventoryItems', itemId, { order: null }))

// Receiving adds the ordered units to the last count and clears flags.
export const markReceived = (item) => {
  if (!item.order) return Promise.resolve()
  return report(
    update('inventoryItems', item.id, {
      onHand: (item.onHand ?? 0) + item.order.units,
      flag: null,
      order: null,
      countedAt: now(),
      countedBy: 'Delivery received',
    }),
  )
}

export const setRequestStatus = (requestId, status) =>
  report(update('inventoryRequests', requestId, { status, resolvedAt: now() }))
