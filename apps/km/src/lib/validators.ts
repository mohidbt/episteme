import { z } from "zod";

const trimmed = z.string().transform((s) => s.trim());
const nonEmptyTrimmed = (max: number) =>
  trimmed.pipe(z.string().min(1).max(max));

const currentYear = new Date().getFullYear();
const yearSchema = z.number().int().min(1000).max(currentYear + 1);

export const libraryCreateSchema = z.object({
  name: nonEmptyTrimmed(200),
});

export const libraryUpdateSchema = z.object({
  name: nonEmptyTrimmed(200).optional(),
});

export const paperCreateSchema = z.object({
  libraryId: z.number().int(),
  folderPath: trimmed.default(""),
  filename: nonEmptyTrimmed(500),
  storageUrl: nonEmptyTrimmed(2000),
  title: nonEmptyTrimmed(1000),
  authors: z.array(z.string()).optional(),
  year: yearSchema.optional(),
  doi: z.string().optional(),
  venue: z.string().optional(),
});

export const paperUpdateSchema = z.object({
  folderPath: trimmed.optional(),
  filename: nonEmptyTrimmed(500).optional(),
  storageUrl: nonEmptyTrimmed(2000).optional(),
  title: nonEmptyTrimmed(1000).optional(),
  authors: z.array(z.string()).optional(),
  year: yearSchema.optional(),
  doi: z.string().optional(),
  venue: z.string().optional(),
});

const citationKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_:-]+$/);

export const referenceCreateSchema = z.object({
  libraryId: z.number().int(),
  folderPath: trimmed.default(""),
  citationKey,
  cslJson: z.unknown(),
  paperId: z.string().nullable().optional(),
});

export const referenceUpdateSchema = z.object({
  folderPath: trimmed.optional(),
  citationKey: citationKey.optional(),
  cslJson: z.unknown().optional(),
  paperId: z.string().nullable().optional(),
});

export const noteCreateSchema = z.object({
  libraryId: z.number().int(),
  folderPath: trimmed.default(""),
  title: nonEmptyTrimmed(500),
  contentMd: z.string().optional(),
  noteType: z.enum(["md", "latex", "pdf-ref"]).default("md"),
});

export const noteUpdateSchema = z.object({
  folderPath: trimmed.optional(),
  title: nonEmptyTrimmed(500).optional(),
  contentMd: z.string().optional(),
  noteType: z.enum(["md", "latex", "pdf-ref"]).optional(),
});

export const noteLinkCreateSchema = z.object({
  sourceNoteId: z.string(),
  targetKind: z.enum(["note", "paper", "reference"]),
  targetId: z.string().nullable().optional(),
  targetTitleRaw: z.string().nullable().optional(),
  positionStart: z.number().int().optional(),
  positionEnd: z.number().int().optional(),
});
