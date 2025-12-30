# slack-bots

Slack bots web application.

## Quick Start

### Using Docker Compose

```bash
docker compose up -d
```

The app will be available at http://localhost:3000

### Local Development

```bash
npm install
npm run dev
```

## API Endpoints

- `GET /` - API info
- `GET /health` - Health check

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT     | 3000    | Server port |
