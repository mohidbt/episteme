import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { documentReferences } from "../document-references";
import { libraryReferences } from "../library-references";
import { keptCitations } from "../kept-citations";
import { documentReferenceMarkers } from "../document-reference-markers";

describe("documentReferences schema", () => {
  const config = getTableConfig(documentReferences);

  it("has correct table name", () => {
    expect(config.name).toBe("document_references");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("document_id");
    expect(colNames).toContain("marker_text");
    expect(colNames).toContain("marker_index");
    expect(colNames).toContain("raw_text");
    expect(colNames).toContain("title");
    expect(colNames).toContain("authors");
    expect(colNames).toContain("year");
    expect(colNames).toContain("doi");
    expect(colNames).toContain("url");
    expect(colNames).toContain("semantic_scholar_id");
    expect(colNames).toContain("abstract");
    expect(colNames).toContain("venue");
    expect(colNames).toContain("citation_count");
    expect(colNames).toContain("page_number");
    expect(colNames).toContain("created_at");
  });

  it("id is primary key", () => {
    const idCol = config.columns.find((c) => c.name === "id");
    expect(idCol?.primary).toBe(true);
  });

  it("document_id is not null", () => {
    const col = config.columns.find((c) => c.name === "document_id");
    expect(col?.notNull).toBe(true);
  });

  it("marker_text is not null", () => {
    const col = config.columns.find((c) => c.name === "marker_text");
    expect(col?.notNull).toBe(true);
  });

  it("marker_index is not null", () => {
    const col = config.columns.find((c) => c.name === "marker_index");
    expect(col?.notNull).toBe(true);
  });

  it("created_at is not null with default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it("has index on document_id", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("document_references_document_id_idx");
  });

  it("document_id has foreign key to documents", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "document_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });
});

describe("libraryReferences schema", () => {
  const config = getTableConfig(libraryReferences);

  it("has correct table name", () => {
    expect(config.name).toBe("library_references");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("user_id");
    expect(colNames).toContain("title");
    expect(colNames).toContain("authors");
    expect(colNames).toContain("year");
    expect(colNames).toContain("doi");
    expect(colNames).toContain("url");
    expect(colNames).toContain("semantic_scholar_id");
    expect(colNames).toContain("abstract");
    expect(colNames).toContain("venue");
    expect(colNames).toContain("citation_count");
    expect(colNames).toContain("notes");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
  });

  it("id is primary key", () => {
    const idCol = config.columns.find((c) => c.name === "id");
    expect(idCol?.primary).toBe(true);
  });

  it("user_id is not null", () => {
    const col = config.columns.find((c) => c.name === "user_id");
    expect(col?.notNull).toBe(true);
  });

  it("title is not null", () => {
    const col = config.columns.find((c) => c.name === "title");
    expect(col?.notNull).toBe(true);
  });

  it("created_at and updated_at have defaults", () => {
    const createdAt = config.columns.find((c) => c.name === "created_at");
    const updatedAt = config.columns.find((c) => c.name === "updated_at");
    expect(createdAt?.hasDefault).toBe(true);
    expect(updatedAt?.hasDefault).toBe(true);
  });

  it("has index on user_id", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("library_references_user_id_idx");
  });

  it("has partial unique index on user_id + doi (race-free DOI dedup)", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("library_references_user_doi_unique_idx");
    const uniqueIdx = config.indexes.find(
      (i) => i.config.name === "library_references_user_doi_unique_idx"
    );
    expect(uniqueIdx?.config.unique).toBe(true);
  });

  it("user_id has foreign key to user", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "user_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });
});

describe("keptCitations schema", () => {
  const config = getTableConfig(keptCitations);

  it("has correct table name", () => {
    expect(config.name).toBe("kept_citations");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("user_id");
    expect(colNames).toContain("document_reference_id");
    expect(colNames).toContain("library_reference_id");
    expect(colNames).toContain("created_at");
  });

  it("id is primary key", () => {
    const idCol = config.columns.find((c) => c.name === "id");
    expect(idCol?.primary).toBe(true);
  });

  it("user_id is not null", () => {
    const col = config.columns.find((c) => c.name === "user_id");
    expect(col?.notNull).toBe(true);
  });

  it("document_reference_id is not null", () => {
    const col = config.columns.find((c) => c.name === "document_reference_id");
    expect(col?.notNull).toBe(true);
  });

  it("library_reference_id is nullable", () => {
    const col = config.columns.find((c) => c.name === "library_reference_id");
    expect(col?.notNull).toBe(false);
  });

  it("created_at has default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col?.hasDefault).toBe(true);
  });

  it("has index on user_id", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("kept_citations_user_id_idx");
  });

  it("has unique constraint on (user_id, document_reference_id)", () => {
    const uniqueConstraints = config.uniqueConstraints;
    const found = uniqueConstraints.find(
      (u) => u.name === "kept_citations_user_doc_ref_unique"
    );
    expect(found).toBeDefined();
    const colNames = found?.columns.map((c) => c.name) ?? [];
    expect(colNames).toContain("user_id");
    expect(colNames).toContain("document_reference_id");
  });

  it("user_id has foreign key to user", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "user_id"
    );
    expect(fk).toBeDefined();
  });

  it("document_reference_id has foreign key to document_references", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "document_reference_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });

  it("library_reference_id has foreign key to library_references", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "library_reference_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });
});

describe("documentReferenceMarkers schema", () => {
  const config = getTableConfig(documentReferenceMarkers);

  it("has correct table name", () => {
    expect(config.name).toBe("document_reference_markers");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("reference_id");
    expect(colNames).toContain("page_number");
    expect(colNames).toContain("x0");
    expect(colNames).toContain("y0");
    expect(colNames).toContain("x1");
    expect(colNames).toContain("y1");
    expect(colNames).toContain("created_at");
  });

  it("id is primary key", () => {
    const idCol = config.columns.find((c) => c.name === "id");
    expect(idCol?.primary).toBe(true);
  });

  it("reference_id is not null", () => {
    const col = config.columns.find((c) => c.name === "reference_id");
    expect(col?.notNull).toBe(true);
  });

  it("page_number is not null", () => {
    const col = config.columns.find((c) => c.name === "page_number");
    expect(col?.notNull).toBe(true);
  });

  it("coordinate columns are not null", () => {
    for (const name of ["x0", "y0", "x1", "y1"]) {
      const col = config.columns.find((c) => c.name === name);
      expect(col?.notNull, `${name} should be not null`).toBe(true);
    }
  });

  it("created_at is not null with default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it("has index on reference_id", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("document_reference_markers_reference_id_idx");
  });

  it("reference_id has foreign key to document_references with cascade on delete", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "reference_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
    expect(fk?.onDelete).toBe("cascade");
  });
});
