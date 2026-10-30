/** @babel */
import path from "node:path";
import os from "node:os";
import { createViewModel } from "./helpers/etch.js";
import DialogsController, { dialogRequests } from "../lib/controllers/dialogs-controller.js";
import GitRootController from "../lib/controllers/git-root-controller.js";

describe("Git dialog request lifetime", () => {
  let dialogs, root;
  afterEach(async () => {
    await dialogs?.destroy();
    await root?.destroy();
  });

  it("prevents cancellation/replacement while opening and keeps a newer forced request intact", async () => {
    let finish;
    root = createViewModel(GitRootController, {
      repository: {
        isDestroyed: () => true,
        getWorkingDirectoryPath: () => path.join(os.tmpdir(), "git-dialog-request"),
        getCommit: async () => ({ isPresent: () => true }),
      },
      workspace: { open: () => new Promise((resolve) => (finish = resolve)) },
    });
    root.openCommitDialog();
    const first = root.state.dialogRequest;
    dialogs = createViewModel(DialogsController, { request: first });
    const wrapped = dialogs.getCommonProps().request;
    const pending = wrapped.accept("main");
    await globalThis.flushMicrotasks();
    expect(first.pending).toBe(true);
    wrapped.cancel();
    root.closeDialog();
    root.openCommitDialog();
    expect(root.state.dialogRequest).toBe(first);

    const replacement = dialogRequests.commit();
    root.updateState({ dialogRequest: replacement });
    dialogs.update({ request: replacement });
    finish({});
    await pending;
    expect(root.state.dialogRequest).toBe(replacement);
    expect(first.pending).toBe(false);
  });

  it("does not let a retired rejection clear another request's busy state or error", async () => {
    let rejectFirst, finishSecond;
    const first = dialogRequests.commit();
    first.onProgressingAccept(() => new Promise((_resolve, reject) => (rejectFirst = reject)));
    dialogs = createViewModel(DialogsController, { request: first });
    const pendingFirst = dialogs.getCommonProps().request.accept("first");
    const second = dialogRequests.commit();
    second.onProgressingAccept(() => new Promise((resolve) => (finishSecond = resolve)));
    dialogs.update({ request: second });
    const pendingSecond = dialogs.getCommonProps().request.accept("second");
    rejectFirst(new Error("Retired request failed"));
    await pendingFirst;
    expect(dialogs.getCommonProps().inProgress).toBe(true);
    expect(dialogs.getCommonProps().error).toBeNull();
    finishSecond();
    await pendingSecond;
    expect(dialogs.getCommonProps().inProgress).toBe(false);
  });
});
