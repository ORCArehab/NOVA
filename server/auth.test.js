import crypto from 'node:crypto';
import http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Sign-in and sessions end to end: the real Express app, a fake ORCA identity
// API on a local port, and Google's token endpoint stubbed. Every value below
// is synthetic.

const NOVA_KEY = `test-nova-key-${crypto.randomBytes(8).toString('hex')}`;
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const CLIENT_ID = 'nova-test-client.apps.googleusercontent.com';
const CLIENT_SECRET = `test-google-secret-${crypto.randomBytes(8).toString('hex')}`;
const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
const SCRIBE_ID = '22222222-2222-4222-8222-222222222222';

const MIN = 60 * 1000;

// --- time -------------------------------------------------------------------
const realNow = Date.now.bind(Date);
let clockOffset = 0;
const advance = (ms) => {
  clockOffset += ms;
};

// --- logs: everything printed, so the tests can check nothing secret was ----
const logged = [];
for (const level of ['log', 'info', 'warn', 'error']) {
  vi.spyOn(console, level).mockImplementation((...args) => logged.push(args.map(String).join(' ')));
}

// --- fake ORCA ----------------------------------------------------------------
const issuedTokens = [];
const orca = {
  requests: [],
  person: null,
  // Per-endpoint overrides: { status, body } or 'drop' (connection closed).
  sessionsReply: null,
  refreshReply: null,
  tokenTtlMs: 8 * 60 * MIN,
};

function issue(person) {
  const token = `orca-user-token-${crypto.randomBytes(12).toString('hex')}`;
  issuedTokens.push(token);
  return { person: { active: true, imageUrl: null, ...person }, token, expiresAt: new Date(Date.now() + orca.tokenTtlMs).toISOString() };
}

const orcaServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    orca.requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${NOVA_KEY}`) return send(401, { error: 'Unauthorized' });

    if (req.method === 'POST' && req.url === '/v1/identity/sessions') {
      if (orca.sessionsReply === 'drop') return req.socket.destroy();
      if (orca.sessionsReply) return send(orca.sessionsReply.status, orca.sessionsReply.body);
      const { idToken } = JSON.parse(raw || '{}');
      if (typeof idToken !== 'string') return send(400, { error: 'Invalid request' });
      return send(200, issue(orca.person));
    }
    if (req.method === 'POST' && req.url === '/v1/identity/sessions/refresh') {
      if (!issuedTokens.includes(req.headers['x-orca-user-token'])) return send(401, { error: 'Unauthorized' });
      if (orca.refreshReply === 'drop') return req.socket.destroy();
      if (orca.refreshReply) return send(orca.refreshReply.status, orca.refreshReply.body);
      return send(200, issue(orca.person));
    }
    send(404, { error: 'Not found' });
  });
});

const refreshCalls = () => orca.requests.filter((r) => r.url === '/v1/identity/sessions/refresh').length;
const sessionCalls = () => orca.requests.filter((r) => r.url === '/v1/identity/sessions').length;

// --- Google's token endpoint ---------------------------------------------------
let idTokenClaims;
const issuedIdTokens = [];
function fakeIdToken(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${part({ alg: 'RS256' })}.${part(claims)}.${crypto.randomBytes(16).toString('base64url')}`;
  issuedIdTokens.push(token);
  return token;
}

const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input, init) => {
  if (String(input) === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    if (form.get('client_secret') !== CLIENT_SECRET || form.get('code') !== 'good-code') {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    return new Response(JSON.stringify({ id_token: fakeIdToken(idTokenClaims) }), { status: 200 });
  }
  return realFetch(input, init);
});

// --- the app under test, with a cookie jar ---------------------------------------
let base;
let appServer;

const BASE_ENV = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  ALLOWED_EMAIL_DOMAIN: 'orcarehab.com',
  SESSION_SECRET,
  NOVA_API_KEY: NOVA_KEY,
  NODE_ENV: 'test',
};
const MANAGED_ENV = [...Object.keys(BASE_ENV), 'ORCA_API_URL', 'VERCEL', 'NOVA_SCRIBE_TEAMS'];
const savedEnv = Object.fromEntries(MANAGED_ENV.map((key) => [key, process.env[key]]));

class Browser {
  cookies = new Map();
  responses = [];

