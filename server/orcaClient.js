// The ORCA Backend API's identity endpoints (/v1/identity). ORCA is the
// authority on who someone is and which roles they hold: it verifies the
// Google ID token, enforces the Workspace domain and account status, and
// reads roles from its own database on every call.
//
// Server-side only. NOVA_API_KEY and the ORCA user token never reach the
// browser, and neither is ever logged.

const TIMEOUT_MS = 5000;

export class OrcaError extends Error {
  // status: ORCA's HTTP status, or 0 when ORCA couldn't be reached or answered
  // with something unusable. reason: ORCA's { error } message, if any.
  constructor(status, reason) {
    super(`ORCA identity request failed (${status || 'unreachable'})`);
    this.status = status;
    this.reason = reason ?? null;
  }
}

export function orcaConfigured() {
  return Boolean(process.env.ORCA_API_URL && process.env.NOVA_API_KEY);
}

async function call(method, path, { userToken, body } = {}) {
  if (!orcaConfigured()) throw new OrcaError(0, 'not_configured');

  const headers = { Authorization: `Bearer ${process.env.NOVA_API_KEY}` };
  if (userToken) headers['x-orca-user-token'] = userToken;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(new URL(path, process.env.ORCA_API_URL), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new OrcaError(0, null);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new OrcaError(res.status, typeof data?.error === 'string' ? data.error : null);
  return data;
}

// -> { id, name, email, roles } from ORCA's person JSON. Anything malformed
// is treated as ORCA being unavailable rather than guessed at.
function readPerson(person) {
  if (
    !person ||
    typeof person.id !== 'string' ||
    typeof person.email !== 'string' ||
    !Array.isArray(person.roles) ||
    !person.roles.every((role) => typeof role === 'string') ||
    person.active !== true
  ) {
    throw new OrcaError(0, null);
  }
  return {
    id: person.id,
    email: person.email,
    name: typeof person.name === 'string' && person.name ? person.name : person.email.split('@')[0],
    roles: person.roles,
  };
}

function readSessionResponse(data) {
  const expiresAt = Date.parse(data?.expiresAt);
  if (typeof data?.token !== 'string' || !data.token || !Number.isFinite(expiresAt)) throw new OrcaError(0, null);
  return { person: readPerson(data.person), token: data.token, expiresAt };
}

// Google ID token -> { person, token, expiresAt (ms) }.
export async function createOrcaSession(idToken) {
  return readSessionResponse(await call('POST', '/v1/identity/sessions', { body: { idToken } }));
}

// A still-valid ORCA token -> a fresh one, with the person's current roles.
export async function refreshOrcaSession(userToken) {
  return readSessionResponse(await call('POST', '/v1/identity/sessions/refresh', { userToken }));
}

