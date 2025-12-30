const express = require('express');
const router = express.Router();
const db = require('../db');
const linuxService = require('../services/linux');
const sshService = require('../services/ssh');
const slackService = require('../services/slack');
const n8nService = require('../services/n8n');

// Get all bots
router.get('/', (req, res) => {
  try {
    const bots = db.prepare(`
      SELECT * FROM bots ORDER BY created_at DESC
    `).all();
    res.json(bots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single bot
router.get('/:id', (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    res.json(bot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new bot (full provisioning)
router.post('/', async (req, res) => {
  const {
    name,           // Bot name (e.g., "BL", "TP")
    slackToken,     // Slack Bot OAuth Token
    channelName,    // Optional: Slack channel name to create
    customUsername, // Optional: Custom Linux username
    sshPublicKey,   // Optional: User-provided SSH public key
    description,    // Optional description
  } = req.body;

  if (!name || !slackToken) {
    return res.status(400).json({ error: 'name and slackToken are required' });
  }

  // Validate name format (alphanumeric, lowercase)
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sanitizedName.length < 1 || sanitizedName.length > 20) {
    return res.status(400).json({ error: 'name must be 1-20 alphanumeric characters' });
  }

  // Use custom username if provided, otherwise default
  const username = customUsername || `paulo-${sanitizedName}`;

  // Validate username format if custom
  if (customUsername && !/^[a-z][a-z0-9_-]*$/.test(customUsername)) {
    return res.status(400).json({ error: 'username must start with lowercase letter and contain only lowercase letters, numbers, underscores, and hyphens' });
  }

  const botDisplayName = sanitizedName.toUpperCase();
  const defaultChannelName = channelName || `claude-bot-${sanitizedName}`;

  let sshCredential = null;
  let slackCredential = null;
  let workflow = null;
  let slackChannel = null;
  let keypair = null;

  try {
    // Step 1: Validate Slack token
    const tokenValidation = await slackService.validateToken(slackToken);
    if (!tokenValidation.valid) {
      throw new Error(`Invalid Slack token: ${tokenValidation.error}`);
    }

    // Step 2: Create Slack channel
    try {
      slackChannel = await slackService.createChannel(slackToken, defaultChannelName);
    } catch (channelError) {
      // Channel creation might fail due to missing scopes, continue anyway
      console.warn('Could not create Slack channel:', channelError.message);
    }

    // Step 3: Generate SSH keypair or use provided public key
    if (sshPublicKey) {
      // Validate the provided public key format
      const keyPattern = /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-dss)\s+[A-Za-z0-9+/]+[=]*(\s+.*)?$/;
      if (!keyPattern.test(sshPublicKey.trim())) {
        throw new Error('Invalid SSH public key format. Must be OpenSSH format (ssh-rsa, ssh-ed25519, etc.)');
      }
      keypair = { publicKey: sshPublicKey.trim(), privateKey: null };
    } else {
      keypair = sshService.generateKeyPair();
    }

    // Step 4: Create Linux user
    const userResult = linuxService.createUser(username, keypair.publicKey);
    if (!userResult.success) {
      // User might already exist, try to update SSH key
      if (userResult.error && userResult.error.includes('already exists')) {
        linuxService.addAuthorizedKey(username, keypair.publicKey);
      } else {
        throw new Error(`Failed to create Linux user: ${userResult.error}`);
      }
    }

    // Step 5: Create n8n SSH credential (only if we generated the keypair)
    if (keypair.privateKey) {
      sshCredential = await n8nService.createSSHCredential(
        botDisplayName,
        username,
        keypair.privateKey
      );
    } else {
      // User provided their own key - they need to configure n8n credential manually
      // Create a placeholder credential note
      console.log(`User provided SSH public key for ${username} - n8n SSH credential must be configured manually`);
    }

    // Step 6: Create n8n Slack credential
    slackCredential = await n8nService.createSlackCredential(
      botDisplayName,
      slackToken
    );

    // Step 7: Create n8n workflow from template
    workflow = await n8nService.createWorkflow(
      botDisplayName,
      username,
      sshCredential?.id || null,
      sshCredential?.name || `SSH - ${botDisplayName} (manual)`,
      slackCredential.id,
      slackCredential.name
    );

    // Step 8: Save bot to database
    const stmt = db.prepare(`
      INSERT INTO bots (name, username, description, ssh_credential_id, slack_credential_id, workflow_id, slack_channel_id, slack_channel_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created')
    `);
    const result = stmt.run(
      botDisplayName,
      username,
      description || null,
      sshCredential?.id || null,
      slackCredential.id,
      workflow.id,
      slackChannel?.channel?.id || null,
      slackChannel?.channel?.name || null
    );

    const messageparts = [];
    messageparts.push('Bot created successfully!');
    if (slackChannel) {
      messageparts.push(`Channel #${slackChannel.channel.name} was ${slackChannel.existed ? 'found' : 'created'}.`);
    }
    if (!keypair.privateKey) {
      messageparts.push('You provided your own SSH key - configure the n8n SSH credential manually.');
    }
    messageparts.push('Open the workflow in n8n to test and activate it.');

    res.json({
      success: true,
      bot: {
        id: result.lastInsertRowid,
        name: botDisplayName,
        username,
        workflow_id: workflow.id,
        workflow_url: `https://n8n.headbangtech.com/workflow/${workflow.id}`,
        slack_channel: slackChannel?.channel || null,
        status: 'created',
        ssh_key_provided: !!sshPublicKey,
      },
      message: messageparts.join(' '),
    });

  } catch (error) {
    // Rollback on failure
    console.error('Bot creation failed:', error);

    // Clean up created resources
    if (workflow) {
      try {
        await n8nService.deleteWorkflow(workflow.id);
      } catch (e) {
        console.error('Failed to delete workflow:', e);
      }
    }
    if (slackCredential) {
      try {
        await n8nService.deleteCredential(slackCredential.id);
      } catch (e) {
        console.error('Failed to delete Slack credential:', e);
      }
    }
    if (sshCredential) {
      try {
        await n8nService.deleteCredential(sshCredential.id);
      } catch (e) {
        console.error('Failed to delete SSH credential:', e);
      }
    }
    // Note: We don't delete the Linux user on failure as it might have existed before

    res.status(500).json({ error: error.message });
  }
});

// Activate a bot's workflow
router.post('/:id/activate', async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    await n8nService.activateWorkflow(bot.workflow_id);

    db.prepare('UPDATE bots SET status = ? WHERE id = ?').run('active', req.params.id);

    res.json({ success: true, message: 'Bot activated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deactivate a bot's workflow
router.post('/:id/deactivate', async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    await n8nService.deactivateWorkflow(bot.workflow_id);

    db.prepare('UPDATE bots SET status = ? WHERE id = ?').run('inactive', req.params.id);

    res.json({ success: true, message: 'Bot deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a bot (cleanup all resources)
router.delete('/:id', async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const errors = [];

    // Delete workflow
    if (bot.workflow_id) {
      try {
        await n8nService.deleteWorkflow(bot.workflow_id);
      } catch (e) {
        errors.push(`Failed to delete workflow: ${e.message}`);
      }
    }

    // Delete Slack credential
    if (bot.slack_credential_id) {
      try {
        await n8nService.deleteCredential(bot.slack_credential_id);
      } catch (e) {
        errors.push(`Failed to delete Slack credential: ${e.message}`);
      }
    }

    // Delete SSH credential
    if (bot.ssh_credential_id) {
      try {
        await n8nService.deleteCredential(bot.ssh_credential_id);
      } catch (e) {
        errors.push(`Failed to delete SSH credential: ${e.message}`);
      }
    }

    // Optionally delete Linux user (commented out for safety)
    // if (bot.username) {
    //   try {
    //     linuxService.deleteUser(bot.username);
    //   } catch (e) {
    //     errors.push(`Failed to delete Linux user: ${e.message}`);
    //   }
    // }

    // Delete from database
    db.prepare('DELETE FROM bots WHERE id = ?').run(req.params.id);

    if (errors.length > 0) {
      res.json({
        success: true,
        message: 'Bot deleted with some errors',
        errors
      });
    } else {
      res.json({ success: true, message: 'Bot deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
