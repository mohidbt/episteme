import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  papers,
  papersets,
  references_,
  TRASH_FOLDER_NAME,
} from "@episteme/db/schema";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { resolveNoteSlug } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { extractCover } from "@/lib/pdf-extract";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";
const SEED_PAPER_FILE = "2005.11401.pdf";
const SEED_PAPER_TITLE =
  "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks";
const SEED_PAPER_DOI = "10.48550/arXiv.2005.11401";
const SEED_PAPER_AUTHORS = [
  "Patrick Lewis",
  "Ethan Perez",
  "Aleksandra Piktus",
  "Fabio Petroni",
  "Vladimir Karpukhin",
  "Naman Goyal",
  "Heinrich Küttler",
  "Mike Lewis",
  "Wen-tau Yih",
  "Tim Rocktäschel",
  "Sebastian Riedel",
  "Douwe Kiela",
];
const SEED_PAPER_YEAR = 2020;

const SEED_REFERENCES = [
  "alphafold.csl.json",
  "attention.csl.json",
  "bert.csl.json",
  "gpt3.csl.json",
  "diffusion.csl.json",
];

const READING_LIST_FOLDER = "Reading List";
const FOUNDATIONS_FOLDER = "Foundations";
const PCA_FOLDER = "PCA";

// Real PCA references (Principal Component Analysis canon). Citation keys are
// derived automatically; no fabrication — every entry below has a verifiable
// publication. The accompanying paperset rows (see SEED_PCA_PAPERSET) ARE
// fabricated demo data, marked accordingly.
const SEED_PCA_REFERENCES = [
  "pca-pearson1901.csl.json",
  "pca-hotelling1933.csl.json",
  "pca-jolliffe2002.csl.json",
  "pca-tipping-bishop1999.csl.json",
  "pca-novembre2008.csl.json",
  "pca-turk-pentland1991.csl.json",
];

// PCA-folder demo PDFs. NOTE: these test PDFs are propensity-score-matching
// papers used as stand-in content for the demo — they are NOT the canonical
// PCA references above. The seed pairs each with a plausible title/authors
// extracted from the PDF, so the guest can experience "paper-with-PDF" rows
// in a paperset alongside reference-only rows.
const SEED_PCA_PAPERS: Array<{
  filename: string;
  title: string;
  authors: string[];
  year: number;
  doi: string | null;
}> = [
  {
    filename: "pca-paper-1.pdf",
    title:
      "Using Propensity-Score Matched Cohorts to Evaluate Career Outcomes for Medical Students Completing the Underserved Pathway",
    authors: [
      "Genya Shimkin",
      "Kimberly Kardonsky",
      "Alisse Cassell",
      "Ayan Mohamed",
      "Mansi Shah",
      "Amanda Kost",
      "Lynn Oliver",
      "Sharon Dobie",
      "Samira Farah",
    ],
    year: 2025,
    doi: null,
  },
  {
    filename: "pca-paper-2.pdf",
    title:
      "Propensity-score matching with GAN-generated observations from electronic health records: simulation study and application to the evaluation of prone positioning in COVID-19 patients under mechanical ventilation",
    authors: [
      "Bertrand Bouvarel",
      "Benjamin Glemain",
      "Fabrice Carrat",
      "Nathanael Lapidus",
    ],
    year: 2025,
    doi: null,
  },
  {
    filename: "pca-paper-3.pdf",
    title:
      "Propensity score matching–difference-in-differences analysis of the casual effect of opening intermediate high-speed railway stations on employment status in surrounding municipalities",
    authors: ["Jikang Fan", "Shintaro Terabe", "Hideki Yaginuma"],
    year: 2025,
    doi: null,
  },
];

