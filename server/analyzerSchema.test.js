import { describe, expect, it } from 'vitest';
import { cleanDate, cleanText, MAX_ROWS_PER_REQUEST, parseRowsRequest, sanitizeHeader, sanitizeRows } from './analyzerSchema.js';

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('parseRowsRequest', () => {
  it('accepts well-formed rows and drops extra fields', () => {
    expect(parseRowsRequest({ rows: [{ id: 'r1', image: IMAGE, extra: 'x' }] })).toEqual({ rows: [{ id: 'r1', image: IMAGE }] });
  });

  it('rejects empty, oversized, duplicate-id, and non-image requests', () => {
    expect(parseRowsRequest({}).error).toBeTruthy();
    expect(parseRowsRequest({ rows: [] }).error).toBeTruthy();
    const tooMany = Array.from({ length: MAX_ROWS_PER_REQUEST + 1 }, (_, i) => ({ id: `r${i}`, image: IMAGE }));
    expect(parseRowsRequest({ rows: tooMany }).error).toBeTruthy();
    expect(parseRowsRequest({ rows: [{ id: 'r1', image: IMAGE }, { id: 'r1', image: IMAGE }] }).error).toBeTruthy();
    expect(parseRowsRequest({ rows: [{ id: 'r1', image: 'https://example.com/a.jpg' }] }).error).toBeTruthy();
    expect(parseRowsRequest({ rows: [{ id: '../x', image: IMAGE }] }).error).toBeTruthy();
  });
});

describe('cleanText / cleanDate', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(cleanText('  Cedar\nGrove\u0000  Nursing ')).toBe('Cedar Grove Nursing');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(42)).toBeNull();
  });

  it('only accepts real calendar dates', () => {
    expect(cleanDate('2026-09-29')).toBe('2026-09-29');
    expect(cleanDate('2026-02-30')).toBeNull();
    expect(cleanDate('09/29/2026')).toBeNull();
    expect(cleanDate(null)).toBeNull();
  });
});

describe('sanitizeHeader', () => {
  it('falls back to unknown/null instead of passing through unexpected values', () => {
    expect(sanitizeHeader({ documentType: 'invoice', facility: '', date: 'Sept 29', dateLabeled: true })).toEqual({
      documentType: 'unknown',
      facility: null,
      date: null,
      dateLabeled: false,
    });
    expect(sanitizeHeader({ documentType: 'census_sheet', facility: 'Cedar Grove', date: '2026-09-29', dateLabeled: true })).toEqual({
      documentType: 'census_sheet',
      facility: 'Cedar Grove',
      date: '2026-09-29',
      dateLabeled: true,
    });
    // Anything but a literal true is "not clearly labeled".
    expect(sanitizeHeader({ date: '2026-09-29', dateLabeled: 'yes' }).dateLabeled).toBe(false);
  });
});

describe('sanitizeRows', () => {
  it('returns one reading per requested id, in request order', () => {
    const raw = {
      rows: [
        { id: 'r2', notAPatientRow: true, patients: [{ name: 'Header', legibility: 'clear' }] },
        { id: 'r1', notAPatientRow: false, patients: [{ name: 'Michael Reyes', legibility: 'clear' }] },
        { id: 'r99', notAPatientRow: false, patients: [{ name: 'Not Requested', legibility: 'clear' }] },
      ],
    };

    expect(sanitizeRows(raw, ['r1', 'r2'])).toEqual([
      { id: 'r1', notAPatientRow: false, patients: [{ name: 'Michael Reyes', legibility: 'clear' }] },
      { id: 'r2', notAPatientRow: true, patients: [] },
    ]);
  });

  it('turns skipped or malformed rows into an unreadable entry instead of dropping them', () => {
    const raw = { rows: [{ id: 'r2', patients: [] }, { id: 'r3', patients: [{ name: 'Jo', legibility: 'very clear' }] }] };

    expect(sanitizeRows(raw, ['r1', 'r2', 'r3'])).toEqual([
      { id: 'r1', notAPatientRow: false, patients: [{ name: null, legibility: 'unclear' }] },
      { id: 'r2', notAPatientRow: false, patients: [{ name: null, legibility: 'unclear' }] },
      { id: 'r3', notAPatientRow: false, patients: [{ name: 'Jo', legibility: 'unclear' }] },
    ]);
    expect(sanitizeRows(null, ['r1'])).toHaveLength(1);
  });
});
