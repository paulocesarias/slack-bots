import { useState, useEffect } from 'react'
import UserForm from './components/UserForm'
import UserList from './components/UserList'
import KeyGenerator from './components/KeyGenerator'

function App() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      setUsers(data)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const handleUserCreated = (user) => {
    setUsers(prev => [user, ...prev])
    showMessage('success', `User "${user.username}" created successfully!`)
  }

  const handleUserDeleted = (username) => {
    setUsers(prev => prev.filter(u => u.username !== username))
    showMessage('success', `User "${username}" deleted successfully!`)
  }

  const handleError = (error) => {
    showMessage('error', error)
  }

  return (
    <div className="app">
      <header>
        <h1>Slack Bots</h1>
        <p>Provision Linux users with SSH keys and Slack channels</p>
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
