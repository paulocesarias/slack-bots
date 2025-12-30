const forge = require('node-forge');
const crypto = require('crypto');

function generateKeyPair() {
  return new Promise((resolve, reject) => {
    // Generate RSA key pair using node-forge
    forge.pki.rsa.generateKeyPair({ bits: 4096, workers: -1 }, (err, keypair) => {
      if (err) {
        return reject(err);
      }

      try {
        // Convert to OpenSSH format
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
        const publicKey = keypair.publicKey;

        // Create SSH public key format
        const sshPublicKey = forgePublicKeyToSSH(publicKey);

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

function forgePublicKeyToSSH(publicKey) {
  // Get the modulus and exponent
  const n = publicKey.n;
  const e = publicKey.e;

  // Convert to buffers
  const nBytes = Buffer.from(n.toString(16), 'hex');
  const eBytes = Buffer.from(e.toString(16), 'hex');

  // Build SSH public key blob
  const typeBuffer = Buffer.from('ssh-rsa');
  const parts = [
    lengthPrefixed(typeBuffer),
    lengthPrefixed(padIfNeeded(eBytes)),
    lengthPrefixed(padIfNeeded(nBytes))
  ];

  const blob = Buffer.concat(parts);
  const base64 = blob.toString('base64');

  return `ssh-rsa ${base64} slack-bots-generated`;
}

function lengthPrefixed(buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.length, 0);
  return Buffer.concat([length, buffer]);
}

function padIfNeeded(buffer) {
  // If the high bit is set, we need to pad with a zero byte
  if (buffer[0] & 0x80) {
    return Buffer.concat([Buffer.from([0]), buffer]);
  }
  return buffer;
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
