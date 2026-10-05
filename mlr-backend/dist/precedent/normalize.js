import { createHash, createHmac } from 'node:crypto';
import { REQUIRED_FIELDS } from './mapping.js';
/** Maps each field to its column index; throws listing missing required headers and what the file has. */
export function resolveColumns(headers, mapping) {
    const norm = (s) => s.trim().toLowerCase();
    const index = new Map(headers.map((h, i) => [norm(h), i]));
    const out = {};
    const missing = [];
    for (const [field, headerName] of Object.entries(mapping.columns)) {
        if (!headerName)
            continue;
        const i = index.get(norm(headerName));
        if (i === undefined) {
            if (REQUIRED_FIELDS.includes(field))
                missing.push(`"${headerName}" (${field})`);
            else
                missing.push(`"${headerName}" (${field}, optional; remove it from the mapping if the export has no such column)`);
        }
        else
            out[field] = i;
    }
    if (missing.length) {
        throw new Error(`Columns not found: ${missing.join(', ')}. The file has: ${headers.map((h) => `"${h}"`).join(', ')}`);
    }
    return out;
}
/**
 * Stable, keyed pseudonym: the same name always maps to the same token under one key, and the name
 * can't be recovered from it. Case and whitespace differences in the name are ignored.
 */
export function pseudonymize(name, key) {
    const normalized = name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    return `Reviewer-${createHmac('sha256', key).update(normalized).digest('hex').slice(0, 8).toUpperCase()}`;
}
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Phone numbers: optional +country code, then 7+ digits with common separators.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,3}\b/g;
const DATE_LIKE = /^(?:\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/;
/** Replaces email addresses and phone numbers in free text. Names in free text are NOT detected. */
export function redact(text) {
    return text
        .replace(EMAIL, '[email]')
        .replace(PHONE, (m) => m.replace(/\D/g, '').length >= 7 && !DATE_LIKE.test(m.trim()) ? '[phone]' : m);
}
export function parseDate(cell, formats) {
    if (cell === null)
        return null;
    if (cell instanceof Date)
        return Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
    if (typeof cell === 'number') {
        // Excel serial date (days since 1899-12-30), as some exports store dates as plain numbers.
        if (cell < 1 || cell > 2958465)
            return null;
        return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86_400_000)
            .toISOString()
            .slice(0, 10);
    }
    const s = cell.trim();
    for (const format of formats) {
        const m = {
            'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/,
            'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
            'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
            'DD.MM.YYYY': /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
        }[format].exec(s);
        if (!m)
            continue;
        const [y, mo, d] = format === 'YYYY-MM-DD'
            ? [m[1], m[2], m[3]]
            : format === 'MM/DD/YYYY'
                ? [m[3], m[1], m[2]]
                : [m[3], m[2], m[1]];
        const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
        // Reject impossible dates (e.g. 2025-02-31 rolling over into March).
        if (date.getUTCFullYear() === Number(y) &&
            date.getUTCMonth() === Number(mo) - 1 &&
            date.getUTCDate() === Number(d)) {
            return date.toISOString().slice(0, 10);
        }
    }
    return null;
}
/** Looks a value up in a value map, ignoring case and spacing. */
function mapValue(raw, map) {
    if (raw === null)
        return { value: null, unknown: false };
    const key = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = Object.entries(map).find(([k]) => k.replace(/\s+/g, ' ').trim().toLowerCase() === key);
    return hit ? { value: hit[1], unknown: false } : { value: null, unknown: true };
}
/** One row → a precedent, or the reasons it can't be imported. */
export function normalizeRow(cells, cols, mapping, opts) {
    const text = (field) => {
        const i = cols[field];
        if (i === undefined)
            return null;
        const v = cells[i];
        if (v === null || v === undefined)
            return null;
        const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim();
        return s || null;
    };
    const errors = [];
    const comment = text('commentText');
    if (!comment)
        errors.push('comment is empty');
    const brand = text('brand');
    if (!brand)
        errors.push('brand is empty');
    const dateCell = cols.date === undefined ? null : (cells[cols.date] ?? null);
    const date = parseDate(dateCell, mapping.dateFormats);
    if (!date)
        errors.push(`date "${dateCell ?? ''}" is not a valid date (${mapping.dateFormats.join(' or ')})`);
    const status = mapValue(text('status'), mapping.values.status);
    if (status.unknown)
        errors.push(`status "${text('status')}" is not in the mapping (${Object.keys(mapping.values.status).join(', ')})`);
    const fn = mapValue(text('reviewerFunction'), mapping.values.reviewerFunction);
    // An unmapped reviewer function isn't fatal: keep the row, record it as "other".
    const reviewerFunction = fn.unknown ? 'other' : fn.value;
    if (errors.length)
        return { ok: false, errors };
    const reviewer = text('reviewer');
    const reviewerPseudonym = reviewer ? pseudonymize(reviewer, opts.pseudonymKey) : null;
    const commentText = redact(comment);
    const site = text('site') ?? opts.site;
    const value = {
        sourceCommentId: text('sourceCommentId'),
        proofName: text('proofName'),
        proofVersion: text('proofVersion'),
        pageRef: text('page'),
        commentText,
        reviewerPseudonym,
        reviewerFunction,
        status: status.value,
        commentedAt: date,
        brand: brand,
        country: text('country'),
        site,
    };
    const fingerprint = createHash('sha256')
        .update(JSON.stringify([
        value.site,
        value.brand,
        value.commentedAt,
        value.proofName,
        value.pageRef,
        value.commentText.toLowerCase(),
        value.reviewerPseudonym,
    ]))
        .digest('hex');
    return { ok: true, value: { ...value, fingerprint } };
}
//# sourceMappingURL=normalize.js.map