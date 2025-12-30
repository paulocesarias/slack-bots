import { useState } from 'react'

function BotList({ bots, onBotDeleted, onStatusChanged, onError }) {
  const [actionLoading, setActionLoading] = useState({})

  const handleActivate = async (bot) => {
    setActionLoading(prev => ({ ...prev, [bot.id]: 'activate' }))
    try {
      const res = await fetch(`/api/bots/${bot.id}/activate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onStatusChanged()
    } catch (error) {
      onError(error.message)
    } finally {
      setActionLoading(prev => ({ ...prev, [bot.id]: null }))
    }
  }

  const handleDeactivate = async (bot) => {
    setActionLoading(prev => ({ ...prev, [bot.id]: 'deactivate' }))
    try {
      const res = await fetch(`/api/bots/${bot.id}/deactivate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onStatusChanged()
    } catch (error) {
      onError(error.message)
    } finally {
      setActionLoading(prev => ({ ...prev, [bot.id]: null }))
    }
  }

  const handleDelete = async (bot) => {
    if (!confirm(`Are you sure you want to delete bot "${bot.name}"? This will remove the workflow and credentials from n8n.`)) {
      return
    }

    setActionLoading(prev => ({ ...prev, [bot.id]: 'delete' }))
    try {
      const res = await fetch(`/api/bots/${bot.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onBotDeleted(bot.id)
    } catch (error) {
      onError(error.message)
    } finally {
      setActionLoading(prev => ({ ...prev, [bot.id]: null }))
    }
  }

  if (bots.length === 0) {
    return <p className="empty-state">No bots created yet. Create your first bot above!</p>
  }

  return (
    <div className="bot-list">
      {bots.map(bot => (
        <div key={bot.id} className={`bot-card ${bot.status}`}>
          <div className="bot-header">
            <h3>Slack Bot {bot.name}</h3>
            <span className={`status-badge ${bot.status}`}>
              {bot.status}
            </span>
          </div>

          <div className="bot-details">
            <div className="detail">
              <label>Linux User:</label>
              <code>{bot.username}</code>
            </div>
            {bot.description && (
              <div className="detail">
                <label>Description:</label>
                <span>{bot.description}</span>
              </div>
            )}
            <div className="detail">
              <label>Created:</label>
              <span>{new Date(bot.created_at).toLocaleString()}</span>
            </div>
          </div>

          <div className="bot-actions">
            <a
              href={`https://n8n.headbangtech.com/workflow/${bot.workflow_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="button secondary"
            >
              Open in n8n
            </a>

            {bot.status === 'active' ? (
              <button
                className="warning"
                onClick={() => handleDeactivate(bot)}
                disabled={actionLoading[bot.id]}
              >
                {actionLoading[bot.id] === 'deactivate' ? 'Deactivating...' : 'Deactivate'}
              </button>
            ) : (
              <button
                className="success"
                onClick={() => handleActivate(bot)}
                disabled={actionLoading[bot.id]}
              >
                {actionLoading[bot.id] === 'activate' ? 'Activating...' : 'Activate'}
              </button>
            )}

            <button
              className="danger"
              onClick={() => handleDelete(bot)}
              disabled={actionLoading[bot.id]}
            >
              {actionLoading[bot.id] === 'delete' ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default BotList
