import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rewordRouter from './routes/reword.js';
import chatRouter from './routes/chat.js';
import updateNoteRouter from './routes/updateNote.js';
import suggestionsRouter from './routes/suggestions.js';
import applySuggestionsRouter from './routes/applySuggestions.js';
import analyzeDocumentRouter from './routes/analyzeDocument.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './session.js';
import { auditLog } from './auditLog.js';
import { aiEnabled } from './openaiClient.js';

// The Express app itself, with no listener attached — shared between the
// local dev server (server/index.js) and the Vercel serverless entry
// (api/index.js), which each handle running/serving it differently.
export const app = express();

// Behind Vercel's proxy, trust X-Forwarded-Proto/For so req.protocol and
// req.secure reflect the real HTTPS connection (session.js's Secure cookie
// flag and auth.js's OAuth redirect URI depend on it). Locally, only trust
// Vite's proxy on loopback.
app.set('trust proxy', process.env.VERCEL ? true : 'loopback');

// Same-origin only — the frontend is served from the same host (or proxied
// to it by Vite in dev), and the session cookie shouldn't be usable
// cross-origin.
app.use(cors({ origin: false }));
app.use(auditLog);

// Sign-in — the only unauthenticated routes. Everything mounted after
// requireAuth needs an ORCA-backed session with NOVA access (session.js),
// and request bodies are only read once that's established.
app.use('/api/auth', express.json({ limit: '16kb' }), authRouter);
app.use('/api', requireAuth);

// GET /api/capabilities -> { analyzer } — whether the Analyzer can be used,
// so the browser can switch it off before any document is chosen. A yes/no
// only; nothing about how AI is configured.
app.get('/api/capabilities', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ analyzer: aiEnabled() });
});

// The AI routes need OPENAI_API_KEY. A deployment can leave it unset: NOVA
// still signs people in, and these routes say AI isn't enabled. requireAi
// runs before the body parser, so when AI is off the app answers 503
// without reading or parsing the request body (note text, document crops).
// The browser is what keeps documents from being sent at all (see
// AnalyzerScreen); this is the second line.
function requireAi(req, res, next) {
  if (!aiEnabled()) return res.status(503).json({ error: 'NOVA’s AI features aren’t enabled on this deployment.' });
  next();
}

const readJsonBody = express.json({ limit: '2mb' });

app.use('/api/reword', requireAi, readJsonBody, rewordRouter);
app.use('/api/chat', requireAi, readJsonBody, chatRouter);
app.use('/api/update-note', requireAi, readJsonBody, updateNoteRouter);
app.use('/api/suggestions', requireAi, readJsonBody, suggestionsRouter);
app.use('/api/apply-suggestions', requireAi, readJsonBody, applySuggestionsRouter);
app.use('/api/analyze-document', requireAi, readJsonBody, analyzeDocumentRouter);

// Last resort for anything a route didn't handle. Logs only what failed and
// where — never the request body (note text is PHI), cookies or tokens —
// and tells the browser nothing beyond that it failed.
app.use((err, req, res, _next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  console.error('Unhandled error:', JSON.stringify({ method: req.method, path: req.path, status, name: err?.name, code: typeof err?.code === 'string' ? err.code : undefined }));
  if (res.headersSent) return;
  res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : 'The request couldn’t be processed.' });
});
