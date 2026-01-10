const N8N_API_ENDPOINT = process.env.N8N_API_ENDPOINT || 'https://n8n.headbangtech.com/api/v1';
const N8N_API_KEY = process.env.N8N_API_KEY;
const SSH_HOST = process.env.SSH_HOST || '72.61.78.57';
const SSH_PORT = parseInt(process.env.SSH_PORT || '28473');

// Core Handler workflow ID (PROD) - all bots call this sub-workflow
const CORE_HANDLER_WORKFLOW_ID = 'SzSWuatYOMAXB2bz';

// CLI tool configurations
// Note: In v2 architecture, the Core Handler + claude-streamer.py handles execution
// These are kept for display purposes and future multi-tool support
const CLI_TOOLS = {
  claude: {
    name: 'Claude Code',
    description: 'Anthropic Claude-powered coding assistant with streaming responses',
  },
  codex: {
    name: 'Codex CLI',
    description: 'OpenAI Codex-based CLI tool (not yet supported in v2)',
    supported: false,
  },
  gemini: {
    name: 'Gemini CLI',
    description: 'Google Gemini-powered coding assistant (not yet supported in v2)',
    supported: false,
  },
  grok: {
    name: 'Grok CLI',
    description: 'xAI Grok-powered coding assistant (not yet supported in v2)',
    supported: false,
  },
  aider: {
    name: 'Aider',
    description: 'AI pair programming tool (not yet supported in v2)',
    supported: false,
  },
};

