const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Allowed email domains (empty array = allow all)
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim())
  : [];

// Allowed emails (empty array = allow all from allowed domains)
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [];

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  },
  (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value?.toLowerCase();

    if (!email) {
      return done(null, false, { message: 'No email found in Google profile' });
    }

    // Check if email is allowed
    const domain = email.split('@')[1];

    // If specific emails are configured, check against them
    if (ALLOWED_EMAILS.length > 0) {
      if (!ALLOWED_EMAILS.includes(email)) {
        console.log(`Access denied for email: ${email}`);
        return done(null, false, { message: 'Email not authorized' });
      }
    }
    // Otherwise, check domain if domains are configured
    else if (ALLOWED_DOMAINS.length > 0) {
      if (!ALLOWED_DOMAINS.includes(domain)) {
        console.log(`Access denied for domain: ${domain}`);
        return done(null, false, { message: 'Domain not authorized' });
      }
    }

    const user = {
      id: profile.id,
      email: email,
      name: profile.displayName,
      picture: profile.photos?.[0]?.value
    };

    console.log(`User authenticated: ${email}`);
    return done(null, user);
  }
));

module.exports = passport;
