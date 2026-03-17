import { useState } from 'react'
import PostsTab from './PostsTab'
import FavoritePlacesTab from './FavoritePlacesTab'
import CommunityBoardTab from './CommunityBoardTab'

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
      </div>

      {activeSection === 'posts' && <PostsTab user={user} />}
      {activeSection === 'places' && <FavoritePlacesTab />}
      {activeSection === 'community' && <CommunityBoardTab />}
    </div>
  )
}

export default WebsiteContentTab
