import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { documentSegments, DocumentSegmentBbox, DocumentSegmentPayload, DocumentSegmentKind } from "../document-segments";

describe("documentSegments schema", () => {
  const config = getTableConfig(documentSegments);

  it("has correct table name", () => {
    expect(config.name).toBe("document_segments");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        "id",
        "document_id",
        "page",
        "kind",
        "bbox",
        "payload",
        "order_index",
        "created_at",
      ])
    );
  });

  it("id is serial primary key", () => {
    const col = config.columns.find((c) => c.name === "id");
    expect(col?.primary).toBe(true);
    expect(col?.columnType).toBe("PgSerial");
  });

  it("document_id is integer not null with FK to documents", () => {
    const col = config.columns.find((c) => c.name === "document_id");
    expect(col?.columnType).toBe("PgInteger");
    expect(col?.notNull).toBe(true);

    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "document_id"
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });

  it("page is integer not null", () => {
    const col = config.columns.find((c) => c.name === "page");
    expect(col?.columnType).toBe("PgInteger");
    expect(col?.notNull).toBe(true);
  });

  it("kind is text not null with TypeScript type narrowing", () => {
    const col = config.columns.find((c) => c.name === "kind");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
  });

  it("exports DocumentSegmentKind type", () => {
    const kind: DocumentSegmentKind = "paragraph";
    expect(kind).toBeDefined();
  });

  it("bbox is jsonb not null", () => {
    const col = config.columns.find((c) => c.name === "bbox");
    expect(col?.columnType).toBe("PgJsonb");
    expect(col?.notNull).toBe(true);
  });

  it("payload is jsonb not null", () => {
    const col = config.columns.find((c) => c.name === "payload");
    expect(col?.columnType).toBe("PgJsonb");
    expect(col?.notNull).toBe(true);
  });

  it("order_index is integer not null", () => {
    const col = config.columns.find((c) => c.name === "order_index");
    expect(col?.columnType).toBe("PgInteger");
    expect(col?.notNull).toBe(true);
  });

  it("created_at is timestamptz not null with default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col?.columnType).toBe("PgTimestamp");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it("has index on (document_id, page)", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "document_segments_document_page_idx"
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(cols).toEqual(["document_id", "page"]);
  });

  it("exports DocumentSegmentBbox type", () => {
    const bbox: DocumentSegmentBbox = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(bbox).toBeDefined();
  });

  it("exports DocumentSegmentPayload type", () => {
    const payload: DocumentSegmentPayload = { text: "test", heading_level: 1 };
    expect(payload).toBeDefined();
  });
});
