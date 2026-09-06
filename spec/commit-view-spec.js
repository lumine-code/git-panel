/** @babel */
/** @jsx React.createElement */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Disposable, TextBuffer } from "lumine";

import CommitView from "../lib/views/commit-view";

describe("the commit view controls", () => {
  let container, root, messageBuffer, tooltipManager, wasActEnvironment;

  beforeEach(() => {
    wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    messageBuffer = new TextBuffer();
    const disposable = () => ({ dispose() {} });
    tooltipManager = {
      add: jasmine.createSpy("add tooltip").and.callFake(disposable),
      addComposite: jasmine.createSpy("add composite tooltip").and.callFake(disposable),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    messageBuffer.destroy();
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  });

  it("overlays the character count immediately before the expand button", async () => {
    const config = {
      get: () => false,
      onDidChange: () => new Disposable(),
    };
    const currentBranch = {
      getName: () => "main",
      isDetached: () => false,
      isPresent: () => true,
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
          currentBranch={currentBranch}
          toggleExpandedCommitMessageEditor={() => {}}
          deactivateCommitBox={false}
          userStore={{}}
          selectedCoAuthors={[]}
          updateSelectedCoAuthors={() => {}}
        />,
      );
    });

    const editor = container.querySelector(".git-panel-CommitView-editor");
    const controls = editor.querySelector(".git-panel-CommitView-editorControls");
    const messageEditor = editor.querySelector("lumine-text-editor");
    const characterCount = controls.querySelector(".git-panel-CommitView-remaining-characters");
    const expandButton = controls.querySelector(".git-panel-CommitView-expandButton");
    const bar = container.querySelector(".git-panel-CommitView-bar");

    expect(messageEditor.classList).toContain("git-panel-CommitView-messageEditor");
    expect(characterCount.nextElementSibling).toBe(expandButton);
    expect(bar.querySelector(".git-panel-CommitView-remaining-characters")).toBeNull();
    expect(bar.lastElementChild).toBe(bar.querySelector(".git-panel-CommitView-commit"));
  });

  it("targets the message editor and commit button with their own context menus", () => {
    const menu = require("../menus/main.json")["context-menu"];
    expect(
      menu[".git-panel-CommitView-messageEditor"].map((item) => item.command).filter(Boolean),
    ).toEqual(["git-panel:toggle-expanded-commit-message-editor"]);
    expect(
      menu[".git-panel-CommitView-commit"].map((item) => item.command).filter(Boolean),
    ).toEqual(["git-panel:commit", "git-panel:amend-last-commit"]);
  });
});
