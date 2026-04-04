import { useState } from 'react'
import PostsTab from './PostsTab'
import DrinksTab from './DrinksTab'
import FavoritePlacesTab from './FavoritePlacesTab'
import CommunityBoardTab from './CommunityBoardTab'
import ImageUploadTab from './ImageUploadTab'
import InstagramPostsTab from './InstagramPostsTab'

function WebsiteContentTab({ user }) {
  const [activeSection, setActiveSection] = useState('posts')

  return (
    <div className="website-content-tab">
      <div className="website-content-tabs">
        <button
          className={`website-content-tab-button ${activeSection === 'posts' ? 'active' : ''}`}
          onClick={() => setActiveSection('posts')}
        >
          Posts
        </button>
        <button
          className={`website-content-tab-button ${activeSection === 'drinks' ? 'active' : ''}`}
          onClick={() => setActiveSection('drinks')}
        >
          Drinks
        </button>
        <button
          className={`website-content-tab-button ${activeSection === 'places' ? 'active' : ''}`}
          onClick={() => setActiveSection('places')}
        >
          Favorite Places
        </button>
        <button
          className={`website-content-tab-button ${activeSection === 'community' ? 'active' : ''}`}
          onClick={() => setActiveSection('community')}
        >
          Community Board
        </button>
        <button
          className={`website-content-tab-button ${activeSection === 'images' ? 'active' : ''}`}
          onClick={() => setActiveSection('images')}
        >
          Images
        </button>
        <button
          className={`website-content-tab-button ${activeSection === 'instagram' ? 'active' : ''}`}
          onClick={() => setActiveSection('instagram')}
        >
          Instagram
        </button>
      </div>

      {activeSection === 'posts' && <PostsTab user={user} />}
      {activeSection === 'drinks' && <DrinksTab />}
      {activeSection === 'places' && <FavoritePlacesTab />}
      {activeSection === 'community' && <CommunityBoardTab />}
      {activeSection === 'images' && <ImageUploadTab />}
      {activeSection === 'instagram' && <InstagramPostsTab />}
    </div>
  )
}

export default WebsiteContentTab
