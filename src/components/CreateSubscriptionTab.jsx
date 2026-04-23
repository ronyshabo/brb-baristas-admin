import React, { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const CreateSubscriptionTab = () => {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    type: 'open',
    drink: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleTypeChange = (e) => {
    setForm((prev) => ({ ...prev, type: e.target.value, drink: '' }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)
    try {
      await addDoc(collection(db, 'subscribers'), {
        name: form.name,
        phone: form.phone,
        email: form.email,
        type: form.type,
        drink: form.type === 'specific' ? form.drink : '',
        drinksRemaining: 30,
        drinksToday: 0,
        lastUsedDate: null,
      })
      setSuccess(true)
      setForm({ name: '', phone: '', email: '', type: 'open', drink: '' })
    } catch (err) {
      setError('Failed to create subscription. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div>
      <h2>Create New Subscription</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          name="name"
          placeholder="Name"
          value={form.name}
          onChange={handleChange}
          required
        />
        <input
          type="text"
          name="phone"
          placeholder="Phone Number"
          value={form.phone}
          onChange={handleChange}
          required
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
        />
        <select name="type" value={form.type} onChange={handleTypeChange} required>
          <option value="open">BRB Member (Open Subscription)</option>
          <option value="specific">Specific Drink Subscription</option>
        </select>
        {form.type === 'specific' && (
          <input
            type="text"
            name="drink"
            placeholder="Favorite Drink"
            value={form.drink}
            onChange={handleChange}
            required
          />
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Subscription'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>Subscription created successfully!</p>}
    </div>
  )
}

export default CreateSubscriptionTab
