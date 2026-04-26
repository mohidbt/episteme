import { describe, expect, it } from "vitest";
import { Hocuspocus } from "@hocuspocus/server";

describe("Hocuspocus constructor", () => {
  it("instantiates without throwing", () => {
    expect(() => new Hocuspocus({ port: 0, extensions: [] })).not.toThrow();
  });
});
