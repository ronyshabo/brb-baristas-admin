import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const toDateValue = (value) => {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    return value.toDate()
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

const sortByCreatedAtDesc = (left, right) => {
  const leftStamp = toDateValue(left.createdAt)?.getTime() || 0
  const rightStamp = toDateValue(right.createdAt)?.getTime() || 0
  return rightStamp - leftStamp
}

const formatDate = (value) => {
  const dateValue = toDateValue(value)
  if (!dateValue) return 'Date unknown'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(dateValue)
}

function CommunityBoardTab() {
  const [posters, setPosters] = useState([])
  const [loading, setLoading] = useState(true)

  const loadPosters = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'communityPosters'))
      const list = []
      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })
      setPosters(list.sort(sortByCreatedAtDesc))
    } catch (error) {
      console.error('Error loading community posters:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPosters()
  }, [])

  const handleSetApproved = async (poster, approved) => {
    try {
      await updateDoc(doc(db, 'communityPosters', poster.id), {
        approved,
        reviewedAt: new Date(),
      })

      setPosters((previous) => previous.map((entry) => (
        entry.id === poster.id ? { ...entry, approved } : entry
      )))
    } catch (error) {
      console.error('Error updating poster approval:', error)
      alert('Failed to update poster approval')
    }
  }

  const handleDeletePoster = async (posterId) => {
    if (!confirm('Delete this community submission?')) return

    try {
      await deleteDoc(doc(db, 'communityPosters', posterId))
      setPosters((previous) => previous.filter((entry) => entry.id !== posterId))
    } catch (error) {
      console.error('Error deleting poster:', error)
      alert('Failed to delete poster')
    }
  }

  const pendingPosters = posters.filter((poster) => !poster.approved)
  const approvedPosters = posters.filter((poster) => poster.approved)

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Community Board Approval</h2>
        <p>Review submissions from the website and approve what should go public.</p>
      </div>

      {loading ? <p>Loading submissions...</p> : null}

      <div className="admin-content-split">
        <section>
          <h3>Pending ({pendingPosters.length})</h3>
          <div className="admin-content-list">
            {pendingPosters.length === 0 && !loading ? <p>No pending submissions.</p> : null}
            {pendingPosters.map((poster) => (
              <article key={poster.id} className="admin-content-card">
                {poster.imageUrl ? <img className="admin-poster-image" src={poster.imageUrl} alt={poster.title || 'Poster'} /> : null}
                <div className="admin-content-card-top">
                  <h4>{poster.title || 'Untitled poster'}</h4>
                  <span className="status-pill draft">Pending</span>
                </div>
                <p className="admin-content-meta">{String(poster.type || 'event').toUpperCase()} • {formatDate(poster.createdAt)}</p>
                <p>{poster.description || 'No description provided.'}</p>
                <div className="admin-card-actions">
                  <button type="button" onClick={() => handleSetApproved(poster, true)}>Approve</button>
                  <button type="button" className="danger" onClick={() => handleDeletePoster(poster.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h3>Approved ({approvedPosters.length})</h3>
          <div className="admin-content-list">
            {approvedPosters.length === 0 && !loading ? <p>No approved posters yet.</p> : null}
            {approvedPosters.map((poster) => (
              <article key={poster.id} className="admin-content-card">
                {poster.imageUrl ? <img className="admin-poster-image" src={poster.imageUrl} alt={poster.title || 'Poster'} /> : null}
                <div className="admin-content-card-top">
                  <h4>{poster.title || 'Untitled poster'}</h4>
                  <span className="status-pill live">Approved</span>
                </div>
                <p className="admin-content-meta">{String(poster.type || 'event').toUpperCase()} • {formatDate(poster.createdAt)}</p>
                <p>{poster.description || 'No description provided.'}</p>
                <div className="admin-card-actions">
                  <button type="button" onClick={() => handleSetApproved(poster, false)}>Move to Pending</button>
                  <button type="button" className="danger" onClick={() => handleDeletePoster(poster.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default CommunityBoardTab
