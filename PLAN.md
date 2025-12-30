# Slack-Bots Web App Implementation Plan

## Overview
Build a web app to provision Linux users with SSH keys and create corresponding Slack apps/channels.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  - Form to input: username, SSH key (or generate), Slack config │
│  - Display created resources and history                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Express API)                        │
│  POST /api/users - Create user with SSH key + Slack resources   │
│  GET /api/users - List created users                            │
│  POST /api/keys/generate - Generate SSH keypair                 │
│  GET /api/health - Health check                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌───────────┐   ┌───────────┐
        │  SQLite  │   │  Local    │   │  Slack    │
        │ Database │   │  System   │   │   API     │
        │ (history)│   │ (useradd) │   │           │
        └──────────┘   └───────────┘   └───────────┘
```

## Tech Stack

### Backend
- **Express.js** - API server (existing)
- **better-sqlite3** - SQLite database for history
- **node-forge** or **ssh-keygen** - SSH key generation
- **@slack/web-api** - Slack API client

### Frontend
- **React** - UI framework
- **Vite** - Build tool
- Simple CSS (no framework, keep it lightweight)

## Project Structure

```
slack-bots/
├── src/
│   ├── index.js              # Express server entry
│   ├── routes/
│   │   ├── users.js          # User creation endpoints
│   │   └── keys.js           # SSH key endpoints
│   ├── services/
│   │   ├── linux.js          # Linux user management
│   │   ├── slack.js          # Slack API integration
│   │   └── ssh.js            # SSH key generation
│   └── db/
│       ├── index.js          # Database connection
│       └── schema.sql        # Table definitions
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── UserForm.jsx
│   │   │   ├── UserList.jsx
│   │   │   └── KeyGenerator.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── vite.config.js
├── data/                     # SQLite DB + generated keys
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Database Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  ssh_public_key TEXT NOT NULL,
  ssh_private_key TEXT,  -- Only stored if we generated it
  slack_app_name TEXT,
  slack_channel_id TEXT,
  slack_channel_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## API Endpoints

### POST /api/users
Create a new user with SSH key and Slack resources.

**Request:**
```json
{
  "username": "john-doe",
  "sshPublicKey": "ssh-rsa AAAA...",  // or null to generate
  "slackApiToken": "xoxb-...",
  "slackAppName": "john-doe-bot",
  "slackChannelName": "john-doe-channel"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "john-doe",
    "sshPublicKey": "ssh-rsa AAAA...",
    "sshPrivateKey": "-----BEGIN...",  // only if generated
    "slackChannelId": "C0123456789",
    "slackChannelName": "john-doe-channel"
  }
}
```

### GET /api/users
List all created users.

### POST /api/keys/generate
Generate a new SSH keypair without creating a user.

**Response:**
```json
{
  "publicKey": "ssh-rsa AAAA...",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----..."
}
```

## Implementation Steps

1. **Backend Setup**
   - Add dependencies (better-sqlite3, @slack/web-api, ssh-keygen)
   - Create database schema and connection
   - Implement SSH key generation service
   - Implement Linux user creation service (useradd, authorized_keys)
   - Implement Slack API service (create channel, create app manifest)
   - Create API routes

2. **Frontend Setup**
   - Initialize Vite + React in /client
   - Create form component for user input
   - Create user list component
   - Add key generation UI with download option
   - Style with simple CSS

3. **Docker Updates**
   - Multi-stage build (build React, serve with Express)
   - Mount volume for SQLite persistence
   - Add required system packages for useradd

4. **Security Considerations**
   - Slack token passed per-request (not stored)
   - Private keys shown once, optionally stored
   - Input validation for usernames
   - Rate limiting on user creation

## Form Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Linux Username | text | Yes | Username to create (alphanumeric + hyphen) |
| SSH Public Key | textarea | No* | Paste existing key |
| Generate Key Pair | checkbox | No* | Generate new keypair |
| Slack API Token | password | Yes | Bot token (xoxb-...) |
| Slack App Name | text | Yes | Name for the Slack app |
| Slack Channel Name | text | Yes | Channel to create |

*Either provide SSH key or check generate option

## Docker Considerations

The container needs privileges to create system users:
- Run as root or with sudo capabilities
- Mount /etc/passwd, /etc/shadow, /home (or use host networking)
- Alternative: Execute via SSH to host from container

**Recommended approach:** Container executes commands on host via mounted Docker socket or SSH to localhost.