// DUMMY DATA — fabricated for the guest-mode demo. NOT real research findings
// for any of the cited papers. Kept in lockstep order with SEED_PCA_REFERENCES.
const SEED_PCA_PAPERSET_FILENAME = "pca-survey.csv";
const SEED_PCA_PAPERSET_COLUMNS = [
  {
    name: "Uses PCA",
    description:
      "Whether and how PCA is used in the paper (yes/no plus extent).",
  },
  {
    name: "Variables matched on",
    description:
      "Which variables or features the analysis is performed over.",
  },
] as const;
const SEED_PCA_PAPERSET_ROWS = [
  {
    "Uses PCA": "Yes, foundational derivation",
    "Variables matched on": "n-dimensional point coordinates",
  },
  {
    "Uses PCA": "Yes, primary statistical method",
    "Variables matched on": "psychometric test scores",
  },
  {
    "Uses PCA": "Yes, comprehensive treatment (book)",
    "Variables matched on": "general multivariate observations",
  },
  {
    "Uses PCA": "Yes, probabilistic latent-variable form",
    "Variables matched on": "Gaussian observed variables",
  },
  {
    "Uses PCA": "Yes, dimensionality reduction",
    "Variables matched on": "SNP genotype frequencies across individuals",
  },
  {
    "Uses PCA": "Yes, primary method",
    "Variables matched on": "image pixel intensities (face images)",
  },
] as const;

