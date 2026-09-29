import crypto from 'node:crypto';

// A stateless, HMAC-signed session cookie rather than a server-side
// session store — Vercel's serverless instances don't share memory or a
// durable filesystem (see userStore.js), so the cookie itself has to carry
// the identity, signed so the browser can't forge or edit it.
export const SESSION_COOKIE = 'nova_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one clinical day

const isServerless = Boolean(process.env.VERCEL);

// Required when deployed — every serverless instance has to sign/verify
// with the same key. Locally a random per-process fallback keeps dev
// setup to zero steps, at the cost of everyone being signed out whenever
// the dev server restarts.
const secret = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (isServerless) {
    throw new Error('SESSION_SECRET is not set. Set it to a long random string in your hosting provider\'s environment variables.');
  }
  console.warn('SESSION_SECRET is not set — using a random one for this process. Sessions reset whenever the server restarts.');
  return crypto.randomBytes(32).toString('hex');
})();

function sign(value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

// No cookie-parser dependency for the two cookies this app uses.
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function cookieOptions(req, maxAge) {
  return { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/', maxAge };
}

// { email, name } -> sets the signed session cookie on the response.
export function startSession(req, res, { email, name }) {
  const payload = Buffer.from(JSON.stringify({ email, name, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  res.cookie(SESSION_COOKIE, `${payload}.${sign(payload)}`, cookieOptions(req, SESSION_TTL_MS));
}

export function endSession(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

// -> { email, name } for a valid, unexpired cookie, otherwise null.
export function readSession(req) {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const { email, name, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || exp < Date.now()) return null;
    return { email, name };
  } catch {
    return null;
  }
}

// Gates every /api route except /api/auth. Sets req.authUser (the email)
// for the audit log — see auditLog.js.
export function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Your session has expired. Reload the page to sign in again.' });
  }
  req.session = session;
  req.authUser = session.email;
  next();
}
