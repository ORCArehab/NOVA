import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vercel's serverless functions have a read-only filesystem outside /tmp
// (see server/auditLog.js for the same distinction) — writing to a path
// under __dirname there throws EROFS and breaks every route that touches
// accounts. /tmp is writable but not guaranteed to persist or be shared
// across invocations, so on Vercel this is a stopgap that keeps the app
// from hard-erroring, not durable storage — accounts can still reset
// between requests if a cold instance picks them up. A real deployment
// needs an actual persistent store (Vercel KV/Postgres, etc.) here instead.
const isServerless = Boolean(process.env.VERCEL);
const DATA_DIR = isServerless ? '/tmp/nova-data' : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// A JSON file rather than a database — this is a test-run stand-in, same
// spirit as the audit log, not a real accounts store. Fine for one
// long-running process; not built for concurrent writers.
async function persist(users) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Fixed, well-known accounts for the "View as Provider"/"View as Scribe"
// buttons on the sign-in page (see LoginScreen.tsx) — a presenter clicks
// straight in without going through Google. Local dev only: they bypass
// the Google Workspace domain lock entirely, so a deployed instance must
// never create or accept them (see routes/auth.js's POST /demo).
export const demoLoginEnabled = !isServerless && process.env.NODE_ENV !== 'production';

export const DEMO_PROVIDER_EMAIL = 'demo.provider@orcarehab.demo';
export const DEMO_SCRIBE_EMAIL = 'demo.scribe@orcarehab.demo';

function withDemoAccounts(users) {
  if (!demoLoginEnabled) return users;
  const hasProvider = users.some((u) => u.email === DEMO_PROVIDER_EMAIL);
  const hasScribe = users.some((u) => u.email === DEMO_SCRIBE_EMAIL);
  if (hasProvider && hasScribe) return users;

  const provider = users.find((u) => u.email === DEMO_PROVIDER_EMAIL) ?? {
    id: crypto.randomUUID(),
    name: 'Dr. Demo Provider',
    email: DEMO_PROVIDER_EMAIL,
    role: 'provider',
    supervisorId: null,
  };
  const scribe = users.find((u) => u.email === DEMO_SCRIBE_EMAIL) ?? {
    id: crypto.randomUUID(),
    name: 'Demo Scribe',
    email: DEMO_SCRIBE_EMAIL,
    role: 'scribe',
    supervisorId: provider.id,
  };

  const next = [...users];
  if (!hasProvider) next.push(provider);
  if (!hasScribe) next.push(scribe);
  return next;
}

// Cached as a promise (not the resolved value) so concurrent early callers
// all await the same load/seed instead of racing to seed the file twice.
let usersPromise = null;

async function load() {
  if (usersPromise) return usersPromise;
  usersPromise = (async () => {
    let users;
    try {
      const raw = await readFile(USERS_FILE, 'utf8');
      users = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      users = [];
    }
    const withDemo = withDemoAccounts(users);
    if (withDemo !== users) await persist(withDemo);
    return withDemo;
  })();
  return usersPromise;
}

export async function listUsers() {
  return load();
}

export async function findUserByEmail(email) {
  const users = await load();
  const normalized = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === normalized) ?? null;
}

export async function createUser({ name, email, role, supervisorId }) {
  const users = await load();
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role,
    supervisorId: role === 'scribe' ? supervisorId : null,
  };
  const next = [...users, user];
  usersPromise = Promise.resolve(next);
  await persist(next);
  return user;
}
