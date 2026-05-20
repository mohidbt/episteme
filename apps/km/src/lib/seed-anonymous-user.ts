import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  folders,
  libraries,
  notes,
  papers,
  papersets,
  references_,
  TRASH_FOLDER_NAME,
} from "@episteme/db/schema";
import { storage, paperSourceKey, paperCoverKey, assetSourceKey } from "@/lib/storage";
import { resolveNoteSlug } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { extractCover } from "@/lib/pdf-extract";
import { rebuildLinks } from "@episteme/notes-core";
import { seedPaperCitations } from "@/lib/citations/seed-paper-citations";

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
const PSM_FOLDER = "PSM";
const BIO_FOLDER = "Bio";

const BIO_REFERENCE_FILE = "bio-fungi.csl.json";
const BIO_PAPER1 = {
  filename: "fungi.pdf",
  title: "A travelling-wave strategy for plant–fungal trade",
  authors: [
    "Loreto Oyarte Galvez",
    "Corentin Bisot",
    "Philippe Bourrianne",
    "Howard A. Stone",
    "E. Toby Kiers",
    "Thomas S. Shimizu",
  ],
  year: 2025,
  doi: "10.1038/s41586-025-08614-x",
} as const;
const BIO_PAPER2 = {
  filename: "spontaneous.pdf",
  title:
    "Spontaneous switching in a protein signalling array reveals near-critical cooperativity",
  authors: ["Johannes M. Keegstra"],
  year: 2026,
  doi: "10.1038/s41567-025-03158-3",
} as const;
const BIO_NOTE_FUNGAL_TITLE = "Fungal";
const BIO_NOTE_ECOLI_TITLE = "EColi";
const BIO_NOTE_FUNGAL_MD = `# Fungal chemotaxis — scratchpad

#chemotaxis

- Mycorrhizal hyphae forage as a self-regulating **travelling wave** — growing tips pull an expanding mycelium, density self-tuned by fusion. See [[pdf:fungi.pdf]].
- Tip steering is a slow integration of chemical gradients (sugars, phosphate, host root exudates) — way longer timescales than bacterial chemotaxis.
- No flagellum, no run-and-tumble: directionality emerges from differential growth + branch reinforcement.
- Open question: is the "wave" really a chemotactic response or a network-level optimisation that *looks* chemotactic from outside?
- Compare with EColi run-and-tumble (see [[EColi]]) — totally different mechanism, similar functional outcome (find the resource).
`;
const BIO_NOTE_ECOLI_MD = `# E. coli chemotaxis — scratchpad

#chemotaxis

- Run-and-tumble: ~1s straight runs, brief tumbles, biased by recent ligand history.
- CheA → CheY-P binds FliM → CW rotation → tumble. CheR/CheB methylation = adaptation, gives the cell a memory of ~3s.
- **Logarithmic sensing** — response depends on fold-change in ligand, not absolute conc. Weber's law for bacteria.
- Receptor clusters at the pole are cooperative; spontaneous switching of the array is near-critical — see [[pdf:spontaneous.pdf]].
- Contrast with hyphal foraging in [[Fungal]]: same goal (climb gradient), wildly different machinery + timescale.
`;

// Real PSM references (Propensity-Score Matching canon). Citation keys are
// derived automatically; no fabrication — every entry below has a verifiable
// publication. The accompanying paperset rows (see SEED_PSM_PAPERSET) ARE
// fabricated demo data, marked accordingly.
const SEED_PSM_REFERENCES = [
  "psm-rosenbaum-rubin1983.csl.json",
  "psm-rosenbaum-rubin1985.csl.json",
  "psm-rubin1973.csl.json",
  "psm-heckman1979.csl.json",
  "psm-dehejia-wahba2002.csl.json",
  "psm-austin2011.csl.json",
];

// PSM-folder demo PDFs. The accompanying paperset rows demonstrate the
// research-survey workflow on guest accounts. The seed pairs each PDF with
// its title/authors so the guest can experience "paper-with-PDF" rows in a
// paperset alongside reference-only rows.
const SEED_PSM_PAPERS: Array<{
  filename: string;
  title: string;
  authors: string[];
  year: number;
  doi: string | null;
}> = [
  {
    filename: "psm-paper-1.pdf",
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
    doi: "10.22454/FamMed.2025.305728",
  },
  {
    filename: "psm-paper-2.pdf",
    title:
      "Propensity-score matching with GAN-generated observations from electronic health records: simulation study and application to the evaluation of prone positioning in COVID-19 patients under mechanical ventilation",
    authors: [
      "Bertrand Bouvarel",
      "Benjamin Glemain",
      "Fabrice Carrat",
      "Nathanael Lapidus",
    ],
    year: 2025,
    doi: "10.1101/2025.07.31.25332504",
  },
  {
    filename: "psm-paper-3.pdf",
    title:
      "Propensity score matching–difference-in-differences analysis of the casual effect of opening intermediate high-speed railway stations on employment status in surrounding municipalities",
    authors: ["Jikang Fan", "Shintaro Terabe", "Hideki Yaginuma"],
    year: 2025,
    doi: "10.1016/j.cstp.2025.101592",
  },
];

