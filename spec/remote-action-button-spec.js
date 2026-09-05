/** @babel */
/** @jsx React.createElement */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Disposable, TextBuffer } from "lumine";

import RemoteActionButton, { remoteActionState } from "../lib/views/remote-action-button";
import { fetchRepository, pullRepository, pushRepository } from "../lib/remote-actions";
import CommitView from "../lib/views/commit-view";

function branch({ detached = false, name = "main" } = {}) {
  return {
    getName: () => name,
    getRefSpec: (direction) => `refs/${direction.toLowerCase()}`,
    getUpstream: () => ({
      getRemoteName: () => "origin",
      getRemoteRef: () => "refs/remotes/origin/main",
    }),
    isDetached: () => detached,
    isPresent: () => true,
  };
}

function remote(present = true) {
  return { isPresent: () => present };
}

function state(overrides = {}) {
  return remoteActionState({
    aheadCount: 0,
    behindCount: 0,
    currentBranch: branch(),
    currentRemote: remote(),
    originExists: true,
    ...overrides,
  });
}

describe("the remote action button state", () => {
  it("covers every idle repository state", () => {
    expect(state()).toEqual(jasmine.objectContaining({ action: "fetch", text: "Fetch" }));
    expect(state({ aheadCount: 2 })).toEqual(
      jasmine.objectContaining({ action: "push", text: "Push 2" }),
    );
    expect(state({ behindCount: 3 })).toEqual(
      jasmine.objectContaining({ action: "pull", text: "Pull 3" }),
    );
    expect(state({ aheadCount: 2, behindCount: 3 })).toEqual(
      jasmine.objectContaining({
        action: "pull-or-force-push",
        secondaryText: "2",
        text: "Pull 3",
      }),
    );
    expect(state({ currentRemote: remote(false) })).toEqual(
      jasmine.objectContaining({ action: "publish", text: "Publish" }),
    );
    expect(state({ currentRemote: remote(false), originExists: false })).toEqual(
      jasmine.objectContaining({ disabled: true, text: "No remote" }),
    );
    expect(state({ currentBranch: branch({ detached: true }) })).toEqual(
      jasmine.objectContaining({ disabled: true, text: "Not on branch" }),
    );
  });

  it("gives in-progress operations precedence and disables the button", () => {
    expect(state({ isFetching: true, aheadCount: 2 })).toEqual(
      jasmine.objectContaining({ disabled: true, text: "Fetching", iconAnimation: "rotate" }),
    );
    expect(state({ isPulling: true })).toEqual(
      jasmine.objectContaining({ disabled: true, text: "Pulling", iconAnimation: "down" }),
    );
    expect(state({ isPushing: true })).toEqual(
      jasmine.objectContaining({ disabled: true, text: "Pushing", iconAnimation: "up" }),
    );
  });
});

