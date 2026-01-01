const N8N_API_ENDPOINT = process.env.N8N_API_ENDPOINT || 'https://n8n.headbangtech.com/api/v1';
const N8N_API_KEY = process.env.N8N_API_KEY;
const SSH_HOST = process.env.SSH_HOST || '72.61.78.57';
const SSH_PORT = parseInt(process.env.SSH_PORT || '22');

async function apiRequest(method, endpoint, body = null) {
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

  const response = await fetch(`${N8N_API_ENDPOINT}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `n8n API error: ${response.status}`);
  }

  return data;
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
    },
  });
}

// Get template workflow
async function getWorkflow(workflowId) {
  return apiRequest('GET', `/workflows/${workflowId}`);
}

// Create a new workflow based on template
async function createWorkflow(name, username, sshCredentialId, sshCredentialName, slackCredentialId, slackCredentialName) {
  // Get template workflow (Slack Bot TP)
  const templateId = process.env.N8N_TEMPLATE_WORKFLOW_ID || 'JTlX2bfBh6O4HcAR';
  const template = await getWorkflow(templateId);

  // Clone and modify the workflow
  const newWorkflow = {
    name: `Slack Bot ${name}`,
    nodes: template.nodes.map(node => {
      const newNode = { ...node };

      // Update SSH node
      if (node.type === 'n8n-nodes-base.ssh') {
        newNode.parameters = {
          ...node.parameters,
          cwd: `/home/${username}`,
        };
        newNode.credentials = {
          sshPrivateKey: {
            id: sshCredentialId,
            name: sshCredentialName,
          },
        };
      }

      // Update Slack nodes
      if (node.type === 'n8n-nodes-base.slack') {
        newNode.credentials = {
          slackApi: {
            id: slackCredentialId,
            name: slackCredentialName,
          },
        };
      }

      // Generate new IDs for nodes
      newNode.id = generateUUID();

      return newNode;
    }),
    connections: template.connections,
    settings: template.settings,
    staticData: null,
    active: false, // Start inactive, user can activate after testing
  };

  return apiRequest('POST', '/workflows', newWorkflow);
}

// Activate a workflow
async function activateWorkflow(workflowId) {
  return apiRequest('PATCH', `/workflows/${workflowId}`, { active: true });
}

// Deactivate a workflow
async function deactivateWorkflow(workflowId) {
  return apiRequest('PATCH', `/workflows/${workflowId}`, { active: false });
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
};
