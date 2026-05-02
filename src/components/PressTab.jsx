import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const PRESS_TYPES = [
  { value: 'youtube', label: 'YouTube Interview' },
  { value: 'spotify', label: 'Spotify Podcast' },
  { value: 'magazine', label: 'Magazine Article' },
]

const EMPTY_FORM = {
  type: 'youtube',
  title: '',
  url: '',
  description: '',
  order: '',
  published: true,
}

function PressTab() {
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({ ...EMPTY_FORM })
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({})

  const loadFeatures = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'pressFeatures'))
      const list = []
      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })
      list.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
      setFeatures(list)
    } catch (error) {
      console.error('Error loading press features:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFeatures()
  }, [])

  const handleAdd = async (event) => {
    event.preventDefault()

    const url = formData.url.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('URL must start with http:// or https://')
      return
    }

    try {
      await addDoc(collection(db, 'pressFeatures'), {
        type: formData.type,
        title: formData.title.trim(),
        url,
        description: formData.description.trim(),
        order: formData.order !== '' ? Number(formData.order) : 9999,
        published: Boolean(formData.published),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      setFormData({ ...EMPTY_FORM })
      await loadFeatures()
    } catch (error) {
      console.error('Error adding press feature:', error)
      alert('Failed to save. Please try again.')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this press feature?')) return
    try {
      await deleteDoc(doc(db, 'pressFeatures', id))
      await loadFeatures()
    } catch (error) {
      console.error('Error deleting press feature:', error)
      alert('Failed to delete. Please try again.')
    }
  }

  const startEdit = (feature) => {
    setEditingId(feature.id)
    setEditData({
      type: feature.type || 'youtube',
      title: feature.title || '',
      url: feature.url || '',
      description: feature.description || '',
      order: feature.order !== undefined ? String(feature.order) : '',
      published: feature.published !== false,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditData({})
  }

  const handleSaveEdit = async (id) => {
    const url = editData.url.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('URL must start with http:// or https://')
      return
    }

    try {
      await updateDoc(doc(db, 'pressFeatures', id), {
        type: editData.type,
        title: editData.title.trim(),
        url,
        description: editData.description.trim(),
        order: editData.order !== '' ? Number(editData.order) : 9999,
        published: Boolean(editData.published),
        updatedAt: new Date(),
      })
      cancelEdit()
      await loadFeatures()
    } catch (error) {
      console.error('Error updating press feature:', error)
      alert('Failed to update. Please try again.')
    }
  }

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Press &amp; Media</h2>
        <p>Add YouTube interviews, Spotify podcast episodes, and magazine articles that will appear on the website.</p>
      </div>

      <form className="admin-content-form" onSubmit={handleAdd}>
        <select
          value={formData.type}
          onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value }))}
        >
          {PRESS_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Title (e.g. BRB Coffee Feature on Austin Weekly)"
          value={formData.title}
          onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
          required
        />

        <input
          type="url"
          placeholder="URL (https://...)"
          value={formData.url}
          onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
          required
        />

        <input
          type="text"
          placeholder="Short description (optional)"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
        />

        <input
          type="number"
          placeholder="Display order (lower = shown first, default 9999)"
          value={formData.order}
          onChange={(e) => setFormData((prev) => ({ ...prev, order: e.target.value }))}
        />

        <label className="admin-checkbox-row">
          <input
            type="checkbox"
            checked={formData.published}
            onChange={(e) => setFormData((prev) => ({ ...prev, published: e.target.checked }))}
          />
          Published (visible on website)
        </label>

        <button type="submit">Add Feature</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : features.length === 0 ? (
        <p>No press features added yet.</p>
      ) : (
        <div className="admin-content-list">
          {features.map((feature) => (
            <article key={feature.id} className="admin-content-card">
              <div className="admin-content-card-top">
                <h3>{feature.title}</h3>
                <span className={`status-pill ${feature.published !== false ? 'live' : 'draft'}`}>
                  {feature.published !== false ? 'Published' : 'Draft'}
                </span>
              </div>

              <p className="admin-content-meta">
                {PRESS_TYPES.find((t) => t.value === feature.type)?.label || feature.type}
                {' • Order: '}{feature.order ?? 9999}
              </p>

              {feature.description && <p>{feature.description}</p>}

              <p className="admin-content-meta">
                <a href={feature.url} target="_blank" rel="noreferrer">{feature.url}</a>
              </p>

              {editingId === feature.id ? (
                <div className="ig-edit-form">
                  <select
                    value={editData.type}
                    onChange={(e) => setEditData((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    {PRESS_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Title"
                    value={editData.title}
                    onChange={(e) => setEditData((prev) => ({ ...prev, title: e.target.value }))}
                  />
                  <input
                    type="url"
                    placeholder="URL"
                    value={editData.url}
                    onChange={(e) => setEditData((prev) => ({ ...prev, url: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={editData.description}
                    onChange={(e) => setEditData((prev) => ({ ...prev, description: e.target.value }))}
                  />
                  <input
                    type="number"
                    placeholder="Order"
                    value={editData.order}
                    onChange={(e) => setEditData((prev) => ({ ...prev, order: e.target.value }))}
                  />
                  <label className="admin-checkbox-row">
                    <input
                      type="checkbox"
                      checked={editData.published}
                      onChange={(e) => setEditData((prev) => ({ ...prev, published: e.target.checked }))}
                    />
                    Published
                  </label>
                  <div className="admin-card-actions">
                    <button type="button" onClick={() => handleSaveEdit(feature.id)}>Save</button>
                    <button type="button" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="admin-card-actions">
                  <button type="button" onClick={() => startEdit(feature)}>Edit</button>
                  <button type="button" className="danger" onClick={() => handleDelete(feature.id)}>Delete</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export default PressTab
