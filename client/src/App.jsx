import { useState, useEffect } from 'react'
import Login from './components/Login'
import BotForm from './components/BotForm'
import BotList from './components/BotList'

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [newBotResult, setNewBotResult] = useState(null) // For showing SSH key after creation

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/auth/me')
        const data = await res.json()
        if (data.authenticated) {
          setUser(data.user)
        }
      } catch (error) {
        console.error('Auth check failed:', error)
      } finally {
        setAuthLoading(false)
      }
    }
    checkAuth()
  }, [])

  const fetchBots = async () => {
    try {
      const res = await fetch('/api/bots')
      if (res.status === 401) {
        setUser(null)
        return
      }
      const data = await res.json()
      setBots(data)
    } catch (error) {
      console.error('Failed to fetch bots:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchBots()
    }
  }, [user])

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' })
      setUser(null)
      setBots([])
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 8000)
  }

  const handleBotCreated = (result) => {
    fetchBots()
    showMessage('success', result.message)
    // If SSH key was generated, show it to the user
    if (result.bot?.ssh_private_key) {
      setNewBotResult(result.bot)
    }
  }

  const handleBotDeleted = (botId) => {
    setBots(prev => prev.filter(b => b.id !== botId))
    showMessage('success', 'Bot deleted successfully!')
  }

  const handleBotStatusChanged = () => {
    fetchBots()
  }

  const handleError = (error) => {
    if (error.includes('Authentication')) {
      setUser(null)
      return
    }
    showMessage('error', error)
  }

  if (authLoading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <div className="app">
      <header>
        <div className="header-content">
          <div>
            <h1>Slack Bots</h1>
            <p>Create and manage Claude-powered Slack bots</p>
          </div>
          <div className="user-info">
            {user.picture && (
              <img src={user.picture} alt={user.name} className="avatar" />
            )}
            <div className="user-details">
              <span className="user-name">{user.name}</span>
              <span className="user-email">{user.email}</span>
            </div>
            <button className="secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {message && (
        <div className={`alert ${message.type}`}>
          {message.text}
        </div>
      )}

      {newBotResult && (
        <div className="modal-overlay" onClick={() => setNewBotResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Bot Created: {newBotResult.name}</h3>
            <p className="warning-text">
              Save this SSH private key now! It will NOT be shown again.
            </p>
            <div className="ssh-key-container">
              <label>SSH Private Key:</label>
              <textarea
                readOnly
                value={newBotResult.ssh_private_key}
                rows={15}
                onClick={e => e.target.select()}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newBotResult.ssh_private_key)
                  showMessage('success', 'SSH key copied to clipboard!')
                }}
              >
                Copy to Clipboard
              </button>
            </div>
            <div className="modal-info">
              <p><strong>Username:</strong> <code>{newBotResult.username}</code></p>
              <p><strong>CLI Tool:</strong> {newBotResult.cli_tool_name}</p>
              <p><strong>Workflow:</strong> <a href={newBotResult.workflow_url} target="_blank" rel="noopener noreferrer">Open in n8n</a></p>
            </div>
            <button className="primary" onClick={() => setNewBotResult(null)}>
              I've Saved the Key - Close
            </button>
          </div>
        </div>
      )}

      <div className="container">
        <div className="card">
          <h2>Create New Bot</h2>
          <BotForm
            onBotCreated={handleBotCreated}
            onError={handleError}
          />
        </div>

        <div className="card">
          <h2>Your Bots</h2>
          {loading ? (
            <div className="loading">Loading...</div>
          ) : (
            <BotList
              bots={bots}
              onBotDeleted={handleBotDeleted}
              onStatusChanged={handleBotStatusChanged}
              onError={handleError}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
