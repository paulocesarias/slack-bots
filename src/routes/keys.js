const express = require('express');
const router = express.Router();
const sshService = require('../services/ssh');

// Generate a new SSH keypair
router.post('/generate', async (req, res) => {
  try {
    const keypair = await sshService.generateKeyPair();
    res.json({
      success: true,
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate an SSH public key
router.post('/validate', (req, res) => {
  const { publicKey } = req.body;

  if (!publicKey) {
    return res.status(400).json({ error: 'Public key is required' });
  }

  const isValid = sshService.validatePublicKey(publicKey);
  res.json({ valid: isValid });
});

module.exports = router;
