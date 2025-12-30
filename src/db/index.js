const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/slack-bots.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = {
  // Users
  createUser: db.prepare(`
    INSERT INTO users (username, ssh_public_key, ssh_private_key, slack_app_name, slack_channel_id, slack_channel_name)
    VALUES (@username, @sshPublicKey, @sshPrivateKey, @slackAppName, @slackChannelId, @slackChannelName)
  `),

  getUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),

  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),

  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),

  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `),

  db
};
