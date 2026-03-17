import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import '../styles/AdminContentTabs.css'

const sortByDateDesc = (left, right) => {
  const leftDate = left.publishedAt?.toDate?.() || left.createdAt?.toDate?.() || new Date(0)
  const rightDate = right.publishedAt?.toDate?.() || right.createdAt?.toDate?.() || new Date(0)
  return rightDate.getTime() - leftDate.getTime()
}

function PostsTab({ user }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    title: '',
    body: '',
    author: '',
    published: true,
  })

  const loadPosts = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'posts'))
      const list = []
      snapshot.forEach((entry) => {
        list.push({ id: entry.id, ...entry.data() })
      })
      setPosts(list.sort(sortByDateDesc))
    } catch (error) {
      console.error('Error loading posts:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPosts()
  }, [])

  const handleCreatePost = async (event) => {
    event.preventDefault()

    if (!formData.title.trim() || !formData.body.trim()) {
      alert('Please add a title and post body.')
      return
    }

    try {
      const published = Boolean(formData.published)
      const payload = {
        title: formData.title.trim(),
        body: formData.body.trim(),
        author: formData.author.trim() || user?.email || 'Admin',
        published,
        status: published ? 'published' : 'draft',
        createdAt: new Date(),
        publishedAt: published ? new Date() : null,
      }

      await addDoc(collection(db, 'posts'), payload)
      setFormData({ title: '', body: '', author: '', published: true })
      await loadPosts()
    } catch (error) {
      console.error('Error creating post:', error)
      alert('Failed to create post')
    }
  }

  const handleTogglePublished = async (post) => {
    const nextPublished = !(post.published ?? false)

    try {
      await updateDoc(doc(db, 'posts', post.id), {
        published: nextPublished,
        status: nextPublished ? 'published' : 'draft',
        publishedAt: nextPublished ? new Date() : post.publishedAt || null,
        updatedAt: new Date(),
      })

      setPosts((previous) => previous.map((entry) => (
        entry.id === post.id
          ? {
              ...entry,
              published: nextPublished,
              status: nextPublished ? 'published' : 'draft',
              publishedAt: nextPublished ? new Date() : entry.publishedAt || null,
            }
          : entry
      )))
    } catch (error) {
      console.error('Error toggling post visibility:', error)
      alert('Failed to update post visibility')
    }
  }

  const handleDeletePost = async (postId) => {
    if (!confirm('Delete this post?')) return

    try {
      await deleteDoc(doc(db, 'posts', postId))
      setPosts((previous) => previous.filter((entry) => entry.id !== postId))
    } catch (error) {
      console.error('Error deleting post:', error)
      alert('Failed to delete post')
    }
  }

  return (
    <div className="admin-content-tab">
      <div className="admin-content-header">
        <h2>Website Posts</h2>
        <p>Create announcements that appear on the website post board.</p>
      </div>

      <form className="admin-content-form" onSubmit={handleCreatePost}>
        <input
          type="text"
          placeholder="Post title"
          value={formData.title}
          onChange={(event) => setFormData({ ...formData, title: event.target.value })}
          required
        />
        <textarea
          rows={4}
          placeholder="Write the post body"
          value={formData.body}
          onChange={(event) => setFormData({ ...formData, body: event.target.value })}
          required
        />
        <input
          type="text"
          placeholder="Author (optional)"
          value={formData.author}
          onChange={(event) => setFormData({ ...formData, author: event.target.value })}
        />

        <label className="admin-checkbox-row">
          <input
            type="checkbox"
            checked={formData.published}
            onChange={(event) => setFormData({ ...formData, published: event.target.checked })}
          />
          Publish immediately
        </label>

        <button type="submit">Create Post</button>
      </form>

      {loading ? <p>Loading posts...</p> : null}

      <div className="admin-content-list">
        {posts.length === 0 && !loading ? <p>No posts yet.</p> : null}
        {posts.map((post) => (
          <article key={post.id} className="admin-content-card">
            <div className="admin-content-card-top">
              <h3>{post.title || 'Untitled post'}</h3>
              <span className={`status-pill ${(post.published ?? false) ? 'live' : 'draft'}`}>
                {(post.published ?? false) ? 'Published' : 'Draft'}
              </span>
            </div>
            <p className="admin-content-meta">{post.author || 'Admin'}</p>
            <p>{post.body || post.content || post.message || 'No body'}</p>
            <div className="admin-card-actions">
              <button type="button" onClick={() => handleTogglePublished(post)}>
                {(post.published ?? false) ? 'Move to Draft' : 'Publish'}
              </button>
              <button type="button" className="danger" onClick={() => handleDeletePost(post.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export default PostsTab
