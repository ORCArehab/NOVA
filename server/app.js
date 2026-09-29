import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rewordRouter from './routes/reword.js';
import chatRouter from './routes/chat.js';
import updateNoteRouter from './routes/updateNote.js';
import suggestionsRouter from './routes/suggestions.js';
import applySuggestionsRouter from './routes/applySuggestions.js';
import teamRouter from './routes/team.js';
import analyzeDocumentRouter from './routes/analyzeDocument.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './session.js';
import { auditLog } from './auditLog.js';

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
app.use(express.json({ limit: '2mb' }));
app.use(auditLog);

// Google Workspace SSO — the only unauthenticated routes. Everything
// mounted after requireAuth needs a signed-in @orcarehab.com session.
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);

app.use('/api/reword', rewordRouter);
app.use('/api/chat', chatRouter);
app.use('/api/update-note', updateNoteRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/apply-suggestions', applySuggestionsRouter);
app.use('/api/team', teamRouter);
app.use('/api/analyze-document', analyzeDocumentRouter);