async function apiRequest(method, endpoint, body = null, retries = 3) {
  const options = {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${N8N_API_ENDPOINT}${endpoint}`, options);

      // Handle non-JSON responses (like Bad Gateway)
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // If it's a 502/503/504, retry
        if (response.status >= 500 && attempt < retries) {
          console.log(`n8n API error ${response.status}, retrying (${attempt}/${retries})...`);
          await new Promise(r => setTimeout(r, 1000 * attempt)); // exponential backoff
          continue;
        }
        throw new Error(`n8n API error: ${response.status} - ${text.substring(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(data.message || `n8n API error: ${response.status}`);
      }

      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries && error.message.includes('n8n API error: 5')) {
        console.log(`n8n API error, retrying (${attempt}/${retries})...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Create SSH Private Key credential
async function createSSHCredential(name, username, privateKey) {
  return apiRequest('POST', '/credentials', {
    name: `SSH - ${name}`,
    type: 'sshPrivateKey',
    data: {
      host: SSH_HOST,
      port: SSH_PORT,
      username: username,
      privateKey: privateKey,
    },
  });
}

// Create Slack API credential
async function createSlackCredential(name, accessToken) {
  return apiRequest('POST', '/credentials', {
    name: `Slack - ${name}`,
    type: 'slackApi',
    data: {
      accessToken: accessToken,
      signatureSecret: '',
      notice: '',
    },
  });
}

// Get template workflow
async function getWorkflow(workflowId) {
  return apiRequest('GET', `/workflows/${workflowId}`);
}

// Create a new workflow based on v2 template (sub-workflow architecture)
async function createWorkflow(name, username, sshCredentialId, sshCredentialName, slackCredentialId, slackCredentialName, slackChannelId, slackChannelName, slackToken, cliTool = 'claude') {
  // Generate unique IDs for this workflow
  const webhookId = generateUUID();

  // Build the v2 workflow structure directly (no template needed)
  // This uses the Core Handler sub-workflow architecture with streaming support
  const newWorkflow = {
    name: `Slack Bot ${name}`,
    nodes: [
      {
        parameters: {
          trigger: ['message'],
          channelId: {
            __rl: true,
            value: slackChannelId || 'CONFIGURE_ME',
            mode: slackChannelId ? 'id' : 'list',
            cachedResultName: slackChannelName || 'Select a channel',
          },
          options: {},
        },
        type: 'n8n-nodes-base.slackTrigger',
        typeVersion: 1,
        position: [160, 0],
        id: generateUUID(),
        name: 'Slack Trigger',
        webhookId: webhookId,
        credentials: {
          slackApi: {
            id: slackCredentialId,
            name: slackCredentialName,
          },
        },
      },
      {
        parameters: {
          workflowId: {
            __rl: true,
            value: CORE_HANDLER_WORKFLOW_ID,
            mode: 'id',
          },
          options: {},
        },
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [360, 0],
        id: generateUUID(),
        name: 'Call Core Handler',
      },
      {
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: '',
              typeValidation: 'strict',
              version: 3,
            },
            conditions: [
              {
                id: 'should-process',
                leftValue: '={{ $json.shouldProcess }}',
                rightValue: true,
                operator: {
                  type: 'boolean',
                  operation: 'equals',
                },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [560, 0],
        id: generateUUID(),
        name: 'Should Process?',
      },
      {
        parameters: {
          authentication: 'privateKey',
          command: `=# Deduplication check using lock file
MSG_TS="{{ $json.message_ts }}"
LOCK_FILE="/tmp/slack_lock_\${MSG_TS}"

# Try to create lock file - if it exists, another process is handling this
if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  echo "Duplicate message, skipping"
  exit 0
fi

# Clean up lock file after 60 seconds (in background)
(sleep 60 && rmdir "$LOCK_FILE" 2>/dev/null) &

# Export Slack token and run the Claude streamer script
export SLACK_TOKEN="${slackToken}"
python3 /opt/slack-bots/claude-streamer.py "{{ $json.channel }}" "{{ $json.thread_ts }}" "{{ $json.message_ts }}" "{{ $json.sessionId }}" "{{ $json.encodedMessage }}" "{{ $json.encodedFiles }}"`,
          cwd: `/home/${username}`,
        },
        type: 'n8n-nodes-base.ssh',
        typeVersion: 1,
        position: [760, 0],
        id: generateUUID(),
        name: 'Execute Claude with Streaming',
        credentials: {
          sshPrivateKey: {
            id: sshCredentialId,
            name: sshCredentialName,
          },
        },
      },
    ],
    connections: {
      'Slack Trigger': {
        main: [
          [
            {
              node: 'Call Core Handler',
              type: 'main',
              index: 0,
            },
          ],
        ],
      },
      'Call Core Handler': {
        main: [
          [
            {
              node: 'Should Process?',
              type: 'main',
              index: 0,
            },
          ],
        ],
      },
      'Should Process?': {
        main: [
          [
            {
              node: 'Execute Claude with Streaming',
              type: 'main',
              index: 0,
            },
          ],
        ],
      },
    },
    settings: {
      executionOrder: 'v1',
      callerPolicy: 'workflowsFromSameOwner',
    },
    staticData: null,
  };

  return apiRequest('POST', '/workflows', newWorkflow);
}

// Activate a workflow
async function activateWorkflow(workflowId) {
  return apiRequest('POST', `/workflows/${workflowId}/activate`);
}

// Deactivate a workflow
async function deactivateWorkflow(workflowId) {
  return apiRequest('POST', `/workflows/${workflowId}/deactivate`);
}

// Delete credential
async function deleteCredential(credentialId) {
  return apiRequest('DELETE', `/credentials/${credentialId}`);
}

// Delete workflow
async function deleteWorkflow(workflowId) {
  return apiRequest('DELETE', `/workflows/${workflowId}`);
}

// Get credential by ID - validates credential exists
async function getCredential(credentialId) {
  return apiRequest('GET', `/credentials/${credentialId}`);
}

// Helper to generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Get available CLI tools
function getAvailableCliTools() {
  return Object.entries(CLI_TOOLS).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: value.description,
    supported: value.supported !== false, // Default to true if not specified
  }));
}

// Extract webhook URL from a workflow
function getWebhookUrlFromWorkflow(workflow) {
  if (!workflow || !workflow.nodes) return null;

  const slackTrigger = workflow.nodes.find(node => node.type === 'n8n-nodes-base.slackTrigger');
  if (!slackTrigger || !slackTrigger.webhookId) return null;

  // Construct the webhook URL
  const baseUrl = N8N_API_ENDPOINT.replace('/api/v1', '');
  return `${baseUrl}/webhook/${slackTrigger.webhookId}/webhook`;
}

module.exports = {
  createSSHCredential,
  createSlackCredential,
  createWorkflow,
  activateWorkflow,
  deactivateWorkflow,
  deleteCredential,
  deleteWorkflow,
  getWorkflow,
  getCredential,
  getAvailableCliTools,
  getWebhookUrlFromWorkflow,
  CLI_TOOLS,
};
