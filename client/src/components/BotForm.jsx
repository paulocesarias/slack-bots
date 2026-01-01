import { useState, useEffect } from 'react'

function BotForm({ onBotCreated, onError }) {
  const [name, setName] = useState('')
  const [slackTokenMode, setSlackTokenMode] = useState('new') // 'new' or 'existing'
  const [slackToken, setSlackToken] = useState('')
  const [existingSlackCredId, setExistingSlackCredId] = useState('')
  const [existingSlackCreds, setExistingSlackCreds] = useState([])
  const [channelName, setChannelName] = useState('')
  const [customUsername, setCustomUsername] = useState('')
  const [sshPublicKey, setSshPublicKey] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingCreds, setLoadingCreds] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copied, setCopied] = useState(false)

  // Fetch existing Slack credentials when mode changes to 'existing'
  useEffect(() => {
    if (slackTokenMode === 'existing' && existingSlackCreds.length === 0) {
      setLoadingCreds(true)
      fetch('/api/bots/slack-credentials')
        .then(res => res.json())
        .then(data => {
          setExistingSlackCreds(data)
          if (data.length > 0) {
            setExistingSlackCredId(data[0].id)
          }
        })
        .catch(err => onError('Failed to load Slack credentials'))
        .finally(() => setLoadingCreds(false))
    }
  }, [slackTokenMode])

  const defaultUsername = `paulo-${name.toLowerCase() || 'name'}`
  const effectiveUsername = customUsername || defaultUsername

  const generateManifest = () => {
    return JSON.stringify({
      display_information: {
        name: `Claude Bot ${name.toUpperCase() || 'NAME'}`
      },
      features: {
        bot_user: {
          display_name: `Claude Bot ${name.toUpperCase() || 'NAME'}`,
          always_online: true
        }
      },
      oauth_config: {
        scopes: {
          bot: [
            "app_mentions:read",
            "channels:history",
            "channels:manage",
            "channels:read",
            "chat:write",
            "groups:history",
            "groups:read",
            "im:history",
            "im:read",
            "im:write",
            "files:read"
          ]
        }
      },
      settings: {
        event_subscriptions: {
          bot_events: [
            "app_mention",
            "message.im"
          ]
        },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false
      }
    }, null, 2)
  }

  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(generateManifest())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      onError('Failed to copy to clipboard')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const payload = {
        name,
        channelName: channelName || undefined,
        customUsername: customUsername || undefined,
        sshPublicKey: sshPublicKey || undefined,
        description
      }

      // Add Slack credential based on mode
      if (slackTokenMode === 'new') {
        payload.slackToken = slackToken
      } else {
        payload.existingSlackCredId = existingSlackCredId
      }

      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create bot')
      }

      onBotCreated(data)
      setName('')
      setSlackToken('')
      setChannelName('')
      setCustomUsername('')
      setSshPublicKey('')
      setDescription('')
      setShowAdvanced(false)
    } catch (error) {
      onError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bot-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Bot Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., BL, TP, SW"
            required
            pattern="[a-zA-Z0-9]+"
            title="Only letters and numbers allowed"
          />
          <small>Used for naming credentials and workflow in n8n</small>
        </div>

        <div className="form-group">
          <label>Slack Credential</label>
          <div className="slack-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${slackTokenMode === 'new' ? 'active' : ''}`}
              onClick={() => setSlackTokenMode('new')}
            >
              New Token
            </button>
            <button
              type="button"
              className={`mode-btn ${slackTokenMode === 'existing' ? 'active' : ''}`}
              onClick={() => setSlackTokenMode('existing')}
            >
              Use Existing
            </button>
          </div>
        </div>

        {slackTokenMode === 'new' ? (
          <div className="form-group">
            <label htmlFor="slackToken">
              Slack Bot OAuth Token
              <button
                type="button"
                className="help-toggle"
                onClick={() => setShowHelp(!showHelp)}
              >
                {showHelp ? 'Hide help' : 'How to create Slack App?'}
              </button>
            </label>
            <input
              id="slackToken"
              type="password"
              value={slackToken}
              onChange={(e) => setSlackToken(e.target.value)}
              placeholder="xoxb-..."
              required
            />
          </div>
        ) : (
          <div className="form-group">
            <label htmlFor="existingSlackCred">Select Existing Slack Credential</label>
            {loadingCreds ? (
              <p className="loading-text">Loading credentials...</p>
            ) : existingSlackCreds.length === 0 ? (
              <p className="no-creds-text">No existing Slack credentials found. Create a new token first.</p>
            ) : (
              <select
                id="existingSlackCred"
                value={existingSlackCredId}
                onChange={(e) => setExistingSlackCredId(e.target.value)}
                required
              >
                {existingSlackCreds.map(cred => (
                  <option key={cred.id} value={cred.id}>
                    {cred.name}
                  </option>
                ))}
              </select>
            )}
            <small>Reuse an existing Slack App credential for this bot</small>
          </div>
        )}

        {showHelp && (
          <div className="help-box">
            <h4>Quick Setup with App Manifest:</h4>
            <ol>
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">api.slack.com/apps</a></li>
              <li>Click <strong>"Create New App"</strong> → <strong>"From an app manifest"</strong></li>
              <li>Select your workspace</li>
              <li>Choose <strong>JSON</strong> tab and paste this manifest:</li>
            </ol>

            <div className="manifest-container">
              <pre className="manifest-code">{generateManifest()}</pre>
              <button type="button" className="copy-btn" onClick={copyManifest}>
                {copied ? 'Copied!' : 'Copy Manifest'}
              </button>
            </div>

            <ol start={5}>
              <li>Click <strong>"Next"</strong> → <strong>"Create"</strong></li>
              <li>Go to <strong>"Install App"</strong> in sidebar → <strong>"Install to Workspace"</strong></li>
              <li>Copy the <strong>"Bot User OAuth Token"</strong> (starts with xoxb-)</li>
            </ol>

            <div className="help-note">
              <strong>Note:</strong> Event subscriptions URL will be auto-configured when you activate the workflow in n8n.
            </div>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="channelName">Slack Channel Name (optional)</label>
          <input
            id="channelName"
            type="text"
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder={`claude-bot-${name.toLowerCase() || 'name'}`}
          />
          <small>Leave empty to use default: <code>claude-bot-{name.toLowerCase() || 'name'}</code></small>
        </div>

        <div className="advanced-toggle">
          <button
            type="button"
            className="toggle-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼ Hide Advanced Options' : '▶ Advanced Options (Linux user, SSH key)'}
          </button>
        </div>

        {showAdvanced && (
          <div className="advanced-options">
            <div className="form-group">
              <label htmlFor="customUsername">Linux Username (optional)</label>
              <input
                id="customUsername"
                type="text"
                value={customUsername}
                onChange={(e) => setCustomUsername(e.target.value)}
                placeholder={defaultUsername}
                pattern="[a-z][a-z0-9_-]*"
                title="Must start with lowercase letter, can contain lowercase letters, numbers, underscores, and hyphens"
              />
              <small>Leave empty to use default: <code>{defaultUsername}</code></small>
            </div>

            <div className="form-group">
              <label htmlFor="sshPublicKey">SSH Public Key (optional)</label>
              <textarea
                id="sshPublicKey"
                value={sshPublicKey}
                onChange={(e) => setSshPublicKey(e.target.value)}
                placeholder="ssh-rsa AAAA... or ssh-ed25519 AAAA..."
                rows={3}
              />
              <small>Provide your own public key, or leave empty to auto-generate a keypair</small>
            </div>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="description">Description (optional)</label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bot for project X"
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Creating Bot...' : 'Create Bot'}
        </button>
      </form>

      <div className="info-box">
        <h4>What happens when you create a bot:</h4>
        <ol>
          {slackTokenMode === 'new' ? (
            <>
              <li>Slack token is validated</li>
              <li>Slack channel <code>#{channelName || `claude-bot-${name.toLowerCase() || 'name'}`}</code> is created</li>
            </>
          ) : (
            <li>Existing Slack credential is used (channel creation skipped)</li>
          )}
          <li>Linux user <code>{effectiveUsername}</code> is created</li>
          <li>{sshPublicKey ? 'Your SSH public key is added' : 'SSH keypair is generated'} for n8n access</li>
          <li>n8n credentials (SSH {slackTokenMode === 'new' ? '+ Slack ' : ''}are created</li>
          <li>Workflow is cloned from template</li>
        </ol>
        <p>After creation, open the workflow in n8n to test and activate it.</p>
      </div>
    </div>
  )
}

export default BotForm
