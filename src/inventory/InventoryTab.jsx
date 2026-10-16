// Admin inventory tab — rendered by brb-baristas' Dashboard. This whole
// src/inventory/ folder is shared: brb-inventory is the source of truth and
// brb-baristas holds a copy (see README "Updating the admin tab").
// All styles are scoped under .inv-admin.

import { useEffect, useMemo, useState } from 'react'
import {
  addCategory,
  addStarterCatalog,
  addItem,
  addSource,
  cancelOrder,
  deleteCategory,
  deleteItem,
  deleteSource,
  markOrdered,
  markReceived,
  moveCategory,
  setRequestStatus,
  updateCategory,
  updateItem,
  updateSource,
  watchCategories,
  watchItems,
  watchRequests,
  STARTER_CATEGORIES,
  STARTER_SOURCES,
  watchSources,
} from './store'
import { buildReport, NO_SOURCE, plural, shoppingListText, sortCategories, sourceListText, sourceNameOf, UNCATEGORIZED } from './order'
import { timeAgo } from './time'
import './InventoryTab.css'

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('Copy this order list:', text)
    return false
  }
}

// Copies whatever `getText` returns, with a brief "Copied ✓".
function CopyButton({ getText, label = 'Copy list', ...props }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(getText())) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return <button type="button" onClick={copy} {...props}>{copied ? 'Copied ✓' : label}</button>
}

