# Slack Bots - User Provisioning

Web application for provisioning Linux users with SSH access and Slack integration.

## Features

- Create Linux users on the host system
- Generate SSH keypairs or use existing public keys
- Configure Slack API integration
- Create Slack channels and apps
- Google SSO authentication for secure access
- SQLite database for tracking provisioned users

## Deployment

The app is deployed at https://slackbots.headbangtech.cloud using Docker Compose with Traefik reverse proxy.

### Prerequisites

- Docker and Docker Compose
- Traefik reverse proxy (running on the same Docker network)
- Google OAuth credentials

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Session Configuration
SESSION_SECRET=your-random-session-secret

# Access Control (comma-separated)
ALLOWED_EMAILS=user1@gmail.com,user2@gmail.com
ALLOWED_DOMAINS=example.com
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create or select an OAuth 2.0 Client ID
3. Add the callback URL to **Authorized redirect URIs**:
   ```
   https://slackbots.headbangtech.cloud/auth/google/callback
   ```

### Deploy

```bash
docker compose up -d
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Traefik                            │
│              (Reverse Proxy + TLS)                      │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                  slack-bots                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Express.js Backend                  │   │
│  │  - Google OAuth (Passport.js)                   │   │
│  │  - REST API for user provisioning               │   │
│  │  - SSH key generation (node-forge)              │   │
│  │  - Linux user management                        │   │
│  │  - Slack API integration                        │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │              React SPA Frontend                  │   │
│  │  - User provisioning form                       │   │
│  │  - Google SSO login                             │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  SQLite                          │   │
│  │  - User history                                 │   │
│  │  - Session storage                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         │ Mounted Volumes (privileged)
         ▼
┌─────────────────────────────────────────────────────────┐
│                    Host System                          │
│  - /etc/passwd, /etc/shadow, /etc/group                │
│  - /home (for user directories)                        │
└─────────────────────────────────────────────────────────┘
```

## API Endpoints

### Public
- `GET /api/health` - Health check

### Authentication
- `GET /auth/google` - Initiate Google OAuth login
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/me` - Get current user info
- `POST /auth/logout` - Logout

### Protected (requires authentication)
- `GET /api/users` - List provisioned users
- `POST /api/users` - Create a new Linux user
- `DELETE /api/users/:username` - Delete a user
- `POST /api/keys/generate` - Generate SSH keypair

## Local Development

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Run backend
npm run dev

# Run frontend (separate terminal)
cd client && npm run dev
```

## Security Notes

- The container runs in **privileged mode** to manage host system users
- Access is restricted via Google SSO with email/domain whitelisting
- Session data is stored in SQLite
- SSH private keys are only shown once during generation