describe("the remote action button", () => {
  let container, root, view, repository, tooltipManager, wasActEnvironment;

  beforeEach(() => {
    wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    repository = {
      fetch: jasmine.createSpy("fetch").and.resolveTo(),
      getCurrentBranch: jasmine.createSpy("getCurrentBranch").and.resolveTo(branch()),
      getRemoteForBranch: jasmine.createSpy("getRemoteForBranch").and.resolveTo(remote()),
      pull: jasmine.createSpy("pull").and.resolveTo(),
      push: jasmine.createSpy("push").and.resolveTo(),
    };
    const disposable = () => ({ dispose() {} });
    tooltipManager = {
      add: jasmine.createSpy("add tooltip").and.callFake(disposable),
      addComposite: jasmine.createSpy("add composite tooltip").and.callFake(disposable),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  });

  async function render(overrides = {}) {
    await act(async () => {
      root.render(
        <RemoteActionButton
          ref={(component) => {
            view = component;
          }}
          repository={repository}
          currentBranch={branch()}
          currentRemote={remote()}
          aheadCount={2}
          behindCount={0}
          originExists={true}
          tooltipManager={tooltipManager}
          {...overrides}
        />,
      );
    });
  }

  it("renders a regular button and force-pushes on Ctrl/Cmd-click", async () => {
    await render();

    const buttonElement = container.querySelector(".git-panel-RemoteActionButton");
    expect(buttonElement.tagName.toLowerCase()).toBe("button");
    expect(buttonElement.textContent).toBe("Push 2");

    await view.handleClick({ ctrlKey: true, metaKey: false });
    expect(repository.push).toHaveBeenCalledWith("main", {
      force: true,
      setUpstream: false,
      refSpec: "refs/push",
    });
  });

  it("dispatches the primary Fetch, Pull, Push, and Publish actions", async () => {
    const click = () => view.handleClick({ ctrlKey: false, metaKey: false });

    await render({ aheadCount: 0 });
    await click();
    expect(repository.fetch).toHaveBeenCalled();

    await render({ aheadCount: 0, behindCount: 2 });
    await click();
    expect(repository.pull).toHaveBeenCalled();

    await render();
    await click();
    expect(repository.push).toHaveBeenCalledWith("main", {
      force: false,
      setUpstream: false,
      refSpec: "refs/push",
    });

    await render({ aheadCount: 0, currentRemote: remote(false) });
    await click();
    expect(repository.push.calls.mostRecent().args[1]).toEqual({
      force: false,
      setUpstream: true,
      refSpec: "refs/push",
    });
  });

  it("disables the action while the repository is switching", async () => {
    await render({ disabled: true });
    expect(container.querySelector("button").disabled).toBe(true);

    await view.handleClick({ ctrlKey: false, metaKey: false });
    expect(repository.push).not.toHaveBeenCalled();
  });

  it("sits after the character count at the right edge of the commit bar", async () => {
    const messageBuffer = new TextBuffer();
    const config = {
      get: () => false,
      onDidChange: () => new Disposable(),
    };

    await act(async () => {
      root.render(
        <CommitView
          workspace={lumine.workspace}
          commands={lumine.commands}
          tooltips={tooltipManager}
          config={config}
          stagedChangesExist={false}
          mergeConflictsExist={false}
          prepareToCommit={() => Promise.resolve(true)}
          commit={() => Promise.resolve()}
          abortMerge={() => {}}
          maximumCharacterLimit={72}
          messageBuffer={messageBuffer}
          isMerging={false}
          isCommitting={false}
          lastCommit={{ isPresent: () => true }}
          currentBranch={branch()}
          currentRemote={remote()}
          aheadCount={0}
          behindCount={0}
          originExists={true}
          isFetching={false}
          isPulling={false}
          isPushing={false}
          isSwitchingRepository={false}
          repository={repository}
          toggleExpandedCommitMessageEditor={() => {}}
          deactivateCommitBox={false}
          userStore={{}}
          selectedCoAuthors={[]}
          updateSelectedCoAuthors={() => {}}
        />,
      );
    });

    const bar = container.querySelector(".git-panel-CommitView-bar");
    const characterCount = bar.querySelector(".git-panel-CommitView-remaining-characters");
    const actionButton = bar.querySelector(".git-panel-RemoteActionButton");
    expect(actionButton.tagName.toLowerCase()).toBe("button");
    expect(characterCount.nextElementSibling).toBe(actionButton);
    expect(bar.lastElementChild).toBe(actionButton);

    messageBuffer.destroy();
  });
});

describe("remote action commands", () => {
  it("resolve the current branch every time they are dispatched", async () => {
    const first = branch({ name: "first" });
    const second = branch({ name: "second" });
    const repository = {
      fetch: jasmine.createSpy("fetch").and.resolveTo(),
      getCurrentBranch: jasmine
        .createSpy("getCurrentBranch")
        .and.returnValues(Promise.resolve(first), Promise.resolve(second), Promise.resolve(first)),
      getRemoteForBranch: jasmine.createSpy("getRemoteForBranch").and.resolveTo(remote()),
      pull: jasmine.createSpy("pull").and.resolveTo(),
      push: jasmine.createSpy("push").and.resolveTo(),
    };

    await pushRepository(repository);
    await pullRepository(repository);
    await fetchRepository(repository);

    expect(repository.push.calls.mostRecent().args[0]).toBe("first");
    expect(repository.pull.calls.mostRecent().args[0]).toBe("second");
    expect(repository.fetch).toHaveBeenCalledWith("refs/remotes/origin/main", {
      remoteName: "origin",
    });
    expect(repository.getCurrentBranch).toHaveBeenCalledTimes(3);
  });
});

describe("the remote action context menu", () => {
  it("keeps every remote command on the moved button", () => {
    const menu = require("../menus/main.json")["context-menu"];
    expect(
      menu[".git-panel-RemoteActionButton"].map((item) => item.command).filter(Boolean),
    ).toEqual(["git-panel:fetch", "git-panel:pull", "git-panel:push", "git-panel:force-push"]);
  });
});