// DUMMY DATA — fabricated for the guest-mode demo. NOT real research findings
// for any of the cited papers. Kept in lockstep order with SEED_PSM_PAPERS
// (only the paper-backed rows; reference-only rows that produced "(missing
// paper)" entries have been removed — see #110).
const SEED_PSM_PAPERSET_FILENAME = "psm-survey.csv";
const SEED_PSM_PAPERSET_COLUMNS = [
  {
    name: "Uses PSM",
    description:
      "Whether and how propensity-score matching is used in the paper (yes/no plus extent).",
  },
  {
    name: "Variables matched on",
    description: "Which covariates the matching is performed over.",
  },
  {
    name: "Sample size",
    description:
      "Approximate number of subjects, observations, or matched pairs analyzed.",
  },
] as const;
const SEED_PSM_PAPERSET_ROWS = [
  {
    "Uses PSM": "Yes, primary analysis",
    "Variables matched on":
      "demographics, prior training experience, financial-aid status",
    "Sample size": "~1,200 family-medicine graduates",
  },
  {
    "Uses PSM": "Yes, with GAN-augmented controls",
    "Variables matched on": "baseline EHR vitals and comorbidities",
    "Sample size": "4,313 ventilated COVID-19 patients",
  },
  // Last row left empty so the user can fill cells themselves and try the
  // AI-fill workflow on a real paperset row.
  {
    "Uses PSM": "",
    "Variables matched on": "",
    "Sample size": "",
  },
] as const;

// Page anchors for prepopulated cells — drives the cell-grounding chip on
// /d/[id]. Format is `<paperId>:p<page>:<orderIndex>`; ordering doesn't
// matter for the demo (any non-empty index renders the chip + deep-links to
// /papers/<id>/read?p=<page>).
//
// Row indices align with `psmInsertedPapers` (paper-backed rows only). Row 2
// is intentionally absent — that row is the empty AI-fill demo target.
const SEED_PSM_PAPERSET_CELL_PAGES: Record<number, Record<string, number>> = {
  0: {
    "Uses PSM": 3,
    "Variables matched on": 4,
    "Sample size": 2,
  },
  1: {
    "Uses PSM": 5,
    "Variables matched on": 6,
    "Sample size": 8,
  },
};

