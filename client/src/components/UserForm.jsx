import { useState } from 'react'

function UserForm({ onUserCreated, onError }) {
  const [formData, setFormData] = useState({
    username: '',
    sshPublicKey: '',
    generateKey: false,
    slackApiToken: '',
    slackAppName: '',
    slackChannelName: ''
  })
  const [loading, setLoading] = useState(false)
  const [createdKey, setCreatedKey] = useState(null)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setCreatedKey(null)

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user')
      }

      // Store private key if generated
      if (data.user.sshPrivateKey) {
        setCreatedKey({
          publicKey: data.user.sshPublicKey,
          privateKey: data.user.sshPrivateKey
        })
      }

      onUserCreated(data.user)

      // Reset form (but keep Slack token for convenience)
      setFormData(prev => ({
        username: '',
        sshPublicKey: '',
        generateKey: false,
        slackApiToken: prev.slackApiToken,
        slackAppName: '',
        slackChannelName: ''
      }))
    } catch (error) {
      onError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadKey = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="section-title">Linux User</div>

      <div className="form-group">
        <label htmlFor="username">Username</label>
        <input
          type="text"
          id="username"
          name="username"
          value={formData.username}
          onChange={handleChange}
          placeholder="john-doe"
          pattern="^[a-z][a-z0-9-]{0,30}[a-z0-9]$"
          required
        />
      </div>

      <div className="divider" />
      <div className="section-title">SSH Key</div>

      <div className="form-group checkbox-group">
        <input
          type="checkbox"
          id="generateKey"
          name="generateKey"
          checked={formData.generateKey}
          onChange={handleChange}
        />
        <label htmlFor="generateKey">Generate new SSH key pair</label>
      </div>

      {!formData.generateKey && (
        <div className="form-group">
          <label htmlFor="sshPublicKey">SSH Public Key</label>
          <textarea
            id="sshPublicKey"
            name="sshPublicKey"
            value={formData.sshPublicKey}
            onChange={handleChange}
            placeholder="ssh-rsa AAAA... or ssh-ed25519 AAAA..."
            required={!formData.generateKey}
          />
        </div>
      )}

      <div className="divider" />
      <div className="section-title">Slack Integration (Optional)</div>

      <div className="form-group">
        <label htmlFor="slackApiToken">Slack Bot Token</label>
        <input
          type="password"
          id="slackApiToken"
          name="slackApiToken"
          value={formData.slackApiToken}
          onChange={handleChange}
          placeholder="xoxb-..."
        />
      </div>

      <div className="form-group">
        <label htmlFor="slackAppName">Slack App Name</label>
        <input
          type="text"
          id="slackAppName"
          name="slackAppName"
          value={formData.slackAppName}
          onChange={handleChange}
          placeholder="my-bot"
        />
      </div>

      <div className="form-group">
        <label htmlFor="slackChannelName">Slack Channel Name</label>
        <input
          type="text"
          id="slackChannelName"
          name="slackChannelName"
          value={formData.slackChannelName}
          onChange={handleChange}
          placeholder="john-doe-channel"
        />
      </div>

      <div className="button-group">
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create User'}
        </button>
      </div>

      {createdKey && (
        <div className="key-display">
          <h4>Generated SSH Keys (save these now!)</h4>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Public Key:</strong>
            <pre>{createdKey.publicKey}</pre>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Private Key:</strong>
            <pre>{createdKey.privateKey}</pre>
          </div>

          <div className="button-group">
            <button
              type="button"
              className="secondary"
              onClick={() => downloadKey(createdKey.privateKey, 'id_rsa')}
            >
              Download Private Key
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadKey(createdKey.publicKey, 'id_rsa.pub')}
            >
              Download Public Key
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

export default UserForm
