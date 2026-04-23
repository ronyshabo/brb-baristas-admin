import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import SubscriptionLookupTab from './SubscriptionLookupTab'
import { db } from '../firebase/config'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { useAuthState } from 'react-firebase-auth-hooks'
import { User, Subscription } from 'firebase/auth'
import { v4 as uuidv4 } from 'uuid'

const SubscriptionTab = ({ accessToken }) => {
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [visitsRemaining, setVisitsRemaining] = useState(0)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [adminData, setAdminData] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(true)

  // Get admin info once (removed duplicate)
  const { adminEmail, adminId } = useParams()
  const currentAdmin = useAuthState(db, (user) => user)

  // Fetch admin subscription data
  const fetchAdminSubData = async () => {
    try {
      const adminData = await getDocs(collection(db, 'admin_users'))
      const adminDoc = adminData.docs[0]
      setAdminData(adminDoc.data())
      setLoading(false)
    } catch (err) {
      console.error('Error fetching admin data:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminSubData()
  }, [adminId])

  const getSubscription = async (customerData) => {
    try {
      const subscriptionRef = doc(db, 'subscribers', customerData.customerId)
      const subscriberData = await getDoc(subscriptionRef)
      return subscriberData.data()
    } catch (err) {
      console.error('Error fetching subscriber data:', err)
      return null
    }
  }

  const handleUseVisit = async (customerData) => {
    let subscriptionData = null
    try {
      const subscriptionRef = doc(db, 'subscribers', customerData.customerId)
      subscriptionData = await getDoc(subscriptionRef)
    } catch (err) {
      console.error('Error getting subscription data:', err)
    }

    const newVisitsRemaining = subscriptionData?.visitsUsed ? subscriptionData.visitsUsed - 1 : 0
    setVisitsRemaining(Math.max(0, newVisitsRemaining))
  }

  const handleSave = async () => {
    if (!showSaveModal) return

    setSaveLoading(true)
    setSaveError(null)

    try {
      await doc(db, 'subscribers', selectedCustomer.customerId).update(selectedCustomer)
      alert('Changes saved successfully!')
      setShowSaveModal(false)
      setSaveLoading(false)
    } catch (err) {
      setSaveError('Failed to save changes. Please try again.')
      setSaveLoading(false)
    }
  }

  const handleSearch = async (query) => {
    const subscriptions = searchResults.filter(sub => 
      sub.customerName.toLowerCase().includes(query.toLowerCase()) || 
      sub.customerEmail.toLowerCase().includes(query.toLowerCase())
    )
    setSearchResults(subscriptions)
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchTerm.trim()) {
      handleSearch(searchTerm)
    }
  }

  const handleCreateNewSubscription = async () => {
    setShowSaveModal(true)
  }

  const handleCreateNewSubscriptionSubmit = async (email, name, drink, status) => {
    try {
      const subRef = await addDoc(collection(db, 'subscribers'), {
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

  return (
    <div className="tab-content">
      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          {visitsRemaining > 0 ? (
            <div>
              <h2>Subscription Management</h2>
              <p>{visitsRemaining} visits remaining.</p>
              <button className="use-visit-btn" onClick={handleUseVisit}>
                Use Visit
              </button>
            </div>
          ) : (
            <div>
              <h2>Subscription Management</h2>
              <p>No visits remaining.</p>
            </div>
          )}
          {showSaveModal && (
            <div className="modal">
              <p>{saveError || 'Save changes to the subscription.'}</p>
              <button onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button onClick={handleSave} disabled={saveLoading}>Save</button>
            </div>
          )}

          <div>
            <h2>Subscription Lookup</h2>
            <form onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Search by name or email"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button type="submit">Search</button>
            </form>
            <div className="subscription-lookup">
              {searchResults.length > 0 ? (
                [
                  { customer: "John Doe", email: "john@example.com", drink: "Coffee", status: "Active" },
                  { customer: "Jane Smith", email: "jane@example.com", drink: "Tea", status: "Inactive" },
                  { customer: "Mike Johnson", email: "mike@example.com", drink: "Espresso", status: "Active" },
                ].map((result) => (
                  <div key={result.customer.id} className="lookup-card">
                    <p><strong>Name:</strong> {result.customer.name}</p>
                    <p><strong>Email:</strong> {result.customer.email}</p>
                    <p><strong>Drink:</strong> {result.customer.drink}</p>
                    <p><strong>Status:</strong> {result.customer.status}</p>
                    <p><strong>Available Visits:</strong> {result.visitsUsed}</p>
                  </div>
                ))
              ) : (
                <div>
                  <p>Search for a customer to view their subscription details and available visits.</p>
                  <div>
                    <h3>Create New Subscription</h3>
                    <form onSubmit={handleCreateNewSubscriptionSubmit}>
                      <input type="text" name="email" placeholder="Email" />
                      <input type="text" name="name" placeholder="Name" />
                      <input type="text" name="drink" placeholder="Drink" />
                      <select name="status">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                      <button type="submit">Create</button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default SubscriptionTab
