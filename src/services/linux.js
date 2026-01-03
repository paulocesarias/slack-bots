const { execSync, spawn } = require('child_process');

const VALID_USERNAME_REGEX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

// SSH configuration from environment
const SSH_HOST = process.env.SSH_HOST || '127.0.0.1';
const SSH_PORT = process.env.SSH_PORT || '22';
const SSH_USER = process.env.SSH_USER || 'root';
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/app/ssh/id_rsa';

function sshExec(command, options = {}) {
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    '-p', SSH_PORT,
    '-i', SSH_KEY_PATH,
    `${SSH_USER}@${SSH_HOST}`,
    command
  ];

  try {
    const result = execSync(`ssh ${sshArgs.map(a => `"${a}"`).join(' ')}`, {
      encoding: 'utf8',
      stdio: options.stdio || 'pipe',
      timeout: options.timeout || 30000
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString() || ''
    };
  }
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }

  if (!VALID_USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error: 'Username must start with a letter, contain only lowercase letters, numbers, and hyphens, and be 2-32 characters long'
    };
  }

  // Check reserved usernames
  const reserved = ['root', 'admin', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'mail', 'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'gnats', 'nobody', 'systemd-network', 'systemd-resolve', 'syslog', 'messagebus', 'uuidd', 'dnsmasq', 'sshd', 'ubuntu', 'paulo'];

  if (reserved.includes(username)) {
    return { valid: false, error: 'Username is reserved' };
  }

  return { valid: true };
}

function userExists(username) {
  const result = sshExec(`id ${username} 2>/dev/null && echo EXISTS || echo NOTEXISTS`);
  if (!result.success) {
    return false;
  }
  return result.output.includes('EXISTS');
}

function createUser(username, sshPublicKey) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (userExists(username)) {
    return { success: false, error: `User ${username} already exists` };
  }

  // Escape the SSH key for shell
  const escapedKey = sshPublicKey.trim().replace(/'/g, "'\\''");

  // Create user with useradd, set up SSH directory and authorized_keys
  const commands = [
    `useradd -m -s /bin/bash ${username}`,
    `mkdir -p /home/${username}/.ssh`,
    `chmod 700 /home/${username}/.ssh`,
    `echo '${escapedKey}' > /home/${username}/.ssh/authorized_keys`,
    `chmod 600 /home/${username}/.ssh/authorized_keys`,
    `chown -R ${username}:${username} /home/${username}/.ssh`
  ].join(' && ');

  const result = sshExec(commands);

  if (!result.success) {
    return { success: false, error: result.error || result.stderr };
  }

  // Get the UID of the new user
  const uidResult = sshExec(`id -u ${username}`);
  const uid = uidResult.success ? parseInt(uidResult.output, 10) : null;

  return {
    success: true,
    username,
    homeDir: `/home/${username}`,
    uid
  };
}

function addAuthorizedKey(username, sshPublicKey) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (!sshPublicKey || typeof sshPublicKey !== 'string') {
    throw new Error('SSH public key is required');
  }

  if (!userExists(username)) {
    throw new Error(`User ${username} does not exist`);
  }

  // Escape the SSH key for shell
  const escapedKey = sshPublicKey.trim().replace(/'/g, "'\\''");

  const commands = [
    `mkdir -p /home/${username}/.ssh`,
    `chmod 700 /home/${username}/.ssh`,
    `echo '${escapedKey}' >> /home/${username}/.ssh/authorized_keys`,
    `chmod 600 /home/${username}/.ssh/authorized_keys`,
    `chown -R ${username}:${username} /home/${username}/.ssh`
  ].join(' && ');

  const result = sshExec(commands);

  if (!result.success) {
    throw new Error(`Failed to add SSH key: ${result.error || result.stderr}`);
  }

  return { success: true };
}

function deleteUser(username) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (!userExists(username)) {
    throw new Error(`User ${username} does not exist`);
  }

  // Kill processes, delete user and home directory
  const commands = [
    `pkill -u ${username} 2>/dev/null || true`,
    `userdel -r ${username}`
  ].join(' && ');

  const result = sshExec(commands);

  if (!result.success) {
    throw new Error(`Failed to delete user: ${result.error || result.stderr}`);
  }

  return { success: true, username };
}

function listUsers() {
  // Get users with UID >= 1000 and < 65534 (regular users)
  const result = sshExec(`awk -F: '$3 >= 1000 && $3 < 65534 { print $1":"$3 }' /etc/passwd`);

  if (!result.success) {
    throw new Error(`Failed to list users: ${result.error || result.stderr}`);
  }

  const users = result.output
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [username, uid] = line.split(':');
      return { username, uid: parseInt(uid, 10) };
    });

  return users;
}

module.exports = {
  validateUsername,
  userExists,
  createUser,
  addAuthorizedKey,
  deleteUser,
  listUsers
};
