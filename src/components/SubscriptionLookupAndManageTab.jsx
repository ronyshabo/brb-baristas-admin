import React, { useState } from 'react'
import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const SubscriptionLookupAndManageTab = () => {
  const [phone, setPhone] = useState('')
  const [subscription, setSubscription] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(false)
  const [renewLoading, setRenewLoading] = useState(false)
  const [useLoading, setUseLoading] = useState(false)

  const handleLookup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    setSubscription(null)
    try {
      const querySnapshot = await getDocs(collection(db, 'subscribers'))
      const found = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })).find(sub => sub.phone === phone)
      if (found) {
        setSubscription(found)
      } else {
        setError('No subscription found for this phone number.')
      }
    } catch (err) {
      setError('Error looking up subscription.')
    }
    setLoading(false)
  }

  const handleUseDrink = async () => {
    if (!subscription) return
    setUseLoading(true)
    setError(null)
    setSuccess(null)
    const today = new Date().toISOString().slice(0, 10)
    let drinksToday = subscription.drinksToday
    let lastUsedDate = subscription.lastUsedDate
    if (lastUsedDate !== today) drinksToday = 0
    if (subscription.drinksRemaining <= 0) {
      setError('No drinks remaining. Please renew subscription.')
      setUseLoading(false)
      return
    }
    if (drinksToday >= 3) {
      setError('Daily limit reached (3 drinks per day).')
      setUseLoading(false)
      return
    }
    try {
      const subRef = doc(db, 'subscribers', subscription.id)
      await updateDoc(subRef, {
        drinksRemaining: subscription.drinksRemaining - 1,
        drinksToday: drinksToday + 1,
        lastUsedDate: today
      })
      setSubscription({ ...subscription, drinksRemaining: subscription.drinksRemaining - 1, drinksToday: drinksToday + 1, lastUsedDate: today })
      setSuccess('Drink used!')
    } catch (err) {
      setError('Failed to update subscription.')
    }
    setUseLoading(false)
  }

  const handleRenew = async () => {
    if (!subscription) return
    setRenewLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const subRef = doc(db, 'subscribers', subscription.id)
      await updateDoc(subRef, {
        drinksRemaining: 30,
        drinksToday: 0,
        lastUsedDate: null
      })
      setSubscription({ ...subscription, drinksRemaining: 30, drinksToday: 0, lastUsedDate: null })
      setSuccess('Subscription renewed!')
    } catch (err) {
      setError('Failed to renew subscription.')
    }
    setRenewLoading(false)
  }

  return (
    <div>
      <h2>Lookup & Manage Subscription</h2>
      <form onSubmit={handleLookup} style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Enter phone number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>{loading ? 'Looking up...' : 'Lookup'}</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
      {subscription && (
        <div style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8 }}>
          <p><strong>Name:</strong> {subscription.name}</p>
          <p><strong>Email:</strong> {subscription.email}</p>
          <p><strong>Phone:</strong> {subscription.phone}</p>
          <p><strong>Type:</strong> {subscription.type === 'open' ? 'BRB Member (Open)' : 'Specific Drink'}</p>
          {subscription.type === 'specific' && <p><strong>Drink:</strong> {subscription.drink}</p>}
          <p><strong>Drinks Remaining:</strong> {subscription.drinksRemaining}</p>
          <p><strong>Drinks Used Today:</strong> {subscription.lastUsedDate === new Date().toISOString().slice(0, 10) ? subscription.drinksToday : 0} / 3</p>
          <button onClick={handleUseDrink} disabled={useLoading || subscription.drinksRemaining <= 0 || (subscription.lastUsedDate === new Date().toISOString().slice(0, 10) && subscription.drinksToday >= 3)}>
            {useLoading ? 'Processing...' : 'Use Drink'}
          </button>
          <button onClick={handleRenew} disabled={renewLoading || subscription.drinksRemaining === 30} style={{ marginLeft: 8 }}>
            {renewLoading ? 'Renewing...' : 'Renew Subscription'}
          </button>
        </div>
      )}
    </div>
  )
}

export default SubscriptionLookupAndManageTab
