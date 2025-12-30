import { useState, useEffect } from 'react'
import UserForm from './components/UserForm'
import UserList from './components/UserList'
import KeyGenerator from './components/KeyGenerator'
import Login from './components/Login'

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [users, setUsers] = useState([])
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

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users')
      if (res.status === 401) {
        setUser(null)
        return
      }
      const data = await res.json()
      setUsers(data)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchUsers()
    }
  }, [user])

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' })
      setUser(null)
      setUsers([])
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const handleUserCreated = (newUser) => {
    setUsers(prev => [newUser, ...prev])
    showMessage('success', `User "${newUser.username}" created successfully!`)
  }

  const handleUserDeleted = (username) => {
    setUsers(prev => prev.filter(u => u.username !== username))
    showMessage('success', `User "${username}" deleted successfully!`)
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
            <p>Provision Linux users with SSH keys and Slack channels</p>
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
        <div>
          <div className="card">
            <h2>Create New User</h2>
            <UserForm
              onUserCreated={handleUserCreated}
              onError={handleError}
            />
          </div>

          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h2>SSH Key Generator</h2>
            <KeyGenerator onError={handleError} />
          </div>
        </div>

        <div className="card">
          <h2>Created Users</h2>
          {loading ? (
            <div className="loading">Loading...</div>
          ) : (
            <UserList
              users={users}
              onUserDeleted={handleUserDeleted}
              onError={handleError}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
