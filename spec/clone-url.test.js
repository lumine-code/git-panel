const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { getRepositoryName } = require("../lib/clone-url");

describe("getRepositoryName", () => {
  it("extracts repository names from absolute URLs", () => {
    assert.equal(getRepositoryName("https://github.com/lumine-code/git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("ssh://git@github.com/lumine-code/git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("git://github.com/lumine-code/git-panel.git"), "git-panel");
    assert.equal(
      getRepositoryName("https://github.com/lumine-code/git-panel.git?ref=main#readme"),
      "git-panel",
    );
  });

  it("supports SCP-style Git sources", () => {
    assert.equal(getRepositoryName("git@github.com:lumine-code/git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("git@github.com:git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("github.com:lumine-code/git-panel.git"), "git-panel");
  });

  it("supports local and relative repository paths", () => {
    assert.equal(getRepositoryName("../projects/git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("C:\\projects\\git-panel.git"), "git-panel");
    assert.equal(getRepositoryName("/projects/git-panel"), "git-panel");
  });

  it("returns an empty name when the source has no repository path", () => {
    assert.equal(getRepositoryName("https://github.com"), "");
    assert.equal(getRepositoryName(""), "");
  });
});