  async request(path, { method = 'GET', body, headers = {}, rawBody } = {}) {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await realFetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body || rawBody ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });
    const setCookies = res.headers.getSetCookie();
    for (const header of setCookies) {
      const [pair] = header.split(';');
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      if (/max-age=0\b|expires=thu, 01 jan 1970/i.test(header) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    const result = { status: res.status, location: res.headers.get('location'), setCookies, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
    this.responses.push(result);
    return result;
  }

  // The whole Google round trip: /google/login, then Google sending them back.
  async signIn({ code = 'good-code', state } = {}) {
    const login = await this.request('/api/auth/google/login');
    const sentState = new URL(login.location).searchParams.get('state');
    return this.request(`/api/auth/google/callback?code=${code}&state=${state ?? sentState}`);
  }
}

const sessionCookie = (result) => result.setCookies.find((c) => c.startsWith('nova_session='));

function setPerson(roles, overrides = {}) {
  orca.person = { id: PROVIDER_ID, email: 'pat.provider@orcarehab.com', name: 'Pat Provider', roles, ...overrides };
  idTokenClaims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, hd: 'orcarehab.com', email_verified: true, email: orca.person.email, exp: Math.floor(Date.now() / 1000) + 3600 };
}

beforeAll(async () => {
  await new Promise((resolve) => orcaServer.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, BASE_ENV, { ORCA_API_URL: `http://127.0.0.1:${orcaServer.address().port}` });
  delete process.env.VERCEL;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
  const { app } = await import('./app.js');
  appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.once('listening', resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

beforeEach(() => {
  Object.assign(process.env, BASE_ENV, { ORCA_API_URL: `http://127.0.0.1:${orcaServer.address().port}` });
  delete process.env.VERCEL;
  delete process.env.NOVA_SCRIBE_TEAMS;
  orca.requests.length = 0;
  orca.sessionsReply = null;
  orca.refreshReply = null;
  orca.tokenTtlMs = 8 * 60 * MIN;
  clockOffset = 0;
  setPerson(['PROVIDER']);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const allBrowsers = [];
function browser() {
  const b = new Browser();
  allBrowsers.push(b);
  return b;
}

afterAll(async () => {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => orcaServer.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===================================================================================

describe('signing in through ORCA', () => {
  it('starts a session from ORCA’s answer and gives the browser only the NOVA user', async () => {
    const b = browser();
    const callback = await b.signIn();
    expect(callback.status).toBe(302);
    expect(callback.location).toBe('/');

    // ORCA got the Google ID token, authenticated as NOVA.
    const [call] = orca.requests;
    expect(call.url).toBe('/v1/identity/sessions');
    expect(call.headers.authorization).toBe(`Bearer ${NOVA_KEY}`);
    expect(JSON.parse(call.body)).toEqual({ idToken: issuedIdTokens.at(-1) });

    const me = await b.request('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ user: { id: PROVIDER_ID, name: 'Pat Provider', email: 'pat.provider@orcarehab.com', role: 'provider', teamId: PROVIDER_ID } });
  });

  it('sets an HttpOnly, SameSite=Lax session cookie whose contents the browser can’t read', async () => {
    const b = browser();
    const callback = await b.signIn();
    const cookie = sessionCookie(callback);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/Max-Age=1800\b/);

    const value = b.cookies.get('nova_session');
    const decoded = Buffer.from(value.split('.')[1], 'base64url').toString('latin1');
    for (const secret of [issuedTokens.at(-1), 'pat.provider', 'PROVIDER', PROVIDER_ID]) {
      expect(value).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  it('marks the cookie Secure when deployed', async () => {
    process.env.VERCEL = '1';
    const callback = await browser().signIn();
    expect(sessionCookie(callback)).toMatch(/; Secure/);
  });

  it('rejects a callback whose state doesn’t match, without contacting ORCA', async () => {
    const callback = await browser().signIn({ state: 'forged' });
    expect(callback.location).toBe('/?authError=state');
    expect(sessionCookie(callback)).toBeUndefined();
    expect(sessionCalls()).toBe(0);
  });

  it('turns away an ID token for another app or domain before asking ORCA (non-authoritative filter)', async () => {
    for (const claims of [{ aud: 'portal-client' }, { hd: 'gmail.com' }, { email_verified: false }]) {
      Object.assign(idTokenClaims, claims);
      const callback = await browser().signIn();
      expect(callback.location).toBe('/?authError=domain');
      expect(sessionCookie(callback)).toBeUndefined();
      setPerson(['PROVIDER']);
    }
    expect(sessionCalls()).toBe(0);
  });

  it('lets ORCA decide: a token that passes NOVA’s filter but ORCA rejects starts no session', async () => {
    const cases = [
      [{ status: 401, body: { error: 'Unauthorized' } }, 'failed'],
      [{ status: 403, body: { error: 'Not an ORCA Workspace account' } }, 'domain'],
      [{ status: 403, body: { error: 'Account disabled' } }, 'disabled'],
      [{ status: 409, body: { error: 'Account conflict' } }, 'conflict'],
      [{ status: 500, body: { error: 'Internal error' } }, 'unavailable'],
      [{ status: 200, body: { person: { id: 'x' }, token: 'y' } }, 'unavailable'],
      ['drop', 'unavailable'],
    ];
    for (const [reply, code] of cases) {
      orca.sessionsReply = reply;
      const b = browser();
      const callback = await b.signIn();
      expect(callback.location, JSON.stringify(reply)).toBe(`/?authError=${code}`);
      expect(sessionCookie(callback)).toBeUndefined();
      expect((await b.request('/api/auth/me')).status).toBe(401);
    }
  });

  it('fails closed when ORCA isn’t configured', async () => {
    delete process.env.ORCA_API_URL;
    const login = await browser().request('/api/auth/google/login');
    expect(login.location).toBe('/?authError=not_configured');
  });

  it('fails closed when deployed without a session secret', async () => {
    process.env.VERCEL = '1';
    delete process.env.SESSION_SECRET;
    const login = await browser().request('/api/auth/google/login');
    expect(login.location).toBe('/?authError=not_configured');
  });

  it('a Google code exchange failure starts no session', async () => {
    const callback = await browser().signIn({ code: 'bad-code' });
    expect(callback.location).toBe('/?authError=failed');
    expect(sessionCalls()).toBe(0);
  });
});

describe('roles come only from ORCA', () => {
  it('PROVIDER -> provider, SCRIBE -> scribe, both -> provider', async () => {
    for (const [roles, role] of [
      [['PROVIDER'], 'provider'],
      [['SCRIBE'], 'scribe'],
      [['SCRIBE', 'PROVIDER', 'ADMIN'], 'provider'],
    ]) {
      setPerson(roles);
      const b = browser();
      await b.signIn();
      expect((await b.request('/api/auth/me')).json.user.role).toBe(role);
    }
  });

  it('ORCA accounts with neither role get no session', async () => {
    for (const roles of [[], ['ADMIN'], ['HR', 'IT', 'HIM']]) {
      setPerson(roles);
      const b = browser();
      const callback = await b.signIn();
      expect(callback.location).toBe('/?authError=no_access');
      expect(sessionCookie(callback)).toBeUndefined();
      expect((await b.request('/api/reword', { method: 'POST', body: { text: 'x', noteType: 'initial' } })).status).toBe(401);
    }
  });

  it('ignores any role the browser sends, and self-onboarding no longer exists', async () => {
    setPerson(['SCRIBE']);
    const b = browser();
    await b.signIn();
    expect((await b.request('/api/auth/me?role=provider', { headers: { 'x-nova-role': 'provider' } })).json.user.role).toBe('scribe');

    const onboard = await b.request('/api/auth/onboard', { method: 'POST', body: { role: 'provider', supervisorId: null } });
    expect(onboard.status).toBe(404);
    expect((await b.request('/api/auth/me')).json.user.role).toBe('scribe');
    expect((await b.request('/api/team')).status).toBe(404);
  });

  it('a role removed in ORCA takes effect at the next 5-minute re-check', async () => {
    const b = browser();
    await b.signIn();
    expect((await b.request('/api/reword', { method: 'POST', rawBody: '{' })).status).toBe(400);

    orca.person = { ...orca.person, roles: ['ADMIN'] };
    advance(4 * MIN);
    // Within the window: no ORCA call yet, still allowed.
    expect((await b.request('/api/reword', { method: 'POST', rawBody: '{' })).status).toBe(400);
    expect(refreshCalls()).toBe(0);

    advance(1 * MIN + 1000);
    const denied = await b.request('/api/reword', { method: 'POST', rawBody: '{' });
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe('no_access');
    expect(refreshCalls()).toBe(1);
    expect(b.cookies.has('nova_session')).toBe(false);
  });

  it('a page load (/api/auth/me) always re-checks with ORCA', async () => {
    const b = browser();
    await b.signIn();
    await b.request('/api/auth/me');
    await b.request('/api/auth/me');
    expect(refreshCalls()).toBe(2);

    orca.person = { ...orca.person, roles: ['SCRIBE'] };
    expect((await b.request('/api/auth/me')).json.user.role).toBe('scribe');
  });

  it('a person ORCA no longer accepts (deactivated, token refused) is signed out', async () => {
    const b = browser();
    await b.signIn();
    orca.refreshReply = { status: 401, body: { error: 'Unauthorized' } };
    advance(6 * MIN);
    const res = await b.request('/api/reword', { method: 'POST', body: {} });
    expect(res.status).toBe(401);
    expect(b.cookies.has('nova_session')).toBe(false);
  });

  it('ORCA being unreachable fails closed but keeps the session', async () => {
    const b = browser();
    await b.signIn();
    orca.refreshReply = 'drop';
    advance(6 * MIN);
    const res = await b.request('/api/reword', { method: 'POST', body: {} });
    expect(res.status).toBe(503);
    expect(b.cookies.has('nova_session')).toBe(true);

    orca.refreshReply = null;
    expect((await b.request('/api/auth/me')).status).toBe(200);
  });

  it('each re-check renews the ORCA token, and the next re-check uses the new one', async () => {
    const b = browser();
    await b.signIn();
    const first = issuedTokens.at(-1);
    await b.request('/api/auth/me');
    const second = issuedTokens.at(-1);
    await b.request('/api/auth/me');
    const refreshes = orca.requests.filter((r) => r.url === '/v1/identity/sessions/refresh');
    expect(refreshes.map((r) => r.headers['x-orca-user-token'])).toEqual([first, second]);
  });
});

describe('session limits', () => {
  it('expires after 30 idle minutes', async () => {
    const b = browser();
    await b.signIn();
    advance(30 * MIN + 1000);
    const res = await b.request('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.json.code).toBe('session_expired');
  });

  it('activity slides the idle timeout', async () => {
    const b = browser();
    await b.signIn();
    for (let i = 0; i < 4; i++) {
      advance(20 * MIN);
      expect((await b.request('/api/auth/me')).status).toBe(200);
    }
  });

  it('ends 12 hours after sign-in however active', async () => {
    const b = browser();
    await b.signIn();
    let elapsed = 0;
    while (elapsed + 20 * MIN < 12 * 60 * MIN) {
      advance(20 * MIN);
      elapsed += 20 * MIN;
      expect((await b.request('/api/auth/me')).status, `at ${elapsed / MIN} min`).toBe(200);
    }
    advance(12 * 60 * MIN - elapsed + 1000);
    expect((await b.request('/api/auth/me')).status).toBe(401);
  });

  it('caps the cookie lifetime at what’s left of the 12 hours', async () => {
    const b = browser();
    await b.signIn();
    let elapsed = 0;
    while (elapsed < 11 * 60 * MIN + 50 * MIN) {
      advance(10 * MIN);
      elapsed += 10 * MIN;
      await b.request('/api/auth/me');
    }
    const maxAge = Number(b.responses.at(-1).setCookies.find((c) => c.startsWith('nova_session='))?.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBeLessThanOrEqual(10 * 60);
  });

  it('never outlives the ORCA token', async () => {
    orca.tokenTtlMs = 3 * MIN;
    const b = browser();
    await b.signIn();
    advance(3 * MIN + 1000);
    const res = await b.request('/api/reword', { method: 'POST', body: {} });
    expect(res.status).toBe(401);
    expect(refreshCalls()).toBe(0);
  });

  it('logout clears the cookie', async () => {
    const b = browser();
    await b.signIn();
    const out = await b.request('/api/auth/logout', { method: 'POST' });
    expect(out.status).toBe(204);
    expect(sessionCookie(out)).toMatch(/nova_session=;/);
    expect((await b.request('/api/auth/me')).status).toBe(401);
  });
});

describe('the cookie can’t be forged or altered', () => {
  it('rejects tampered, re-keyed, foreign-format and garbage cookies', async () => {
    const b = browser();
    await b.signIn();
    const good = b.cookies.get('nova_session');

    const bytes = Buffer.from(good.split('.')[1], 'base64url');
    bytes[bytes.length - 1] ^= 1;
    const tampered = `v1.${bytes.toString('base64url')}`;

    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    const t = browser();
    t.cookies.set('nova_session', good);
    expect((await t.request('/api/auth/me')).status).toBe(401);
    process.env.SESSION_SECRET = SESSION_SECRET;

    // The old cookie format: base64url JSON + HMAC, here even correctly signed.
    const payload = Buffer.from(JSON.stringify({ email: 'pat.provider@orcarehab.com', name: 'Pat', exp: Date.now() + 3600e3, role: 'provider' })).toString('base64url');
    const legacy = `${payload}.${crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')}`;

    for (const value of [tampered, legacy, 'v1.', 'v1.AAAA', 'garbage', `${good}.x`]) {
      const f = browser();
      f.cookies.set('nova_session', value);
      expect((await f.request('/api/auth/me')).status, value.slice(0, 20)).toBe(401);
    }
    expect((await b.request('/api/auth/me')).status).toBe(200);
  });

  it('unauthenticated API calls are refused', async () => {
    const b = browser();
    for (const path of ['/api/reword', '/api/chat', '/api/update-note', '/api/suggestions', '/api/apply-suggestions', '/api/analyze-document/header']) {
      expect((await b.request(path, { method: 'POST', body: {} })).status, path).toBe(401);
    }
  });
});

describe('scribe teams (compatibility only)', () => {
  it('a scribe works in their own team unless NOVA_SCRIBE_TEAMS maps them', async () => {
    setPerson(['SCRIBE'], { id: SCRIBE_ID, email: 'sam.scribe@orcarehab.com', name: 'Sam Scribe' });
    const b = browser();
    await b.signIn();
    expect((await b.request('/api/auth/me')).json.user.teamId).toBe(SCRIBE_ID);

    process.env.NOVA_SCRIBE_TEAMS = `someone@orcarehab.com:aaaa, Sam.Scribe@orcarehab.com:${PROVIDER_ID}`;
    const me = (await b.request('/api/auth/me')).json.user;
    expect(me).toMatchObject({ role: 'scribe', teamId: PROVIDER_ID });
  });

  it('the mapping grants nothing: no role, no access; and it never changes a provider’s team', async () => {
    process.env.NOVA_SCRIBE_TEAMS = `pat.provider@orcarehab.com:${SCRIBE_ID}`;
    const p = browser();
    await p.signIn();
    expect((await p.request('/api/auth/me')).json.user).toMatchObject({ role: 'provider', teamId: PROVIDER_ID });

    setPerson(['ADMIN']);
    expect((await browser().signIn()).location).toBe('/?authError=no_access');
  });
});

describe('demo sign-in (local dev only)', () => {
  it('works locally with synthetic people on a shared team', async () => {
    const b = browser();
    const provider = await b.request('/api/auth/demo', { method: 'POST', body: { role: 'provider' } });
    const scribe = await browser().request('/api/auth/demo', { method: 'POST', body: { role: 'scribe' } });
    expect(provider.json.user.role).toBe('provider');
    expect(scribe.json.user.role).toBe('scribe');
    expect(scribe.json.user.teamId).toBe(provider.json.user.id);
    expect((await b.request('/api/auth/me')).json.user.role).toBe('provider');
    expect(orca.requests).toHaveLength(0);
  });

  it('returns 404 with VERCEL=1', async () => {
    process.env.VERCEL = '1';
    const res = await browser().request('/api/auth/demo', { method: 'POST', body: { role: 'provider' } });
    expect(res.status).toBe(404);
    expect(res.setCookies).toHaveLength(0);
  });

  it('returns 404 with NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    expect((await browser().request('/api/auth/demo', { method: 'POST', body: {} })).status).toBe(404);
  });

  it('a demo session minted locally is worthless once deployed', async () => {
    const b = browser();
    await b.request('/api/auth/demo', { method: 'POST', body: { role: 'provider' } });
    process.env.VERCEL = '1';
    expect((await b.request('/api/auth/me')).status).toBe(401);
  });
});

describe('errors and logs', () => {
  it('a malformed request body is refused generically and never logged', async () => {
    const b = browser();
    await b.signIn();
    const marker = 'SYNTHETIC-PATIENT-NAME-ZQX';
    const res = await b.request('/api/reword', { method: 'POST', rawBody: `{"text": "${marker}` });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(marker);
    expect(logged.join('\n')).not.toContain(marker);
  });

  it('nothing secret ever reached a response body or the logs', () => {
    const responses = allBrowsers.flatMap((b) => b.responses.map((r) => `${r.text}\n${r.location ?? ''}`)).join('\n');
    const logs = logged.join('\n');
    const secrets = [NOVA_KEY, CLIENT_SECRET, SESSION_SECRET, 'good-code', ...issuedTokens, ...issuedIdTokens];
    expect(issuedTokens.length).toBeGreaterThan(10);
    for (const secret of secrets) {
      expect(responses.includes(secret)).toBe(false);
      expect(logs.includes(secret)).toBe(false);
    }
  });
});
