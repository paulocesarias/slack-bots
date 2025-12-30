# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client/ ./
RUN npm run build

# Stage 2: Build backend with native dependencies
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --production

# Stage 3: Production image
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies for user management
RUN apk add --no-cache shadow

# Copy backend dependencies
COPY --from=backend-builder /app/node_modules ./node_modules

# Copy application code
COPY src/ ./src/
COPY package*.json ./

# Copy built frontend
COPY --from=frontend-builder /app/client/dist ./client/dist

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
