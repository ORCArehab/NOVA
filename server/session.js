import crypto from 'node:crypto';
import { demoLoginEnabled } from './demo.js';
import { clientUser } from './identity.js';
import { refreshOrcaSession } from './orcaClient.js';

// A stateless session cookie rather than a server-side session store —
// Vercel's serverless instances don't share memory or a durable filesystem,
// so the cookie itself carries the session. It holds the ORCA user token, so
// it's encrypted (AES-256-GCM), not just signed: the browser can neither read
// nor alter it, and it's HttpOnly so page scripts never see it at all.
//
// ORCA stays the authority: the cookie only remembers what ORCA said, and
// what ORCA says is re-checked at least every ROLE_RECHECK_MS.
export const SESSION_COOKIE = 'nova_session';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000; // one clinical day
export const ROLE_RECHECK_MS = 5 * 60 * 1000;
// How often activity re-issues the cookie to slide the idle timeout.
const TOUCH_INTERVAL_MS = 60 * 1000;

const VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;

const isServerless = () => Boolean(process.env.VERCEL);

// Locally a random per-process secret keeps dev setup to zero steps, at the
// cost of everyone being signed out whenever the dev server restarts.
let devSecret = null;

export function sessionSecretConfigured() {
  return (process.env.SESSION_SECRET ?? '').length >= MIN_SECRET_LENGTH;
}

let cachedKey = null;
function sessionKey() {
  let secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    if (isServerless()) throw new Error('SESSION_SECRET is missing or too short.');
    if (secret) throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    if (!devSecret) {
      console.warn('SESSION_SECRET is not set — using a random one for this process. Sessions reset whenever the server restarts.');
      devSecret = crypto.randomBytes(32).toString('hex');
    }
    secret = devSecret;
  }
  if (cachedKey?.secret !== secret) {
    const key = Buffer.from(crypto.hkdfSync('sha256', secret, 'nova_session', `${SESSION_COOKIE} ${VERSION} aes-256-gcm`, 32));
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  cipher.setAAD(Buffer.from(`${SESSION_COOKIE}.${VERSION}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

function unseal(raw) {
  const [version, sealed, extra] = raw.split('.');
  if (version !== VERSION || !sealed || extra !== undefined) return null;
  const bytes = Buffer.from(sealed, 'base64url');
  if (bytes.length < 29) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${SESSION_COOKIE}.${VERSION}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

// No cookie-parser dependency for the two cookies this app uses.
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Secure whenever deployed, whatever the proxy headers say; locally it
// follows the connection (Vite's dev server may be plain HTTP).
export function cookieOptions(req, maxAge) {
  return { httpOnly: true, secure: isServerless() || req.secure, sameSite: 'lax', path: '/', maxAge };
}

function writeSession(req, res, session, now) {
  const remaining = Math.min(IDLE_TIMEOUT_MS, session.signedInAt + ABSOLUTE_LIMIT_MS - now);
  res.cookie(SESSION_COOKIE, seal(session), cookieOptions(req, remaining));
}

// After ORCA has accepted a sign-in: { person, token, expiresAt } from
// orcaClient.js. Demo sessions (local dev only) have no ORCA token.
export function startSession(req, res, { person, orcaToken = null, orcaExpiresAt = null, demo = false, teamId = null }) {
  const now = Date.now();
  const session = {
    kind: demo ? 'demo' : 'orca',
    person,
    orcaToken,
    orcaExpiresAt,
    teamId,
    signedInAt: now,
    lastSeenAt: now,
    checkedAt: now,
  };
  writeSession(req, res, session, now);
}

export function endSession(req, res) {
  const { maxAge: _maxAge, ...options } = cookieOptions(req);
  res.clearCookie(SESSION_COOKIE, options);
}

// The decrypted session if it's still within every time limit, else null.
function loadSession(req, now) {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const session = unseal(raw);
  if (!session || typeof session !== 'object') return null;

  const { kind, person, signedInAt, lastSeenAt, checkedAt } = session;
  if (!person || ![signedInAt, lastSeenAt, checkedAt].every(Number.isFinite)) return null;
  if (now - lastSeenAt > IDLE_TIMEOUT_MS) return null;
  if (now - signedInAt > ABSOLUTE_LIMIT_MS) return null;

  if (kind === 'demo') return demoLoginEnabled() ? session : null;
  if (kind !== 'orca' || typeof session.orcaToken !== 'string' || !Number.isFinite(session.orcaExpiresAt)) return null;
  // Never outlive ORCA's own token.
  if (session.orcaExpiresAt <= now) return null;
  return session;
}

const UNAUTHENTICATED = { status: 401, code: 'session_expired', error: 'Your session has expired. Reload the page to sign in again.' };
const NO_ACCESS = {
  status: 403,
  code: 'no_access',
  error: 'Your ORCA account doesn’t have NOVA access (it needs the PROVIDER or SCRIBE role). Ask an ORCA administrator.',
};
const UNAVAILABLE = { status: 503, code: 'identity_unavailable', error: 'Can’t confirm your sign-in with ORCA right now. Please try again in a moment.' };

// -> { user } for a valid session that still has NOVA access, else a
// { status, code, error } to send. Re-checks the person with ORCA when the
// last check is ROLE_RECHECK_MS old (or always, with recheck: true), which
// also renews the ORCA token. Every outcome is decided on the server.
export async function resolveSession(req, res, { recheck = false } = {}) {
  const now = Date.now();
  const session = loadSession(req, now);
  if (!session) {
    if (readCookie(req, SESSION_COOKIE) !== null) endSession(req, res);
    return UNAUTHENTICATED;
  }

  let changed = false;
  if (session.kind === 'orca' && (recheck || now - session.checkedAt >= ROLE_RECHECK_MS)) {
    try {
      const fresh = await refreshOrcaSession(session.orcaToken);
      session.person = fresh.person;
      session.orcaToken = fresh.token;
      session.orcaExpiresAt = fresh.expiresAt;
      session.checkedAt = now;
      changed = true;
    } catch (err) {
      // ORCA refused the token (expired, revoked person, deactivated): the
      // session is over. Anything else: fail closed, but keep the cookie so
      // a transient ORCA outage doesn't sign everyone out.
      if (err.status === 401 || err.status === 403) {
        endSession(req, res);
        return UNAUTHENTICATED;
      }
      console.error('ORCA session check failed:', err.status || 'unreachable');
      return UNAVAILABLE;
    }
  }

  const user = clientUser(session.person, session.teamId ?? undefined);
  if (!user) {
    endSession(req, res);
    return NO_ACCESS;
  }

  if (changed || now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
    session.lastSeenAt = now;
    writeSession(req, res, session, now);
  }
  return { user };
}

// Gates every /api route except /api/auth. Sets req.user (what the browser
// may know about them) and req.authUser (the email, for the audit log — see
// auditLog.js).
export async function requireAuth(req, res, next) {
  const result = await resolveSession(req, res);
  if (!result.user) return res.status(result.status).json({ error: result.error, code: result.code });
  req.user = result.user;
  req.authUser = result.user.email;
  next();
}
