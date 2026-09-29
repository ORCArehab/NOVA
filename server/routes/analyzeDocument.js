import { Router } from 'express';
import { isValidImage, parseRowsRequest } from '../analyzerSchema.js';
import { readHeader, readRows } from '../documentReader.js';

const router = Router();

// Crops of patient rows are PHI. Nothing here is written to disk or kept
// in memory past the request, and failures log only the error's status
// and code — never the image, the model's output, or its error text.
// OpenAI reports an exhausted account as a 429 too, but waiting won't fix
// it — someone has to add credits.
const ACCOUNT_LIMIT_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached']);

function fail(res, err, label) {
  console.error(`analyze-document ${label} error:`, err?.status ?? '-', err?.code ?? err?.name ?? '-');
  if (ACCOUNT_LIMIT_CODES.has(err?.code)) {
    return res.status(503).json({ error: 'NOVA’s AI service is unavailable right now. Ask your administrator to check the OpenAI account.' });
  }
  if (err?.status === 429) {
    return res.status(429).json({ error: 'NOVA is handling too many requests right now. Wait a moment and try again.' });
  }
  res.status(502).json({ error: 'NOVA couldn’t read part of this document. Please try again.' });
}

// POST /header { image } -> { documentType, facility, date }
router.post('/header', async (req, res) => {
  const image = req.body?.image;
  if (!isValidImage(image)) return res.status(400).json({ error: 'Invalid header image.' });
  try {
    res.json(await readHeader(image));
  } catch (err) {
    fail(res, err, 'header');
  }
});

// POST /rows { rows: [{ id, image }] } -> { rows: RowReading[] }
router.post('/rows', async (req, res) => {
  const parsed = parseRowsRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    res.json({ rows: await readRows(parsed.rows) });
  } catch (err) {
    fail(res, err, 'rows');
  }
});

export default router;
