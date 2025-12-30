import { useState } from 'react'

function UserList({ users, onUserDeleted, onError }) {
  const [deleting, setDeleting] = useState(null)

  const handleDelete = async (username) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This will remove the Linux user and home directory.`)) {
      return
    }

    setDeleting(username)

    try {
      const res = await fetch(`/api/users/${username}`, {
        method: 'DELETE'
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user')
      }

      onUserDeleted(username)
    } catch (error) {
      onError(error.message)
    } finally {
      setDeleting(null)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString()
  }

  if (users.length === 0) {
    return (
      <div className="empty-state">
        <p>No users created yet.</p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Create your first user using the form.
        </p>
      </div>
    )
  }

  return (
    <div className="user-list">
      {users.map(user => (
        <div key={user.id} className="user-item">
          <h3>{user.username}</h3>
          <p>Created: {formatDate(user.created_at)}</p>

          <div className="meta">
            {user.ssh_private_key && (
              <span className="tag">Key Generated</span>
            )}
            {user.slack_channel_name && (
              <span className="tag">#{user.slack_channel_name}</span>
            )}
            {user.slack_app_name && (
              <span className="tag">{user.slack_app_name}</span>
            )}
          </div>

          <div className="actions">
            <button
              className="danger"
              onClick={() => handleDelete(user.username)}
              disabled={deleting === user.username}
            >
              {deleting === user.username ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default UserList
