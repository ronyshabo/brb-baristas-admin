import { useState, useEffect } from 'react'
import { storage, db } from '../firebase/config'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { addDoc, collection, getDocs, deleteDoc, doc } from 'firebase/firestore'
import '../styles/AdminContentTabs.css'

function ImageUploadTab() {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [imageTitle, setImageTitle] = useState('')
  const [imageCategory, setImageCategory] = useState('general')

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

  // Load images on component mount
  useEffect(() => {
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
        uploadedAt: new Date(),
        fileSize: selectedFile.size,
        contentType: selectedFile.type,
      }

      const docRef = await addDoc(collection(db, 'images'), imageData)

      // Update local state
      setImages([{ id: docRef.id, ...imageData }, ...images])

      // Reset form
      setSelectedFile(null)
      setImageTitle('')
      setImageCategory('general')
      document.querySelector('.image-file-input').value = ''

      alert('Image uploaded successfully!')
    } catch (error) {
      console.error('Error uploading image:', error)
      alert('Failed to upload image. Check console for details.')
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
