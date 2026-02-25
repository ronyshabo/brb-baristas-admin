import { useState, useEffect } from 'react'
import { auth } from './firebase/config'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [googleAccessToken, setGoogleAccessToken] = useState(
    () => localStorage.getItem('brb_google_access_token') || null
  )

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const handleLogout = async () => {
    await signOut(auth)
    setUser(null)
    setGoogleAccessToken(null)
    localStorage.removeItem('brb_google_access_token')
  }

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Login setUser={setUser} setGoogleToken={setGoogleAccessToken} />
  }

  return (
    <div className="app">
      <nav className="navbar">
        <h1>BRB Coffee - Admin Dashboard</h1>
        <button onClick={handleLogout}>Logout</button>
      </nav>
      <Dashboard user={user} googleAccessToken={googleAccessToken} />
    </div>
  )
}

export default App
