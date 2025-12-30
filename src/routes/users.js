const express = require('express');
const router = express.Router();
const db = require('../db');
const sshService = require('../services/ssh');
const linuxService = require('../services/linux');
const slackService = require('../services/slack');

// Get all users
router.get('/', (req, res) => {
  try {
    const users = db.getUsers.all();
    // Don't send private keys in list
    const sanitized = users.map(u => ({
      ...u,
      ssh_private_key: u.ssh_private_key ? '[STORED]' : null
    }));
    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single user
router.get('/:username', (req, res) => {
  try {
    const user = db.getUserByUsername.get(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Don't send private key
    user.ssh_private_key = user.ssh_private_key ? '[STORED]' : null;
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create user
router.post('/', async (req, res) => {
  const {
    username,
    sshPublicKey,
    generateKey,
    slackApiToken,
    slackAppName,
    slackChannelName
  } = req.body;

  try {
    // Validate username
    const validation = linuxService.validateUsername(username);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Check if user already exists in DB
    const existingUser = db.getUserByUsername.get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists in database' });
    }

    let publicKey = sshPublicKey;
    let privateKey = null;

    // Generate SSH key if requested
    if (generateKey) {
      const keypair = await sshService.generateKeyPair();
      publicKey = keypair.publicKey;
      privateKey = keypair.privateKey;
    } else if (!sshPublicKey) {
      return res.status(400).json({ error: 'Either provide an SSH public key or request key generation' });
    } else if (!sshService.validatePublicKey(sshPublicKey)) {
      return res.status(400).json({ error: 'Invalid SSH public key format' });
    }

    // Create Linux user
    await linuxService.createUser(username, publicKey);

    // Create Slack channel if token provided
    let slackChannelId = null;
    let slackChannelResult = null;

    if (slackApiToken && slackChannelName) {
      // Validate token first
      const tokenCheck = await slackService.validateToken(slackApiToken);
      if (!tokenCheck.valid) {
        // Rollback Linux user
        await linuxService.deleteUser(username);
        return res.status(400).json({ error: `Invalid Slack token: ${tokenCheck.error}` });
      }

      slackChannelResult = await slackService.createChannel(slackApiToken, slackChannelName);
      slackChannelId = slackChannelResult.channel.id;

      // Post welcome message
      await slackService.postMessage(
        slackApiToken,
        slackChannelId,
        `Welcome! This channel was created for user \`${username}\` by slack-bots.`
      );
    }

    // Save to database
    const result = db.createUser.run({
      username,
      sshPublicKey: publicKey,
      sshPrivateKey: privateKey,
      slackAppName: slackAppName || null,
      slackChannelId: slackChannelId,
      slackChannelName: slackChannelName || null
    });

    res.status(201).json({
      success: true,
      user: {
        id: result.lastInsertRowid,
        username,
        sshPublicKey: publicKey,
        sshPrivateKey: privateKey, // Only returned on creation if generated
        slackAppName,
        slackChannelId,
        slackChannelName,
        channelExisted: slackChannelResult?.existed || false
      }
    });
  } catch (error) {
    // Try to rollback Linux user on any error
    try {
      if (linuxService.userExists(username)) {
        await linuxService.deleteUser(username);
      }
    } catch {
      // Ignore rollback errors
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete user
router.delete('/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const user = db.getUserByUsername.get(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    // Delete Linux user if exists
    if (linuxService.userExists(username)) {
      await linuxService.deleteUser(username);
    }

    // Delete from database
    db.deleteUser.run(user.id);

    res.json({ success: true, username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
