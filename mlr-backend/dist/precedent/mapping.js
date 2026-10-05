import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
export const MAPPINGS_DIR = fileURLToPath(new URL('../../precedent/mappings/', import.meta.url));
export const PRECEDENT_STATUSES = ['open', 'resolved', 'accepted', 'rejected'];
export const REVIEWER_FUNCTIONS = [
    'medical',
    'legal',
    'regulatory',
    'commercial',
    'other',
];
const header = z.string().trim().min(1);
export const ColumnMappingSchema = z
    .object({
    name: z.string().regex(/^[\w-]+$/),
    sheet: z.string().optional(),
    columns: z
        .object({
        commentText: header,
        date: header,
        brand: header,
        sourceCommentId: header.optional(),
        proofName: header.optional(),
        proofVersion: header.optional(),
        page: header.optional(),
        reviewer: header.optional(),
        reviewerFunction: header.optional(),
        status: header.optional(),
        country: header.optional(),
        site: header.optional(),
    })
        .strict(),
    dateFormats: z.array(z.enum(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD.MM.YYYY'])).min(1),
    values: z
        .object({
        status: z.record(z.string(), z.enum(PRECEDENT_STATUSES)).default({}),
        reviewerFunction: z.record(z.string(), z.enum(REVIEWER_FUNCTIONS)).default({}),
    })
        .strict()
        .default({ status: {}, reviewerFunction: {} }),
})
    .strict();
export const REQUIRED_FIELDS = ['commentText', 'date', 'brand'];
/** Loads a mapping by name (from precedent/mappings/) or by path to a .yaml file. */
export async function loadMapping(nameOrPath = 'default') {
    const path = /[/\\]|\.ya?ml$/.test(nameOrPath) ? nameOrPath : `${MAPPINGS_DIR}${nameOrPath}.yaml`;
    return ColumnMappingSchema.parse(parse(await readFile(path, 'utf8')));
}
//# sourceMappingURL=mapping.js.map