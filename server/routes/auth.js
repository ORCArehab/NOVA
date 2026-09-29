import crypto from 'node:crypto';
import { Router } from 'express';
import { cookieOptions, endSession, readCookie, requireAuth, startSession } from '../session.js';
import {
  createUser,
  DEMO_PROVIDER_EMAIL,
  DEMO_SCRIBE_EMAIL,
  demoLoginEnabled,
  findUserByEmail,
  listUsers,
} from '../userStore.js';

const router = Router();

// Google Workspace sign-in, locked to one domain. The app has no sign-in
// or sign-up form of its own — people arrive from the Workspace app
// launcher, bounce through Google (silently, if they're already signed in
// to Workspace), and land back here already identified.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'orcarehab.com').toLowerCase();

const STATE_COOKIE = 'nova_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

function isAllowedEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// Must exactly match an Authorized redirect URI on the Google OAuth
// client. Derived from the request rather than configured, so the same
// build works on localhost (through Vite's /api proxy, which keeps the
// browser-facing Host) and on any deployed domain.
function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

// The frontend reads ?authError= to explain why it's showing the sign-in
// screen instead of the app.
function failLogin(res, code) {
  res.redirect(`/?authError=${code}`);
}

// GET /google/login -> redirect to Google's consent screen.
router.get('/google/login', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return failLogin(res, 'not_configured');

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, cookieOptions(req, STATE_TTL_MS));

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Pre-selects the Workspace account in Google's chooser — a hint only,
    // the callback enforces the domain regardless.
    hd: ALLOWED_DOMAIN,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /google/callback?code&state -> verifies the Google identity, then
// starts a session and sends the browser back to the app.
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, cookieOptions(req));

  if (error === 'access_denied') return failLogin(res, 'cancelled');
  if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || state !== expectedState) {
    return failLogin(res, 'state');
  }

  let claims;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const { id_token: idToken } = await tokenRes.json();
    // The ID token came straight from Google's token endpoint over TLS in
    // exchange for our client secret, so per OpenID Connect Core §3.1.3.7
    // its signature doesn't need separately verifying — the claims below
    // still do.
    claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    return failLogin(res, 'failed');
  }

  const validIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!validIssuer || claims.aud !== GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now()) {
    return failLogin(res, 'failed');
  }
  // Both checks: hd proves it's a Workspace-managed account on our domain
  // (not a personal Google account that merely uses that email address).
  if (claims.email_verified !== true || claims.hd !== ALLOWED_DOMAIN || !isAllowedEmail(claims.email)) {
    return failLogin(res, 'domain');
  }

  const email = claims.email.toLowerCase();
  startSession(req, res, { email, name: claims.name || email.split('@')[0] });
  res.redirect('/');
});

// GET /me -> { email, name, member } for the signed-in user. member is
// null on their first visit, until they pick a role (POST /onboard).
router.get('/me', requireAuth, async (req, res) => {
  const member = await findUserByEmail(req.session.email);
  res.json({ email: req.session.email, name: member?.name ?? req.session.name, member });
});

// POST /onboard { role, supervisorId? } -> creates the signed-in user's
// account the first time they arrive. Name and email come from Google,
// never from the request body.
router.post('/onboard', requireAuth, async (req, res) => {
  const { role, supervisorId } = req.body ?? {};

  if (await findUserByEmail(req.session.email)) {
    return res.status(409).json({ error: 'Your account is already set up.' });
  }
  if (role !== 'provider' && role !== 'scribe') {
    return res.status(400).json({ error: 'Role must be "provider" or "scribe".' });
  }
  if (role === 'scribe') {
    const users = await listUsers();
    if (!users.some((u) => u.id === supervisorId && u.role === 'provider')) {
      return res.status(400).json({ error: 'Select the provider you scribe for.' });
    }
  }

  const member = await createUser({
    name: req.session.name,
    email: req.session.email,
    role,
    supervisorId: role === 'scribe' ? supervisorId : null,
  });
  res.status(201).json(member);
});

// POST /logout -> clears the session. Doesn't sign them out of Google
// itself — that's their Workspace session, not ours.
router.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

// POST /demo { role } -> signs straight into a fixed demo account. Local
// dev only; 404s anywhere else so it doesn't exist on a deployment.
router.post('/demo', async (req, res) => {
  if (!demoLoginEnabled) return res.status(404).json({ error: 'Not found.' });

  const email = req.body?.role === 'scribe' ? DEMO_SCRIBE_EMAIL : DEMO_PROVIDER_EMAIL;
  const member = await findUserByEmail(email);
  startSession(req, res, { email: member.email, name: member.name });
  res.json(member);
});

export default router;
