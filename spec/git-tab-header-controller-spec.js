/** @babel */

import GitTabHeaderController from "../lib/controllers/git-tab-header-controller";
import Author, { nullAuthor } from "../lib/models/author";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function repositoryUnavailable() {
  const error = new Error(
    "Git repository is unavailable during history: working-directory-missing",
  );
  error.code = "ERR_GIT_REPOSITORY_UNAVAILABLE";
  return error;
}

describe("GitTabHeaderController committer refresh", () => {
  let controller;
  let previousAuthor;

  beforeEach(() => {
    previousAuthor = new Author("previous@example.com", "Previous Author");
    controller = new GitTabHeaderController({ getCommitter: () => Promise.resolve(null) });
    controller._isMounted = true;
    controller.state.committer = previousAuthor;
    spyOn(controller, "setState").and.callFake((state) => {
      controller.state = { ...controller.state, ...state };
    });
    spyOn(console, "error");
  });

  afterEach(() => controller.componentWillUnmount());

  it("clears the avatar and handles a working directory disappearing during a refresh", async () => {
    controller.props.getCommitter = () => Promise.reject(repositoryUnavailable());

    await controller.updateCommitter();

    expect(controller.state.committer).toBe(nullAuthor);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("handles a background read aborted when its repository is destroyed", async () => {
    const error = new Error("The Git operation was aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    controller.props.getCommitter = () => Promise.reject(error);

    await controller.updateCommitter();

    expect(controller.state.committer).toBe(nullAuthor);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ignores an old repository read that completes after the replacement repository", async () => {
    const previous = deferred();
    const currentAuthor = new Author("current@example.com", "Current Author");
    controller.props.getCommitter = () => previous.promise;
    const previousRefresh = controller.updateCommitter();

    controller.props.getCommitter = () => Promise.resolve(currentAuthor);
    await controller.updateCommitter();
    previous.resolve(previousAuthor);
    await previousRefresh;

    expect(controller.state.committer).toBe(currentAuthor);
    expect(controller.setState).toHaveBeenCalledTimes(1);
  });

  it("does not clear a replacement avatar when the old repository read fails", async () => {
    const previous = deferred();
    const currentAuthor = new Author("current@example.com", "Current Author");
    controller.props.getCommitter = () => previous.promise;
    const previousRefresh = controller.updateCommitter();

    controller.props.getCommitter = () => Promise.resolve(currentAuthor);
    await controller.updateCommitter();
    previous.reject(repositoryUnavailable());
    await previousRefresh;

    expect(controller.state.committer).toBe(currentAuthor);
    expect(controller.setState).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reports an unexpected current error without rejecting its background refresh", async () => {
    const error = new Error("Git configuration could not be read");
    controller.props.getCommitter = () => {
      throw error;
    };

    await controller.updateCommitter();

    expect(console.error).toHaveBeenCalledWith("Unable to refresh Git committer", error);
    expect(controller.state.committer).toBe(previousAuthor);
  });

  it("does not update or report errors after unmounting", async () => {
    const read = deferred();
    controller.props.getCommitter = () => read.promise;
    const refresh = controller.updateCommitter();
    controller.componentWillUnmount();
    read.reject(new Error("Old repository failed"));

    await refresh;

    expect(controller.setState).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
