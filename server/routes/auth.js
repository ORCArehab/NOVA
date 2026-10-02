import crypto from 'node:crypto';
import { Router } from 'express';
import { demoLoginEnabled, demoPerson, demoTeamId } from '../demo.js';
import { clientUser } from '../identity.js';
import { createOrcaSession, orcaConfigured } from '../orcaClient.js';
import { cookieOptions, endSession, readCookie, resolveSession, sessionSecretConfigured, startSession } from '../session.js';

const router = Router();

// Google Workspace sign-in through NOVA's own OAuth client, with ORCA as the
// authority on the result. The app has no sign-in or sign-up form of its own
// — people arrive from the Workspace app launcher, bounce through Google
// (silently, if they're already signed in to Workspace), and land back here.
// The Google ID token then goes to ORCA (/v1/identity/sessions), which
// verifies it, decides whether this is an active ORCA account, and says which
// roles it holds. Only ORCA's answer starts a session.
const config = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  domain: (process.env.ALLOWED_EMAIL_DOMAIN || 'orcarehab.com').toLowerCase(),
});

const STATE_COOKIE = 'nova_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

function signInConfigured() {
  const { clientId, clientSecret } = config();
  const sessionsReady = sessionSecretConfigured() || !process.env.VERCEL;
  return Boolean(clientId && clientSecret && orcaConfigured() && sessionsReady);
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

// ORCA's refusals -> ?authError= codes (see LoginScreen.tsx).
function orcaFailureCode(err) {
  if (err.reason === 'not_configured') return 'not_configured';
  if (err.status === 403 && err.reason === 'Account disabled') return 'disabled';
  if (err.status === 403) return 'domain';
  if (err.status === 409) return 'conflict';
  if (err.status === 401) return 'failed';
  return 'unavailable';
}

// A quick, non-authoritative look at the ID token's claims, only to turn
// away obviously wrong accounts (a personal Google account, say) without a
// round trip to ORCA. Passing it proves nothing: ORCA verifies the token
// and decides.
function plausibleIdToken(idToken) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    const { clientId, domain } = config();
    return claims.aud === clientId && claims.hd === domain && claims.email_verified === true;
  } catch {
    return false;
  }
}

// GET /google/login -> redirect to Google's consent screen.
router.get('/google/login', (req, res) => {
  if (!signInConfigured()) return failLogin(res, 'not_configured');

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, cookieOptions(req, STATE_TTL_MS));

  const { clientId, domain } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Pre-selects the Workspace account in Google's chooser — a hint only;
    // ORCA enforces the domain.
    hd: domain,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /google/callback?code&state -> gets the Google ID token, has ORCA
// accept it, then starts a session and sends the browser back to the app.
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = readCookie(req, STATE_COOKIE);
  const { maxAge: _maxAge, ...stateCookie } = cookieOptions(req);
  res.clearCookie(STATE_COOKIE, stateCookie);

  if (error === 'access_denied') return failLogin(res, 'cancelled');
  if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || state !== expectedState) {
    return failLogin(res, 'state');
  }
  if (!signInConfigured()) return failLogin(res, 'not_configured');

  const { clientId, clientSecret } = config();
  let idToken;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    ({ id_token: idToken } = await tokenRes.json());
    if (typeof idToken !== 'string') throw new Error('no ID token in the token response');
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    return failLogin(res, 'failed');
  }

  if (!plausibleIdToken(idToken)) return failLogin(res, 'domain');

  let orca;
  try {
    orca = await createOrcaSession(idToken);
  } catch (err) {
    console.error('ORCA sign-in refused:', err.status || 'unreachable');
    return failLogin(res, orcaFailureCode(err));
  }

  // Signed in to ORCA, but without a role that uses NOVA.
  if (!clientUser(orca.person)) return failLogin(res, 'no_access');

  startSession(req, res, { person: orca.person, orcaToken: orca.token, orcaExpiresAt: orca.expiresAt });
  res.redirect('/');
});

// GET /me -> { user: { id, name, email, role, teamId } } for the signed-in
// user, re-checked with ORCA on every call, so a page load always reflects
// their current ORCA roles.
router.get('/me', async (req, res) => {
  const result = await resolveSession(req, res, { recheck: true });
  if (!result.user) return res.status(result.status).json({ error: result.error, code: result.code });
  req.authUser = result.user.email;
  res.json({ user: result.user });
});

// POST /logout -> clears the session. Doesn't sign them out of Google
// itself — that's their Workspace session, not ours.
router.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

// POST /demo { role } -> signs straight into a fixed synthetic person.
// Local dev only; 404s anywhere else so it doesn't exist on a deployment.
router.post('/demo', (req, res) => {
  if (!demoLoginEnabled()) return res.status(404).json({ error: 'Not found.' });

  const person = demoPerson(req.body?.role);
  startSession(req, res, { person, demo: true, teamId: demoTeamId() });
  res.json({ user: clientUser(person, demoTeamId()) });
});

export default router;
