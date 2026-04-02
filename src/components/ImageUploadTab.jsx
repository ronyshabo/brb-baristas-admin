import { useState, useEffect } from 'react'
import { storage, db } from '../firebase/config'
import { ref, uploadBytes, getDownloadURL, deleteObject, list } from 'firebase/storage'
import { addDoc, collection, getDocs, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import '../styles/AdminContentTabs.css'

function ImageUploadTab() {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [imageTitle, setImageTitle] = useState('')
  const [imageCategory, setImageCategory] = useState('general')
  const [storageStatus, setStorageStatus] = useState('checking')
  const [uploadError, setUploadError] = useState(null)

  // Load images from Firestore metadata and Storage
  const loadImages = async () => {
    try {
      setLoading(true)
      const snapshot = await getDocs(collection(db, 'images'))
      const imageList = []
      snapshot.forEach((entry) => {
        imageList.push({ id: entry.id, ...entry.data() })
      })
      setImages(imageList.sort((a, b) => (b.uploadedAt?.toDate?.() || new Date(0)) - (a.uploadedAt?.toDate?.() || new Date(0))))
    } catch (error) {
      console.error('Error loading images:', error)
      alert('Failed to load images')
    } finally {
      setLoading(false)
    }
  }

  // Check storage connectivity and load images on mount
  useEffect(() => {
    const checkStorage = async () => {
      try {
        const rootRef = ref(storage, 'images')
        await list(rootRef, { maxResults: 1 })
        setStorageStatus('connected')
      } catch (error) {
        console.error('Storage check failed:', error)
        if (error.code === 'storage/unauthorized') {
          setStorageStatus('unauthorized')
        } else if (error.code === 'storage/invalid-default-bucket') {
          setStorageStatus('no-bucket')
        } else {
          setStorageStatus('error')
        }
      }
    }
    checkStorage()
    loadImages()
  }, [])

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file)
    } else {
      alert('Please select a valid image file')
      setSelectedFile(null)
    }
  }

  const handleUploadImage = async (e) => {
    e.preventDefault()

    if (!selectedFile) {
      alert('Please select an image file')
      return
    }

    if (!imageTitle.trim()) {
      alert('Please enter an image title')
      return
    }

    try {
      setUploading(true)
      setUploadError(null)

      // Create a unique filename with timestamp
      const timestamp = Date.now()
      const filename = `${timestamp}_${selectedFile.name}`
      const fileRef = ref(storage, `images/${imageCategory}/${filename}`)

      // Upload to Firebase Storage
      await uploadBytes(fileRef, selectedFile)

      // Get download URL
      const downloadURL = await getDownloadURL(fileRef)

      // Save metadata to Firestore
      const imageData = {
        title: imageTitle.trim(),
        category: imageCategory,
        fileName: filename,
        downloadURL,
        storagePath: `images/${imageCategory}/${filename}`,
        uploadedAt: serverTimestamp(),
        fileSize: selectedFile.size,
        contentType: selectedFile.type,
      }

      const docRef = await addDoc(collection(db, 'images'), imageData)

      // Update local state
      setImages([{ id: docRef.id, ...imageData, uploadedAt: new Date() }, ...images])

      // Reset form
      setSelectedFile(null)
      setImageTitle('')
      setImageCategory('general')
      document.querySelector('.image-file-input').value = ''

      alert('Image uploaded successfully!')
    } catch (error) {
      console.error('Error uploading image:', error)
      let errorMsg = 'Failed to upload image.'
      if (error.code === 'storage/unauthorized') {
        errorMsg += ' Permission denied — Firebase Storage rules need to allow authenticated writes. Go to Firebase Console > Storage > Rules.'
      } else if (error.code === 'storage/canceled') {
        errorMsg += ' Upload was canceled.'
      } else if (error.code === 'storage/unknown') {
        errorMsg += ' Unknown error. Check your network connection and CORS settings.'
      } else if (error.code === 'storage/invalid-default-bucket') {
        errorMsg += ' Storage bucket is not configured. Check VITE_FIREBASE_STORAGE_BUCKET in your environment.'
      } else {
        errorMsg += ` ${error.code || ''}: ${error.message}`
      }
      setUploadError(errorMsg)
      alert(errorMsg)
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteImage = async (imageId, imagePath) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    try {
      // Delete from Firestore
      await deleteDoc(doc(db, 'images', imageId))

      // Delete from Storage
      const fileRef = ref(storage, imagePath)
      await deleteObject(fileRef)

      // Update local state
      setImages(images.filter((img) => img.id !== imageId))
      alert('Image deleted successfully!')
    } catch (error) {
      console.error('Error deleting image:', error)
      alert('Failed to delete image. Check console for details.')
    }
  }

  return (
    <div className="admin-tab-container">
      <h2>Image Upload</h2>

      {storageStatus === 'no-bucket' && (
        <div style={{ background: '#fee', border: '1px solid #c00', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          <strong>Storage not configured:</strong> The VITE_FIREBASE_STORAGE_BUCKET environment variable is missing or empty. Image uploads will not work until this is set.
        </div>
      )}
      {storageStatus === 'unauthorized' && (
        <div style={{ background: '#fff3e0', border: '1px solid #e65100', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          <strong>Storage access denied:</strong> Firebase Storage security rules are blocking access. Go to <strong>Firebase Console → Storage → Rules</strong> and make sure authenticated users can read/write. Example rule:
          <pre style={{ background: '#f5f5f5', padding: '8px', marginTop: '8px', fontSize: '13px' }}>{`rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}`}</pre>
        </div>
      )}
      {uploadError && (
        <div style={{ background: '#fee', border: '1px solid #c00', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {uploadError}
        </div>
      )}

      <form onSubmit={handleUploadImage} className="image-upload-form">
        <div className="form-group">
          <label htmlFor="image-title">Image Title:</label>
          <input
            id="image-title"
            type="text"
            value={imageTitle}
            onChange={(e) => setImageTitle(e.target.value)}
            placeholder="Enter image title"
            disabled={uploading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="image-category">Category:</label>
          <select
            id="image-category"
            value={imageCategory}
            onChange={(e) => setImageCategory(e.target.value)}
            disabled={uploading}
          >
            <option value="general">General</option>
            <option value="drinks">Drinks</option>
            <option value="events">Events</option>
            <option value="favorites">Favorite Places</option>
            <option value="community">Community</option>
            <option value="gallery">Gallery</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="image-file">Select Image:</label>
          <input
            id="image-file"
            className="image-file-input"
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={uploading}
          />
        </div>

        <button type="submit" disabled={uploading || !selectedFile}>
          {uploading ? 'Uploading...' : 'Upload Image'}
        </button>
      </form>

      <hr />

      <h3>Uploaded Images ({images.length})</h3>

      {loading ? (
        <p>Loading images...</p>
      ) : images.length === 0 ? (
        <p>No images uploaded yet</p>
      ) : (
        <div className="images-grid">
          {images.map((image) => (
            <div key={image.id} className="image-card">
              <img
                src={image.downloadURL}
                alt={image.title}
                className="image-thumbnail"
              />
              <div className="image-info">
                <h4>{image.title}</h4>
                <p className="image-category">{image.category}</p>
                <p className="image-date">
                  {new Date(image.uploadedAt?.toDate?.() || image.uploadedAt).toLocaleDateString()}
                </p>
                <a
                  href={image.downloadURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="image-link"
                >
                  View
                </a>
                <button
                  onClick={() => handleDeleteImage(image.id, image.storagePath)}
                  className="delete-button"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageUploadTab
