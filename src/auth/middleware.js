// Authentication middleware
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  // For API requests, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // For page requests, redirect to login
  res.redirect('/login');
}

// Check if user is authenticated (for API)
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
  requireAuth,
  isAuthenticated
};
