CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  ssh_public_key TEXT NOT NULL,
  ssh_private_key TEXT,
  slack_app_name TEXT,
  slack_channel_id TEXT,
  slack_channel_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  description TEXT,
  ssh_credential_id TEXT,
  slack_credential_id TEXT,
  slack_credential_shared INTEGER DEFAULT 0,
  workflow_id TEXT,
  slack_channel_id TEXT,
  slack_channel_name TEXT,
  status TEXT DEFAULT 'created',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
