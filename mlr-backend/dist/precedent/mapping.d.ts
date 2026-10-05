import { z } from 'zod';
export declare const MAPPINGS_DIR: string;
export declare const PRECEDENT_STATUSES: readonly ["open", "resolved", "accepted", "rejected"];
export declare const REVIEWER_FUNCTIONS: readonly ["medical", "legal", "regulatory", "commercial", "other"];
export declare const ColumnMappingSchema: z.ZodObject<{
    name: z.ZodString;
    sheet: z.ZodOptional<z.ZodString>;
    columns: z.ZodObject<{
        commentText: z.ZodString;
        date: z.ZodString;
        brand: z.ZodString;
        sourceCommentId: z.ZodOptional<z.ZodString>;
        proofName: z.ZodOptional<z.ZodString>;
        proofVersion: z.ZodOptional<z.ZodString>;
        page: z.ZodOptional<z.ZodString>;
        reviewer: z.ZodOptional<z.ZodString>;
        reviewerFunction: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        country: z.ZodOptional<z.ZodString>;
        site: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    dateFormats: z.ZodArray<z.ZodEnum<{
        "YYYY-MM-DD": "YYYY-MM-DD";
        "MM/DD/YYYY": "MM/DD/YYYY";
        "DD/MM/YYYY": "DD/MM/YYYY";
        "DD.MM.YYYY": "DD.MM.YYYY";
    }>>;
    values: z.ZodDefault<z.ZodObject<{
        status: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodEnum<{
            open: "open";
            accepted: "accepted";
            rejected: "rejected";
            resolved: "resolved";
        }>>>;
        reviewerFunction: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodEnum<{
            other: "other";
            medical: "medical";
            legal: "legal";
            regulatory: "regulatory";
            commercial: "commercial";
        }>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type MappedField = keyof ColumnMapping['columns'];
export declare const REQUIRED_FIELDS: MappedField[];
/** Loads a mapping by name (from precedent/mappings/) or by path to a .yaml file. */
export declare function loadMapping(nameOrPath?: string): Promise<ColumnMapping>;
