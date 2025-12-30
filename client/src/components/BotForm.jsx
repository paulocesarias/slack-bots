import { useState } from 'react'

function BotForm({ onBotCreated, onError }) {
  const [name, setName] = useState('')
  const [slackToken, setSlackToken] = useState('')
  const [channelName, setChannelName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slackToken, channelName: channelName || undefined, description })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create bot')
      }

      onBotCreated(data)
      setName('')
      setSlackToken('')
      setChannelName('')
      setDescription('')
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
          <small>This will create Linux user: paulo-{name.toLowerCase() || 'name'}</small>
        </div>

        <div className="form-group">
          <label htmlFor="slackToken">
            Slack Bot OAuth Token
            <button
              type="button"
              className="help-toggle"
              onClick={() => setShowHelp(!showHelp)}
            >
              {showHelp ? 'Hide help' : 'How to get this?'}
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

        {showHelp && (
          <div className="help-box">
            <h4>How to get a Slack Bot Token:</h4>
            <ol>
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">api.slack.com/apps</a></li>
              <li>Click "Create New App" → "From scratch"</li>
              <li>Name your app (e.g., "Claude Bot BL") and select your workspace</li>
              <li>Go to "OAuth & Permissions" in the sidebar</li>
              <li>Add these Bot Token Scopes:
                <ul>
                  <li><code>app_mentions:read</code></li>
                  <li><code>channels:history</code></li>
                  <li><code>channels:manage</code> (for channel creation)</li>
                  <li><code>chat:write</code></li>
                  <li><code>im:history</code></li>
                  <li><code>im:read</code></li>
                  <li><code>im:write</code></li>
                </ul>
              </li>
              <li>Click "Install to Workspace" at the top</li>
              <li>Copy the "Bot User OAuth Token" (starts with xoxb-)</li>
              <li>Go to "Event Subscriptions" → Enable Events</li>
              <li>Subscribe to bot events: <code>app_mention</code>, <code>message.im</code></li>
            </ol>
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
          <li>Slack token is validated</li>
          <li>Slack channel <code>#{channelName || `claude-bot-${name.toLowerCase() || 'name'}`}</code> is created</li>
          <li>Linux user <code>paulo-{name.toLowerCase() || 'name'}</code> is created</li>
          <li>SSH keypair is generated for n8n access</li>
          <li>n8n credentials (SSH + Slack) are created</li>
          <li>Workflow is cloned from template</li>
        </ol>
        <p>After creation, open the workflow in n8n to test and activate it.</p>
      </div>
    </div>
  )
}

export default BotForm