function dummyPapersetCsv(
  rowRefs: Array<{ citationKey: string; title: string }>,
): string {
  const header = ["Reference", ...SEED_PCA_PAPERSET_COLUMNS.map((c) => c.name)];
  const lines = [header.map(csvEscape).join(",")];
  for (let i = 0; i < rowRefs.length; i++) {
    const ref = rowRefs[i];
    const row = SEED_PCA_PAPERSET_ROWS[i];
    lines.push(
      [
        `${ref.citationKey} — ${ref.title}`,
        row["Uses PCA"],
        row["Variables matched on"],
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function csvEscape(field: string): string {
  if (/[",\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/**
 * Seed app-level demo content for a freshly-created anonymous user. Idempotent:
 * if all four seed kinds (library, note, paper, reference) exist, no-op.
 * Otherwise wipe any partial state for this user and re-seed from scratch — a
 * prior failed run (e.g. MinIO down, fs read error) leaves a half-seeded user
 * that must be made whole on retry.
 */
export async function seedAnonymousUser(userId: string): Promise<void> {
  const [libRow] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .limit(1);
  const [noteRow] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.userId, userId))
    .limit(1);
  const [paperRow] = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.userId, userId))
    .limit(1);
  const [refRow] = await db
    .select({ id: references_.id })
    .from(references_)
    .where(eq(references_.userId, userId))
    .limit(1);
  if (libRow && noteRow && paperRow && refRow) return;

  if (libRow || noteRow || paperRow || refRow) {
    await db.delete(libraries).where(eq(libraries.userId, userId));
  }

  const { lib, foundationsFolder, pcaFolder } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(libraries)
      .values({ userId, name: "My Library" })
      .returning();
    await tx.insert(folders).values({
      libraryId: created.id,
      userId,
      parentId: null,
      name: TRASH_FOLDER_NAME,
      isTrash: true,
    });
    const [readingList] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: READING_LIST_FOLDER,
      })
      .returning();
    const [foundations] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: readingList.id,
        name: FOUNDATIONS_FOLDER,
      })
      .returning();
    const [pca] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: PCA_FOLDER,
      })
      .returning();
    return { lib: created, foundationsFolder: foundations, pcaFolder: pca };
  });

  const noteMdPath = path.join(process.cwd(), SEED_DIR, WELCOME_NOTE_FILE);
  const contentMd = await fs.readFile(noteMdPath, "utf8");
  const slug = await resolveNoteSlug(userId, WELCOME_NOTE_TITLE);
  await db.insert(notes).values({
    libraryId: lib.id,
    userId,
    folderPath: "",
    title: WELCOME_NOTE_TITLE,
    slug,
    contentMd,
  });

  const pdfPath = path.join(process.cwd(), SEED_DIR, SEED_PAPER_FILE);
  const pdfBuf = await fs.readFile(pdfPath);
  const [paper] = await db
    .insert(papers)
    .values({
      libraryId: lib.id,
      userId,
      folderPath: "",
      folderId: null,
      filename: SEED_PAPER_FILE,
      title: SEED_PAPER_TITLE,
      doi: SEED_PAPER_DOI,
      authors: SEED_PAPER_AUTHORS,
      year: SEED_PAPER_YEAR,
    })
    .returning();
  await storage.uploadObject(
    paperSourceKey(paper.id),
    pdfBuf,
    "application/pdf",
  );

  // Cover failure must NOT fail the whole seed — same policy as finalize route.
  try {
    const cover = await extractCover(new Uint8Array(pdfBuf));
    await storage.uploadObject(paperCoverKey(paper.id), cover, "image/png");
  } catch (err) {
    console.warn(`seed: cover extraction failed for paper ${paper.id}`, err);
  }

  for (let i = 0; i < SEED_REFERENCES.length; i++) {
    const cslPath = path.join(process.cwd(), SEED_DIR, SEED_REFERENCES[i]);
    const cslRaw = JSON.parse(await fs.readFile(cslPath, "utf8")) as CslItem;
    const cslJson = validateCslJson(cslRaw);
    const citationKey = deriveCitationKey(cslJson);
    // First reference (AlphaFold) at library root; the rest live in the nested
    // Reading List/Foundations folder so the demo shows nested-folder usage.
    const inFoundations = i > 0;
    await db.insert(references_).values({
      libraryId: lib.id,
      userId,
      folderPath: inFoundations
        ? `${READING_LIST_FOLDER}/${FOUNDATIONS_FOLDER}`
        : "",
      folderId: inFoundations ? foundationsFolder.id : null,
      citationKey,
      cslJson,
      paperId: null,
    });
  }

  // PCA folder — real references + a dummy paperset that demonstrates the
  // research-survey workflow on guest accounts without requiring uploads.
  const pcaInsertedRefs: Array<{
    id: string;
    citationKey: string;
    title: string;
  }> = [];
  for (const file of SEED_PCA_REFERENCES) {
    const cslPath = path.join(process.cwd(), SEED_DIR, file);
    const cslRaw = JSON.parse(await fs.readFile(cslPath, "utf8")) as CslItem;
    const cslJson = validateCslJson(cslRaw);
    const citationKey = deriveCitationKey(cslJson);
    const [inserted] = await db
      .insert(references_)
      .values({
        libraryId: lib.id,
        userId,
        folderPath: PCA_FOLDER,
        folderId: pcaFolder.id,
        citationKey,
        cslJson,
        paperId: null,
      })
      .returning();
    pcaInsertedRefs.push({
      id: inserted.id,
      citationKey,
      title: typeof cslJson.title === "string" ? cslJson.title : citationKey,
    });
  }

  // Insert PCA-folder PDFs as actual paper rows. The first 3 paperset rows
  // will reference these paper IDs (paper-backed rows); the remaining 3 stay
  // as reference-only rows so the demo shows both shapes side-by-side.
  const pcaInsertedPapers: Array<{ id: string; title: string }> = [];
  for (const meta of SEED_PCA_PAPERS) {
    const pdfFsPath = path.join(process.cwd(), SEED_DIR, meta.filename);
    const buf = await fs.readFile(pdfFsPath);
    const [inserted] = await db
      .insert(papers)
      .values({
        libraryId: lib.id,
        userId,
        folderPath: PCA_FOLDER,
        folderId: pcaFolder.id,
        filename: meta.filename,
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
        doi: meta.doi,
      })
      .returning();
    await storage.uploadObject(
      paperSourceKey(inserted.id),
      buf,
      "application/pdf",
    );
    try {
      const cover = await extractCover(new Uint8Array(buf));
      await storage.uploadObject(paperCoverKey(inserted.id), cover, "image/png");
    } catch (err) {
      console.warn(
        `seed: cover extraction failed for PCA paper ${inserted.id}`,
        err,
      );
    }
    pcaInsertedPapers.push({ id: inserted.id, title: meta.title });
  }

  // First 3 rowRefs → real paper IDs (paper-backed rows). Remaining 3 →
  // reference IDs (reference-only rows).
  const rowRefs = [
    ...pcaInsertedPapers.map((p) => ({ paper_id: p.id })),
    ...pcaInsertedRefs.slice(3).map((r) => ({ paper_id: r.id })),
  ];
  // The CSV body should reflect the paper title for paper-backed rows and the
  // citation-key + ref-title for reference-only rows.
  const rowLabels = [
    ...pcaInsertedPapers.map((p) => ({
      citationKey: "paper",
      title: p.title,
    })),
    ...pcaInsertedRefs.slice(3),
  ];
  await db.insert(papersets).values({
    libraryId: lib.id,
    userId,
    folderId: pcaFolder.id,
    filename: SEED_PCA_PAPERSET_FILENAME,
    columns: SEED_PCA_PAPERSET_COLUMNS.map((c) => ({
      name: c.name,
      description: c.description,
    })),
    rowRefs,
    cellGrounding: {},
    runningCells: [],
    content: dummyPapersetCsv(rowLabels),
  });
}
