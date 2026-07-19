const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { URIPattern, nonURIMatch } = require("../lib/atom/uri-pattern-core");

describe("URIPattern", () => {
  it("matches exact URIs and optional trailing slashes", () => {
    const pattern = new URIPattern("atom-github://exact/match");

    assert.equal(pattern.matches("atom-github://exact/match").ok(), true);
    assert.equal(pattern.matches("atom-github://exact/match/").ok(), true);
    assert.equal(pattern.matches("atom-github://exactbutnot").ok(), false);
    assert.equal(pattern.matches("atom-github://exact").ok(), false);
    assert.equal(pattern.matches("https://exact/match").ok(), false);
    assert.equal(pattern.matches("atom-github://exact/match?no=no").ok(), false);
    assert.equal(pattern.matches(undefined).ok(), false);
    assert.equal(pattern.matches(null).ok(), false);
  });

  it("matches exact authentication, hashes, and dashed hostnames", () => {
    const authenticated = new URIPattern("proto://user:pass@host/some/path");
    assert.equal(authenticated.matches("proto://user:pass@host/some/path").ok(), true);
    assert.equal(authenticated.matches("proto://other:pass@host/some/path").ok(), false);
    assert.equal(authenticated.matches("proto://user:wrong@host/some/path").ok(), false);

    const hashed = new URIPattern("proto://host/foo#exact");
    assert.equal(hashed.matches("proto://host/foo#exact").ok(), true);
    assert.equal(hashed.matches("proto://host/foo#nope").ok(), false);
    assert.equal(
      new URIPattern("atom-github://with-many-dashes")
        .matches("atom-github://with-many-dashes")
        .ok(),
      true,
    );
  });

  it("captures protocol, authentication, and hostname placeholders", () => {
    assert.deepEqual(
      new URIPattern("{proto}://host/some/path").matches("something://host/some/path").getParams(),
      { proto: "something" },
    );
    assert.deepEqual(
      new URIPattern("proto://{user}@host/some/path")
        .matches("proto://me@host/some/path")
        .getParams(),
      { user: "me" },
    );
    assert.deepEqual(
      new URIPattern("proto://me:{password}@host/some/path")
        .matches("proto://me:swordfish@host/some/path")
        .getParams(),
      { password: "swordfish" },
    );
    assert.deepEqual(
      new URIPattern("proto://{host}:8080/some/path")
        .matches("proto://Somewhere.COM:8080/some/path")
        .getParams(),
      { host: "somewhere.com" },
    );
  });

  it("captures path segments and splats", () => {
    const segment = new URIPattern("atom-github://base/exact/{id}");
    assert.deepEqual(segment.matches("atom-github://base/exact/0").getParams(), { id: "0" });
    assert.equal(segment.matches("atom-github://base/exact/").ok(), false);
    assert.equal(segment.matches("atom-github://base/exact/0/more").ok(), false);

    const splat = new URIPattern("proto://host/root/{rest...}");
    assert.deepEqual(splat.matches("proto://host/root").getParams(), { rest: [] });
    assert.deepEqual(splat.matches("proto://host/root/a").getParams(), { rest: ["a"] });
    assert.deepEqual(splat.matches("proto://host/root/a/b/c").getParams(), {
      rest: ["a", "b", "c"],
    });
  });

  it("matches query placeholders independent of order", () => {
    const pattern = new URIPattern("proto://host?p0={zero}&p1={one}");
    assert.deepEqual(pattern.matches("proto://host?p0=aaa&p1=bbb").getParams(), {
      zero: "aaa",
      one: "bbb",
    });
    assert.deepEqual(pattern.matches("proto://host?p1=no&p0=yes").getParams(), {
      zero: "yes",
      one: "no",
    });
    assert.deepEqual(pattern.matches("proto://host?p0=&p1=").getParams(), {
      zero: "",
      one: "",
    });
    assert.equal(pattern.matches("proto://host?p0=no").ok(), false);
  });

  it("distinguishes single and repeated query placeholders", () => {
    const single = new URIPattern("proto://host?p={single}");
    assert.equal(single.matches("proto://host?p=0&p=1&p=2").ok(), false);

    const splat = new URIPattern("proto://host?ps={multi...}");
    assert.deepEqual(splat.matches("proto://host").getParams(), { multi: [] });
    assert.deepEqual(splat.matches("proto://host?ps=0").getParams(), { multi: ["0"] });
    assert.deepEqual(splat.matches("proto://host?ps=0&ps=1&ps=2").getParams(), {
      multi: ["0", "1", "2"],
    });
  });

  it("captures hashes, decodes values, and ignores unnamed captures", () => {
    assert.deepEqual(
      new URIPattern("proto://host/root#{hash}").matches("proto://host/root#value").getParams(),
      { hash: "value" },
    );

    const decoded = new URIPattern("proto://host/root/{child}?q={search}").matches(
      "proto://host/root/hooray%3E%20for%3C%20encodings?q=%3F%26%3F!",
    );
    assert.deepEqual(decoded.getParams(), {
      child: "hooray> for< encodings",
      search: "?&?!",
    });

    const unnamed = new URIPattern("proto://host/root/{}?q={}#{}").matches(
      "proto://host/root/anything?q=at#all",
    );
    assert.deepEqual(unnamed.getParams(), {});
  });

  it("returns a non-match for invalid URI input", () => {
    const pattern = new URIPattern("proto://host/{capture}");

    assert.equal(pattern.matches("not a URI").ok(), false);
    assert.equal(pattern.matches("proto://host/%E0%A4%A").ok(), false);
  });

  it("preserves pattern and match metadata", () => {
    const pattern = new URIPattern("proto://host/{capture0}/{capture1}");
    const uri = "proto://host/first/and%20escaped";
    const match = pattern.matches(uri);

    assert.equal(pattern.getOriginal(), "proto://host/{capture0}/{capture1}");
    assert.equal(pattern.toString(), "<URIPattern proto://host/{capture0}/{capture1}>");
    assert.equal(match.getURI(), uri);
    assert.deepEqual(match.getParams(), { capture0: "first", capture1: "and escaped" });
    assert.equal(match.toString(), '<URIMatch ok capture0="first" capture1="and escaped">');
    assert.equal(nonURIMatch.toString(), "<nonURIMatch>");
    assert.equal(nonURIMatch.getURI(), undefined);
    assert.deepEqual(nonURIMatch.getParams(), {});
  });
});
