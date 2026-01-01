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

// Run migrations for existing databases
function runMigrations() {
  const tableInfo = db.prepare("PRAGMA table_info(bots)").all();
  const columnNames = tableInfo.map(col => col.name);

  // Check if slack_credential_shared column exists
  if (!columnNames.includes('slack_credential_shared')) {
    console.log('Migrating: Adding slack_credential_shared column to bots table');
    db.exec('ALTER TABLE bots ADD COLUMN slack_credential_shared INTEGER DEFAULT 0');
  }

  // Check if slack_channel_id column exists
  if (!columnNames.includes('slack_channel_id')) {
    console.log('Migrating: Adding slack_channel_id column to bots table');
    db.exec('ALTER TABLE bots ADD COLUMN slack_channel_id TEXT');
  }

  // Check if slack_channel_name column exists
  if (!columnNames.includes('slack_channel_name')) {
    console.log('Migrating: Adding slack_channel_name column to bots table');
    db.exec('ALTER TABLE bots ADD COLUMN slack_channel_name TEXT');
  }
}

runMigrations();

// Export the raw db for direct queries in routes
module.exports = db;
