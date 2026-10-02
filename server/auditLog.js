import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

// Vercel's serverless functions have a read-only filesystem outside /tmp,
// and /tmp itself isn't persisted or shared across invocations — so a local
// log file isn't durable there. Write to stdout instead; Vercel captures
// that as Function Logs, which is the platform's actual audit trail.
const isServerless = () => Boolean(process.env.VERCEL);

let logDirReady = null;

// Records who accessed which endpoint, when, and whether it succeeded —
// never the request or response body, since that's where PHI (the note
// text) lives. This is an access trail, not a content log.
export function auditLog(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      // Without the query string: the sign-in callback's carries Google's
      // authorization code.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      user: req.authUser ?? null,
      ip: req.ip,
      durationMs: Date.now() - start,
    };

    if (isServerless()) {
      console.log('AUDIT', JSON.stringify(entry));
      return;
    }

    logDirReady ??= mkdir(LOG_DIR, { recursive: true });
    logDirReady
      .then(() => appendFile(LOG_FILE, JSON.stringify(entry) + '\n'))
      .catch((err) => console.error('audit log write failed:', err.message));
  });

  next();
}
