import { useState } from 'react'

function KeyGenerator({ onError }) {
  const [loading, setLoading] = useState(false)
  const [keys, setKeys] = useState(null)

  const generateKeys = async () => {
    setLoading(true)
    setKeys(null)

    try {
      const res = await fetch('/api/keys/generate', {
        method: 'POST'
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate keys')
      }

      setKeys({
        publicKey: data.publicKey,
        privateKey: data.privateKey
      })
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

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem' }}>
        Generate an SSH key pair without creating a user. Useful for preparing keys in advance.
      </p>

      <button onClick={generateKeys} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Key Pair'}
      </button>

      {keys && (
        <div className="key-display">
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Public Key
              <button
                type="button"
                className="secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                onClick={() => copyToClipboard(keys.publicKey)}
              >
                Copy
              </button>
            </h4>
            <pre>{keys.publicKey}</pre>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Private Key
              <button
                type="button"
                className="secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                onClick={() => copyToClipboard(keys.privateKey)}
              >
                Copy
              </button>
            </h4>
            <pre>{keys.privateKey}</pre>
          </div>

          <div className="button-group">
            <button
              type="button"
              className="secondary"
              onClick={() => downloadKey(keys.privateKey, 'id_rsa')}
            >
              Download Private Key
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => downloadKey(keys.publicKey, 'id_rsa.pub')}
            >
              Download Public Key
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default KeyGenerator
