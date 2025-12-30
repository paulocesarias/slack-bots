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
