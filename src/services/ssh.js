const forge = require('node-forge');

function generateKeyPair() {
  return new Promise((resolve, reject) => {
    // Generate RSA key pair using node-forge
    forge.pki.rsa.generateKeyPair({ bits: 4096, workers: -1 }, (err, keypair) => {
      if (err) {
        return reject(err);
      }

      try {
        // Convert private key to PEM format
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

        // Convert public key to OpenSSH format
        const sshPublicKey = forge.ssh.publicKeyToOpenSSH(keypair.publicKey, 'slack-bots-generated');

        resolve({
          publicKey: sshPublicKey,
          privateKey: privateKeyPem
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function validatePublicKey(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const trimmed = key.trim();

  // Check for common SSH key formats
  const validPrefixes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];

  return validPrefixes.some(prefix => trimmed.startsWith(prefix));
}

module.exports = {
  generateKeyPair,
  validatePublicKey
};
