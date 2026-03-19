import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const DRINK_GROUP_OPTIONS = ['Coffee', 'Teas', 'Specialty', 'Decaf']

const sortByName = (left, right) => {
  const leftName = String(left.name || left.title || '').toLowerCase()
  const rightName = String(right.name || right.title || '').toLowerCase()
  return leftName.localeCompare(rightName)
}

const normalizeDrinkGroup = (value) => {
  const trimmedValue = String(value || '').trim().toLowerCase()

  if (trimmedValue === 'coffee') return 'Coffee'
  if (trimmedValue === 'tea' || trimmedValue === 'teas') return 'Teas'
  if (trimmedValue === 'specialty') return 'Specialty'
  if (trimmedValue === 'decaf') return 'Decaf'

  return String(value || '').trim()
}

function DrinksTab() {
  const [drinks, setDrinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    group: 'Coffee',
    price: '',
    description: '',
    imageUrl: '',
    published: true,
  })

  const loadDrinks = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'drinks'))
      const list = []

      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })

      setDrinks(list.sort(sortByName))
    } catch (error) {
      console.error('Error loading drinks:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDrinks()
  }, [])

  const handleCreateDrink = async (event) => {
    event.preventDefault()

    if (!formData.name.trim() || !formData.group.trim() || !formData.price.trim()) {
      alert('Please add a drink name, group, and price.')
      return
    }

    try {
      const published = Boolean(formData.published)
      const normalizedGroup = normalizeDrinkGroup(formData.group)

      await addDoc(collection(db, 'drinks'), {
        name: formData.name.trim(),
        group: normalizedGroup,
        category: normalizedGroup,
        price: formData.price.trim(),
        description: formData.description.trim(),
        imageUrl: formData.imageUrl.trim(),
        published,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      setFormData({
        name: '',
        group: 'Coffee',
        price: '',
        description: '',
        imageUrl: '',
        published: true,
      })
      await loadDrinks()
    } catch (error) {
      console.error('Error creating drink:', error)
      alert('Failed to add drink')
    }
  }

  const handleTogglePublished = async (drink) => {
    const nextPublished = !(drink.published ?? true)

    try {
      await updateDoc(doc(db, 'drinks', drink.id), {
        published: nextPublished,
        updatedAt: new Date(),
      })

      setDrinks((previous) => previous.map((entry) => (
        entry.id === drink.id ? { ...entry, published: nextPublished } : entry
      )))
    } catch (error) {
      console.error('Error updating drink visibility:', error)
      alert('Failed to update drink')
    }
  }

  const handleDeleteDrink = async (drinkId) => {
    if (!confirm('Delete this drink?')) return

    try {
      await deleteDoc(doc(db, 'drinks', drinkId))
      setDrinks((previous) => previous.filter((entry) => entry.id !== drinkId))
    } catch (error) {
      console.error('Error deleting drink:', error)
      alert('Failed to delete drink')
    }
  }

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Drinks Menu</h2>
        <p>Add drinks that the website menu or blog can read from Firestore.</p>
      </div>

      <form className="admin-content-form" onSubmit={handleCreateDrink}>
        <input
          type="text"
          placeholder="Drink name"
          value={formData.name}
          onChange={(event) => setFormData({ ...formData, name: event.target.value })}
          required
        />
        <input
          type="text"
          list="drink-group-options"
          placeholder="Group: Coffee, Teas, Specialty, or Decaf"
          value={formData.group}
          onChange={(event) => setFormData({ ...formData, group: event.target.value })}
          required
        />
        <datalist id="drink-group-options">
          {DRINK_GROUP_OPTIONS.map((groupName) => (
            <option key={groupName} value={groupName} />
          ))}
        </datalist>
        <input
          type="text"
          placeholder="Price (example: $5.50)"
          value={formData.price}
          onChange={(event) => setFormData({ ...formData, price: event.target.value })}
          required
        />
        <input
          type="url"
          placeholder="Image URL (optional)"
          value={formData.imageUrl}
          onChange={(event) => setFormData({ ...formData, imageUrl: event.target.value })}
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
            checked={formData.published}
            onChange={(event) => setFormData({ ...formData, published: event.target.checked })}
          />
          Show on website
        </label>

        <button type="submit">Add Drink</button>
      </form>

      {loading ? <p>Loading drinks...</p> : null}

      <div className="admin-content-list">
        {drinks.length === 0 && !loading ? <p>No drinks yet.</p> : null}
        {drinks.map((drink) => (
          <article key={drink.id} className="admin-content-card">
            {drink.imageUrl ? (
              <img className="admin-poster-image" src={drink.imageUrl} alt={drink.name || 'Drink'} />
            ) : null}
            <div className="admin-content-card-top">
              <h3>{drink.name || 'Unnamed drink'}</h3>
              <span className={`status-pill ${(drink.published ?? true) ? 'live' : 'draft'}`}>
                {(drink.published ?? true) ? 'Visible' : 'Hidden'}
              </span>
            </div>
            <p className="admin-content-meta">{drink.group || drink.category || 'Ungrouped'} • {drink.price || 'No price'}</p>
            <p>{drink.description || 'No description.'}</p>
            <div className="admin-card-actions">
              <button type="button" onClick={() => handleTogglePublished(drink)}>
                {(drink.published ?? true) ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="danger" onClick={() => handleDeleteDrink(drink.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export default DrinksTab