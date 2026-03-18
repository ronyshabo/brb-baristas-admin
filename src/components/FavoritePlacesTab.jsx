import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const sortByName = (left, right) => {
  const leftName = String(left.name || left.title || '').toLowerCase()
  const rightName = String(right.name || right.title || '').toLowerCase()
  return leftName.localeCompare(rightName)
}

function FavoritePlacesTab() {
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    logoUrl: '',
    description: '',
    active: true,
  })

  const loadPlaces = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'favoritePlaces'))
      const list = []
      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })
      setPlaces(list.sort(sortByName))
    } catch (error) {
      console.error('Error loading favorite places:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPlaces()
  }, [])

  const handleCreatePlace = async (event) => {
    event.preventDefault()

    if (!formData.name.trim() || !formData.url.trim()) {
      alert('Please add a name and URL.')
      return
    }

    try {
      await addDoc(collection(db, 'favoritePlaces'), {
        name: formData.name.trim(),
        url: formData.url.trim(),
        logoUrl: formData.logoUrl.trim(),
        description: formData.description.trim(),
        active: Boolean(formData.active),
        createdAt: new Date(),
      })

      setFormData({ name: '', url: '', logoUrl: '', description: '', active: true })
      await loadPlaces()
    } catch (error) {
      console.error('Error creating favorite place:', error)
      alert('Failed to add place')
    }
  }

  const handleToggleActive = async (place) => {
    const nextActive = !(place.active ?? true)

    try {
      await updateDoc(doc(db, 'favoritePlaces', place.id), {
        active: nextActive,
        updatedAt: new Date(),
      })

      setPlaces((previous) => previous.map((entry) => (
        entry.id === place.id ? { ...entry, active: nextActive } : entry
      )))
    } catch (error) {
      console.error('Error toggling place active state:', error)
      alert('Failed to update place')
    }
  }

  const handleDeletePlace = async (placeId) => {
    if (!confirm('Delete this favorite place?')) return

    try {
      await deleteDoc(doc(db, 'favoritePlaces', placeId))
      setPlaces((previous) => previous.filter((entry) => entry.id !== placeId))
    } catch (error) {
      console.error('Error deleting favorite place:', error)
      alert('Failed to delete place')
    }
  }

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Favorite Places</h2>
        <p>Add and manage favorite local places displayed on the website.</p>
      </div>

      <form className="admin-content-form" onSubmit={handleCreatePlace}>
        <input
          type="text"
          placeholder="Place name"
          value={formData.name}
          onChange={(event) => setFormData({ ...formData, name: event.target.value })}
          required
        />
        <input
          type="url"
          placeholder="https://example.com"
          value={formData.url}
          onChange={(event) => setFormData({ ...formData, url: event.target.value })}
          required
        />
        <input
          type="url"
          placeholder="Logo image URL (optional)"
          value={formData.logoUrl}
          onChange={(event) => setFormData({ ...formData, logoUrl: event.target.value })}
        />
        <textarea
          rows={3}
          placeholder="Description (optional)"
          value={formData.description}
          onChange={(event) => setFormData({ ...formData, description: event.target.value })}
        />

        <label className="admin-checkbox-row">
          <input
            type="checkbox"
            checked={formData.active}
            onChange={(event) => setFormData({ ...formData, active: event.target.checked })}
          />
          Show on website
        </label>

        <button type="submit">Add Place</button>
      </form>

      {loading ? <p>Loading places...</p> : null}

      <div className="admin-content-list">
        {places.length === 0 && !loading ? <p>No places yet.</p> : null}
        {places.map((place) => (
          <article key={place.id} className="admin-content-card">
            {place.logoUrl ? (
              <img
                src={place.logoUrl}
                alt={`${place.name || place.title || 'Place'} logo`}
                style={{ maxHeight: '60px', maxWidth: '160px', objectFit: 'contain', marginBottom: '0.5rem' }}
              />
            ) : null}
            <div className="admin-content-card-top">
              <h3>{place.name || place.title || 'Unnamed place'}</h3>
              <span className={`status-pill ${(place.active ?? true) ? 'live' : 'draft'}`}>
                {(place.active ?? true) ? 'Visible' : 'Hidden'}
              </span>
            </div>
            <p>
              <a href={place.url || place.website || place.link} target="_blank" rel="noreferrer">
                {place.url || place.website || place.link}
              </a>
            </p>
            <p>{place.description || 'No description.'}</p>
            <div className="admin-card-actions">
              <button type="button" onClick={() => handleToggleActive(place)}>
                {(place.active ?? true) ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="danger" onClick={() => handleDeletePlace(place.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export default FavoritePlacesTab