function dummyPapersetCsv(
  rowRefs: Array<{ citationKey: string; title: string }>,
): string {
  const header = ["Reference", ...SEED_PSM_PAPERSET_COLUMNS.map((c) => c.name)];
  const lines = [header.map(csvEscape).join(",")];
  for (let i = 0; i < rowRefs.length; i++) {
    const ref = rowRefs[i];
    const row = SEED_PSM_PAPERSET_ROWS[i];
    lines.push(
      [
        `${ref.citationKey} — ${ref.title}`,
        row["Uses PSM"],
        row["Variables matched on"],
        row["Sample size"],
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Build a `cellGrounding` map for the prepopulated paperset cells. Surfaces
 * the page-deeplink chip feature (BG2b) on the guest demo — clicking the
 * chip opens the paper at the chosen page via `/papers/<id>/read?p=N`.
 */
function buildSeedCellGrounding(
  papers: Array<{ id: string }>,
): Record<string, Record<string, { paper_id: string; block_ids: string[] }>> {
  const out: Record<
    string,
    Record<string, { paper_id: string; block_ids: string[] }>
  > = {};
  for (const [rowIdxStr, perCol] of Object.entries(SEED_PSM_PAPERSET_CELL_PAGES)) {
    const rowIdx = Number(rowIdxStr);
    const paper = papers[rowIdx];
    if (!paper) continue;
    const row: Record<string, { paper_id: string; block_ids: string[] }> = {};
    for (const [col, page] of Object.entries(perCol)) {
      row[col] = {
        paper_id: paper.id,
        block_ids: [`${paper.id}:p${page}:0`],
      };
    }
    out[String(rowIdx)] = row;
  }
  return out;
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

  const { lib, foundationsFolder, psmFolder, bioFolder } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(libraries)
      .values({ userId, name: "Example Library" })
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
    const [psm] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: PSM_FOLDER,
      })
      .returning();
    const [bio] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: BIO_FOLDER,
      })
      .returning();
    return { lib: created, foundationsFolder: foundations, psmFolder: psm, bioFolder: bio };
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
  // storage_url must mirror what finalize would set — chandra, read_paper,
  // citations/extract, pages/[n]/text all key off it. Seed bypasses finalize
  // so we set it explicitly here.
  await db
    .update(papers)
    .set({ storageUrl: paperSourceKey(paper.id) })
    .where(eq(papers.id, paper.id));

  // Cover failure must NOT fail the whole seed — same policy as finalize
  // route. Use console.error (not warn) and include the storage endpoint so
  // deploy breakage (e.g. S3_ENDPOINT unset on Vercel) is diagnosable from
  // logs instead of silently producing coverless guest libraries.
  try {
    const cover = await extractCover(new Uint8Array(pdfBuf));
    await storage.uploadObject(paperCoverKey(paper.id), cover, "image/png");
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(
      `seed: cover extraction/upload failed for paper ${paper.id} ` +
        `(s3_endpoint=${process.env.S3_ENDPOINT ?? "<unset>"} ` +
        `s3_bucket=${process.env.S3_BUCKET ?? "<unset>"}): ${reason}`,
    );
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

  // PSM folder — real references + a dummy paperset that demonstrates the
  // research-survey workflow on guest accounts without requiring uploads.
  const psmInsertedRefs: Array<{
    id: string;
    citationKey: string;
    title: string;
  }> = [];
  for (const file of SEED_PSM_REFERENCES) {
    const cslPath = path.join(process.cwd(), SEED_DIR, file);
    const cslRaw = JSON.parse(await fs.readFile(cslPath, "utf8")) as CslItem;
    const cslJson = validateCslJson(cslRaw);
    const citationKey = deriveCitationKey(cslJson);
    const [inserted] = await db
      .insert(references_)
      .values({
        libraryId: lib.id,
        userId,
        folderPath: PSM_FOLDER,
        folderId: psmFolder.id,
        citationKey,
        cslJson,
        paperId: null,
      })
      .returning();
    psmInsertedRefs.push({
      id: inserted.id,
      citationKey,
      title: typeof cslJson.title === "string" ? cslJson.title : citationKey,
    });
  }

  // Insert PSM-folder PDFs as actual paper rows. The 3 paperset rows reference
  // these paper IDs (paper-backed rows) so the demo shows real survey content.
  const psmInsertedPapers: Array<{ id: string; title: string }> = [];
  for (const meta of SEED_PSM_PAPERS) {
    const pdfFsPath = path.join(process.cwd(), SEED_DIR, meta.filename);
    const buf = await fs.readFile(pdfFsPath);
    const [inserted] = await db
      .insert(papers)
      .values({
        libraryId: lib.id,
        userId,
        folderPath: PSM_FOLDER,
        folderId: psmFolder.id,
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
    await db
      .update(papers)
      .set({ storageUrl: paperSourceKey(inserted.id) })
      .where(eq(papers.id, inserted.id));
    try {
      const cover = await extractCover(new Uint8Array(buf));
      await storage.uploadObject(paperCoverKey(inserted.id), cover, "image/png");
    } catch (err) {
      console.warn(
        `seed: cover extraction failed for PSM paper ${inserted.id}`,
        err,
      );
    }
    psmInsertedPapers.push({ id: inserted.id, title: meta.title });
    // D7.1: pre-extract synthetic doc-refs from the PSM CSL list + auto-link
    // inline so /references is non-empty on minute-zero guest workspaces.
    // Failures must not break seed — auto-link is best-effort.
    try {
      await seedPaperCitations(inserted.id, SEED_PSM_REFERENCES);
    } catch (err) {
      console.warn(
        `seed: synthetic citation seed failed for PSM paper ${inserted.id}`,
        err,
      );
    }
  }

  // #110: Only paper-backed rows — reference-only rows that produced
  // "(missing paper)" have been removed.
  const rowRefs = psmInsertedPapers.map((p) => ({ paper_id: p.id }));
  const rowLabels = psmInsertedPapers.map((p) => ({
    citationKey: "paper",
    title: p.title,
  }));
  await db.insert(papersets).values({
    libraryId: lib.id,
    userId,
    folderId: psmFolder.id,
    filename: SEED_PSM_PAPERSET_FILENAME,
    columns: SEED_PSM_PAPERSET_COLUMNS.map((c) => ({
      name: c.name,
      description: c.description,
    })),
    rowRefs,
    cellGrounding: buildSeedCellGrounding(psmInsertedPapers),
    runningCells: [],
    content: dummyPapersetCsv(rowLabels),
  });

  // Bio folder — chemotaxis demo: 2 papers + 1 RIS-derived reference (linked to
  // paper1) + 2 cross-linked notes with #chemotaxis tags.
  const bioPapers: Record<"fungi" | "spontaneous", { id: string }> = {
    fungi: { id: "" },
    spontaneous: { id: "" },
  };
  for (const [key, meta] of [
    ["fungi", BIO_PAPER1] as const,
    ["spontaneous", BIO_PAPER2] as const,
  ]) {
    const pdfFsPath = path.join(process.cwd(), SEED_DIR, meta.filename);
    const buf = await fs.readFile(pdfFsPath);
    const [inserted] = await db
      .insert(papers)
      .values({
        libraryId: lib.id,
        userId,
        folderPath: BIO_FOLDER,
        folderId: bioFolder.id,
        filename: meta.filename,
        title: meta.title,
        authors: [...meta.authors],
        year: meta.year,
        doi: meta.doi,
      })
      .returning();
    await storage.uploadObject(
      paperSourceKey(inserted.id),
      buf,
      "application/pdf",
    );
    await db
      .update(papers)
      .set({ storageUrl: paperSourceKey(inserted.id) })
      .where(eq(papers.id, inserted.id));
    try {
      const cover = await extractCover(new Uint8Array(buf));
      await storage.uploadObject(paperCoverKey(inserted.id), cover, "image/png");
    } catch (err) {
      console.warn(`seed: cover extraction failed for bio paper ${inserted.id}`, err);
    }
    bioPapers[key] = { id: inserted.id };
  }

  // Reference: same publication as fungi.pdf — paperId links the two.
  const bioCslRaw = JSON.parse(
    await fs.readFile(path.join(process.cwd(), SEED_DIR, BIO_REFERENCE_FILE), "utf8"),
  ) as CslItem;
  const bioCsl = validateCslJson(bioCslRaw);
  const bioCitationKey = deriveCitationKey(bioCsl);
  await db.insert(references_).values({
    libraryId: lib.id,
    userId,
    folderPath: BIO_FOLDER,
    folderId: bioFolder.id,
    citationKey: bioCitationKey,
    cslJson: bioCsl,
    paperId: bioPapers.fungi.id,
  });

  // Notes — insert Fungal first (EColi links to Fungal by title via [[Fungal]]).
  const fungalSlug = await resolveNoteSlug(userId, BIO_NOTE_FUNGAL_TITLE);
  const [fungalNote] = await db
    .insert(notes)
    .values({
      libraryId: lib.id,
      userId,
      folderPath: BIO_FOLDER,
      folderId: bioFolder.id,
      title: BIO_NOTE_FUNGAL_TITLE,
      slug: fungalSlug,
      contentMd: BIO_NOTE_FUNGAL_MD,
    })
    .returning();
  const ecoliSlug = await resolveNoteSlug(userId, BIO_NOTE_ECOLI_TITLE);
  const [ecoliNote] = await db
    .insert(notes)
    .values({
      libraryId: lib.id,
      userId,
      folderPath: BIO_FOLDER,
      folderId: bioFolder.id,
      title: BIO_NOTE_ECOLI_TITLE,
      slug: ecoliSlug,
      contentMd: BIO_NOTE_ECOLI_MD,
    })
    .returning();

  await rebuildLinks(fungalNote.id, BIO_NOTE_FUNGAL_MD, userId);
  await rebuildLinks(ecoliNote.id, BIO_NOTE_ECOLI_MD, userId);

  // Root-folder image asset: "Context Matters" demo image.
  const IMG_FILE = "context-matters.jpeg";
  try {
    const imgBuf = await fs.readFile(path.join(process.cwd(), SEED_DIR, IMG_FILE));
    const [imgAsset] = await db
      .insert(assets)
      .values({
        libraryId: lib.id,
        userId,
        folderId: null,
        filename: IMG_FILE,
        mimeType: "image/jpeg",
        sizeBytes: imgBuf.byteLength,
      })
      .returning();
    await storage.uploadObject(assetSourceKey(imgAsset.id), imgBuf, "image/jpeg");
  } catch (err) {
    console.warn("seed: context-matters image asset failed", err);
  }
}
