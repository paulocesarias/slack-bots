const { execSync } = require('child_process');
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
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    return passwd.split('\n').some(line => line.startsWith(username + ':'));
  } catch {
    return false;
  }
}

function getNextUid() {
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  const uids = passwd
    .split('\n')
    .filter(line => line.trim())
    .map(line => parseInt(line.split(':')[2], 10))
    .filter(uid => uid >= 1000 && uid < 65534);

  const maxUid = uids.length > 0 ? Math.max(...uids) : 999;
  return maxUid + 1;
}

function createUser(username, sshPublicKey) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (userExists(username)) {
    return { success: false, error: `User ${username} already exists` };
  }

  try {
    const uid = getNextUid();
    const homeDir = `/home/${username}`;

    // Append to /etc/passwd
    const passwdLine = `${username}:x:${uid}:${uid}::/home/${username}:/bin/bash\n`;
    fs.appendFileSync('/etc/passwd', passwdLine);

    // Append to /etc/group
    const groupLine = `${username}:x:${uid}:\n`;
    fs.appendFileSync('/etc/group', groupLine);

    // Append to /etc/shadow (locked password - no login via password)
    const shadowLine = `${username}:!:19000:0:99999:7:::\n`;
    fs.appendFileSync('/etc/shadow', shadowLine);

    // Create home directory
    fs.mkdirSync(homeDir, { recursive: true, mode: 0o755 });

    // Create .ssh directory
    const sshDir = path.join(homeDir, '.ssh');
    fs.mkdirSync(sshDir, { mode: 0o700 });

    // Write authorized_keys
    const authorizedKeysPath = path.join(sshDir, 'authorized_keys');
    fs.writeFileSync(authorizedKeysPath, sshPublicKey.trim() + '\n', { mode: 0o600 });

    // Set ownership using chown command
    execSync(`chown -R ${uid}:${uid} ${homeDir}`, { stdio: 'pipe' });

    return {
      success: true,
      username,
      homeDir,
      uid
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
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

  try {
    const sshDir = `/home/${username}/.ssh`;
    const authorizedKeysPath = path.join(sshDir, 'authorized_keys');

    // Create .ssh directory if it doesn't exist
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { mode: 0o700 });
    }

    // Append key to authorized_keys
    fs.appendFileSync(authorizedKeysPath, sshPublicKey.trim() + '\n', { mode: 0o600 });

    // Fix ownership
    execSync(`chown -R ${username}:${username} ${sshDir}`, { stdio: 'pipe' });

    return { success: true };
  } catch (error) {
    throw new Error(`Failed to add SSH key: ${error.message}`);
  }
}

function deleteUser(username) {
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

    // Remove from /etc/passwd
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    const newPasswd = passwd.split('\n').filter(line => !line.startsWith(username + ':')).join('\n');
    fs.writeFileSync('/etc/passwd', newPasswd);

    // Remove from /etc/group
    const group = fs.readFileSync('/etc/group', 'utf8');
    const newGroup = group.split('\n').filter(line => !line.startsWith(username + ':')).join('\n');
    fs.writeFileSync('/etc/group', newGroup);

    // Remove from /etc/shadow
    const shadow = fs.readFileSync('/etc/shadow', 'utf8');
    const newShadow = shadow.split('\n').filter(line => !line.startsWith(username + ':')).join('\n');
    fs.writeFileSync('/etc/shadow', newShadow);

    // Remove home directory
    const homeDir = `/home/${username}`;
    if (fs.existsSync(homeDir)) {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }

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
  addAuthorizedKey,
  deleteUser,
  listUsers
};
