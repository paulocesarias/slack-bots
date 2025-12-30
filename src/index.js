const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const cors = require('cors');
const path = require('path');

const passport = require('./auth/passport');
const { isAuthenticated } = require('./auth/middleware');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const keysRouter = require('./routes/keys');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for secure cookies behind Traefik
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// Session configuration
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: process.env.SESSION_DIR || './data'
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Health check (unauthenticated)
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Auth routes (unauthenticated)
app.use('/auth', authRouter);

// Protected API routes
app.use('/api/users', isAuthenticated, usersRouter);
app.use('/api/keys', isAuthenticated, keysRouter);

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../client/dist')));

// Fallback to React app for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Slack Bots server running on port ${PORT}`);
});
