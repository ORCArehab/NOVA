// Input and output validation for the Document Analyzer's AI step
// (routes/analyzeDocument.js). Kept free of the OpenAI client so it can be
// unit-tested without an API key. Nothing the model returns reaches the
// browser without passing through here first.

export const MAX_ROWS_PER_REQUEST = 12;
// Per crop, as a base64 data URL. A full-width row at 150 DPI is well
// under this; it's here to bound the request, not to be hit.
export const MAX_IMAGE_CHARS = 700_000;

const DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const ROW_ID = /^r\d{1,5}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_TYPES = new Set(['billing_sheet', 'census_sheet', 'unknown']);
const LEGIBILITY = new Set(['clear', 'partial', 'unclear']);

export function isValidImage(value) {
  return typeof value === 'string' && value.length <= MAX_IMAGE_CHARS && DATA_URL.test(value);
}

// -> { rows } or { error } for POST /rows's body.
export function parseRowsRequest(body) {
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'No rows to read.' };
  if (rows.length > MAX_ROWS_PER_REQUEST) return { error: 'Too many rows in one request.' };
  const seen = new Set();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !ROW_ID.test(row.id) || seen.has(row.id)) return { error: 'Invalid row id.' };
    if (!isValidImage(row.image)) return { error: 'Invalid row image.' };
    seen.add(row.id);
  }
  return { rows: rows.map(({ id, image }) => ({ id, image })) };
}

// Printable text only, trimmed and bounded — model output is untrusted.
export function cleanText(value, maxLength = 120) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

export function cleanDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real && y >= 2000 && y <= 2100 ? value : null;
}

// Model JSON -> { documentType, facility, date, dateLabeled }, with
// anything unrecognized dropped to "unknown"/null/false rather than
// guessed. dateLabeled is only ever true alongside a valid date.
export function sanitizeHeader(raw) {
  const date = cleanDate(raw?.date);
  return {
    documentType: DOCUMENT_TYPES.has(raw?.documentType) ? raw.documentType : 'unknown',
    facility: cleanText(raw?.facility),
    date,
    dateLabeled: date !== null && raw?.dateLabeled === true,
  };
}

// Model JSON -> one reading per requested id, in request order. A row the
// model skipped or mangled comes back unreadable (name null) rather than
// disappearing, so the browser can still show it for manual review.
export function sanitizeRows(raw, requestedIds) {
  const byId = new Map();
  for (const row of Array.isArray(raw?.rows) ? raw.rows : []) {
    if (typeof row?.id === 'string' && !byId.has(row.id)) byId.set(row.id, row);
  }

  return requestedIds.map((id) => {
    const row = byId.get(id);
    if (!row) return { id, notAPatientRow: false, patients: [{ name: null, legibility: 'unclear' }] };

    const notAPatientRow = row.notAPatientRow === true;
    const patients = notAPatientRow
      ? []
      : (Array.isArray(row.patients) ? row.patients : []).slice(0, 5).map((p) => {
          const name = cleanText(p?.name, 80);
          return { name, legibility: name && LEGIBILITY.has(p?.legibility) ? p.legibility : 'unclear' };
        });

    if (!notAPatientRow && patients.length === 0) {
      return { id, notAPatientRow: false, patients: [{ name: null, legibility: 'unclear' }] };
    }
    return { id, notAPatientRow, patients };
  });
}
