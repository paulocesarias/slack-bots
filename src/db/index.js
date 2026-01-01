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
  // Check if slack_credential_shared column exists
  const tableInfo = db.prepare("PRAGMA table_info(bots)").all();
  const hasSharedColumn = tableInfo.some(col => col.name === 'slack_credential_shared');

  if (!hasSharedColumn) {
    console.log('Migrating: Adding slack_credential_shared column to bots table');
    db.exec('ALTER TABLE bots ADD COLUMN slack_credential_shared INTEGER DEFAULT 0');
  }
}

runMigrations();

// Export the raw db for direct queries in routes
module.exports = db;
