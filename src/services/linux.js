const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const VALID_USERNAME_REGEX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

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
  const reserved = ['root', 'admin', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'mail', 'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc', 'gnats', 'nobody', 'systemd-network', 'systemd-resolve', 'syslog', 'messagebus', 'uuidd', 'dnsmasq', 'sshd'];

  if (reserved.includes(username)) {
    return { valid: false, error: 'Username is reserved' };
  }

  return { valid: true };
}

function userExists(username) {
  try {
    execSync(`id ${username}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function createUser(username, sshPublicKey) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (userExists(username)) {
    throw new Error(`User ${username} already exists`);
  }

  try {
    // Create user with home directory
    execSync(`useradd -m -s /bin/bash ${username}`, { stdio: 'pipe' });

    // Create .ssh directory
    const sshDir = `/home/${username}/.ssh`;
    fs.mkdirSync(sshDir, { mode: 0o700 });

    // Write authorized_keys
    const authorizedKeysPath = path.join(sshDir, 'authorized_keys');
    fs.writeFileSync(authorizedKeysPath, sshPublicKey.trim() + '\n', { mode: 0o600 });

    // Set ownership
    execSync(`chown -R ${username}:${username} ${sshDir}`);

    return {
      success: true,
      username,
      homeDir: `/home/${username}`
    };
  } catch (error) {
    // Cleanup on failure
    try {
      execSync(`userdel -r ${username}`, { stdio: 'ignore' });
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Failed to create user: ${error.message}`);
  }
}

async function deleteUser(username) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (!userExists(username)) {
    throw new Error(`User ${username} does not exist`);
  }

  try {
    // Kill any processes owned by the user
    try {
      execSync(`pkill -u ${username}`, { stdio: 'ignore' });
    } catch {
      // User might not have any running processes
    }

    // Delete user and home directory
    execSync(`userdel -r ${username}`, { stdio: 'pipe' });

    return { success: true, username };
  } catch (error) {
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}

function listUsers() {
  try {
    // Get users with UID >= 1000 (regular users)
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    const users = passwd
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [username, , uid] = line.split(':');
        return { username, uid: parseInt(uid, 10) };
      })
      .filter(user => user.uid >= 1000 && user.uid < 65534);

    return users;
  } catch (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }
}

module.exports = {
  validateUsername,
  userExists,
  createUser,
  deleteUser,
  listUsers
};
