import { openai } from './openaiClient.js';
import { sanitizeHeader, sanitizeRows } from './analyzerSchema.js';

// The AI half of the Document Analyzer. By the time anything reaches this
// module, the browser has already decided — deterministically, from pixel
// colors — which rows of the sheet are highlighted, and cropped them out.
// The model only reads those crops; it never sees the rest of the sheet
// and never decides what counts as highlighted.

// Needs a vision-capable model. OPENAI_VISION_MODEL exists in case
// OPENAI_MODEL is ever pointed at a text-only one.
function visionModel() {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

const HEADER_PROMPT = `You are reading the top section of a scanned document from a skilled nursing facility, rehab facility, or hospital — typically a billing sheet or a patient census sheet.

Determine:
- documentType: "billing_sheet" if the document is titled or clearly structured as a billing/charge/encounter sheet; "census_sheet" if it is a census, resident list, or patient roster; otherwise "unknown".
- facility: the facility name exactly as printed. null if no facility name is printed.
- date: the date the sheet is for (census date, date of service, rounding date), as YYYY-MM-DD. null if no such date is printed, or if you cannot tell which printed date is the service/census date.
- dateLabeled: true only if that date is explicitly labeled on the sheet as the census/service/rounding date (e.g. "Census Date: 09/29/2026", "Date of Service: ..."). false if the date appears without such a label, or could be a print/run timestamp.

Never guess. If something is not clearly printed, use null (or "unknown" for documentType).

Respond with ONLY a JSON object of this exact shape:
{"documentType": "billing_sheet" | "census_sheet" | "unknown", "facility": string | null, "date": string | null, "dateLabeled": boolean}`;

const ROWS_PROMPT = `You are reading cropped strips from a scanned facility billing sheet or census sheet. Each image is one horizontal strip of the sheet that a staff member marked with a highlighter, labeled with an id. The strip may also include slivers of the neighboring rows above and below. Those rows are NOT highlighted: never report a name that is cut off at, or touching, the top or bottom edge of the image, and never report a name whose background is not highlighter-colored. Read only the highlighted row(s).

For each image, report the patient(s) in the highlighted row(s):
- name: the patient's name, reordered to "First Last" with normal capitalization (e.g. "REYES, MICHAEL J" -> "Michael J Reyes"). Reordering and capitalization are the only changes allowed — never correct spelling, never complete a partially visible name, never invent a name.
- legibility: "clear" if every letter of the name is plainly readable; "partial" if some letters are uncertain (still return your best reading of what is visible); "unclear" if you cannot read a name at all (use name null).
- If the strip contains no patient row — column headers, totals, a title, a blank line — set notAPatientRow to true with an empty patients list.
- Only if the highlighter color itself clearly covers more than one full patient row, list each of those patients.
- Report only the name. Do not include dates of birth, record numbers, room numbers, diagnoses, or any other field.

Respond with ONLY a JSON object of this exact shape, with one entry per image id:
{"rows": [{"id": string, "notAPatientRow": boolean, "patients": [{"name": string | null, "legibility": "clear" | "partial" | "unclear"}]}]}`;

async function completeJson(system, content) {
  const completion = await openai.chat.completions.create({
    model: visionModel(),
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('empty model response');
  return JSON.parse(text);
}

export async function readHeader(image) {
  const raw = await completeJson(HEADER_PROMPT, [{ type: 'image_url', image_url: { url: image, detail: 'high' } }]);
  return sanitizeHeader(raw);
}

export async function readRows(rows) {
  const content = rows.flatMap(({ id, image }) => [
    { type: 'text', text: `Image id: ${id}` },
    { type: 'image_url', image_url: { url: image, detail: 'high' } },
  ]);
  const raw = await completeJson(ROWS_PROMPT, content);
  return sanitizeRows(raw, rows.map((r) => r.id));
}
