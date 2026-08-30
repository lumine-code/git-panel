/** @babel */

import CommitController from "../lib/controllers/commit-controller";

describe("CommitController existing editor activation", () => {
  it("routes the expanded commit editor through the workspace", async () => {
    const editor = { getPath: () => "COMMIT_EDITMSG" };
    const workspace = {
      open: jasmine.createSpy("open").and.returnValue(Promise.resolve(editor)),
    };
    const controller = Object.create(CommitController.prototype);
    controller.props = { workspace };
    controller.getCommitMessageEditors = () => [editor];

    await controller.activateCommitMessageEditor();

    expect(workspace.open).toHaveBeenCalledWith(editor, { searchAllPanes: true });
  });
});
