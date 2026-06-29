import { describe, expect, it } from "vitest";
import { decideHostRewrite } from "./proxy-host";
import { RESERVED } from "./reserved-usernames";

describe("decideHostRewrite", () => {
  it("rewrites <sub>.epistaime.com/hello → /pub/<sub>/hello", () => {
    const d = decideHostRewrite({
      host: "mohid.epistaime.com",
      pathname: "/hello",
      publishDomain: "epistaime.com",
    });
    expect(d).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/hello",
    });
  });

  it("redirects apex non-root paths to the app subdomain", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/n/abc",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });

  it("redirects www non-root paths to the app subdomain", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });

  it("passes through app", () => {
    expect(
      decideHostRewrite({
        host: "app.epistaime.com",
        pathname: "/n/abc",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through reserved subdomains", () => {
    for (const name of RESERVED) {
      // www is the bare-domain alias (serves landing at "/" and redirects
      // every other path to the app subdomain); it has dedicated coverage.
      if (name === "www") continue;
      expect(
        decideHostRewrite({
          host: `${name}.epistaime.com`,
          pathname: "/hello",
          publishDomain: "epistaime.com",
        }),
      ).toEqual({ kind: "passthrough" });
    }
  });

  it("passes through unrelated hosts", () => {
    expect(
      decideHostRewrite({
        host: "random.example.com",
        pathname: "/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("respects port in publishDomain (local dev)", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.local:3001",
        pathname: "/hello",
        publishDomain: "epistaime.local:3001",
      }),
    ).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/hello",
    });
  });

  it("path at root maps to /pub/<sub>/", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({
      kind: "rewrite",
      subdomain: "mohid",
      targetPath: "/pub/mohid/",
    });
  });

  it("passes through when path already starts with /pub/", () => {
    expect(
      decideHostRewrite({
        host: "mohid.epistaime.com",
        pathname: "/pub/mohid/hello",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  // ── GSD-137: marketing landing host-split ──────────────────────
  it("rewrites bare publish domain '/' → /landing", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "rewrite", subdomain: null, targetPath: "/landing" });
  });

  it("rewrites www '/' → /landing", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "rewrite", subdomain: null, targetPath: "/landing" });
  });

  it("redirects bare domain paths other than '/' to app subdomain (e.g. /sign-up)", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/sign-up",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/sign-in",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });

  it("redirects deep bare domain paths to app subdomain", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/anything/deep",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });

  it("redirects www paths other than '/' to app subdomain", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/sign-up",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });

  it("passes through bare domain /pub/* (does not redirect)", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/pub/alice/note",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through bare domain SEO/metadata files (does not redirect)", () => {
    for (const pathname of ["/robots.txt", "/sitemap.xml", "/icon.svg", "/favicon.ico"]) {
      expect(
        decideHostRewrite({
          host: "epistaime.com",
          pathname,
          publishDomain: "epistaime.com",
        }),
      ).toEqual({ kind: "passthrough" });
    }
  });

  it("passes through www SEO/metadata files (does not redirect)", () => {
    expect(
      decideHostRewrite({
        host: "www.epistaime.com",
        pathname: "/robots.txt",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("passes through app host '/' (app stays at Drive root)", () => {
    expect(
      decideHostRewrite({
        host: "app.epistaime.com",
        pathname: "/",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "passthrough" });
  });

  it("redirects bare domain '/landing' to the app subdomain", () => {
    expect(
      decideHostRewrite({
        host: "epistaime.com",
        pathname: "/landing",
        publishDomain: "epistaime.com",
      }),
    ).toEqual({ kind: "redirect", targetHost: "app.epistaime.com" });
  });
});
