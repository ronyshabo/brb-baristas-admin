import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from './config'

const TOKEN_KEY = 'brb_google_access_token'
const TOKEN_TIME_KEY = 'brb_google_access_token_at'

// Google OAuth access tokens last ~1 hour. Treat them as stale a little early
// so we prompt before a request fails mid-way through loading a schedule.
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000

export const storeGoogleToken = (token) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_TIME_KEY, String(Date.now()))
}

export const clearGoogleToken = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_TIME_KEY)
}

// Returns the stored token only while it is still fresh, clearing it otherwise
// so a stale token never reaches the Calendar API.
export const getFreshGoogleToken = () => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null

  const savedAt = Number(localStorage.getItem(TOKEN_TIME_KEY))
  if (!savedAt || Date.now() - savedAt > TOKEN_MAX_AGE_MS) {
    clearGoogleToken()
    return null
  }

  return token
}

// Must be called from a user gesture (click) or the browser blocks the popup.
export const signInWithGoogleCalendar = async () => {
  const provider = new GoogleAuthProvider()
  provider.addScope('https://www.googleapis.com/auth/calendar')

  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  const accessToken = credential?.accessToken || null

  if (accessToken) storeGoogleToken(accessToken)

  return { user: result.user, accessToken }
}
