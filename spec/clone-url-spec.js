/** @babel */
/* global describe, it, expect */
// Converted from clone-url.test.js (node:test/node:assert → Jasmine).
import { getRepositoryName } from "../lib/clone-url";

describe("getRepositoryName", () => {
  it("extracts repository names from absolute URLs", () => {
    expect(getRepositoryName("https://github.com/lumine-code/git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("ssh://git@github.com/lumine-code/git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("git://github.com/lumine-code/git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("https://github.com/lumine-code/git-panel.git?ref=main#readme")).toBe(
      "git-panel",
    );
  });

  it("supports SCP-style Git sources", () => {
    expect(getRepositoryName("git@github.com:lumine-code/git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("git@github.com:git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("github.com:lumine-code/git-panel.git")).toBe("git-panel");
  });

  it("supports local and relative repository paths", () => {
    expect(getRepositoryName("../projects/git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("C:\\projects\\git-panel.git")).toBe("git-panel");
    expect(getRepositoryName("/projects/git-panel")).toBe("git-panel");
  });

  it("returns an empty name when the source has no repository path", () => {
    expect(getRepositoryName("https://github.com")).toBe("");
    expect(getRepositoryName("")).toBe("");
  });
});