const downloadText = (filename, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const localDateStamp = (date = new Date()) =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')

// ---------------- Order report ----------------

// `packs` holds quantities the admin edited; it lives in OrderReport so the
// shopping-list download uses the same numbers as the cards.
function SourceCard({ source, notes, lines, packs, setPack }) {
  const packsFor = (line) => packs[line.item.id] ?? line.packs

  const order = (line) => {
    const count = packsFor(line)
    if (count > 0) markOrdered(line.item.id, count, count * line.packSize)
  }


  return (
    <section className="inv-admin-card">
      <header className="inv-admin-card-head">
        <div>
          <h3>{source}</h3>
          {notes && <p className="inv-admin-sub inv-admin-notes">{notes}</p>}
        </div>
        <div className="inv-admin-actions">
          <CopyButton getText={() => sourceListText({ source, notes, lines }, { packsOverride: packs })} />
          <button type="button" className="primary" onClick={() => lines.forEach(order)}>Mark all ordered</button>
        </div>
      </header>
      <div className="inv-admin-table-wrap">
        <table className="inv-admin-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">On hand</th>
              <th className="num">Par</th>
              <th className="num" title="Par minus on hand">Need</th>
              <th>Order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const count = packsFor(line)
              const { item } = line
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <div className="inv-admin-sub">
                      {item.flag === 'out' && <span className="inv-admin-tag out">Out</span>}
                      {item.flag === 'low' && <span className="inv-admin-tag low">Low</span>}
                      {line.stale && <span className="inv-admin-tag stale">Old count</span>}
                      counted {timeAgo(item.countedAt)}{item.countedBy ? ` by ${item.countedBy}` : ''}
                    </div>
                  </td>
                  <td className="num">{line.onHand} <span className="inv-admin-unit">{item.unit}</span></td>
                  <td className="num">{line.par}</td>
                  <td className="num">{line.shortfall}</td>
                  <td>
                    <input
                      className="inv-admin-packs"
                      type="number"
                      min="0"
                      value={count}
                      onChange={(event) => setPack(item.id, Math.max(0, Number(event.target.value) || 0))}
                      aria-label={`${item.name} packs to order`}
                    />
                    {plural(count, item.packLabel || item.unit)}
                    {line.packSize > 1 && <div className="inv-admin-sub">= {count * line.packSize} {plural(count * line.packSize, item.unit)}</div>}
                  </td>
                  <td>
                    <button type="button" onClick={() => order(line)} disabled={count === 0}>Ordered</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function OrderReport({ items, sources, openRequests, goToRequests }) {
  const report = useMemo(() => buildReport(items, sources), [items, sources])
  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const lineCount = report.toOrder.reduce((sum, group) => sum + group.lines.length, 0)
  const [packs, setPacks] = useState({})
  const setPack = (itemId, count) => setPacks((current) => ({ ...current, [itemId]: count }))

  const listText = () => shoppingListText(report, { packsOverride: packs, requests: openRequests })
  const downloadList = () => downloadText(`brb-shopping-list-${localDateStamp()}.txt`, listText())
  const nothingToList = lineCount === 0 && openRequests.length === 0

  return (
    <>
      <div className="inv-admin-stats">
        <div><strong>{lineCount}</strong> to order</div>
        <div><strong>{report.toOrder.length}</strong> {plural(report.toOrder.length, 'source')}</div>
        <div><strong>{report.onOrder.length}</strong> on order</div>
        <div><strong>{report.needsCheck.length}</strong> need a look</div>
        <div><strong>{report.okCount}</strong> at par</div>
        <span className="inv-admin-stats-actions">
          <CopyButton getText={listText} label="Copy shopping list" disabled={nothingToList} />
          <button type="button" className="primary" onClick={downloadList} disabled={nothingToList}>
            ⬇ Download shopping list
          </button>
        </span>
      </div>

      {openRequests.length > 0 && (
        <button type="button" className="inv-admin-banner" onClick={goToRequests}>
          {openRequests.length} open barista {plural(openRequests.length, 'request')} — review →
        </button>
      )}

      {report.toOrder.length === 0 && <p className="inv-admin-empty">Nothing below par. Nothing to order.</p>}
      {report.toOrder.map((group) => (
        <SourceCard
          key={group.sourceId ?? 'none'}
          source={group.source}
          notes={group.notes}
          lines={group.lines}
          packs={packs}
          setPack={setPack}
        />
      ))}

      {report.onOrder.length > 0 && (
        <section className="inv-admin-card">
          <header className="inv-admin-card-head"><h3>On order</h3></header>
          <ul className="inv-admin-list">
            {report.onOrder.map(({ item }) => (
              <li key={item.id}>
                <span>
                  <strong>{item.name}</strong> — {item.order.packs} {plural(item.order.packs, item.packLabel || item.unit)}
                  <span className="inv-admin-sub"> · {sourceNameOf(item, sourcesById)} · ordered {timeAgo(item.order.orderedAt)}</span>
                </span>
                <span className="inv-admin-actions">
                  <button type="button" className="primary" onClick={() => markReceived(item)}>Received</button>
                  <button type="button" onClick={() => cancelOrder(item.id)}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.needsCheck.length > 0 && (
        <section className="inv-admin-card">
          <header className="inv-admin-card-head"><h3>Needs a look</h3></header>
          <ul className="inv-admin-list">
            {report.needsCheck.map((line) => (
              <li key={line.item.id}>
                <span>
                  <strong>{line.item.name}</strong>
                  <span className="inv-admin-sub"> · {line.reason} · on hand {line.onHand ?? '—'} / par {line.par}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

// ---------------- Items & par levels ----------------

const EMPTY_ITEM = { name: '', categoryId: '', unit: '', sourceId: '', par: '', packSize: '', packLabel: '' }
const ALL = 'all'
const NONE = 'none'

// Category dropdown with a "+ New category…" option that turns into an inline
// input, so a new category can be made without leaving the item form.
const NEW_CATEGORY = '__new__'

function CategoryPicker({ categories, value, onChange, label }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const cancel = () => {
    setAdding(false)
    setName('')
  }

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return cancel()
    // Reuse an existing category rather than creating "milk" next to "Milk".
    const existing = categories.find((category) => category.name.toLowerCase() === trimmed.toLowerCase())
    const id = existing ? existing.id : await addCategory(trimmed, categories)
    if (id) onChange(id)
    cancel()
  }

  if (adding) {
    return (
      <span className="inv-admin-category-new">
        <input
          autoFocus
          value={name}
          placeholder="New category name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              create()
            }
            if (event.key === 'Escape') cancel()
          }}
          aria-label="New category name"
        />
        <button type="button" className="primary" onClick={create} aria-label="Add category">✓</button>
        <button type="button" onClick={cancel} aria-label="Cancel new category">✕</button>
      </span>
    )
  }

  return (
    <select
      value={categories.some((category) => category.id === value) ? value : ''}
      onChange={(event) => (event.target.value === NEW_CATEGORY ? setAdding(true) : onChange(event.target.value || null))}
      aria-label={label}
    >
      <option value="">— {UNCATEGORIZED} —</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      <option value={NEW_CATEGORY}>+ New category…</option>
    </select>
  )
}

function SourceSelect({ sources, value, onChange, label, placeholder = `— ${NO_SOURCE} —` }) {
  return (
    <select value={value || ''} onChange={(event) => onChange(event.target.value || null)} aria-label={label}>
      <option value="">{placeholder}</option>
      {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
    </select>
  )
}
const NUMERIC_FIELDS = new Set(['par', 'packSize'])

function ItemCell({ item, field, type = 'text', list }) {
  const [value, setValue] = useState(item[field] ?? '')
  useEffect(() => setValue(item[field] ?? ''), [item[field]])

  const save = () => {
    const next = NUMERIC_FIELDS.has(field) ? Math.max(field === 'packSize' ? 1 : 0, Number(value) || 0) : String(value).trim()
    if (next !== item[field]) updateItem(item.id, { [field]: next })
  }

  return (
    <input
      type={type}
      min={type === 'number' ? 0 : undefined}
      value={value}
      list={list}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      aria-label={`${item.name} ${field}`}
    />
  )
}

function ItemsEditor({ items, sources, categories, initialFilter, prefillName, clearPrefill }) {
  const [draft, setDraft] = useState({ ...EMPTY_ITEM, sourceId: initialFilter || '' })
  const [filter, setFilter] = useState(initialFilter || ALL)
  const categoryRank = new Map(categories.map((category, index) => [category.id, index]))
  const rankOf = (item) => categoryRank.get(item.categoryId) ?? categories.length
  const knownSourceIds = new Set(sources.map((source) => source.id))
  const shown = items.filter((item) => {
    if (filter === ALL) return true
    if (filter === NONE) return !knownSourceIds.has(item.sourceId)
    return item.sourceId === filter
  })
  const sorted = shown.sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name))
  const countFor = (sourceId) => items.filter((item) => item.sourceId === sourceId).length
  const unassignedCount = items.filter((item) => !knownSourceIds.has(item.sourceId)).length

  // Filtering to one source makes it the default for new items — "add each item under the source".
  const changeFilter = (value) => {
    setFilter(value)
    setDraft((current) => ({ ...current, sourceId: value === ALL || value === NONE ? current.sourceId : value }))
  }

  useEffect(() => {
    if (prefillName) {
      setDraft((current) => ({ ...EMPTY_ITEM, sourceId: current.sourceId, categoryId: current.categoryId, name: prefillName }))
      clearPrefill()
    }
  }, [prefillName, clearPrefill])

  const submit = (event) => {
    event.preventDefault()
    if (!draft.name.trim()) return
    addItem({
      ...draft,
      name: draft.name.trim(),
      par: Number(draft.par) || 0,
      packSize: Math.max(1, Number(draft.packSize) || 1),
      sourceId: draft.sourceId || null,
      categoryId: draft.categoryId || null,
      packLabel: draft.packLabel.trim() || draft.unit.trim(),
    })
    // Keep source and category so several items can be added to the same place in a row.
    setDraft({ ...EMPTY_ITEM, sourceId: draft.sourceId, categoryId: draft.categoryId })
  }

  const field = (key, placeholder, extra = {}) => (
    <input value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} {...extra} />
  )

  return (
    <>
      <nav className="inv-admin-source-filter" aria-label="Filter items by source">
        <button type="button" className={filter === ALL ? 'active' : ''} onClick={() => changeFilter(ALL)}>
          All <span>{items.length}</span>
        </button>
        {sources.map((source) => (
          <button key={source.id} type="button" className={filter === source.id ? 'active' : ''} onClick={() => changeFilter(source.id)}>
            {source.name} <span>{countFor(source.id)}</span>
          </button>
        ))}
        {unassignedCount > 0 && (
          <button type="button" className={filter === NONE ? 'active' : ''} onClick={() => changeFilter(NONE)}>
            {NO_SOURCE} <span>{unassignedCount}</span>
          </button>
        )}
      </nav>

      <form className="inv-admin-card inv-admin-add" onSubmit={submit}>
        <h3>Add item{draft.sourceId && knownSourceIds.has(draft.sourceId) ? ` to ${sources.find((source) => source.id === draft.sourceId).name}` : ''}</h3>
        <div className="inv-admin-add-grid">
          {field('name', 'Name (e.g. Oat milk)', { autoFocus: Boolean(draft.name) })}
          <CategoryPicker
            categories={categories}
            value={draft.categoryId}
            onChange={(categoryId) => setDraft((current) => ({ ...current, categoryId: categoryId || '' }))}
            label="Category"
          />
          {field('unit', 'Counted as (e.g. carton)')}
          <SourceSelect sources={sources} value={draft.sourceId} onChange={(sourceId) => setDraft({ ...draft, sourceId: sourceId || '' })} label="Source" placeholder="Source…" />
          {field('par', 'Par level', { type: 'number', min: 0 })}
          {field('packSize', 'Units per pack (blank = 1)', { type: 'number', min: 1 })}
          {field('packLabel', 'Pack name (e.g. case)')}
          <button type="submit" className="primary" disabled={!draft.name.trim()}>Add item</button>
        </div>
      </form>


      <section className="inv-admin-card">
        <p className="inv-admin-sub">
          Edits save when you leave the field. <strong>Par</strong> is how many you want on hand right after an order;
          <strong> per pack</strong> is how many come in one pack from that source.
        </p>
        <div className="inv-admin-table-wrap">
          <table className="inv-admin-table inv-admin-edit">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Counted as</th>
                <th>Source</th>
                <th className="num">Par</th>
                <th className="num">Per pack</th>
                <th>Pack name</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className={item.active === false ? 'inactive' : ''}>
                  <td><ItemCell item={item} field="name" /></td>
                  <td>
                    <CategoryPicker
                      categories={categories}
                      value={item.categoryId}
                      onChange={(categoryId) => updateItem(item.id, { categoryId })}
                      label={`${item.name} category`}
                    />
                  </td>
                  <td><ItemCell item={item} field="unit" /></td>
                  <td>
                    <SourceSelect
                      sources={sources}
                      value={knownSourceIds.has(item.sourceId) ? item.sourceId : ''}
                      onChange={(sourceId) => updateItem(item.id, { sourceId })}
                      label={`${item.name} source`}
                    />
                  </td>
                  <td className="num"><ItemCell item={item} field="par" type="number" /></td>
                  <td className="num"><ItemCell item={item} field="packSize" type="number" /></td>
                  <td><ItemCell item={item} field="packLabel" /></td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.active !== false}
                      onChange={(event) => updateItem(item.id, { active: event.target.checked })}
                      aria-label={`${item.name} active`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => window.confirm(`Delete ${item.name}? Its count history goes with it.`) && deleteItem(item.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && <p className="inv-admin-empty">No items under this source yet — add one above.</p>}
      </section>
    </>
  )
}

// ---------------- Sources ----------------

function SourceRow({ source, items, itemCount, showItems }) {
  const [name, setName] = useState(source.name)
  const [notes, setNotes] = useState(source.notes || '')
  useEffect(() => setName(source.name), [source.name])
  useEffect(() => setNotes(source.notes || ''), [source.notes])

  const saveName = () => (name.trim() ? name.trim() !== source.name && updateSource(source.id, { name: name.trim() }) : setName(source.name))
  const saveNotes = () => notes.trim() !== (source.notes || '') && updateSource(source.id, { notes: notes.trim() })
  const remove = () => {
    const warning = itemCount ? ` Its ${itemCount} ${plural(itemCount, 'item')} will move to "${NO_SOURCE}".` : ''
    if (window.confirm(`Delete ${source.name}?${warning}`)) deleteSource(source.id, items)
  }

  return (
    <li className="inv-admin-source">
      <input className="inv-admin-source-name" value={name} onChange={(event) => setName(event.target.value)} onBlur={saveName} aria-label="Source name" />
      <textarea
        value={notes}
        rows={2}
        placeholder="Ordering notes baristas will see — cutoff day, who places it, where to pick up…"
        onChange={(event) => setNotes(event.target.value)}
        onBlur={saveNotes}
        aria-label={`${source.name} notes`}
      />
      <span className="inv-admin-actions">
        <button type="button" onClick={showItems}>{itemCount} {plural(itemCount, 'item')} →</button>
        <button type="button" className="danger" onClick={remove}>Delete</button>
      </span>
    </li>
  )
}

function SourcesPanel({ sources, items, showItemsFor }) {
  const [draft, setDraft] = useState({ name: '', notes: '' })
  const taken = sources.some((source) => source.name.toLowerCase() === draft.name.trim().toLowerCase())

  const submit = (event) => {
    event.preventDefault()
    if (!draft.name.trim() || taken) return
    addSource({ name: draft.name.trim(), notes: draft.notes.trim() })
    setDraft({ name: '', notes: '' })
  }

  return (
    <>
      <form className="inv-admin-card inv-admin-add" onSubmit={submit}>
        <h3>Add source</h3>
        <p className="inv-admin-sub">Where items come from — a store run (HEB), an app (Odeko), a roaster (Medici)…</p>
        <div className="inv-admin-add-grid">
          <input value={draft.name} placeholder="Name (e.g. Costco)" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <input value={draft.notes} placeholder="Ordering notes (optional)" onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          <button type="submit" className="primary" disabled={!draft.name.trim() || taken}>{taken ? 'Already exists' : 'Add source'}</button>
        </div>
      </form>
      <section className="inv-admin-card">
        <p className="inv-admin-sub">Edits save when you leave the field. Notes show up for baristas next to each source.</p>
        <ul className="inv-admin-list">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              items={items}
              itemCount={items.filter((item) => item.sourceId === source.id).length}
              showItems={() => showItemsFor(source.id)}
            />
          ))}
        </ul>
        {sources.length === 0 && <p className="inv-admin-empty">No sources yet.</p>}
      </section>
    </>
  )
}

// ---------------- Categories ----------------

function CategoryRow({ category, categories, items, index, itemCount }) {
  const [name, setName] = useState(category.name)
  useEffect(() => setName(category.name), [category.name])

  const save = () => (name.trim() ? name.trim() !== category.name && updateCategory(category.id, { name: name.trim() }) : setName(category.name))
  const remove = () => {
    const warning = itemCount ? ` Its ${itemCount} ${plural(itemCount, 'item')} will move to "${UNCATEGORIZED}".` : ''
    if (window.confirm(`Delete ${category.name}?${warning}`)) deleteCategory(category.id, items)
  }

  return (
    <li className="inv-admin-category">
      <span className="inv-admin-move">
        <button type="button" onClick={() => moveCategory(categories, category.id, -1)} disabled={index === 0} aria-label={`Move ${category.name} up`}>↑</button>
        <button type="button" onClick={() => moveCategory(categories, category.id, 1)} disabled={index === categories.length - 1} aria-label={`Move ${category.name} down`}>↓</button>
      </span>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        aria-label="Category name"
      />
      <span className="inv-admin-sub">{itemCount} {plural(itemCount, 'item')}</span>
      <button type="button" className="danger" onClick={remove}>Delete</button>
    </li>
  )
}

function CategoriesPanel({ categories, items }) {
  const [name, setName] = useState('')
  const taken = categories.some((category) => category.name.toLowerCase() === name.trim().toLowerCase())
  const uncategorized = items.filter((item) => !categories.some((category) => category.id === item.categoryId)).length

  const submit = (event) => {
    event.preventDefault()
    if (!name.trim() || taken) return
    addCategory(name.trim(), categories)
    setName('')
  }

  return (
    <>
      <form className="inv-admin-card inv-admin-add" onSubmit={submit}>
        <h3>Add category</h3>
        <div className="inv-admin-add-grid">
          <input value={name} placeholder="Name (e.g. Pastries)" onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="primary" disabled={!name.trim() || taken}>{taken ? 'Already exists' : 'Add category'}</button>
        </div>
      </form>
      <section className="inv-admin-card">
        <p className="inv-admin-sub">
          Baristas see categories in this order when they group by category, so match it to how you walk the shop
          when counting. Renames save when you leave the field.
        </p>
        <ul className="inv-admin-list">
          {categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              categories={categories}
              items={items}
              index={index}
              itemCount={items.filter((item) => item.categoryId === category.id).length}
            />
          ))}
        </ul>
        {categories.length === 0 && <p className="inv-admin-empty">No categories yet.</p>}
        {uncategorized > 0 && (
          <p className="inv-admin-sub">{uncategorized} {plural(uncategorized, 'item')} {uncategorized === 1 ? 'has' : 'have'} no category — set it in Items &amp; par levels.</p>
        )}
      </section>
    </>
  )
}

// ---------------- Barista requests ----------------

function RequestsPanel({ requests, addToCatalog }) {
  const [showClosed, setShowClosed] = useState(false)
  const newestFirst = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const open = newestFirst.filter((request) => request.status === 'open')
  const closed = newestFirst.filter((request) => request.status !== 'open')

  return (
    <section className="inv-admin-card">
      {open.length === 0 && <p className="inv-admin-empty">No open requests.</p>}
      <ul className="inv-admin-list">
        {open.map((request) => (
          <li key={request.id}>
            <span>
              <strong>{request.text}</strong>
              <span className="inv-admin-sub"> · {request.requestedBy || 'someone'} · {timeAgo(request.createdAt)}</span>
            </span>
            <span className="inv-admin-actions">
              <button type="button" onClick={() => addToCatalog(request)}>Add to catalog</button>
              <button type="button" className="primary" onClick={() => setRequestStatus(request.id, 'ordered')}>Ordered</button>
              <button type="button" onClick={() => setRequestStatus(request.id, 'dismissed')}>Dismiss</button>
            </span>
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <>
          <button type="button" className="inv-admin-link" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && (
            <ul className="inv-admin-list closed">
              {closed.map((request) => (
                <li key={request.id}>
                  <span>
                    {request.text}
                    <span className="inv-admin-sub"> · {request.status} {timeAgo(request.resolvedAt)}</span>
                  </span>
                  <button type="button" onClick={() => setRequestStatus(request.id, 'open')}>Reopen</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ---------------- Tab shell ----------------

export default function InventoryTab() {
  const [items, setItems] = useState([])
  const [sources, setSources] = useState([])
  const [categories, setCategories] = useState([])
  const [requests, setRequests] = useState([])
  const [view, setView] = useState('report')
  const [prefillName, setPrefillName] = useState('')
  const [itemsFilter, setItemsFilter] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loadedSources, setLoadedSources] = useState(false)

  // Sorted once here so filter chips, dropdowns and the Sources list all agree.
  useEffect(
    () =>
      watchSources((list) => {
        setSources([...list].sort((x, y) => x.name.localeCompare(y.name)))
        setLoadedSources(true)
      }, setLoadError),
    [],
  )
  useEffect(() => watchCategories((list) => setCategories(sortCategories(list)), setLoadError), [])
  useEffect(() => watchItems(setItems, setLoadError), [])
  useEffect(() => watchRequests(setRequests, setLoadError), [])

  const openRequests = requests.filter((request) => request.status === 'open')

  const addToCatalog = (request) => {
    setPrefillName(request.text)
    setView('items')
  }

  const views = [
    { id: 'report', label: 'Order report' },
    { id: 'items', label: 'Items & par levels' },
    { id: 'sources', label: 'Sources' },
    { id: 'categories', label: 'Categories' },
    { id: 'requests', label: `Barista requests${openRequests.length ? ` (${openRequests.length})` : ''}` },
  ]

  return (
    <div className="inv-admin">
      <div className="inv-admin-header">
        <h2>Inventory</h2>
        <p>Barista counts from inventory.brbcoffee-atx.com compared against your par levels.</p>
      </div>
      {loadError && (
        <p className="inv-admin-banner inv-admin-error">
          Couldn’t load inventory ({loadError.code || loadError.message}). Only the admin account can open this tab.
        </p>
      )}
      {loadedSources && sources.length === 0 && categories.length === 0 && items.length === 0 && !loadError && (
        <div className="inv-admin-card inv-admin-starter">
          <h3>Set up inventory</h3>
          <p className="inv-admin-sub">
            Start with sources {STARTER_SOURCES.map(([name]) => name).join(', ')} and categories {STARTER_CATEGORIES.join(', ')}.
            You can rename or delete any of them later, then add items under Items &amp; par levels.
          </p>
          <button type="button" className="primary" onClick={addStarterCatalog}>Add starter sources &amp; categories</button>
        </div>
      )}
      <nav className="inv-admin-subtabs">
        {views.map((entry) => (
          <button key={entry.id} type="button" className={view === entry.id ? 'active' : ''} onClick={() => setView(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>
      {view === 'report' && <OrderReport items={items} sources={sources} openRequests={openRequests} goToRequests={() => setView('requests')} />}
      {view === 'items' && (
        <ItemsEditor
          key={itemsFilter ?? 'all'}
          items={items}
          sources={sources}
          categories={categories}
          initialFilter={itemsFilter}
          prefillName={prefillName}
          clearPrefill={() => setPrefillName('')}
        />
      )}
      {view === 'categories' && <CategoriesPanel categories={categories} items={items} />}
      {view === 'sources' && (
        <SourcesPanel
          sources={sources}
          items={items}
          showItemsFor={(sourceId) => {
            setItemsFilter(sourceId)
            setView('items')
          }}
        />
      )}
      {view === 'requests' && <RequestsPanel requests={requests} addToCatalog={addToCatalog} />}
    </div>
  )
}
