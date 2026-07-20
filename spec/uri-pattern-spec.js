/** @babel */
/* global describe, it, expect */
// The comprehensive URIPattern cases were converted from uri-pattern.test.js
// (node:test/node:assert → Jasmine) and merged here; both exercise the pure
// uri-pattern-core module.
import { URIPattern, nonURIMatch } from "../lib/atom/uri-pattern-core";

describe("URIPattern package adapter", () => {
  it("exposes the default matcher and named non-match export", () => {
    const match = new URIPattern("atom-github://file/{path...}?workdir={workdir}").matches(
      "atom-github://file/src/index.js?workdir=C%3A%5Cproject",
    );

    expect(match.ok()).toBe(true);
    expect(match.getParams()).toEqual({
      path: ["src", "index.js"],
      workdir: "C:\\project",
    });
    expect(nonURIMatch.ok()).toBe(false);
  });
});

describe("URIPattern", () => {
  it("matches exact URIs and optional trailing slashes", () => {
    const pattern = new URIPattern("atom-github://exact/match");

    expect(pattern.matches("atom-github://exact/match").ok()).toBe(true);
    expect(pattern.matches("atom-github://exact/match/").ok()).toBe(true);
    expect(pattern.matches("atom-github://exactbutnot").ok()).toBe(false);
    expect(pattern.matches("atom-github://exact").ok()).toBe(false);
    expect(pattern.matches("https://exact/match").ok()).toBe(false);
    expect(pattern.matches("atom-github://exact/match?no=no").ok()).toBe(false);
    expect(pattern.matches(undefined).ok()).toBe(false);
    expect(pattern.matches(null).ok()).toBe(false);
  });

  it("matches exact authentication, hashes, and dashed hostnames", () => {
    const authenticated = new URIPattern("proto://user:pass@host/some/path");
    expect(authenticated.matches("proto://user:pass@host/some/path").ok()).toBe(true);
    expect(authenticated.matches("proto://other:pass@host/some/path").ok()).toBe(false);
    expect(authenticated.matches("proto://user:wrong@host/some/path").ok()).toBe(false);

    const hashed = new URIPattern("proto://host/foo#exact");
    expect(hashed.matches("proto://host/foo#exact").ok()).toBe(true);
    expect(hashed.matches("proto://host/foo#nope").ok()).toBe(false);
    expect(
      new URIPattern("atom-github://with-many-dashes")
        .matches("atom-github://with-many-dashes")
        .ok(),
    ).toBe(true);
  });

  it("captures protocol, authentication, and hostname placeholders", () => {
    expect(
      new URIPattern("{proto}://host/some/path").matches("something://host/some/path").getParams(),
    ).toEqual({ proto: "something" });
    expect(
      new URIPattern("proto://{user}@host/some/path")
        .matches("proto://me@host/some/path")
        .getParams(),
    ).toEqual({ user: "me" });
    expect(
      new URIPattern("proto://me:{password}@host/some/path")
        .matches("proto://me:swordfish@host/some/path")
        .getParams(),
    ).toEqual({ password: "swordfish" });
    expect(
      new URIPattern("proto://{host}:8080/some/path")
        .matches("proto://Somewhere.COM:8080/some/path")
        .getParams(),
    ).toEqual({ host: "somewhere.com" });
  });

  it("captures path segments and splats", () => {
    const segment = new URIPattern("atom-github://base/exact/{id}");
    expect(segment.matches("atom-github://base/exact/0").getParams()).toEqual({ id: "0" });
    expect(segment.matches("atom-github://base/exact/").ok()).toBe(false);
    expect(segment.matches("atom-github://base/exact/0/more").ok()).toBe(false);

    const splat = new URIPattern("proto://host/root/{rest...}");
    expect(splat.matches("proto://host/root").getParams()).toEqual({ rest: [] });
    expect(splat.matches("proto://host/root/a").getParams()).toEqual({ rest: ["a"] });
    expect(splat.matches("proto://host/root/a/b/c").getParams()).toEqual({
      rest: ["a", "b", "c"],
    });
  });

  it("matches query placeholders independent of order", () => {
    const pattern = new URIPattern("proto://host?p0={zero}&p1={one}");
    expect(pattern.matches("proto://host?p0=aaa&p1=bbb").getParams()).toEqual({
      zero: "aaa",
      one: "bbb",
    });
    expect(pattern.matches("proto://host?p1=no&p0=yes").getParams()).toEqual({
      zero: "yes",
      one: "no",
    });
    expect(pattern.matches("proto://host?p0=&p1=").getParams()).toEqual({
      zero: "",
      one: "",
    });
    expect(pattern.matches("proto://host?p0=no").ok()).toBe(false);
  });

  it("distinguishes single and repeated query placeholders", () => {
    const single = new URIPattern("proto://host?p={single}");
    expect(single.matches("proto://host?p=0&p=1&p=2").ok()).toBe(false);

    const splat = new URIPattern("proto://host?ps={multi...}");
    expect(splat.matches("proto://host").getParams()).toEqual({ multi: [] });
    expect(splat.matches("proto://host?ps=0").getParams()).toEqual({ multi: ["0"] });
    expect(splat.matches("proto://host?ps=0&ps=1&ps=2").getParams()).toEqual({
      multi: ["0", "1", "2"],
    });
  });

  it("captures hashes, decodes values, and ignores unnamed captures", () => {
    expect(
      new URIPattern("proto://host/root#{hash}").matches("proto://host/root#value").getParams(),
    ).toEqual({ hash: "value" });

    const decoded = new URIPattern("proto://host/root/{child}?q={search}").matches(
      "proto://host/root/hooray%3E%20for%3C%20encodings?q=%3F%26%3F!",
    );
    expect(decoded.getParams()).toEqual({
      child: "hooray> for< encodings",
      search: "?&?!",
    });

    const unnamed = new URIPattern("proto://host/root/{}?q={}#{}").matches(
      "proto://host/root/anything?q=at#all",
    );
    expect(unnamed.getParams()).toEqual({});
  });

  it("returns a non-match for invalid URI input", () => {
    const pattern = new URIPattern("proto://host/{capture}");

    expect(pattern.matches("not a URI").ok()).toBe(false);
    expect(pattern.matches("proto://host/%E0%A4%A").ok()).toBe(false);
  });

  it("preserves pattern and match metadata", () => {
    const pattern = new URIPattern("proto://host/{capture0}/{capture1}");
    const uri = "proto://host/first/and%20escaped";
    const match = pattern.matches(uri);

    expect(pattern.getOriginal()).toBe("proto://host/{capture0}/{capture1}");
    expect(pattern.toString()).toBe("<URIPattern proto://host/{capture0}/{capture1}>");
    expect(match.getURI()).toBe(uri);
    expect(match.getParams()).toEqual({ capture0: "first", capture1: "and escaped" });
    expect(match.toString()).toBe('<URIMatch ok capture0="first" capture1="and escaped">');
    expect(nonURIMatch.toString()).toBe("<nonURIMatch>");
    expect(nonURIMatch.getURI()).toBeUndefined();
    expect(nonURIMatch.getParams()).toEqual({});
  });
});
