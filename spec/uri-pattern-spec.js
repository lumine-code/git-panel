/** @babel */
/* global describe, expect, it */

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
