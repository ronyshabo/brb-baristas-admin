import { useEffect, useState, useRef, useCallback } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const MAX_POSTS = 6

function extractPermalink(embedHtml) {
  const match = embedHtml.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

function stripEmbedScript(html) {
  // Remove the <script> tag — we load embed.js globally
  return html.replace(/<script[^>]*>.*?<\/script>/gi, '').trim()
}

function processInstgram() {
  if (window.instgrm?.Embeds) {
    window.instgrm.Embeds.process()
  }
}

function loadEmbedScript() {
  if (document.querySelector('script[src*="instagram.com/embed.js"]')) {
    processInstgram()
    return
  }
  const script = document.createElement('script')
  script.src = 'https://www.instagram.com/embed.js'
  script.async = true
  script.onload = processInstgram
  document.body.appendChild(script)
}

function EmbedPreview({ html }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = html
      loadEmbedScript()
    }
  }, [html])

  return <div ref={containerRef} className="ig-embed-container" />
}

function InstagramPostsTab() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    embedCode: '',
    caption: '',
    order: '',
  })
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({ caption: '', order: '' })

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'instagramPosts'))
      const list = []
      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })
      list.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
      setPosts(list)
    } catch (error) {
      console.error('Error loading Instagram posts:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Re-process embeds when posts change
  useEffect(() => {
    if (posts.length > 0) {
      setTimeout(loadEmbedScript, 300)
    }
  }, [posts])

  const handleAdd = async (event) => {
    event.preventDefault()

    const embedHtml = formData.embedCode.trim()
    if (!embedHtml.includes('instagram.com')) {
      alert('Please paste a valid Instagram embed code.\n\nTo get it: open the Instagram post → click ••• → Embed → Copy embed code.')
      return
    }

    const shortcode = extractPermalink(embedHtml)
    if (!shortcode) {
      alert('Could not find an Instagram post URL in the embed code.')
      return
    }

    if (posts.some((p) => p.shortcode === shortcode)) {
      alert('This Instagram post is already added.')
      return
    }

    try {
      const cleanHtml = stripEmbedScript(embedHtml)
      const postUrl = `https://www.instagram.com/p/${shortcode}/`
      const payload = {
        shortcode,
        postUrl,
        embedHtml: cleanHtml,
        caption: formData.caption.trim(),
        order: formData.order !== '' ? Number(formData.order) : 9999,
        createdAt: new Date(),
      }
      await addDoc(collection(db, 'instagramPosts'), payload)
      setFormData({ embedCode: '', caption: '', order: '' })
      await loadPosts()
    } catch (error) {
      console.error('Error adding Instagram post:', error)
      alert('Failed to add Instagram post')
    }
  }

  const handleDelete = async (postId) => {
    if (!confirm('Remove this Instagram post?')) return
    try {
      await deleteDoc(doc(db, 'instagramPosts', postId))
      setPosts((prev) => prev.filter((p) => p.id !== postId))
    } catch (error) {
      console.error('Error deleting Instagram post:', error)
      alert('Failed to delete Instagram post')
    }
  }

  const startEditing = (post) => {
    setEditingId(post.id)
    setEditData({
      caption: post.caption || '',
      order: post.order ?? 9999,
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditData({ caption: '', order: '' })
  }

  const handleUpdate = async (postId) => {
    try {
      await updateDoc(doc(db, 'instagramPosts', postId), {
        caption: editData.caption.trim(),
        order: editData.order !== '' ? Number(editData.order) : 9999,
      })
      setEditingId(null)
      await loadPosts()
    } catch (error) {
      console.error('Error updating Instagram post:', error)
      alert('Failed to update Instagram post')
    }
  }

  const previewShortcode = extractPermalink(formData.embedCode)
  const previewHtml = previewShortcode ? stripEmbedScript(formData.embedCode.trim()) : null

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Instagram Posts</h2>
        <p>
          Manage embedded Instagram posts shown on the website.
          The public site displays up to {MAX_POSTS} posts sorted by order.
        </p>
        <p className="admin-content-meta">
          <strong>How to get the embed code:</strong> Open the post on Instagram → click <strong>•••</strong> → <strong>Embed</strong> → <strong>Copy embed code</strong>
        </p>
        {posts.length > MAX_POSTS && (
          <p className="ig-warning">
            ⚠ You have {posts.length} posts pinned — only the first {MAX_POSTS} (by order) will appear on the website.
          </p>
        )}
      </div>

      <form className="admin-content-form" onSubmit={handleAdd}>
        <textarea
          rows={5}
          placeholder="Paste Instagram embed code here..."
          value={formData.embedCode}
          onChange={(e) => setFormData({ ...formData, embedCode: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="Caption (optional — used for accessibility)"
          value={formData.caption}
          onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
        />
        <input
          type="number"
          placeholder="Order (lower = shown first, default 9999)"
          value={formData.order}
          onChange={(e) => setFormData({ ...formData, order: e.target.value })}
        />

        {previewHtml && (
          <div className="ig-preview">
            <p className="ig-preview-label">Preview for <strong>{previewShortcode}</strong>:</p>
            <EmbedPreview html={previewHtml} />
          </div>
        )}

        <button type="submit">Add Post</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : posts.length === 0 ? (
        <p>No Instagram posts pinned yet.</p>
      ) : (
        <div className="admin-content-list">
          {posts.map((post, index) => (
            <div
              key={post.id}
              className={`admin-content-card ${index >= MAX_POSTS ? 'ig-card-overflow' : ''}`}
            >
              {index >= MAX_POSTS && (
                <span className="status-pill draft">Hidden on site</span>
              )}
              {index < MAX_POSTS && (
                <span className="status-pill live">Visible #{index + 1}</span>
              )}

              {post.embedHtml ? (
                <EmbedPreview html={post.embedHtml} />
              ) : (
                <div className="admin-content-meta">
                  <a href={post.postUrl} target="_blank" rel="noopener noreferrer">
                    View on Instagram ↗
                  </a>
                </div>
              )}

              {editingId === post.id ? (
                <div className="ig-edit-form">
                  <input
                    type="text"
                    placeholder="Caption"
                    value={editData.caption}
                    onChange={(e) => setEditData({ ...editData, caption: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Order"
                    value={editData.order}
                    onChange={(e) => setEditData({ ...editData, order: e.target.value })}
                  />
                  <div className="admin-card-actions">
                    <button onClick={() => handleUpdate(post.id)}>Save</button>
                    <button onClick={cancelEditing}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="admin-content-meta">
                    <strong>Shortcode:</strong> {post.shortcode}
                  </div>
                  {post.caption && (
                    <div className="admin-content-meta">
                      <strong>Caption:</strong> {post.caption}
                    </div>
                  )}
                  <div className="admin-content-meta">
                    <strong>Order:</strong> {post.order ?? 9999}
                  </div>
                  <div className="admin-card-actions">
                    <button onClick={() => startEditing(post)}>Edit</button>
                    <button className="danger" onClick={() => handleDelete(post.id)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default InstagramPostsTab
