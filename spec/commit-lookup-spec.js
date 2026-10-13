/** @babel */

import { nullCommit } from "../lib/models/commit.js";
import Present from "../lib/models/repository-states/present.js";
import { openCommitDetailItem } from "../lib/views/open-commit-dialog.js";

describe("commit lookup", () => {
  it("represents an unknown revision as an absent commit", async () => {
    const state = Object.create(Present.prototype);
    state.cache = { getOrSet: (_key, load) => load() };
    state.git = () => ({ getCommits: () => Promise.resolve([]) });

    expect(await state.getCommit("missing")).toBe(nullCommit);
  });

  it("rejects an unknown revision before opening a commit item", async () => {
    const repository = {
      getCommit: () => Promise.resolve(nullCommit),
    };
    const workspace = { open: jasmine.createSpy("open") };
    let error = null;

    try {
      await openCommitDetailItem("missing", { workspace, repository });
    } catch (caught) {
      error = caught;
    }

    expect(error?.userMessage).toBe("There is no commit associated with that reference.");
    expect(workspace.open).not.toHaveBeenCalled();
  });
});
