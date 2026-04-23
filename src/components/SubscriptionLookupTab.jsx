import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuthState } from 'react-firebase-auth-hooks'
import { User } from 'firebase/auth'
import { v4 as uuidv4 } from 'uuid'

const SubscriptionLookupTab = ({ onSubscriptionUpdate }) => {
  const [subscribers, setSubscribers] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [foundIndex, setFoundIndex] = useState(-1)
  const [showUseModal, setShowUseModal] = useState(false)
  const [useLoading, setUseLoading] = useState(false)

  const currentUser = useAuthState(db, (user) => user)

  useEffect(() => {
    fetchSubscribers()
    setFoundIndex(0)
  }, [])

  const fetchSubscribers = async () => {
    try {
      const subDocs = await getDocs(collection(db, 'subscribers'))
      const data = subDocs.docs.map(doc => doc.data())
      setSubscribers(data)
      setLoading(false)
    } catch (err) {
      console.error('Error fetching subscribers:', err)
      setLoading(false)
    }
  }

  const getSubscription = async (customerId) => {
    try {
      const subscriberData = subscribers.find(sub => sub.customerId === customerId)
      return subscriberData
    } catch (err) {
      console.error('Error fetching subscriber data:', err)
      return null
    }
  }

  const handleSave = async () => {
    if (!showSaveModal) return

    setSaveLoading(true)
    setSaveError(null)

    try {
      const subscriberDoc = doc(collection(db, 'subscribers'), subscribers[foundIndex].customerId)
      await updateDoc(subscriberDoc, selectedCustomer)
      alert('Changes saved successfully!')
      setShowSaveModal(false)
      setSaveLoading(false)
    } catch (err) {
      console.error('Error saving subscription:', err)
      setSaveError('Failed to save changes. Please try again.')
      setSaveLoading(false)
    }
  }

  const handleSearch = async (query) => {
    const filtered = subscribers.filter(sub => 
      sub.customerName.toLowerCase().includes(query.toLowerCase()) || 
      sub.customerEmail.toLowerCase().includes(query.toLowerCase())
    )
    setSearchResults(filtered)
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchTerm.trim()) {
      handleSearch(searchTerm)
    }
  }

  const handleCreateNewSubscription = () => {
    setSubscribers([])
    setShowSaveModal(true)
  }

  const handleCreateNewSubscriptionSubmit = async (email, name, drink, status) => {
    try {
      const subRef = await collection(db, 'subscribers').add({
        customerId: uuidv4(),
        status,
        visitsUsed: 0,
        email: email,
        name: name,
        drink: drink
      })
      alert('Subscription created successfully!')
    } catch (err) {
      console.error('Error creating subscription:', err)
      alert('Failed to create subscription. Please try again.')
    }
  }

  const handleUseVisit = async (customerData) => {
    setUseLoading(true)
    try {
      const visitedCustomer = subscribers.find(sub => sub.customerId === customerData.customerId)
      const newVisitsRemaining = visitedCustomer?.visitsUsed ? visitedCustomer.visitsUsed - 1 : 0
      setSubscribers(prevSubscribers => prevSubscribers.map(sub => 
        sub.customerId === customerData.customerId ? { ...sub, visitsUsed: newVisitsRemaining } : sub
      ))
      alert('Visit logged successfully!')
    } catch (err) {
      console.error('Error logging visit:', err)
      alert('Failed to log visit. Please try again.')
    } finally {
      setUseLoading(false)
    }
  }

  return (
    <div className="tab-content">
      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <h2>Subscription Management</h2>
          <p>Current Admin: {currentUser?.email || 'Not Logged In'}</p>
          <div>
            <h3>Your Subscription</h3>
            <p>Status: Active</p>
            <p>Drink: House Coffee</p>
            <p>Visits Used: 0/10</p>
            <p>Remaining Visits: {10 - 0}</p>
          </div>
          {showSaveModal && (
            <div className="modal">
              <p>{saveError || 'Save changes to the subscription.'}</p>
              <button onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button onClick={handleSave} disabled={saveLoading}>Save</button>
            </div>
          )}

          <form id="searchForm" onSubmit={handleSearchSubmit}>
            <input
              id="searchInput"
              type="text"
              placeholder="Search by name or email"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button type="submit" id="searchButton">Search</button>
          </form>
          <div className="subscription-lookup">
            {searchResults.length > 0 ? (
              searchResults.map((result, index) => (
                <div key={result.customerId} className="lookup-card">
                  <p>Name: {result.name}</p>
                  <p>Email: {result.email}</p>
                  <p>Drink: {result.drink}</p>
                  <p>Status: {result.status}</p>
                  <p>Available Visits: {result.visitsUsed}</p>
                </div>
              ))
            ) : (
              <div>
                <p>No subscriptions found with that name or email.</p>
                <button onClick={handleCreateNewSubscription}>Create New Subscription</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SubscriptionLookupTab
