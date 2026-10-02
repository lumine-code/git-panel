/** @babel */
/** @jsx h */
import path from "path";

import { h, flushViews, createViewHost } from "./helpers/etch";
import { Disposable, TextBuffer } from "lumine";

import CommitView from "../lib/views/commit-view";

describe("the commit view controls", () => {
  let container, root, messageBuffer, tooltipManager, config, currentBranch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createViewHost(container);
    messageBuffer = new TextBuffer();
    const disposable = () => ({ dispose() {} });
    tooltipManager = {
      add: jasmine.createSpy("add tooltip").and.callFake(disposable),
      addComposite: jasmine.createSpy("add composite tooltip").and.callFake(disposable),
    };
    config = {
      get: () => false,
      onDidChange: () => new Disposable(),
    };
    currentBranch = {
      getName: () => "main",
      isDetached: () => false,
      isPresent: () => true,
    };
  });

  afterEach(async () => {
    await flushViews(async () => root.destroy());
    messageBuffer.destroy();
    container.remove();
  });

  async function renderCommitView() {
    await flushViews(async () => {
      root.update(
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
  }

  it("overlays the character count immediately before the expand button", async () => {
    await renderCommitView();

    const editor = container.querySelector(".git-panel-CommitView-editor");
    const controls = editor.querySelector(".git-panel-CommitView-editorControls");
    const messageEditor = editor.querySelector("lumine-text-editor");
    const characterCount = controls.querySelector(".git-panel-CommitView-remaining-characters");
    const expandButton = controls.querySelector(".git-panel-CommitView-expandButton");
    const bar = container.querySelector(".git-panel-CommitView-bar");

    expect(messageEditor.classList).toContain("git-panel-CommitView-messageEditor");
    expect(characterCount.nextElementSibling).toBe(expandButton);
    expect(bar.querySelector(".git-panel-CommitView-remaining-characters")).toBeNull();
    const visibleControls = [...bar.children].filter((element) => !element.hidden);
    expect(visibleControls.at(-1)).toBe(bar.querySelector(".git-panel-CommitView-commit"));
  });

  it("does not scroll an empty commit editor past the end", async () => {
    const previousScrollPastEnd = lumine.config.get("editor.scrollPastEnd");
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "main.css"),
    );
    container.style.width = "400px";
    container.style.setProperty("--editor-line-height", "24px");

    try {
      lumine.config.set("editor.scrollPastEnd", true);
      await renderCommitView();

      const messageEditor = container.querySelector(".git-panel-CommitView-messageEditor");
      const editorComponent = messageEditor.getComponent();
      const verticalScrollbar = messageEditor.querySelector(".vertical-scrollbar");
      await globalThis.waitForFrames(() => editorComponent.hasInitialMeasurements, {
        description: "commit editor measurements",
      });

      expect(messageEditor.getModel().getScrollPastEnd()).toBe(false);
      expect(messageEditor.getMaxScrollTop()).toBe(0);
      expect(editorComponent.canScrollVertically()).toBe(false);
      expect(verticalScrollbar.style.visibility).toBe("hidden");
    } finally {
      lumine.config.set("editor.scrollPastEnd", previousScrollPastEnd);
      await globalThis.flushMicrotasks();
      stylesheet.dispose();
    }
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
