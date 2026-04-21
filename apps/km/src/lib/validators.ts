import { z } from "zod";
import { isValidFolderPath } from "./tree";

const trimmed = z.string().transform((s) => s.trim());
const nonEmptyTrimmed = (max: number) =>
  trimmed.pipe(z.string().min(1).max(max));

const folderPathSchema = trimmed.pipe(
  z.string().refine(isValidFolderPath, {
    message: 'folder path cannot contain %, _, or \\',
  }),
);

const currentYear = new Date().getFullYear();
const yearSchema = z.number().int().min(1000).max(currentYear + 1);

export const libraryCreateSchema = z.object({
  name: nonEmptyTrimmed(200),
});

export const libraryUpdateSchema = z.object({
  name: nonEmptyTrimmed(200).optional(),
});

const PDF_CONTENT_TYPE = "application/pdf";
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB cap

export const paperUploadInitSchema = z.object({
  libraryId: z.number().int(),
  folderPath: folderPathSchema.default(""),
  filename: nonEmptyTrimmed(500),
  contentType: z.literal(PDF_CONTENT_TYPE),
  sizeBytes: z.number().int().positive().max(MAX_PDF_BYTES),
});

export const paperUpdateSchema = z
  .object({
    folderPath: folderPathSchema.optional(),
    title: nonEmptyTrimmed(1000).optional(),
    authors: z.array(z.string()).optional(),
    year: yearSchema.optional(),
    doi: z.string().nullable().optional(),
  })
  .strict();

const citationKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_:-]+$/);

export const referenceCreateSchema = z.object({
  libraryId: z.number().int(),
  folderPath: folderPathSchema.default(""),
  citationKey,
  cslJson: z.unknown(),
  paperId: z.string().nullable().optional(),
});

export const referenceCreateFromCslSchema = z
  .object({
    libraryId: z.number().int(),
    folderPath: folderPathSchema.default(""),
    cslJson: z.unknown(),
    citationKey: citationKey.optional(),
    paperId: z.string().nullable().optional(),
  })
  .strict();

export const referenceCreateFromDoiSchema = z
  .object({
    libraryId: z.number().int(),
    folderPath: folderPathSchema.default(""),
    doi: z.string().min(1).max(500),
    citationKey: citationKey.optional(),
    paperId: z.string().nullable().optional(),
  })
  .strict();

export const referenceUpdateSchema = z.object({
  folderPath: folderPathSchema.optional(),
  citationKey: citationKey.optional(),
  cslJson: z.unknown().optional(),
  paperId: z.string().nullable().optional(),
});

export const noteCreateSchema = z.object({
  libraryId: z.number().int(),
  folderPath: folderPathSchema.default(""),
  title: nonEmptyTrimmed(500),
  contentMd: z.string().optional(),
  noteType: z.enum(["md", "latex", "pdf-ref"]).default("md"),
});

export const noteUpdateSchema = z.object({
  folderPath: folderPathSchema.optional(),
  title: nonEmptyTrimmed(500).optional(),
  contentMd: z.string().optional(),
  noteType: z.enum(["md", "latex", "pdf-ref"]).optional(),
});

export const noteLinkCreateSchema = z.object({
  sourceNoteId: z.string(),
  targetKind: z.enum(["note", "paper", "reference"]),
  targetId: z.string().nullable().optional(),
  targetTitleRaw: nonEmptyTrimmed(1000),
});

export const paperHighlightCreateSchema = z.object({
  paperId: z.string().uuid(),
  page: z.number().int().positive(),
  bbox: z.unknown().optional().nullable(),
  color: z.string().max(32).nullable().optional(),
  noteMd: z.string().max(10_000).nullable().optional(),
});
