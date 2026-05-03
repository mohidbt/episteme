import type { Author } from "./author-utils";

interface BibtexInput {
  paperId?: string | null;
  doi?: string | null;
  title?: string | null;
  authors?: Author[] | null;
  year?: number | null;
  venue?: string | null;
}

const SPECIAL_CHARS: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/%/g, "\\%"],
  [/\$/g, "\\$"],
  [/&/g, "\\&"],
  [/#/g, "\\#"],
  [/_/g, "\\_"],
];

function escape(str: string): string {
  let s = str;
  for (const [re, replacement] of SPECIAL_CHARS) {
    s = s.replace(re, replacement);
  }
  return s;
}

function toAsciiKeyPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildEntryKey(input: BibtexInput): string {
  const lastName = toAsciiKeyPart(
    input.authors?.[0]?.name?.split(" ").pop()?.toLowerCase() ?? ""
  );
  const yearPart = input.year ? String(input.year) : "";
  const titleWord = toAsciiKeyPart(
    input.title?.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  );
  if (lastName || yearPart || titleWord) {
    return `${lastName}${yearPart}${titleWord}`;
  }
  return `inhale${Date.now()}`;
}

export function formatBibtex(input: BibtexInput): string {
  const key = buildEntryKey(input);
  const fields: string[] = [];

  if (input.title) fields.push(`  title = {${escape(input.title)}}`);

  if (input.authors && input.authors.length > 0) {
    const authorStr = input.authors.map((a) => a.name).join(" and ");
    fields.push(`  author = {${escape(authorStr)}}`);
  }

  if (input.year != null) fields.push(`  year = {${input.year}}`);
  if (input.venue) fields.push(`  journal = {${escape(input.venue)}}`);
  if (input.doi) fields.push(`  doi = {${escape(input.doi)}}`);

  return `@article{${key},\n${fields.join(",\n")}\n}`;
}
